import type {App} from '../app.js'
import type {HaRecovery} from './ha-recovery.js'
import {EngineTransport} from './engine.js'
import {getChannel} from '../db/repo.js'
import {buildView,type RundownView} from './plan.js'
import {assertHaExecutionAdmission,type HaExecutionAdmission} from './ha-execution-admission.js'
import {ENGINE_BINARY} from '../config.js'
import type {HaLeaseClient} from './ha-witness.js'
import {prepareHaNativeGraphics} from './ha-native-graphics.js'
import {AsRun} from './asrun.js'
import type {NativeProgramAdmission} from './native-program-admission.js'
import {operatorDecisions} from '../db/schema.js'
import {randomUUID} from 'node:crypto'
import {Checkpoints} from './checkpoints.js'

type Candidate=Awaited<ReturnType<HaRecovery['activationCandidate']>>
export interface HaHeldDecoder {
  readonly transport:EngineTransport
  readonly revisionId:string|null
  prepare():Promise<{itemId:string|null;decoderId:number|null;firstVideoConfirmed:boolean}>
  stop():Promise<{ownedNativeProcessesStopped:boolean}>
}
export interface HaFencedDecoder extends HaHeldDecoder {
  prepareGraphics():ReturnType<typeof prepareHaNativeGraphics>
  startGraphicMaintenance():Promise<void>
  beginProgramAccounting(proof:NativeProgramAdmission):Promise<void>
  releasePreview():Promise<void>
  controlState():{revisionId:string|null;cuedItemId:string|null;items:Array<{id:string;title:string}>}
  cue(itemId:string,authorize:()=>Promise<void>,requestId:string):ReturnType<EngineTransport['cueAdmitted']>
  takeCued(itemId:string,authorize:()=>Promise<void>,requestId:string):ReturnType<EngineTransport['takeCuedAdmitted']>
  /** Internal PGM only; output release remains owned by the orchestrator. */
  resumeProgram():Promise<void>
}
/** Real owned decoder warmup, NOT publication. No witness grant, configured
 * destination, preview, graphics replay, checkpoint or imported as-run. */
export async function createHaHeldDecoder(candidate:Candidate,app:App,admission:HaExecutionAdmission,authorize:()=>Promise<void>,signal:AbortSignal):Promise<HaHeldDecoder>{
  return createDecoder(candidate,app,admission,authorize,signal,null)
}
/** Called only AFTER transfer/current assignment and confirmed warmup stop.
 * Returns a tracked handle before LOAD/TAKE; caller must stop it on all errors.
 * Preview is deliberately not opened before final publication admission. */
