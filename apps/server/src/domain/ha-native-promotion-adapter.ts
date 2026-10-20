import type {HaPromotionAdapter,HaPreparedNative} from './ha-promotion.js'
import type {HaFencedDecoder} from './ha-held-decoder.js'
import {createHaOwnedMedia} from './ha-owned-media.js'

/** Native adapter implementation for the orchestrator's private factory.
 * It cannot transfer authority, select paths/destinations or release outputs.
 * Product enabling still requires the operational runtime/panel integration. */
export const nativeHaPromotionAdapter:HaPromotionAdapter={
  async prepare(candidate,context):Promise<HaPreparedNative>{
    context.signal.throwIfAborted();await context.assertCurrent()
    const state=candidate.candidate
    if(context.programOutputsDisabled!==true||context.executionApp.haExecutionAdmission!==context.admission||context.executionCopy.id!==context.admission.copy.id||context.executionCopy.file!==context.admission.copy.file)throw new Error('Adaptador HA exige cópia/backend admitidos com saídas retidas.')
    if(state.graphicRecovery.status==='UNVERIFIED'||state.graphicRecovery.status==='BLOCKED'||state.secondaryRecovery?.blockers.length)throw new Error('Composição/eventos não admitem preparo de promoção nativa.')
    if(state.mountChecks.some(check=>check.errors.length))throw new Error('Montagem local bloqueada; nenhuma transferência deve ser enviada.')
    const expectedRevision=state.nativeCursor?.revisionId??state.localExecutionRevisionId??null
    let decoder:HaFencedDecoder|null=null,opening:Promise<HaFencedDecoder>|null=null,activation:ReturnType<HaPreparedNative['activate']>|null=null,stopping:ReturnType<HaPreparedNative['stop']>|null=null,closed=false
    let media:ReturnType<typeof createHaOwnedMedia>=null
    const assertOpen=()=>{context.signal.throwIfAborted();if(closed)throw new Error('Adaptador HA encerrado; não abrir/repetir geração.')}
    return {
      browserMonitor:()=>!closed&&media?.ready()?{preview:media.plan.preview,monitor:media.plan.monitor,port:media.plan.webrtcPort}:null,
      mediaState:()=>media?.state()??'NOT_CONFIGURED',
      activate:activationContext=>activation??=(async()=>{
        assertOpen();activationContext.signal.throwIfAborted()
        await activationContext.assertAdmission();assertOpen();activationContext.signal.throwIfAborted()
        if(state.localOutputs){
          // Stop the owning warmup BEFORE reserving host-wide distribution.
          // Its execution lease must not look like a competing live engine.
          const warm=await context.preparedDecoder.stop()
          if(!warm.ownedNativeProcessesStopped)throw new Error('Warmup não confirmou parada; mídia local não será aberta.')
          await activationContext.assertAdmission();assertOpen()
          media=createHaOwnedMedia(context.executionApp,context.admission,state.localOutputs,state.channel.id,activationContext.assertAdmission,activationContext.signal)
          if(media){await media.prepare();assertOpen();await activationContext.assertAdmission()}
        }
        opening=context.createFencedDecoder();decoder=await opening
        assertOpen();activationContext.signal.throwIfAborted()
        if(decoder.revisionId!==expectedRevision)throw new Error('Geração cercada de outra edição.')
        await decoder.prepare();assertOpen()
        await activationContext.assertAdmission();assertOpen()
        await decoder.resumeProgram();assertOpen();activationContext.signal.throwIfAborted()
        await activationContext.assertAdmission();assertOpen()
        const health=decoder.transport.health()
        if(!health.ready||!health.programAdmission.supported||!health.programAdmission.held||!decoder.transport.fenceBinding())throw new Error('Geração sem confirmação nativa retida/cercada.')
        if(media&&!media.ready())throw new Error('Mídia local perdeu readiness antes de liberar a geração retida.')
        if(media)media.startObservation(programDependent=>{if(programDependent)decoder?.transport.close()})
        return {transport:decoder.transport,revisionId:decoder.revisionId}
      })(),
      stop:()=>stopping??=(async()=>{
        closed=true
        let uncertain=false
        if(opening&&!decoder){try{decoder=await opening}catch{uncertain=true}}
        // Unknown constructor result cannot be replaced by PID lookup or an
        // alleged clean timeout. The orchestrator retains its own quarantine.
        const [native,stoppedMedia]=await Promise.allSettled([decoder?decoder.stop():Promise.resolve({ownedNativeProcessesStopped:!uncertain}),media?media.stop():Promise.resolve({ownedMediaProcessesStopped:true})])
        return {ownedNativeProcessesStopped:native.status==='fulfilled'&&native.value.ownedNativeProcessesStopped&&stoppedMedia.status==='fulfilled'&&stoppedMedia.value.ownedMediaProcessesStopped}
      })(),
    }
  },
}
