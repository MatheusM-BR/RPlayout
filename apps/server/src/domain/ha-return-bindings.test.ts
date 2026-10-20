// NOT_RUN: planning/journal contracts only. No worker, network or native checks.
import {it,expect} from 'vitest'
import Database from 'better-sqlite3'
import {randomUUID} from 'node:crypto'
import {returnCandidateBindings,haReturnBindingRequest} from './ha-return-bindings.js'
import type {readReturnCandidateOrigin} from './ha-return-candidate-origin.js'
import type {HaSnapshot} from './ha-replication.js'
import type {HaBindingInventory} from './ha-bindings.js'
import {installationVault} from './secret-vault.js'
function fixture(){
  const request={candidateId:randomUUID(),planId:randomUUID(),channelId:'ch'}
  const origin={job:{candidateId:request.candidateId,request:{planId:request.planId,channelId:'ch',executionRevisionId:'rev'},recordedAt:new Date().toISOString()},channel:{id:'ch',name:'Canal',programSdiDeviceId:'sdi:FOREIGN'},entries:[{revision:{id:'rev',rundownId:'rd',active:false},payload:{version:1,rundown:{id:'rd',channelId:'ch'},items:[{id:'live',title:'Estúdio',sourceRef:'ndi:RESERVE'}],schedule:{}}}],originalCursor:null} as unknown as ReturnType<typeof readReturnCandidateOrigin>
  const snapshot:HaSnapshot={version:1,capturedAt:new Date().toISOString(),channels:[{channelId:'ch',configuration:{channel:{id:'ch',programSdiDeviceId:null},revision:1,outputs:[{id:'local-out',name:'Principal',kind:'SRT',target:'srt://principal:9000',enabled:true}]},revisions:[],checkpoint:null,transport:null,blockers:{}}],asRun:[],journals:[]}
  const inventory:HaBindingInventory={inputs:[{key:'local-ndi',family:'NDI',label:'ESTÚDIO-ÇÃO',reference:'ndi:LOCAL'}],sdiOutputs:[]}
  return {request,origin,snapshot,inventory}
}
it('selecionada inativa ainda exige entrada; saídas são do principal — NOT_RUN',()=>{
  const db=new Database(':memory:'),f=fixture()
  try{const service=returnCandidateBindings(db,'cluster:principal',f.origin,()=>f.snapshot,()=>{}),view=service.review('ch',f.inventory);expect(view.inputs).toHaveLength(1);expect(view.outputs.map(row=>row.outputId)).toEqual(['local-out']);expect(view.promotionReady).toBe(false);expect(view.physicalSignalValidated).toBe(false)}finally{db.close()}
})
it('plano cifrado/imutável separado e alteração local invalida token — NOT_RUN',()=>{
  const db=new Database(':memory:'),f=fixture()
  try{
    const service=returnCandidateBindings(db,'cluster:principal',f.origin,()=>f.snapshot,()=>{}),view=service.review('ch',f.inventory)
    const binding={requestId:randomUUID(),channelId:'ch',sequence:view.sequence,basePlanId:view.basePlanId,reviewToken:view.reviewToken,inputs:[{sourceKey:view.inputs[0]!.sourceKey,localKey:'local-ndi'}],outputs:[{outputId:'local-out',disposition:'LOCAL' as const,localTarget:'srt://principal:9000?passphrase=RETURN_SECRET'}]}
    expect(haReturnBindingRequest.safeParse({channelId:'other',candidate:f.request,binding}).success).toBe(false)
    f.snapshot.channels[0]!.configuration.revision=2
    expect(()=>service.save(binding,f.inventory,'admin',()=>{})).toThrow('mudou')
    f.snapshot.channels[0]!.configuration.revision=1
    const saved=service.save(binding,f.inventory,'admin',()=>{});expect(saved.saved?.id).toBe(binding.requestId)
    const row=db.prepare('SELECT payload FROM ha_return_binding_plans').get() as {payload:string};expect(row.payload).not.toContain('RETURN_SECRET');expect(saved.saved?.outputs[0]?.target).not.toContain('RETURN_SECRET')
    expect(()=>db.prepare('DELETE FROM ha_return_binding_plans').run()).toThrow()
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name='ha_local_binding_plans'").get()).toBeUndefined()
    const other=returnCandidateBindings(db,'cluster:principal',{...f.origin,job:{...f.origin.job,candidateId:randomUUID()}},()=>f.snapshot,()=>{})
    expect(other.review('ch',f.inventory).saved?.stale).toBe(true)
    expect(()=>other.save({...binding,requestId:randomUUID()},f.inventory,'admin',()=>{})).toThrow('mudou')
  }finally{db.close()}
})
it('sem canal local não reutiliza configuração estrangeira — NOT_RUN',()=>{
  const db=new Database(':memory:'),f=fixture()
  try{f.snapshot.channels=[];expect(()=>returnCandidateBindings(db,'cluster:principal',f.origin,()=>f.snapshot,()=>{}).review('ch',f.inventory)).toThrow('Canal ausente')}finally{db.close()}
})
it('consulta UUID substituído sem revelar credencial ou associar outro candidato — NOT_RUN',()=>{
  const db=new Database(':memory:'),f=fixture()
  try{
    const service=returnCandidateBindings(db,'cluster:principal',f.origin,()=>f.snapshot,()=>{})
    const make=()=>{const view=service.review('ch',f.inventory);return {requestId:randomUUID(),channelId:'ch',sequence:view.sequence,basePlanId:view.basePlanId,reviewToken:view.reviewToken,inputs:[{sourceKey:view.inputs[0]!.sourceKey,localKey:'local-ndi'}],outputs:[{outputId:'local-out',disposition:'LOCAL' as const,localTarget:'srt://principal:9000?passphrase=RETURN_HISTORY_SECRET'}]}}
    const first=make();service.save(first,f.inventory,'admin-a',()=>{})
    const second=make();service.save(second,f.inventory,'admin-b',()=>{})
    const receipt=service.queryPlan(first.requestId,'ch',f.inventory)
    expect(receipt?.id).toBe(first.requestId);expect(receipt?.current).toBe(false);expect(receipt?.confirmationIsHistorical).toBe(true);expect(receipt?.operationalReady).toBe(false);expect(JSON.stringify(receipt)).not.toContain('RETURN_HISTORY_SECRET')
    expect(service.queryPlan(randomUUID(),'ch',f.inventory)).toBeNull()
    expect(()=>service.queryPlan(first.requestId,'other',f.inventory)).toThrow()
    f.snapshot.channels[0]!.configuration.revision=3;expect(service.queryPlan(first.requestId,'ch',f.inventory)?.stale).toBe(true)
    const other=returnCandidateBindings(db,'cluster:principal',{...f.origin,job:{...f.origin.job,candidateId:randomUUID()}},()=>f.snapshot,()=>{})
    expect(()=>other.queryPlan(first.requestId,'ch',f.inventory)).toThrow('outro canal/candidato')
    expect(()=>other.save(first,f.inventory,'admin',()=>{})).toThrow('outro plano')
  }finally{db.close()}
})
it('registro legado sem identidade de candidato preservado, não adotado — NOT_RUN',()=>{
  const db=new Database(':memory:'),f=fixture()
  try{
    const service=returnCandidateBindings(db,'cluster:principal',f.origin,()=>f.snapshot,()=>{}),view=service.review('ch',f.inventory),id=randomUUID()
    const legacy={version:1,request:{requestId:id,channelId:'ch',sequence:1,basePlanId:null,reviewToken:view.reviewToken,inputs:[],outputs:[]},createdAt:new Date().toISOString(),actor:'legacy',snapshotDigest:'old',bindingDigest:'old',confirmedSequence:1,inventoryHash:'old',localInputs:[],localOutputs:[]}
    db.prepare('INSERT INTO ha_return_binding_plans VALUES(?,?,?)').run(id,'ch',installationVault(false).encrypt(JSON.stringify(legacy),'ha-local-bindings:v1:return:cluster:principal:'+id))
    expect(service.review('ch',f.inventory).saved?.stale).toBe(true)
    expect(()=>service.queryPlan(id,'ch',f.inventory)).toThrow('vínculo explícito')
    expect(db.prepare('SELECT count(*) n FROM ha_return_binding_plans').get()).toEqual({n:1})
  }finally{db.close()}
})
