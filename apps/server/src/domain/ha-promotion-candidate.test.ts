import {it,expect} from 'vitest'
import Database from 'better-sqlite3'
import {randomUUID} from 'node:crypto'
import {installationVault} from './secret-vault.js'
import {haSourceBindingKey,type HaBindings} from './ha-bindings.js'
import {materializeHaPayload} from './ha-local-payload.js'
import {haResumeIntent,stoppedHaCheckpoint} from './ha-recovery-cursor.js'
import {readHaPromotionCandidate} from './ha-promotion-candidate.js'
// NOT_RUN. Pure private handoff fixtures; no engine/witness/physical qualification.
function fixture(){
  const db=new Database(':memory:'),request={requestId:randomUUID(),sequence:3,channelId:'ch',bindingPlanId:randomUUID()},context='ha-recovery:v1:test:'+request.requestId
  const plan:ReturnType<HaBindings['executionBindings']>={planId:request.bindingPlanId,bindingDigest:'binding-digest',inputs:[{sourceKey:haSourceBindingKey('ndi:PRIMARY'),local:{key:'local',label:'ESTÚDIO-ÇÃO',family:'NDI',reference:'ndi:LOCAL-ÇÃO'}}],outputs:[]}
  const sourcePayload={version:1,rundown:{id:'rd',channelId:'ch'},items:[{id:'live',rundownId:'rd',type:'LIVE',title:'Jornal',sourceRef:'ndi:PRIMARY',liveEndpoint:'ndi:PRIMARY'}],assets:[],schedule:{items:[],conflicts:[]}}
  const derived=materializeHaPayload(sourcePayload,'rev',plan,new Map(),new Map(),{num:25,den:1},2),mapping=new Map([['rev',derived.id]]),capturedAt='2026-10-10T12:00:00.000Z'
  const original={version:1,channelId:'ch',rundownId:'rd',revisionId:'rev',itemId:'live',elapsed:73,playing:true,realEngine:true,executionId:'execution',rate:{num:25,den:1},audioChannels:2}
  const origin={version:1,request,capturedAt,channel:{channelId:'ch',configuration:{channel:{id:'ch',width:1920,height:1080,rateNum:25,rateDen:1,audioChannels:2},executionRevisionId:'rev'},revisions:[{id:'rev',rundownId:'rd',revision:1,state:'PUBLISHED',active:true,payload:sourcePayload}],checkpoint:{value:original},transport:null,blockers:{}},asRun:[{id:'historical',channelId:'ch'}],journals:[]}
  db.exec(`CREATE TABLE channels(id TEXT,archived_at TEXT,rate_num INTEGER,rate_den INTEGER,audio_channels INTEGER);
    CREATE TABLE output_profiles(id TEXT);CREATE TABLE channel_checkpoints(channel_id TEXT,payload TEXT);
    CREATE TABLE operational_playlist_revisions(id TEXT,rundown_id TEXT,revision INTEGER,state TEXT,active INTEGER,payload TEXT);
    CREATE TABLE ha_recovery_origin(id INTEGER,payload TEXT);CREATE TABLE ha_recovery_cursor(id INTEGER,payload TEXT);CREATE TABLE ha_recovery_plan(id INTEGER,payload TEXT);`)
  db.prepare('INSERT INTO channels VALUES(?,?,?,?,?)').run('ch',capturedAt,25,1,2)
  db.prepare('INSERT INTO channel_checkpoints VALUES(?,?)').run('ch',JSON.stringify(stoppedHaCheckpoint(original,'ch',mapping)))
  db.prepare('INSERT INTO operational_playlist_revisions VALUES(?,?,?,?,?,?)').run(derived.id,'rd',1,'PUBLISHED',1,installationVault().encrypt(JSON.stringify(derived.payload),'operational_playlist_revisions.payload'))
  const put=(table:string,data:unknown,suffix:string)=>db.prepare(`INSERT INTO ${table} VALUES(1,?)`).run(installationVault().encrypt(JSON.stringify(data),context+suffix))
  put('ha_recovery_origin',origin,':origin')
  put('ha_recovery_cursor',{version:1,request,revisionIds:[...mapping],intent:haResumeIntent(original,'ch',mapping,capturedAt)},':cursor')
  put('ha_recovery_plan',{version:1,request,snapshotSequence:3,plan,revisionIds:[...mapping],mountChecks:derived.checks,automaticTake:false,promotionReady:false},':local-plan')
  return {db,request,context,plan,derived}
}
it('binds frozen history, local edition and exact offset without treating live preparation as signal/authority',()=>{
  const f=fixture();try{
    const result=readHaPromotionCandidate(f.db,f.context,f.request,f.plan)
    expect(result).toMatchObject({snapshotSequence:3,localExecutionRevisionId:f.derived.id,nativeCursor:{elapsed:73,revisionId:f.derived.id},historicalAsRun:[{id:'historical',channelId:'ch'}],requiresNativePreparation:true,promotionReady:false,automaticTake:false,physicalOutputValidated:false})
    expect(result.revisions[0]?.payload.items[0]?.sourceRef).toBe('ndi:LOCAL-ÇÃO')
    expect(result.mountChecks.some(row=>row.livePending)).toBe(true)
    expect((f.db.prepare('SELECT archived_at FROM channels').get() as {archived_at:string}).archived_at).toBeTruthy()
  }finally{f.db.close()}
})
it.each(['cursor','edition','channel','outputs','plan','origin'])('rejects changed %s rather than authorizing native output',fault=>{
  const f=fixture();try{
    if(fault==='cursor')f.db.prepare('UPDATE channel_checkpoints SET payload=?').run(JSON.stringify({...stoppedHaCheckpoint({version:1,channelId:'ch',rundownId:null,revisionId:null,itemId:null,elapsed:0,playing:false,realEngine:false},'ch',new Map()),elapsed:100}))
    if(fault==='edition')f.db.exec("UPDATE operational_playlist_revisions SET active=0")
    if(fault==='channel')f.db.exec('UPDATE channels SET archived_at=NULL')
    if(fault==='outputs')f.db.exec("INSERT INTO output_profiles VALUES('foreign-output')")
    if(fault==='origin')f.db.exec("UPDATE ha_recovery_origin SET payload='tampered'")
    const selected=fault==='plan'?{...f.plan,bindingDigest:'changed'}:f.plan
    expect(()=>readHaPromotionCandidate(f.db,f.context,f.request,selected)).toThrow()
  }finally{f.db.close()}
})
