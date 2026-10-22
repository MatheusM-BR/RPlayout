import {afterEach,expect,it,vi} from 'vitest'
import {mkdtemp,rm,writeFile,mkdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createHash,randomUUID} from 'node:crypto'
import {eq} from 'drizzle-orm'
import {openDatabase} from '../db/client.js'
import {channels,mediaAssets,rundowns,rundownItems,qcDecisions} from '../db/schema.js'
import {getChannel} from '../db/repo.js'
import {installationVault} from './secret-vault.js'
import {appendRestorationRecord} from '../db/restoration-records.js'
import {readStorageAdmission,storageAdmissionSignature} from '../db/storage-admission.js'
import {ExecutionOwnership} from './execution-ownership.js'
import {executionHostIdentity} from './execution-host.js'
import {Checkpoints} from './checkpoints.js'
import {HostDistributionFence} from './host-distribution-fence.js'
import {publishOperationalPlaylist} from './operational-playlist.js'
import {reviewRestoredExecution} from './restored-execution-review.js'
import {createApp,type App} from '../app.js'
import {readRestoredActivations,restoredActivationSignature,type RestoredActivation} from '../db/restored-activations.js'
import {serverInstanceSignature} from '../db/server-instances.js'
import {StorageMaintenance} from './storage-maintenance.js'
import {recoverRestoredReservation} from './recover-restored-reservation.js'
import {isRecoveryRehearsal} from './recovery-rehearsal.js'
const databases:ReturnType<typeof openDatabase>[]=[],dirs:string[]=[]
afterEach(async()=>{vi.restoreAllMocks();for(const db of databases.splice(0))if(db.sqlite.open)db.sqlite.close();for(const path of dirs.splice(0))await rm(path,{recursive:true,force:true})})
async function setup(fileBased=false){
  const directory=await mkdtemp(join(tmpdir(),'RPlayout-execution-review-'));dirs.push(directory)
  const db=openDatabase(fileBased?join(directory,'service.db'):':memory:');databases.push(db)
  const media=join(directory,'São José.mkv'),bytes=Buffer.from('unit fixture bytes, not decoded video'),hash=createHash('sha256').update(bytes).digest('hex'),stamp=new Date().toISOString()
  await writeFile(media,bytes)
  db.db.insert(channels).values({id:'ch',name:'Channel',rateNum:25,rateDen:1,width:320,height:180,targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,createdAt:stamp}).run()
  db.db.insert(mediaAssets).values({id:'a',title:'VT',path:media,contentHash:hash,kind:'VIDEO',durationFrames:100,width:320,height:180,rateNum:25,rateDen:1,hasAudio:true,audioChannels:2,qcStatus:'APPROVED',createdAt:stamp}).run()
  db.db.insert(rundowns).values({id:'rd',channelId:'ch',name:'RD',date:'2026-10-09',plannedStart:0,loop:false,createdAt:stamp,updatedAt:stamp}).run()
  db.db.insert(rundownItems).values({id:'vt',rundownId:'rd',sortOrder:0,title:'VT',type:'VT',mediaId:'a',minDuration:0,anchor:{kind:'FLOW'},onOverrun:'PUSH',locked:false,autoNext:true,loop:false}).run()
  const edition=await publishOperationalPlaylist(db.db,(await getChannel(db.db,'ch'))!,'rd','@test')
  const execution=new ExecutionOwnership(db.db,{host:executionHostIdentity(),pid:2147483646,boot:randomUUID()}),owner=execution.claim('ch')
  new Checkpoints(db.sqlite,owner).write({version:1,channelId:'ch',rundownId:'rd',revisionId:edition.id,itemId:'vt',playing:true,realEngine:true,elapsed:25,programTrim:{in:0,out:100,contentHash:hash},rate:{num:25,den:1},audioChannels:2})
  owner.release()
  db.sqlite.exec('CREATE TABLE ha_recovery_origin(id INTEGER)')
  const fingerprint=installationVault(false).fingerprint,report={version:1,requestId:randomUUID(),phase:'QUARANTINED',restoredAt:stamp,backupSha256:'a'.repeat(64),vaultMode:'ORIGINAL_FILE',vaultFingerprint:fingerprint,validation:{integrity:'ok',foreignKeys:'ok',tables:{},restoredAt:stamp,protectedSecrets:'verified',vaultFingerprint:fingerprint,operationalState:{savedCheckpoints:1,savedPlayingCheckpoints:1,publishedRevisions:1,activeRevisions:1,asRunRecords:0,openAsRunRecords:0,executionResumeAllowed:false}},automaticTake:false,promotionReady:false,mediaCopied:false,originalReferencesPreserved:true}
  appendRestorationRecord(db.sqlite,report)
  const manifest=join(directory,'manifest.json');await writeFile(manifest,JSON.stringify({report,protectedProvenance:installationVault(false).encrypt(JSON.stringify(report),'backup-restore:v1:report')}))
  const fence=new HostDistributionFence('')
  vi.spyOn(fence,'assertOwned').mockImplementation(()=>{}) // unit-only native guard substitution
  return {db,directory,media,hash,manifest,fence,edition}
}
it('prepara cursor/edição/SHA/QC sem TAKE, posse nova, alteração de histórico ou remoção de quarentena',async()=>{
  const {db,manifest,fence}=await setup(),before=db.sqlite.prepare('SELECT * FROM channel_checkpoints').all(),owners=db.sqlite.prepare('SELECT * FROM execution_owner_runs').all()
  expect(await reviewRestoredExecution(db.db,manifest,fence)).toMatchObject({stage:'REVIEWED_NOT_ACTIVATED',activeChannels:1,publishedPlans:1,verifiedMedia:1,resumableCursors:1,promotionReady:false,activationPerformed:false})
  expect(db.sqlite.prepare('SELECT * FROM channel_checkpoints').all()).toEqual(before);expect(db.sqlite.prepare('SELECT * FROM execution_owner_runs').all()).toEqual(owners)
  expect(db.sqlite.prepare("SELECT name FROM sqlite_master WHERE name='ha_recovery_origin'").get()).toBeTruthy();expect(readStorageAdmission(db.sqlite)?.phase).toBe('OPEN')
})
it.each(['owner','revision','rate','audio','trim'] as const)('cursor inconsistente %s bloqueia sem reescrita',async field=>{
  const {db,manifest,fence}=await setup(),cursor=JSON.parse((db.sqlite.prepare('SELECT payload FROM channel_checkpoints').get() as {payload:string}).payload)
  if(field==='owner')delete cursor.ownerRunId
  if(field==='revision')cursor.revisionId='changed'
  if(field==='rate')cursor.rate={num:30,den:1}
  if(field==='audio')cursor.audioChannels=8
  if(field==='trim')delete cursor.programTrim
  db.sqlite.prepare('UPDATE channel_checkpoints SET payload=?').run(JSON.stringify(cursor))
  await expect(reviewRestoredExecution(db.db,manifest,fence)).rejects.toThrow();expect(JSON.parse((db.sqlite.prepare('SELECT payload FROM channel_checkpoints').get() as {payload:string}).payload)).toEqual(cursor)
  expect(readStorageAdmission(db.sqlite)?.phase).toBe('OPEN')
})
it('reprovação posterior por canal impede preparação da versão publicada',async()=>{
  const {db,hash,manifest,fence}=await setup();db.db.insert(qcDecisions).values({id:'qc',assetId:'a',contentHash:hash,channelId:'ch',status:'REJECTED',checks:{playable:false,errors:['Rejected'],warnings:[]},actor:'@test',createdAt:new Date().toISOString()}).run()
  await expect(reviewRestoredExecution(db.db,manifest,fence)).rejects.toThrow('aprovação')
})
it('arquivo alterado é recusado; cache comprovado permite preparar SHA publicado sem substituir original',async()=>{
  const {db,directory,media,hash,manifest,fence}=await setup(),original=Buffer.from('unit fixture bytes, not decoded video')
  await writeFile(media,'changed');await expect(reviewRestoredExecution(db.db,manifest,fence)).rejects.toThrow('SHA')
  const cache=join(directory,'cache');await mkdir(cache);await writeFile(join(cache,hash+'.media'),original)
  expect(await reviewRestoredExecution(db.db,manifest,fence,{cacheRoot:cache})).toMatchObject({verifiedMedia:1,activationPerformed:false})
})
it('perda da trava nativa no final recusa preparação e mantém quarentena',async()=>{
  const {db,manifest,fence}=await setup();let calls=0;vi.mocked(fence.assertOwned).mockImplementation(()=>{if(++calls>=4)throw new Error('native-lost')})
  await expect(reviewRestoredExecution(db.db,manifest,fence)).rejects.toThrow('native-lost');expect(readStorageAdmission(db.sqlite)?.phase).toBe('OPEN')
})
it('mudança de banco durante leitura assíncrona recusa snapshot misturado',async()=>{
  const {db,manifest,fence}=await setup();const {FileVersionVerifier}=await import('./file-version.js'),verify=FileVersionVerifier.prototype.matches
  vi.spyOn(FileVersionVerifier.prototype,'matches').mockImplementation(async function(this:InstanceType<typeof FileVersionVerifier>,path,hash){db.db.update(channels).set({name:'changed-during-review'}).where(eq(channels.id,'ch')).run();return verify.call(this,path,hash)})
  await expect(reviewRestoredExecution(db.db,manifest,fence)).rejects.toThrow('Banco mudou')
})
it('handoff retém reserva/fence, registra e audita atomicamente; peer recusado e shutdown libera sem promover',async()=>{
  const {db,manifest,fence}=await setup(true),file=db.sqlite.name
  let app:App|undefined
  try{
    const report=await reviewRestoredExecution(db.db,manifest,fence,{handoff:async admission=>{
      expect(()=>openDatabase(file)).toThrow('manutenção')
      app=await createApp(file,{restoredAdmission:admission})
      expect(app.hostFence).toBe(fence);expect(readStorageAdmission(app.sqlite)?.phase).toBe('MAINTENANCE')
      expect(()=>openDatabase(file)).toThrow('manutenção')
      await expect(createApp(file,{restoredAdmission:admission})).rejects.toThrow('já usada')
    }})
    expect(report).toMatchObject({backendAdmissionCompleted:true,storageReservationRetained:true,activationPerformed:false})
    expect(app!.sqlite.prepare("SELECT count(*) n FROM operator_decisions WHERE kind='RESTORED_BACKEND_ADMITTED'").get()).toEqual({n:1})
    expect(app!.sqlite.prepare('SELECT count(*) n FROM server_instances').get()).toEqual({n:1})
    expect(app!.distributionOwnership.status().blocked).toBe(true)
    db.sqlite.close() // raw review connection is no longer the lease owner
  }finally{if(app)await app.close()}
  const reopened=openDatabase(file);databases.push(reopened)
  expect(readStorageAdmission(reopened.sqlite)?.phase).toBe('OPEN');expect(reopened.sqlite.prepare("SELECT name FROM sqlite_master WHERE name='ha_recovery_origin'").get()).toBeTruthy()
})
it('falha de auditoria reverte registro, mantém cursor e não consome abertura operacional',async()=>{
  const {db,manifest,fence}=await setup(true),before=db.sqlite.prepare('SELECT * FROM channel_checkpoints').all()
  db.sqlite.exec("CREATE TRIGGER injected_admission_failure BEFORE INSERT ON operator_decisions WHEN NEW.kind='RESTORED_BACKEND_ADMITTED' BEGIN SELECT RAISE(ABORT,'injected-audit'); END")
  await expect(reviewRestoredExecution(db.db,manifest,fence,{handoff:async admission=>{await createApp(db.sqlite.name,{restoredAdmission:admission})}})).rejects.toThrow('injected-audit')
  expect(db.sqlite.prepare('SELECT count(*) n FROM server_instances').get()).toEqual({n:0})
  expect(db.sqlite.prepare('SELECT * FROM channel_checkpoints').all()).toEqual(before);expect(readStorageAdmission(db.sqlite)?.phase).toBe('OPEN')
})
it('objeto serializado/forjado não é admissão local e não abre SQLite',async()=>{
  await expect(createApp('this-file-must-not-be-created.db',{restoredAdmission:{} as never})).rejects.toThrow('capacidade local')
})
it('etapa STARTING/FAILED é durável e não remove origem ou permite autoridade nativa fora da capacidade',async()=>{
  const {db,manifest,fence}=await setup(true);let app:App|undefined
  try{
    await reviewRestoredExecution(db.db,manifest,fence,{handoff:async admission=>{app=await createApp(db.sqlite.name,{restoredAdmission:admission})}})
    const admission=app!.restoredAdmission!
    admission.beginNativeActivation(app!.sqlite)
    expect(readRestoredActivations(app!.sqlite).at(-1)?.phase).toBe('STARTING');expect(isRecoveryRehearsal(app!.sqlite)).toBe(true)
    expect(admission.nativeStageAllowed(app!.sqlite)).toBe(true)
    admission.finishNativeActivation(app!.sqlite,'FAILED',[],[],'native-stage-fixture')
    expect(readRestoredActivations(app!.sqlite).at(-1)?.phase).toBe('FAILED');expect(admission.nativeStageAllowed(app!.sqlite)).toBe(false);expect(isRecoveryRehearsal(app!.sqlite)).toBe(true)
    expect(app!.sqlite.prepare("SELECT name FROM sqlite_master WHERE name='ha_recovery_origin'").get()).toBeTruthy()
  }finally{if(app)await app.close()}
})
it('confirmação/auditoria/origem são atômicas; histórico assinado permanece e não é validação física',async()=>{
  const {db,manifest,fence}=await setup(true);let app:App|undefined
  try{
    await reviewRestoredExecution(db.db,manifest,fence,{handoff:async admission=>{app=await createApp(db.sqlite.name,{restoredAdmission:admission})}})
    const admission=app!.restoredAdmission!,sql=app!.sqlite;admission.beginNativeActivation(sql)
    expect(()=>admission.finishNativeActivation(sql,'CONFIRMED',[],[],null)).toThrow('todos')
    sql.exec("CREATE TRIGGER injected_confirm_failure BEFORE INSERT ON operator_decisions WHEN NEW.kind='RESTORED_ACTIVATION_CONFIRMED' BEGIN SELECT RAISE(ABORT,'confirm-audit'); END")
    expect(()=>admission.finishNativeActivation(sql,'CONFIRMED',['ch'],[],null)).toThrow('confirm-audit')
    expect(readRestoredActivations(sql).at(-1)?.phase).toBe('STARTING');expect(sql.prepare("SELECT name FROM sqlite_master WHERE name='ha_recovery_origin'").get()).toBeTruthy()
    sql.exec('DROP TRIGGER injected_confirm_failure')
    admission.finishNativeActivation(sql,'CONFIRMED',['ch'],[],null)
    const run=readRestoredActivations(sql).at(-1)!
    expect(run).toMatchObject({phase:'CONFIRMED',physicalOutputValidated:false,automaticPromotion:false});expect(isRecoveryRehearsal(sql)).toBe(false)
    expect(sql.prepare("SELECT name FROM sqlite_master WHERE name=?").get(run.originTable)).toBeTruthy()
    expect(()=>sql.exec('DELETE FROM restored_activation_runs')).toThrow('history')
    sql.exec("UPDATE restored_activation_runs SET signature='forged'")
    expect(isRecoveryRehearsal(sql)).toBe(true);expect(()=>readRestoredActivations(sql)).toThrow('inválido')
  }finally{if(app)await app.close()}
})
it('cursor nativo pausado é preservado e recusado antes de alocar recursos',async()=>{
  const {db,manifest,fence}=await setup(),saved=JSON.parse((db.sqlite.prepare('SELECT payload FROM channel_checkpoints').get() as {payload:string}).payload)
  saved.playing=false;delete saved.programTrim;db.sqlite.prepare('UPDATE channel_checkpoints SET payload=?').run(JSON.stringify(saved))
  await expect(reviewRestoredExecution(db.db,manifest,fence)).rejects.toThrow('PGM pausado')
  expect(JSON.parse((db.sqlite.prepare('SELECT payload FROM channel_checkpoints').get() as {payload:string}).payload)).toEqual(saved)
})
it('backup HELD requires paused native output admission, not only a valid checkpoint',async()=>{
  const {db,manifest,fence}=await setup(),saved=JSON.parse((db.sqlite.prepare('SELECT payload FROM channel_checkpoints').get() as {payload:string}).payload)
  saved.playing=false;saved.programHold={status:'HELD',decoderId:7,frames:saved.elapsed}
  db.sqlite.prepare('UPDATE channel_checkpoints SET payload=?').run(JSON.stringify(saved))
  const before={cursor:db.sqlite.prepare('SELECT * FROM channel_checkpoints').all(),activations:readRestoredActivations(db.sqlite)}
  await expect(reviewRestoredExecution(db.db,manifest,fence)).rejects.toThrow('admissão nativa pausada das saídas preparadas')
  expect({cursor:db.sqlite.prepare('SELECT * FROM channel_checkpoints').all(),activations:readRestoredActivations(db.sqlite)}).toEqual(before)
})
it('preparação HELD explícita confere cursor/corte sem ativar ou alterar checkpoint',async()=>{
  const {db,manifest,fence}=await setup(),saved=JSON.parse((db.sqlite.prepare('SELECT payload FROM channel_checkpoints').get() as {payload:string}).payload)
  saved.playing=false;saved.programHold={status:'HELD',decoderId:7,frames:saved.elapsed}
  db.sqlite.prepare('UPDATE channel_checkpoints SET payload=?').run(JSON.stringify(saved))
  const report=await reviewRestoredExecution(db.db,manifest,fence,{pausedPreparation:true})
  expect(report).toMatchObject({stage:'REVIEWED_NOT_ACTIVATED',activationPerformed:false,resumableCursors:1})
  expect(JSON.parse((db.sqlite.prepare('SELECT payload FROM channel_checkpoints').get() as {payload:string}).payload)).toEqual(saved)
})
it('corte salvo não pode ser relabelado como pausa alterando somente playing',async()=>{
  const {db,manifest,fence}=await setup()
  const saved=JSON.parse((db.sqlite.prepare('SELECT payload FROM channel_checkpoints').get() as {payload:string}).payload)
  saved.playing=false
  expect(saved.programTrim).toMatchObject({in:0,out:100})
  db.sqlite.prepare('UPDATE channel_checkpoints SET payload=?').run(JSON.stringify(saved))
  const before={cursor:db.sqlite.prepare('SELECT * FROM channel_checkpoints').all(),activations:readRestoredActivations(db.sqlite),admission:readStorageAdmission(db.sqlite)}
  await expect(reviewRestoredExecution(db.db,manifest,fence)).rejects.toThrow('Corte salvo não corresponde a PGM nativo reproduzível')
  expect({cursor:db.sqlite.prepare('SELECT * FROM channel_checkpoints').all(),activations:readRestoredActivations(db.sqlite)}).toEqual({cursor:before.cursor,activations:before.activations})
  const admission=readStorageAdmission(db.sqlite)!
  expect(admission).toMatchObject({phase:'OPEN',owner:null,revision:before.admission!.revision+2})
  expect(Date.parse(admission.changedAt)).toBeGreaterThanOrEqual(Date.parse(before.admission!.changedAt))
})

