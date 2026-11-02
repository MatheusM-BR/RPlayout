import {it,expect,vi} from 'vitest'
import {randomUUID} from 'node:crypto'
import Database from 'better-sqlite3'
import {HaPromotions,type HaPromotionAdapter} from './ha-promotion.js'
import type {HaLeaseClient} from './ha-witness.js'
import type {HaRecovery} from './ha-recovery.js'
import {EngineTransport} from './engine.js'
import type {HostDistributionFence} from './host-distribution-fence.js'
vi.mock('./ha-execution-copy.js',()=>({stageHaExecutionCopy:async(_candidate:unknown,_root:string,id:string)=>({id,file:'MOCK_NOT_A_REAL_EXECUTION_DB',sourceHash:'ab'.repeat(32),preparationId:'MOCK'}),verifyStagedHaExecutionCopy:async()=>{}}))
vi.mock('./ha-execution-admission.js',()=>({HaExecutionAdmission:{acquire:async()=>({markNativePreparation:()=>{},assertHeld:()=>{},releaseAfterStop:(stopped:boolean)=>stopped})}}))
vi.mock('./staged-ha-app.js',()=>({createStagedHaApp:async()=>({close:async()=>{}})}))
vi.mock('./ha-held-decoder.js',()=>({createHaHeldDecoder:async()=>({prepare:async()=>({itemId:'vt',decoderId:31,firstVideoConfirmed:true}),stop:async()=>({ownedNativeProcessesStopped:true})})}))
// NOT_RUN: mocked orchestration only, never native/physical promotion evidence.
function fixture(mode:'ok'|'no-adapter'|'lost-transfer'|'prepare-lost'|'wrong-video'|'wrong-engine'|'wrong-cursor'|'inactive-lease'|'unheld'='ok'){
  const db=new Database(':memory:'),request={requestId:randomUUID(),preparation:{requestId:randomUUID(),channelId:'ch',sequence:1,bindingPlanId:randomUUID()},fromNodeId:'a',targetNodeId:'b',expectedTerm:1,expectedRevision:1}
  let transfers=0,prepares=0,activations=0,stops=0,node='a',revision=1,lastTransferId:string|null=null,term=1
  const ownerId=randomUUID()
  let releases=0
  const witness={transferControlConfigured:true,assignment:async()=>({kind:'ASSIGNMENT',version:1,clusterId:'cluster',channelId:'ch',selectedNodeId:node,revision,lastTransferId,lastTerm:term,lastEngineOwnerId:ownerId,lastEngineNodeId:node,engineLeaseActive:activations>0&&mode!=='inactive-lease',waitingForLeaseExpiry:false,automaticTake:false,physicalOutputValidated:false}),transfer:async()=>{transfers++;node='b';revision=2;lastTransferId=request.requestId;if(mode==='lost-transfer')throw new Error('lost');return {phase:'TRANSFERRED'}}} as unknown as HaLeaseClient
  const saved={version:1,channelId:'ch',rundownId:'rd',revisionId:'derived',itemId:'vt',elapsed:73,playing:true,realEngine:true,programTrim:{in:0,out:500,contentHash:'ab'.repeat(32)}}
  const candidate={candidate:{nativeCursor:saved},verifyCurrent:async()=>{}} as unknown as Awaited<ReturnType<HaRecovery['activationCandidate']>>
  const adapter:HaPromotionAdapter={prepare:async(_candidate,context)=>{
    prepares++;expect(context.programOutputsDisabled).toBe(true);expect(context.executionCopy.id).toBe(request.requestId);expect(context.executionCopy.file).toBe('MOCK_NOT_A_REAL_EXECUTION_DB');if(mode==='prepare-lost')throw new Error('native handle unavailable')
    return {activate:async context=>{
      activations++;await context.assertAdmission();term=2
      // Prototype-backed fake only for orchestrator fixtures; NEVER evidence
      // of a spawned native engine, real lease or physical output.
      const transport=Object.assign(Object.create(EngineTransport.prototype) as EngineTransport,{
        fenceBinding:()=>({ownerId,term:2}),health:()=>({ready:true,programAdmission:{supported:true,held:mode!=='unheld'}}),
        state:()=>({mode:'NATIVE',channelId:'ch',playing:true,onAir:{itemId:mode==='wrong-cursor'?'other':'vt',elapsed:80},programTrim:saved.programTrim}),
        releaseProgramOutputs:async(authorize:()=>Promise<void>)=>{releases++;await authorize();return {channelId:'ch',ownerId,term:2,decoderId:31,itemId:'vt',elapsed:80,firstVideoConfirmed:mode!=='wrong-video',programTrim:saved.programTrim}},
      })
      return {transport:mode==='wrong-engine'?{} as EngineTransport:transport,revisionId:'derived'}
    },stop:async()=>{stops++;return {ownedNativeProcessesStopped:true}}}
  }}
  const hostFence={freshProof:async()=>{},close:()=>{}} as unknown as HostDistributionFence
  const promotions=new HaPromotions(db,'cluster:b','b','a',witness,async()=>candidate,mode==='no-adapter'?null:adapter,'MOCK_NOT_A_REAL_EXECUTION_ROOT',hostFence)
  return {db,request,promotions:{promote:(value:unknown,authorize:()=>void)=>promotions.promote(value,authorize,'tester'),observations:(channelId:string)=>promotions.observations(channelId),close:()=>promotions.close(),settled:()=>promotions.settled()},counts:()=>({transfers,prepares,activations,stops}),releaseCount:()=>releases}
}
it('a historical confirmation without a tracked fenced handle is not displayed as current native execution',async()=>{
  const f=fixture();try{
    await f.promotions.promote(f.request,()=>{})
    expect(f.promotions.observations('ch')).toMatchObject([{phase:'CONFIRMED',nativeConfirmedHistorically:true,confirmationIsHistorical:true,localObservation:'NO_TRACKED_ENGINE',currentItemId:null,currentFrames:null,authorityCheckedNow:false,physicalOutputValidated:false}])
    expect(f.promotions.observations('other')).toEqual([])
    expect(f.counts()).toMatchObject({prepares:1,transfers:1,activations:1})
  }finally{f.promotions.close();await f.promotions.settled();f.db.close()}
})
it('without the real adapter even authority transfer is refused',async()=>{
  const f=fixture('no-adapter');try{await expect(f.promotions.promote(f.request,()=>{})).rejects.toThrow('adaptador');expect(f.counts()).toEqual({transfers:0,prepares:0,activations:0,stops:0});expect(f.db.prepare('SELECT count(*) n FROM ha_promotion_requests').get()).toEqual({n:0})}finally{f.promotions.close();await f.promotions.settled();f.db.close()}
})
it('same UUID only queries; native confirmation is persisted as historical, not a live grant',async()=>{
  const f=fixture();try{
    expect(await f.promotions.promote(f.request,()=>{})).toMatchObject({phase:'CONFIRMED',authorityTransferred:true,nativeConfirmed:true,nativeProof:{term:2,elapsed:80},physicalOutputValidated:false})
    expect(await f.promotions.promote(f.request,()=>{})).toMatchObject({phase:'CONFIRMED',confirmationIsHistorical:true})
    expect(f.counts()).toMatchObject({prepares:1,transfers:1,activations:1})
    await expect(f.promotions.promote({...f.request,expectedTerm:2},()=>{})).rejects.toThrow('outra intenção')
  }finally{f.promotions.close();await f.promotions.settled();f.db.close()}
})
it.each(['lost-transfer','prepare-lost','wrong-video'] as const)('%s preserves uncertainty and never repeats native effects',async mode=>{
  const f=fixture(mode);try{
    const report=await f.promotions.promote(f.request,()=>{});expect(report.phase).toBe('UNCERTAIN')
    expect(report.ownedNativeProcessesStopped).toBe(mode!=='prepare-lost')
    expect(await f.promotions.promote(f.request,()=>{})).toMatchObject({phase:'UNCERTAIN'})
    expect(f.counts().prepares).toBe(1);expect(f.counts().transfers).toBe(mode==='prepare-lost'?0:1)
    await expect(f.promotions.promote({...f.request,requestId:randomUUID()},()=>{})).rejects.toThrow('reconciliação')
  }finally{f.promotions.close();await f.promotions.settled();f.db.close()}
})
it.each(['wrong-engine','wrong-cursor','inactive-lease','unheld'] as const)('%s never dispatches native publication release',async mode=>{
  const f=fixture(mode);try{
    expect(await f.promotions.promote(f.request,()=>{})).toMatchObject({phase:'UNCERTAIN',authorityTransferred:true,ownedNativeProcessesStopped:true})
    expect(f.releaseCount()).toBe(0)
    expect(await f.promotions.promote(f.request,()=>{})).toMatchObject({confirmationIsHistorical:true})
    expect(f.releaseCount()).toBe(0)
  }finally{f.promotions.close();await f.promotions.settled();f.db.close()}
})
