import {randomUUID,createHash} from 'node:crypto'
import type {App} from '../app.js'
import type {HaRecovery} from './ha-recovery.js'
import type {HaExecutionAdmission} from './ha-execution-admission.js'
import {Graphics} from './graphics.js'
import {EngineTransport,EngineCommandRejected} from './engine.js'
import {graphicCapture} from './graphic-composition.js'
import {operatorDecisions} from '../db/schema.js'
import type {Channel} from '@rplayout/protocol'
import {secondaryGraphicWindow} from './secondary-graphic-window.js'
import {HA_GRAPHIC_RECEIPT_PREFIX} from './ha-graphic-receipts.js'

type Candidate=Awaited<ReturnType<HaRecovery['activationCandidate']>>
/** Distinct local preparation receipt, never imports foreign command IDs,
 * secondary-event ownership or PGM checkpoint. Promise is memoized by handle;
 * interrupted/uncertain sends cannot be replayed from this journal. */
export async function prepareHaNativeGraphics(candidate:Candidate,app:App,admission:HaExecutionAdmission,transport:EngineTransport,channel:Channel,authorize:()=>Promise<void>,executionId?:string){
  const recovery=candidate.candidate.graphicRecovery
  if(candidate.candidate.secondaryRecovery?.blockers.length)throw new Error('Ocorrência secundária estrangeira incerta; nenhum replay/admissão gráfica automático.')
  if(recovery.status==='UNVERIFIED'||recovery.status==='BLOCKED'||!recovery.display)throw new Error('Composição HA sem confirmação de origem; não preparar publicação.')
  const id=randomUUID(),binding=transport.fenceBinding()
  const assertGeneration=(held:boolean)=>{
    admission.assertHeld()
    const now=transport.fenceBinding(),health=transport.health()
    if(app.haExecutionAdmission!==admission||!binding||!now||now.ownerId!==binding.ownerId||now.term!==binding.term||health.programAdmission.held!==held||!health.ready)throw new Error('Composição HA perdeu geração/concessão/retencão.')
  }
  const assertHeld=()=>assertGeneration(true)
  const append=(phase:string,payload:Record<string,unknown>)=>{
    assertHeld()
    app.db.insert(operatorDecisions).values({id:id+':'+phase,rundownId:'@ha',kind:'HA_GRAPHIC_PREPARATION_'+phase,actorUsername:'@ha',createdAt:new Date().toISOString(),payload:{version:1,promotionId:admission.copy.id,preparationId:admission.copy.preparationId,channelId:channel.id,ownerId:binding!.ownerId,term:binding!.term,sourceReceiptId:recovery.sourceReceiptId,physicalOutputValidated:false,...payload}}).run()
  }
  await authorize();assertHeld()
  append('ACCEPTED',{publicationAuthorized:false})
  const secondary=candidate.candidate.secondaryRecovery
  const edition=secondary?candidate.candidate.revisions.find(row=>row.sourceRevisionId===secondary.sourceOccurrence.revisionId):candidate.candidate.revisions?.find(row=>row.localRevisionId===(candidate.candidate.nativeCursor?.revisionId??candidate.candidate.localExecutionRevisionId))
  const localExecutionId=executionId??randomUUID(),localPhases=new Set<string>()
  let occurrenceExecutionId=localExecutionId,occurrenceDuration=secondary?.sourceOccurrence.duration??0
  let graphicReceiptId:string|null=null
  let occurrence:{itemId:string;decoderId:number}|null=null
  const assertOccurrence=()=>{
    assertGeneration(false)
    const now=transport.programDecoderBinding()
    if(!occurrence||!now||now.itemId!==occurrence.itemId||now.decoderId!==occurrence.decoderId)throw new Error('Ocorrência/decoder mudou; evento HA anterior não será enviado.')
  }
  const graphics=new Graphics(channel,transport,{
    template:templateId=>edition?.payload.graphics?.templates.find(template=>template.id===templateId),
    remainingDurationFrames:event=>occurrence?secondaryGraphicWindow(event,occurrenceDuration,transport.state().onAir?.elapsed??0).remainingFrames:undefined,
    execute:async(event,mode,work)=>{
      if(!occurrence||!edition||event.type==='DEVICE_AUTOMATION'||event.type==='SCTE_TRIGGER'||event.deviceConfig||event.scteConfig)throw new Error('Destino secundário HA sem vínculo local executável.')
      await authorize();assertOccurrence()
      const phaseKey=JSON.stringify([occurrenceExecutionId,occurrence.decoderId,event.id,mode])
      if(localPhases.has(phaseKey))throw new Error('Fase secundária local já admitida; não repetir comando.')
      localPhases.add(phaseKey)
      const runId=randomUUID(),eventCapture:Parameters<typeof graphicCapture.run>[0]={}
      const record=(phase:string,payload:Record<string,unknown>={})=>{
        assertOccurrence()
        app.db.insert(operatorDecisions).values({id:runId+':'+phase,rundownId:'@ha',kind:'HA_SECONDARY_'+phase,actorUsername:'@ha',createdAt:new Date().toISOString(),payload:{version:1,promotionId:admission.copy.id,channelId:channel.id,executionId:occurrenceExecutionId,revisionId:edition.localRevisionId,itemId:occurrence!.itemId,decoderId:occurrence!.decoderId,eventId:event.id,mode,frames:transport.state().onAir?.elapsed??0,ownerId:binding!.ownerId,term:binding!.term,physicalOutputValidated:false,...payload}}).run()
      }
      record('ACCEPTED');let sending=false
      try{
        if(mode==='DISMISS'&&graphics.displaySnapshot().owners[event.targetLayer]?.eventId!==event.id){record('SUPERSEDED',{signalRecovered:false});return}
        await graphicCapture.run(eventCapture,()=>work(assertOccurrence,()=>{record('SENDING');sending=true}))
        await authorize();assertOccurrence()
        if(!sending||!eventCapture.display)throw new Error('Evento gráfico HA sem composição/ACK locais.')
        record('CONFIRMED',{composition:eventCapture.display,compositionHash:createHash('sha256').update(JSON.stringify(eventCapture.display)).digest('hex')})
        graphicReceiptId=HA_GRAPHIC_RECEIPT_PREFIX+runId+':CONFIRMED'
      }catch(error){
        try{record(sending&&!(error instanceof EngineCommandRejected)?'UNCERTAIN':'REJECTED')}catch{}
        throw error
      }
    },
  }),capture:Parameters<typeof graphicCapture.run>[0]={}
  if(edition)graphics.scheduler.setEvents(edition.payload.secondaryEvents??[])
  if(secondary){
    if(!edition)throw new Error('Ocorrência secundária sem edição local derivada.')
    graphics.scheduler.seedRecoveredItem(secondary.sourceOccurrence.itemId,secondary.entries)
  }
  let sent=false
  try{
    await authorize();assertHeld()
    await graphicCapture.run(capture,()=>graphics.restoreDisplayConfirmed(recovery.display!,assertHeld,()=>{assertHeld();append('SENDING',{});sent=true}))
    await authorize();assertHeld()
    if(!sent||!capture.display)throw new Error('Preparo gráfico sem composição/ACK atribuíveis à geração local.')
    const compositionHash=createHash('sha256').update(JSON.stringify(capture.display)).digest('hex')
    append('CONFIRMED',{compositionHash,composition:capture.display,publicationAuthorized:false})
    graphicReceiptId=HA_GRAPHIC_RECEIPT_PREFIX+id+':CONFIRMED'
    let timer:ReturnType<typeof setInterval>|null=null,pending:Promise<void>|null=null,closed=false,started=false,failed=false,changingOccurrence=false
    const expire=async()=>{
      // No I/O/hash/witness polling on the cadence when no layer is due.
      // Native lease renewal independently guards publication authority.
      if(closed||recovery.display!.emergencySvg!==null||!graphics.hasExpiredLayers())return
      await authorize();assertGeneration(false)
      if(closed)return
      if(!graphics.hasExpiredLayers())return
      const expirationId=randomUUID(),expirationCapture:Parameters<typeof graphicCapture.run>[0]={}
      const record=(phase:string,payload:Record<string,unknown>={})=>{
        assertGeneration(false)
        app.db.insert(operatorDecisions).values({id:expirationId+':'+phase,rundownId:'@ha',kind:'HA_GRAPHIC_EXPIRATION_'+phase,actorUsername:'@ha',createdAt:new Date().toISOString(),payload:{version:1,promotionId:admission.copy.id,channelId:channel.id,ownerId:binding!.ownerId,term:binding!.term,sourcePreparationReceiptId:id,physicalOutputValidated:false,...payload}}).run()
      }
      record('ACCEPTED');let sending=false
      try{
        await graphicCapture.run(expirationCapture,()=>graphics.expireConfirmed(()=>{if(closed)throw new Error('Manutenção gráfica encerrada.');assertGeneration(false)},()=>{record('SENDING');sending=true}))
        await authorize();assertGeneration(false)
        if(closed||!sending||!expirationCapture.display)throw new Error('Expiração gráfica sem composição/ACK atribuíveis.')
        record('CONFIRMED',{composition:expirationCapture.display,compositionHash:createHash('sha256').update(JSON.stringify(expirationCapture.display)).digest('hex')})
        graphicReceiptId=HA_GRAPHIC_RECEIPT_PREFIX+expirationId+':CONFIRMED'
      }catch(error){
        try{record(sending&&!(error instanceof EngineCommandRejected)?'UNCERTAIN':'REJECTED')}catch{}
        throw error
      }
    }
    const tick=()=>{
      if(closed||failed||pending||changingOccurrence)return
      pending=(async()=>{
        if(edition&&occurrence&&recovery.display!.emergencySvg===null){
          const state=transport.state().onAir
          if(state?.itemId===occurrence.itemId&&graphics.scheduler.hasDue(state.itemId,state.elapsed,occurrenceDuration)){
            await authorize();assertOccurrence()
            await graphics.scheduler.tick(state.itemId,state.elapsed,occurrenceDuration)
          }
        }
        await expire()
      })().catch(()=>{
        // Lost authority/storage/ACK cannot leave an unmaintained composition
        // publishing indefinitely. Close ONLY the owned transport generation.
        failed=true;if(timer)clearInterval(timer);timer=null;transport.close()
      }).finally(()=>{pending=null})
    }
    return {receiptId:id,compositionHash,physicalOutputValidated:false as const,publicationAuthorized:false as const,
      confirmedGraphicReceipt:()=>graphicReceiptId,
      admitOccurrence:async(next:{itemId:string;decoderId:number;duration:number;executionId:string})=>{
        if(closed||failed||changingOccurrence||!edition)throw new Error('Ocorrência gráfica local indisponível.')
        if(!next.itemId||!Number.isSafeInteger(next.decoderId)||next.decoderId<=0||!Number.isSafeInteger(next.duration)||next.duration<0||!next.executionId)throw new Error('Ocorrência gráfica sem identidade/duração nativas.')
        if(occurrence?.decoderId===next.decoderId){if(occurrence.itemId!==next.itemId||occurrenceExecutionId!==next.executionId||occurrenceDuration!==next.duration)throw new Error('Decoder gráfico reutilizado com outra ocorrência.');return}
        changingOccurrence=true
        try{
          await pending;await authorize();assertGeneration(false)
          const now=transport.programDecoderBinding()
          if(closed||failed||!now||now.itemId!==next.itemId||now.decoderId!==next.decoderId||!edition.payload.items.some(item=>item.id===next.itemId))throw new Error('Nova ocorrência não pertence ao decoder/edição em PGM.')
          const events=(edition.payload.secondaryEvents??[]).filter(event=>event.enabled&&(!event.rundownItemId||event.rundownItemId===next.itemId))
          if(next.duration===0&&events.some(event=>event.triggerMode==='OFFSET_BEFORE_END'))throw new Error('Evento relativo ao fim exige duração explícita da nova ocorrência.')
          app.db.insert(operatorDecisions).values({id:randomUUID(),rundownId:'@ha',kind:'HA_OCCURRENCE_ADMITTED',actorUsername:'@ha',createdAt:new Date().toISOString(),payload:{version:1,promotionId:admission.copy.id,channelId:channel.id,executionId:next.executionId,revisionId:edition.localRevisionId,itemId:next.itemId,decoderId:next.decoderId,duration:next.duration,ownerId:binding!.ownerId,term:binding!.term,foreignRunsReplayed:false,physicalOutputValidated:false}}).run()
          occurrence={itemId:next.itemId,decoderId:next.decoderId};occurrenceExecutionId=next.executionId;occurrenceDuration=next.duration
          graphics.scheduler.resetItem(next.itemId)
        }finally{changingOccurrence=false}
      },
      startMaintenance:async()=>{
        if(closed||failed||started)throw new Error('Manutenção gráfica já iniciada/encerrada/incerta; não reiniciar.')
        await authorize();assertGeneration(false);started=true
        if(secondary&&!occurrence){
          occurrence=transport.programDecoderBinding()
          if(!occurrence||occurrence.itemId!==secondary.sourceOccurrence.itemId)throw new Error('Eventos HA não pertencem ao decoder retomado.')
        }
        timer=setInterval(tick,250);timer.unref();tick()
      },
      stopMaintenance:async()=>{closed=true;if(timer)clearInterval(timer);timer=null;await pending},
    }
  }catch(error){
    // ACK/storage/authority loss is not equivalent to a definitive refusal.
    try{append(sent&&!(error instanceof EngineCommandRejected)?'UNCERTAIN':'REJECTED',{})}catch{/* ACCEPTED/SENDING remain durable quarantine evidence. */}
    throw error
  }
}