it.each(['alive','denied','remote','native-proof','forged'] as const)('recuperação explícita mantém reserva quando prova %s falha',async mode=>{
  const {db,manifest,fence}=await setup();new StorageMaintenance(db.sqlite).acquire()
  vi.spyOn(fence,'freshProof').mockImplementation(async()=>{if(mode==='native-proof')throw new Error('native-proof-refused')})
  if(mode==='remote'){const row=readStorageAdmission(db.sqlite)!,next={...row,owner:{...row.owner!,host:'REMOTE'}};db.sqlite.prepare('UPDATE storage_admission SET payload=?,signature=?').run(JSON.stringify(next),storageAdmissionSignature(next))}
  if(mode==='forged')db.sqlite.exec("UPDATE storage_admission SET signature='forged'")
  if(mode==='alive')vi.spyOn(process,'kill').mockImplementation(()=>true)
  else vi.spyOn(process,'kill').mockImplementation(()=>{throw Object.assign(new Error('unit-only absence probe'),{code:mode==='denied'?'EPERM':'ESRCH'})})
  const before=db.sqlite.prepare('SELECT * FROM storage_admission').all()
  await expect(recoverRestoredReservation(db.db,manifest,fence)).rejects.toThrow()
  expect(db.sqlite.prepare('SELECT * FROM storage_admission').all()).toEqual(before)
  expect(db.sqlite.prepare("SELECT count(*) n FROM operator_decisions WHERE kind='RESTORED_RESERVATION_RECOVERED'").get()).toEqual({n:0})
})
it('recuperação explícita auditada não altera cursor, posse, histórico ou quarentena',async()=>{
  const {db,manifest,fence}=await setup();new StorageMaintenance(db.sqlite).acquire()
  vi.spyOn(fence,'freshProof').mockResolvedValue();vi.spyOn(process,'kill').mockImplementation(()=>{throw Object.assign(new Error('unit-only absence'),{code:'ESRCH'})})
  const snapshot=()=>['channel_checkpoints','execution_owner_runs','as_run','restoration_records','ha_recovery_origin'].map(table=>db.sqlite.prepare(`SELECT * FROM ${table}`).all()),before=snapshot()
  expect(await recoverRestoredReservation(db.db,manifest,fence)).toMatchObject({stage:'RESERVATION_RELEASED_NOT_ACTIVATED',activationPerformed:false,interruptedActivationFailed:false})
  expect(readStorageAdmission(db.sqlite)?.phase).toBe('OPEN');expect(snapshot()).toEqual(before)
  expect(db.sqlite.prepare("SELECT count(*) n FROM operator_decisions WHERE kind='RESTORED_RESERVATION_RECOVERED'").get()).toEqual({n:1})
  await expect(recoverRestoredReservation(db.db,manifest,fence)).rejects.toThrow('Não há reserva')
})
it('ativação interrompida só vira FAILED junto da liberação/auditoria; falha reverte ambas',async()=>{
  const {db,manifest,fence}=await setup();new StorageMaintenance(db.sqlite).acquire()
  vi.spyOn(fence,'freshProof').mockResolvedValue();vi.spyOn(process,'kill').mockImplementation(()=>{throw Object.assign(new Error('unit-only absence'),{code:'ESRCH'})})
  const owner=readStorageAdmission(db.sqlite)!.owner!,instance={version:1 as const,id:randomUUID(),host:owner.host,pid:owner.pid,boot:randomUUID(),phase:'OPEN' as const,openedAt:new Date().toISOString(),closedAt:null}
  db.sqlite.prepare('INSERT INTO server_instances VALUES(?,?,?)').run(instance.id,JSON.stringify(instance),serverInstanceSignature(instance))
  const requestId=(await import('../db/restoration-records.js')).readRestorationRecords(db.sqlite).at(-1)!.requestId
  const activation:RestoredActivation={version:1,id:randomUUID(),requestId,instanceId:instance.id,phase:'STARTING',startedAt:new Date().toISOString(),finishedAt:null,nativeReadyChannels:[],resumedChannels:[],message:null,originTable:null,automaticPromotion:false,physicalOutputValidated:false}
  db.sqlite.prepare('INSERT INTO restored_activation_runs VALUES(?,?,?)').run(activation.id,JSON.stringify(activation),restoredActivationSignature(activation))
  db.sqlite.exec("CREATE TRIGGER recovery_audit_failure BEFORE INSERT ON operator_decisions WHEN NEW.kind='RESTORED_RESERVATION_RECOVERED' BEGIN SELECT RAISE(ABORT,'recovery-audit'); END")
  await expect(recoverRestoredReservation(db.db,manifest,fence)).rejects.toThrow('recovery-audit')
  expect(readStorageAdmission(db.sqlite)?.phase).toBe('MAINTENANCE');expect(readRestoredActivations(db.sqlite).at(-1)).toEqual(activation)
  db.sqlite.exec('DROP TRIGGER recovery_audit_failure')
  expect(await recoverRestoredReservation(db.db,manifest,fence)).toMatchObject({interruptedActivationFailed:true})
  expect(readRestoredActivations(db.sqlite).at(-1)?.phase).toBe('FAILED');expect(isRecoveryRehearsal(db.sqlite)).toBe(true)
})