export async function createHaFencedDecoder(candidate:Candidate,app:App,admission:HaExecutionAdmission,witness:HaLeaseClient,assertAdmission:()=>Promise<void>,signal:AbortSignal,assertLeaseAdmission:()=>Promise<void>):Promise<HaFencedDecoder>{
  return createDecoder(candidate,app,admission,assertAdmission,signal,witness,assertLeaseAdmission)
}
async function createDecoder(candidate:Candidate,app:App,admission:HaExecutionAdmission,authorize:()=>Promise<void>,signal:AbortSignal,witness:HaLeaseClient|null,assertLeaseAdmission:(()=>Promise<void>)|null=null):Promise<HaFencedDecoder>{
  assertHaExecutionAdmission(admission);admission.assertHeld()
  if(app.haExecutionAdmission!==admission||!ENGINE_BINARY)throw new Error('Preparo HA exige backend copiado admitido e engine nativo da instalação.')
  const current=async()=>{
    if(signal.aborted)throw new Error('Decoder HA cancelado.')
    admission.assertHeld();await authorize()
    // Fenced factory's authorize is the orchestrator's full assertAdmission,
    // already including candidate proof. Warmup has only local authorization.
    if(!witness)await candidate.verifyCurrent()
    admission.assertHeld()
  }
  await current()
  const state=candidate.candidate,saved=state.nativeCursor,revisionId=saved?.revisionId??state.localExecutionRevisionId??null
  const edition=state.revisions.find(row=>row.localRevisionId===revisionId)
  if(revisionId&&!edition)throw new Error('Edição exata do decoder HA não está preparada.')
  const channel=await getChannel(app.db,state.channel.id,true)
  if(!channel||!channel.archivedAt)throw new Error('Canal HA deve continuar arquivado no preparo.')
  const assets=new Map((edition?.payload.assets??[]).map(asset=>[asset.id,asset]))
  const view:RundownView|null=edition?{...buildView(edition.payload.rundown,channel,edition.payload.items,assets,null,null),schedule:edition.payload.schedule}:null
  const lease=await app.executionOwnership.claimWhenReady(channel.id)
  await current();lease.assertOwned()
  const asRun=witness?new AsRun(app.db,channel,'NATIVE',lease):null
  const checkpoints=witness?new Checkpoints(app.sqlite,lease):null
  let localExecutionId=randomUUID(),accountedDecoder:{itemId:string;decoderId:number}|null=null
  let checkpointTimer:ReturnType<typeof setInterval>|null=null
  let confirmedGraphicReceipt:(()=>string|null)|null=null
  let accountingStarted=false,accountingStart:Promise<void>|null=null,accountingWork:Promise<void>=Promise.resolve(),accountingFailure=false
  const account=(work:()=>Promise<void>)=>{
    accountingWork=accountingWork.then(async()=>{
      if(accountingFailure)return
      admission.assertHeld();lease.assertOwned()
      await work()
    }).catch(()=>{accountingFailure=true;transport.close()})
  }
  const writeCheckpoint=(initial?:NativeProgramAdmission)=>{
    if(!checkpoints||accountingFailure)return
    admission.assertHeld();lease.assertOwned()
    if(!transport.fenceBinding()||!transport.health().ready||transport.health().programAdmission.held)throw new Error('Checkpoint HA exige PGM liberado da geração própria.')
    const runtime=transport.state(),decoder=transport.programDecoderBinding()
    if(runtime.onAir&&(!accountedDecoder||!decoder||accountedDecoder.itemId!==decoder.itemId||accountedDecoder.decoderId!==decoder.decoderId))return
    const position=initial?.itemId!==null&&initial?{itemId:initial.itemId,decoderId:initial.decoderId,frames:initial.elapsed}:transport.programPositionEvidence()
    if(runtime.onAir&&(!position||!decoder||position.itemId!==decoder.itemId||position.decoderId!==decoder.decoderId))return
    const frames=runtime.onAir?position!.frames:0,trim=runtime.playing?runtime.programTrim??undefined:undefined
    // EOS may briefly report the terminal frame outside the reproducible cut.
    // Preserve last valid cursor until native clear/new decoder, never clamp.
    if(trim&&frames>=trim.out-trim.in)return
    const graphicReceiptId=confirmedGraphicReceipt?.()
    if(!graphicReceiptId)throw new Error('Checkpoint HA sem composição local confirmada.')
    checkpoints.write({version:1,channelId:channel.id,rundownId:view?.rundown.id??null,revisionId,itemId:runtime.onAir?.itemId??null,elapsed:frames,playing:runtime.playing,realEngine:true,programTrim:trim,rate:channel.rate,audioChannels:channel.audioChannels??2,executionId:localExecutionId,graphicReceiptId})
  }
  const transport=new EngineTransport(channel,()=>view,id=>assets.get(id)??null,{
    binary:ENGINE_BINARY,outputs:witness?(state.localOutputs.program.length?state.localOutputs.program:['null']):['null'],preview:witness?state.localOutputs.preview:null,bitrateKbps:500,holdProgramOutputs:true,
    fenceLease:witness?async(owner,nonce)=>{
      if(!assertLeaseAdmission||signal.aborted)throw new Error('Renovação HA sem admissão atual própria.')
      admission.assertHeld();lease.assertOwned();await assertLeaseAdmission()
      const grant=await witness.obtain(channel.id,owner,nonce)
      if(signal.aborted)throw new Error('Renovação HA cancelada.')
      admission.assertHeld();lease.assertOwned();await assertLeaseAdmission()
      return grant
    }:undefined,
    executionIdentity:()=>revisionId,canRestartEngine:()=>false,canRecoverProgram:()=>false,
    onTakeConfirmed:(itemId,position,_recovered,previous)=>{
      if(!accountingStarted||!asRun)return // internal held TAKE is not airing
      const confirmedDecoder=transport.programDecoderBinding()
      account(async()=>{
        if(transport.health().programAdmission.held)throw new Error('TAKE interno não pode gerar as-run de transmissão.')
        const now=transport.programDecoderBinding()
        if(!confirmedDecoder||confirmedDecoder.itemId!==itemId||!now||now.itemId!==itemId||now.decoderId!==confirmedDecoder.decoderId)throw new Error('Ocorrência mudou antes do accounting/gráfico local.')
        const entry=view?.items.find(row=>row.item.id===itemId),trim=transport.state().programTrim
        if(!entry||!graphicPreparation)throw new Error('Novo item sem edição/grafismos preparados.')
        const duration=entry.item.type==='LIVE'?entry.item.durationOverride??0:trim?trim.out-trim.in:entry.trim.out-entry.trim.in
        const nextExecutionId=randomUUID()
        await (await graphicPreparation).admitOccurrence({itemId,decoderId:now.decoderId,duration,executionId:nextExecutionId})
        if(previous)asRun.noteExit(previous.itemId,previous.reason,previous.frames)
        await asRun.follow(itemId,view,revisionId,position,true)
        const after=transport.programDecoderBinding()
        if(!after||after.itemId!==itemId||after.decoderId!==now.decoderId)throw new Error('Decoder mudou durante a admissão da nova ocorrência.')
        localExecutionId=nextExecutionId;accountedDecoder=after
        writeCheckpoint()
      })
    },
    onProgramCleared:(reason,position)=>{
      if(accountingStarted&&asRun)account(async()=>{await asRun.finish(reason,position);writeCheckpoint()})
    },
    assertExecutionOwned:()=>{if(signal.aborted)throw new Error('Decoder HA cancelado.');admission.assertHeld();lease.assertOwned()},
    beforeProcessStart:token=>lease.beforeSpawn(token),onProcessStarted:(pid,token)=>{if(pid!==null)lease.spawned(pid,token)},onProcessExited:(pid,token)=>lease.exited(pid,token),
  })
  let preparation:ReturnType<HaHeldDecoder['prepare']>|null=null,stopping:ReturnType<HaHeldDecoder['stop']>|null=null,resuming:Promise<void>|null=null,graphicPreparation:ReturnType<typeof prepareHaNativeGraphics>|null=null,previewRelease:Promise<void>|null=null
  const prepareGraphics=()=>graphicPreparation??=(async()=>{
    if(!witness)throw new Error('Warmup não admite composição sob concessão nativa.')
    await current()
    await (preparation??=transport.prepareHeldDecoder(saved?.playing?saved.itemId:null,saved?.playing?saved.elapsed:0,saved?.playing?saved.programTrim:undefined,current))
    const prepared=await prepareHaNativeGraphics(candidate,app,admission,transport,channel,current,localExecutionId)
    confirmedGraphicReceipt=prepared.confirmedGraphicReceipt
    return prepared
  })()
  return {transport,revisionId,
    controlState:()=>{const preview=transport.state().preview;return {revisionId,cuedItemId:preview?.kind==='ITEM'?preview.id:null,items:(view?.items??[]).map(entry=>({id:entry.item.id,title:entry.item.title}))}},
    cue:(itemId,authorizeCommand,requestId)=>{if(!witness||!accountingStarted)return Promise.reject(new Error('CUE exige PGM/accounting admitidos.'));return transport.cueAdmitted(itemId,async()=>{await current();await authorizeCommand()},requestId)},
    takeCued:(itemId,authorizeCommand,requestId)=>{if(!witness||!accountingStarted)return Promise.reject(new Error('TAKE exige PGM/accounting admitidos.'));return transport.takeCuedAdmitted(itemId,async()=>{await current();await authorizeCommand()},requestId)},
    prepareGraphics,
    releasePreview:()=>previewRelease??=(async()=>{
      if(!witness||!accountingStarted)throw new Error('Preview exige accounting após release de PGM.')
      if(state.localOutputs.preview)await transport.releasePreviewOutput(current)
    })(),
    startGraphicMaintenance:async()=>{if(!graphicPreparation)throw new Error('Composição não preparada.');await (await graphicPreparation).startMaintenance()},
    beginProgramAccounting:proof=>accountingStart??=(async()=>{
      if(!witness||!asRun)throw new Error('Warmup não registra as-run de PGM.')
      await current();lease.assertOwned()
      const assertProof=()=>{
        admission.assertHeld();lease.assertOwned()
        const binding=transport.fenceBinding(),decoder=transport.programDecoderBinding()
        if(transport.health().programAdmission.held||!binding||binding.ownerId!==proof.ownerId||binding.term!==proof.term||proof.channelId!==channel.id||proof.itemId!==null&&(!decoder||decoder.itemId!==proof.itemId||decoder.decoderId!==proof.decoderId)||proof.itemId===null&&decoder)throw new Error('As-run exige a geração/decoder do PGM nativo liberado, não um recibo antigo.')
      }
      assertProof()
      if(proof.itemId!==null){
        if(!proof.firstVideoConfirmed||!Number.isSafeInteger(proof.elapsed)||proof.elapsed<0)throw new Error('As-run HA sem posição/primeiro quadro nativos.')
        await asRun.follow(proof.itemId,view,revisionId,proof.elapsed,true)
      }
      assertProof()
      app.db.insert(operatorDecisions).values({id:randomUUID(),rundownId:'@ha',kind:'HA_PROGRAM_ACCOUNTING_STARTED',actorUsername:'@ha',createdAt:new Date().toISOString(),payload:{version:1,promotionId:admission.copy.id,preparationId:admission.copy.preparationId,channelId:channel.id,localExecutionId,localRevisionId:revisionId,sourceRevisionId:edition?.sourceRevisionId??null,sourceCapturedAt:state.capturedAt,ownerRunId:lease.assertOwned().id,nativeProof:proof,importedAsRunExecuted:false,physicalOutputValidated:false}}).run()
      assertProof();accountedDecoder=transport.programDecoderBinding();writeCheckpoint(proof);accountingStarted=true
      checkpointTimer=setInterval(()=>{try{writeCheckpoint()}catch{accountingFailure=true;transport.close();if(checkpointTimer)clearInterval(checkpointTimer);checkpointTimer=null}},1000);checkpointTimer.unref()
    })(),
    prepare:()=>preparation??=transport.prepareHeldDecoder(saved?.playing?saved.itemId:null,saved?.playing?saved.elapsed:0,saved?.playing?saved.programTrim:undefined,current),
    resumeProgram:()=>resuming??=(async()=>{
      if(!witness)throw new Error('Warmup sem concessão não pode preparar PGM interno.')
      await current()
      await (preparation??=transport.prepareHeldDecoder(saved?.playing?saved.itemId:null,saved?.playing?saved.elapsed:0,saved?.playing?saved.programTrim:undefined,current))
      await prepareGraphics()
      if(saved?.playing){
        if(!saved.rundownId)throw new Error('Cursor HA sem grade correspondente.')
        await transport.resumeHeldProgram(saved.rundownId,saved.itemId!,saved.elapsed,saved.programTrim,current)
      }
      await current()
    })(),
    stop:()=>stopping??=(async()=>{
      if(checkpointTimer)clearInterval(checkpointTimer);checkpointTimer=null
      const graphicsStop=graphicPreparation?.then(graphics=>graphics.stopMaintenance(),()=>{})
      const result=await transport.closeConfirmed()
      await graphicsStop
      if(!result.ownedNativeProcessesStopped)return result
      try{
        admission.assertHeld();await accountingWork
        if(asRun&&accountingStart){await accountingStart.catch(()=>{});await asRun.finish('HA_EXECUTION_STOP')}
        if(accountingFailure||!lease.canSpawn())return {ownedNativeProcessesStopped:false}
        lease.sealObservation();lease.release();lease.finalRelease();return result
      }catch{return {ownedNativeProcessesStopped:false}}
    })(),
  }
}
