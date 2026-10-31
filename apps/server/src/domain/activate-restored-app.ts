import {lstat} from 'node:fs/promises'
import {createStagedRestoredApp} from './staged-restored-app.js'
import {reviewRestoredExecution} from './restored-execution-review.js'
import {ENGINE_BINARY} from '../config.js'
import {runtimeFor,syncDistribution,type App,type ChannelRuntime} from '../app.js'
import {listChannels,listRundowns} from '../db/repo.js'
import {Checkpoints} from './checkpoints.js'
import {EngineTransport} from './engine.js'
import {restoredLiveVideoConfirmed} from './restored-live-confirmation.js'

/** Explicit local activation: same held storage/native admission, no staged
 * JSON receipt interpreted as takeover permission. Native readiness and exact
 * saved recovery are confirmed before the origin marker is archived. */
export async function activateRestoredApp(file:string,manifest:string):Promise<App>{
  if(!ENGINE_BINARY||!(await lstat(ENGINE_BINARY)).isFile())throw new Error('Ativação exige engine nativo da instalação; simulador recusado.')
  const app=await createStagedRestoredApp(file,manifest,{pausedPreparation:true}),admission=app.restoredAdmission!,ready:string[]=[],resumed:string[]=[]
  const prepared:Array<{runtime:ChannelRuntime;paused:boolean}>=[]
  let began=false
  let releaseAttempted=false
  try{
    await reviewRestoredExecution(app.db,manifest,app.hostFence!,{cacheRoot:process.env.RPLAYOUT_CACHE,heldMaintenance:admission.maintenance,pausedPreparation:admission.pausedPreparation})
    admission.beginNativeActivation(app.sqlite);began=true
    await app.hostFence!.freshProof();await syncDistribution(app)
    for(const channel of await listChannels(app.db)){
      const saved=new Checkpoints(app.sqlite).read(channel.id)
      const paused=Boolean(saved?.realEngine&&!saved.playing&&saved.programHold?.status==='HELD')
      if(saved?.realEngine&&!saved.playing&&saved.itemId&&!paused)throw new Error('PGM pausado exige recuperação de quadro congelado; cursor preservado, ativação recusada.')
      const runtime=await runtimeFor(app,channel.id)
      if(!runtime||!(runtime.transport instanceof EngineTransport))throw new Error('Runtime nativo não foi admitido para o canal restaurado.')
      const recovering=await runtime.recoverCheckpoint()
      if((saved?.playing||paused)&&!recovering)throw new Error(runtime.recoveryError??'Cursor salvo não foi preparado para recuperação.')
      if(!recovering){const [first]=await listRundowns(app.db,channel.id);if(first)await runtime.load(first.id)}
      const deadline=performance.now()+30000;let confirmed=false
      while(performance.now()<deadline){
        admission.assertNativeActivation(app.sqlite)
        const health=runtime.transport.health()
        if(runtime.recoveryError)throw new Error(runtime.recoveryError)
        if(health.ready){
          runtime.checkpoint(true)
          const state=runtime.transport.state()
          if(!recovering){confirmed=true;break}
          if(paused&&!state.playing&&state.onAir?.itemId===saved!.itemId&&state.onAir.elapsed===saved!.elapsed&&health.programHold?.status==='HELD'&&health.programHold.frames===saved!.elapsed){
            if(JSON.stringify(state.programTrim)!==JSON.stringify(saved!.programTrim))throw new Error('Corte pausado não corresponde ao cursor salvo.')
            confirmed=true;break
          }
          if(state.playing&&state.onAir?.itemId===saved!.itemId&&state.onAir.elapsed>=saved!.elapsed&&(saved!.programTrim||restoredLiveVideoConfirmed(state,saved!.itemId!))){
            if(saved!.programTrim&&JSON.stringify(state.programTrim)!==JSON.stringify(saved!.programTrim))throw new Error('Corte confirmado no engine não corresponde ao cursor salvo.')
            confirmed=true;break
          }
        }
        await new Promise(resolve=>setTimeout(resolve,100))
      }
      if(!confirmed)throw new Error('Engine não confirmou prontidão/retomada dentro da janela; origem preservada.')
      ready.push(channel.id);if(recovering)resumed.push(channel.id)
      prepared.push({runtime,paused})
    }
    // Prepare every channel before releasing any program consumer. A failed
    // later release can still be partially applied: preserve origin/uncertainty.
    for(const {runtime,paused} of prepared){
      admission.recordOutputRelease(app.sqlite,runtime.channel.id,'PROGRAM','ATTEMPTED',paused);releaseAttempted=true
      const proof=await (runtime.transport as EngineTransport).releaseProgramOutputs(async()=>{admission.assertNativeActivation(app.sqlite);await app.hostFence!.freshProof();admission.assertNativeActivation(app.sqlite)},paused)
      admission.recordOutputRelease(app.sqlite,runtime.channel.id,'PROGRAM','CONFIRMED',paused,proof)
    }
    for(const {runtime} of prepared){
      if(runtime.temMonitor('pvw')){
        admission.recordOutputRelease(app.sqlite,runtime.channel.id,'PREVIEW','ATTEMPTED',false);releaseAttempted=true
        await (runtime.transport as EngineTransport).releasePreviewOutput(async()=>{admission.assertNativeActivation(app.sqlite);await app.hostFence!.freshProof();admission.assertNativeActivation(app.sqlite)})
        admission.recordOutputRelease(app.sqlite,runtime.channel.id,'PREVIEW','CONFIRMED',false)
      }
    }
    await app.hostFence!.freshProof()
    admission.finishNativeActivation(app.sqlite,'CONFIRMED',ready,resumed,null)
    return app
  }catch(error){
    if(began)try{admission.finishNativeActivation(app.sqlite,'FAILED',ready,resumed,(releaseAttempted?'Liberação de saída tentada; falha não equivale a rollback. Confira os recibos. ':'')+(error instanceof Error?error.message:'Ativação recusada.'))}catch{/* Lost admission preserves STARTING/uncertain, never fabricates failure resolution. */}
    await app.close()
    throw error
  }
}
