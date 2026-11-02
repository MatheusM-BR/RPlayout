import {it,expect,vi} from 'vitest'
import {nativeHaPromotionAdapter} from './ha-native-promotion-adapter.js'
import type {HaPromotionAdapter} from './ha-promotion.js'
// NOT_RUN. Mock handle orchestration only, not witness/storage/native proof.
function fixture(){
  const copy={id:'copy',file:'copy.db'},admission={copy},transport={health:()=>({ready:true,programAdmission:{supported:true,held:true}}),fenceBinding:()=>({ownerId:'owner',term:9})}
  const decoder={revisionId:'edition',transport,prepare:vi.fn(async()=>{}),resumeProgram:vi.fn(async()=>{}),stop:vi.fn(async()=>({ownedNativeProcessesStopped:true}))}
  const candidate={candidate:{graphicRecovery:{status:'CLEAR'},secondaryRecovery:null,mountChecks:[],nativeCursor:{revisionId:'edition'}}}
  const context={programOutputsDisabled:true,signal:new AbortController().signal,executionCopy:copy,admission,executionApp:{haExecutionAdmission:admission},assertCurrent:vi.fn(async()=>{}),createFencedDecoder:vi.fn(async()=>decoder)}
  return {candidate,context,decoder,typedCandidate:candidate as unknown as Parameters<HaPromotionAdapter['prepare']>[0],typedContext:context as unknown as Parameters<HaPromotionAdapter['prepare']>[1]}
}
it('preparation opens no second decoder; activation uses the private factory only once and never releases outputs',async()=>{
  const f=fixture(),handle=await nativeHaPromotionAdapter.prepare(f.typedCandidate,f.typedContext)
  expect(f.context.createFencedDecoder).not.toHaveBeenCalled()
  const context={signal:new AbortController().signal,assertAdmission:vi.fn(async()=>{})}
  const first=await handle.activate(context),second=await handle.activate(context)
  expect(first).toBe(second);expect(f.context.createFencedDecoder).toHaveBeenCalledTimes(1)
  expect(f.decoder.prepare).toHaveBeenCalledTimes(1);expect(f.decoder.resumeProgram).toHaveBeenCalledTimes(1)
  await handle.stop();await handle.stop();expect(f.decoder.stop).toHaveBeenCalledTimes(1)
})
it('closed adapter cannot subsequently open a generation',async()=>{
  const f=fixture(),handle=await nativeHaPromotionAdapter.prepare(f.typedCandidate,f.typedContext)
  await handle.stop()
  await expect(handle.activate({signal:new AbortController().signal,assertAdmission:async()=>{}})).rejects.toThrow('encerrado')
  expect(f.context.createFencedDecoder).not.toHaveBeenCalled()
})
it('lost constructor result is uncertain and activation rejection is not retried',async()=>{
  const f=fixture();f.context.createFencedDecoder.mockRejectedValue(new Error('constructor result lost'))
  const handle=await nativeHaPromotionAdapter.prepare(f.typedCandidate,f.typedContext),context={signal:new AbortController().signal,assertAdmission:async()=>{}}
  await expect(handle.activate(context)).rejects.toThrow('lost')
  await expect(handle.activate(context)).rejects.toThrow('lost')
  expect(f.context.createFencedDecoder).toHaveBeenCalledTimes(1)
  await expect(handle.stop()).resolves.toEqual({ownedNativeProcessesStopped:false})
})
it('rejected own decoder cleanup remains unconfirmed, not a successful stop — NOT_RUN',async()=>{
  const f=fixture(),handle=await nativeHaPromotionAdapter.prepare(f.typedCandidate,f.typedContext)
  await handle.activate({signal:new AbortController().signal,assertAdmission:async()=>{}})
  f.decoder.stop.mockRejectedValue(new Error('exit not observed'))
  expect(await handle.stop()).toEqual({ownedNativeProcessesStopped:false})
})
