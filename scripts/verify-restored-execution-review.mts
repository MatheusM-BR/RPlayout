import assert from 'node:assert/strict'
import {execFile,spawn,type ChildProcess} from 'node:child_process'
import {createServer} from 'node:net'
import {promisify} from 'node:util'
import {mkdtemp,readFile,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'
import {createRequire} from 'node:module'
const root=fileURLToPath(new URL('..',import.meta.url)),[measuredSource,vault,legacyFolder]=process.argv.slice(2)
assert.ok(measuredSource&&vault&&legacyFolder,'Pass previous own measured DB/vault and restored historical fixture folder, read-only inputs')
const directory=await mkdtemp(join(tmpdir(),'RPlayout-restored-review-')),run=promisify(execFile)
process.env.RPLAYOUT_VAULT_FILE=vault;delete process.env.RPLAYOUT_VAULT_KEY
const {openDatabase}=await import('../apps/server/src/db/client.js'),{channels,mediaAssets,rundowns,rundownItems}=await import('../apps/server/src/db/schema.js'),{getChannel}=await import('../apps/server/src/db/repo.js'),{publishOperationalPlaylist}=await import('../apps/server/src/domain/operational-playlist.js')
const {readStorageAdmission}=await import('../apps/server/src/db/storage-admission.js'),{readRestorationRecords}=await import('../apps/server/src/db/restoration-records.js')
const {readRestoredActivations}=await import('../apps/server/src/db/restored-activations.js')
const serverRequire=createRequire(new URL('../apps/server/package.json',import.meta.url)),Database=serverRequire('better-sqlite3'),{drizzle}=serverRequire('drizzle-orm/better-sqlite3')
const env={...Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^RPLAYOUT_|^VITEST$/i.test(key))),RPLAYOUT_INSTALL_ROOT:root}
const review=join(root,'apps/server/dist/review-restored.cjs'),restore=join(root,'apps/server/dist/restore-backup.cjs'),sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex')
let backend:ChildProcess|null=null,backendLog=''
async function exited(child:ChildProcess){if(child.exitCode!==null||child.signalCode!==null)return;let timer:ReturnType<typeof setTimeout>|undefined;try{await Promise.race([new Promise<void>(resolve=>child.once('exit',()=>resolve())),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Own backend exit observation expired')),15000)})])}finally{if(timer)clearTimeout(timer)}}
async function freePort(){const socket=createServer();await new Promise<void>(resolve=>socket.listen(0,'127.0.0.1',resolve));const port=(socket.address() as {port:number}).port;await new Promise<void>(resolve=>socket.close(()=>resolve()));return port}
let result:Record<string,unknown>={result:'FAIL',directory},source:any=null
try{
  const measured=new Database(measuredSource,{readonly:true,fileMustExist:true})
  let asset:any;try{asset=drizzle(measured).select().from(mediaAssets).all()[0]}finally{measured.close()}
  assert.ok(asset?.path&&(asset.durationNs||asset.durationFrames)&&asset.width&&asset.height,'Actual prior native probe metadata required')
  const mediaBefore=sha(await readFile(asset.path)),stamp=new Date().toISOString()
  assert.equal(mediaBefore,asset.contentHash)
  source=openDatabase(join(directory,'source.db'))
  source.db.insert(channels).values({id:'ch',name:'Review native media',rateNum:25,rateDen:1,width:320,height:180,targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,createdAt:stamp}).run()
  source.db.insert(mediaAssets).values({...asset,id:'asset',qcStatus:'APPROVED',ignored:false,createdAt:stamp}).run()
  source.db.insert(rundowns).values({id:'rd',channelId:'ch',name:'RD',date:'2026-10-09',plannedStart:0,loop:false,createdAt:stamp,updatedAt:stamp}).run()
  source.db.insert(rundownItems).values({id:'vt',rundownId:'rd',sortOrder:0,title:'VT',type:'VT',mediaId:'asset',minDuration:0,anchor:{kind:'FLOW'},onOverrun:'PUSH',locked:false,autoNext:true,loop:false}).run()
  await publishOperationalPlaylist(source.db,(await getChannel(source.db,'ch'))!,'rd','@verifier')
  const backup=join(directory,'backup.db');await source.sqlite.backup(backup);source.sqlite.close();source=null
  const destination=join(directory,'restored'),restoreReport=JSON.parse((await run(process.execPath,[restore,'--backup',backup,'--destination',destination,'--vault-file',vault],{env,windowsHide:true,timeout:90000})).stdout.trim())
  const file=join(destination,'service.db'),manifest=join(destination,'restore-quarantine.json'),db=new Database(file,{readonly:true,fileMustExist:true})
  let preserved:any
  try{preserved={receipts:readRestorationRecords(db),editions:db.prepare('SELECT * FROM operational_playlist_revisions').all(),cursors:db.prepare('SELECT * FROM channel_checkpoints').all(),owners:db.prepare('SELECT * FROM execution_owner_runs').all()}}finally{db.close()}
  const reviewed=JSON.parse((await run(process.execPath,[review,'--database',file,'--manifest',manifest,'--vault-file',vault],{env,windowsHide:true,timeout:90000})).stdout.trim())
  assert.deepEqual(reviewed,{stage:'REVIEWED_NOT_ACTIVATED',requestId:restoreReport.requestId,activeChannels:1,publishedPlans:1,verifiedMedia:1,resumableCursors:0,liveItemsRequiringSignalConfirmation:0,activationPerformed:false,promotionReady:false,physicalOutputValidated:false})
  const after=new Database(file,{readonly:true,fileMustExist:true})
  try{
    assert.equal(readStorageAdmission(after)?.phase,'OPEN');assert.equal(readStorageAdmission(after)?.revision,2)
    assert.deepEqual({receipts:readRestorationRecords(after),editions:after.prepare('SELECT * FROM operational_playlist_revisions').all(),cursors:after.prepare('SELECT * FROM channel_checkpoints').all(),owners:after.prepare('SELECT * FROM execution_owner_runs').all()},preserved)
    assert.ok(after.prepare("SELECT name FROM sqlite_master WHERE name='ha_recovery_origin'").get())
  }finally{after.close()}
  // Historical legacy cursor is deliberately not fabricated into signed native ownership.
  const legacyCopy=join(directory,'legacy-copy.db'),legacy=new Database(join(legacyFolder,'service.db'),{readonly:true,fileMustExist:true})
  try{await legacy.backup(legacyCopy)}finally{legacy.close()}
  try{await run(process.execPath,[review,'--database',legacyCopy,'--manifest',join(legacyFolder,'restore-quarantine.json'),'--vault-file',vault],{env,windowsHide:true,timeout:90000});throw new Error('Unexpected legacy approval')}
  catch(error:any){assert.equal(error.code,1);assert.match(error.stderr,/recursos da distribuição|legado|posse|predecessor/i)}
  const missingEnv={...env,RPLAYOUT_HOST_GUARD:''}
  try{await run(process.execPath,[review,'--database',file,'--manifest',manifest,'--vault-file',vault],{env:missingEnv,windowsHide:true,timeout:30000});throw new Error('Unexpected missing-helper approval')}
  catch(error:any){assert.equal(error.code,1);assert.match(error.stderr,/Posse nativa/)}
  assert.equal(sha(await readFile(asset.path)),mediaBefore)
  const server=join(root,'apps/server/dist/server.cjs'),port=await freePort(),peerFile=join(directory,'peer.db')
  const peerCopy=new Database(file,{readonly:true});try{await peerCopy.backup(peerFile)}finally{peerCopy.close()}
  const backendEnv={...env,RPLAYOUT_VAULT_FILE:vault,RPLAYOUT_DB:file,RPLAYOUT_MEDIA:join(directory,'media-root'),RPLAYOUT_THUMBS:join(directory,'thumbs'),RPLAYOUT_CACHE:join(directory,'cache'),RPLAYOUT_MEDIA_VERSIONS:join(directory,'versions'),RPLAYOUT_BACKUPS:join(directory,'backups'),RPLAYOUT_BACKUP_HOURS:'0',RPLAYOUT_ENGINE:'',RPLAYOUT_MEDIAMTX:'',RPLAYOUT_RELAY:'',RPLAYOUT_DEVICES:'',RPLAYOUT_PROBE:'',RPLAYOUT_PROXY:'',RPLAYOUT_AUDIO_ANALYSIS:'',HOST:'127.0.0.1',PORT:String(port),LOG_LEVEL:'warn'}
  // Test-only IPC driver emits the product's normal shutdown event. This is
  // not a claim about Windows signal delivery or a product control endpoint.
  backend=spawn(process.execPath,['-e',"process.on('message',m=>{if(m==='own-shutdown')process.emit('SIGTERM')});require(process.argv[1])",server,'--stage-restored',manifest],{cwd:directory,env:backendEnv,windowsHide:true,stdio:['ignore','pipe','pipe','ipc']})
  for(const stream of [backend.stdout,backend.stderr])stream?.on('data',chunk=>backendLog=(backendLog+String(chunk)).slice(-12000))
  const deadline=performance.now()+30000;let ready=false
  while(performance.now()<deadline){assert.ok(backend.exitCode===null&&backend.signalCode===null,backendLog);try{if((await fetch(`http://127.0.0.1:${port}/api/health`,{signal:AbortSignal.timeout(1000)})).ok){ready=true;break}}catch{}await new Promise(resolve=>setTimeout(resolve,100))}
  assert.ok(ready,'Own staged backend observation expired '+backendLog)
  const staged=new Database(file,{readonly:true})
  try{
    assert.equal(readStorageAdmission(staged)?.phase,'MAINTENANCE')
    assert.equal(staged.prepare('SELECT count(*) n FROM server_instances').get().n,1)
    assert.equal(staged.prepare("SELECT count(*) n FROM operator_decisions WHERE kind='RESTORED_BACKEND_ADMITTED'").get().n,1)
    assert.deepEqual(staged.prepare('SELECT * FROM execution_owner_runs').all(),preserved.owners)
    assert.deepEqual(staged.prepare('SELECT * FROM channel_checkpoints').all(),preserved.cursors)
  }finally{staged.close()}
  try{await run(process.execPath,[server],{cwd:directory,env:{...backendEnv,PORT:String(await freePort())},windowsHide:true,timeout:30000});throw new Error('Unexpected shared DB peer admission')}
  catch(error:any){assert.equal(error.code,1);assert.match(error.stderr,/Banco reservado para manutenção/)}
  try{await run(process.execPath,[server,'--stage-restored',manifest],{cwd:directory,env:{...backendEnv,RPLAYOUT_DB:peerFile,PORT:String(await freePort())},windowsHide:true,timeout:30000});throw new Error('Unexpected different DB host peer admission')}
  catch(error:any){assert.equal(error.code,1);assert.match(error.stderr,/Posse nativa não confirmada/)}
  backend.send('own-shutdown');await exited(backend);assert.equal(backend.exitCode,0,backendLog)
  const finished=new Database(file,{readonly:true})
  try{
    assert.equal(readStorageAdmission(finished)?.phase,'OPEN')
    assert.ok(finished.prepare("SELECT name FROM sqlite_master WHERE name='ha_recovery_origin'").get())
    assert.equal(finished.prepare("SELECT count(*) n FROM server_instances WHERE json_extract(payload,'$.phase')='STORAGE_CLOSED'").get().n,1)
    assert.deepEqual(finished.prepare('SELECT * FROM channel_checkpoints').all(),preserved.cursors)
  }finally{finished.close()}
  // Activation is a new, explicit invocation after the staged backend exited.
  // This fixture has NO playing cursor: native initialization is not PGM resume.
  const nativePort=await freePort(),gst=process.env.GSTREAMER_1_0_ROOT_MSVC_X86_64
  assert.ok(gst,'Actual GStreamer runtime required for native activation')
  const nativeEnv={...backendEnv,PORT:String(nativePort),RPLAYOUT_ENGINE:join(root,'apps/engine/target/release/rplayout-engine.exe'),RPLAYOUT_ENGINE_OUTPUT:'null',PATH:join(gst,'bin')+';'+process.env.PATH,GST_PLUGIN_PATH:join(gst,'lib/gstreamer-1.0'),GST_PLUGIN_SYSTEM_PATH:join(gst,'lib/gstreamer-1.0'),GST_PLUGIN_SCANNER:join(gst,'libexec/gstreamer-1.0/gst-plugin-scanner.exe'),GST_REGISTRY:join(directory,'native-registry.bin')}
  backend=spawn(process.execPath,['-e',"process.on('message',m=>{if(m==='own-shutdown')process.emit('SIGTERM')});require(process.argv[1])",server,'--activate-restored',manifest],{cwd:directory,env:nativeEnv,windowsHide:true,stdio:['ignore','pipe','pipe','ipc']})
  for(const stream of [backend.stdout,backend.stderr])stream?.on('data',chunk=>backendLog=(backendLog+String(chunk)).slice(-12000))
  const nativeDeadline=performance.now()+45000;let nativeReady=false
  while(performance.now()<nativeDeadline){assert.ok(backend.exitCode===null&&backend.signalCode===null,backendLog);try{if((await fetch(`http://127.0.0.1:${nativePort}/api/health`,{signal:AbortSignal.timeout(1000)})).ok){nativeReady=true;break}}catch{}await new Promise(resolve=>setTimeout(resolve,100))}
  assert.ok(nativeReady,'Own native activation observation expired '+backendLog)
  let confirmedActivation:any
  const activated=new Database(file,{readonly:true})
  try{
    confirmedActivation=readRestoredActivations(activated).at(-1)
    assert.equal(confirmedActivation?.phase,'CONFIRMED')
    assert.deepEqual(confirmedActivation.nativeReadyChannels,['ch']);assert.deepEqual(confirmedActivation.resumedChannels,[])
    assert.equal(confirmedActivation.physicalOutputValidated,false);assert.equal(confirmedActivation.automaticPromotion,false)
    assert.equal(readStorageAdmission(activated)?.phase,'MAINTENANCE')
    assert.equal(activated.prepare("SELECT name FROM sqlite_master WHERE name='ha_recovery_origin'").get(),undefined)
    assert.ok(activated.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(confirmedActivation.originTable))
    assert.deepEqual(readRestorationRecords(activated),preserved.receipts)
    assert.deepEqual(activated.prepare('SELECT * FROM operational_playlist_revisions').all(),preserved.editions)
    assert.ok(activated.prepare('SELECT count(*) n FROM execution_owner_runs').get().n>preserved.owners.length)
  }finally{activated.close()}
  backend.send('own-shutdown');await exited(backend);assert.equal(backend.exitCode,0,backendLog)
  const nativeFinished=new Database(file,{readonly:true})
  try{assert.equal(readStorageAdmission(nativeFinished)?.phase,'OPEN');assert.deepEqual(readRestoredActivations(nativeFinished).at(-1),confirmedActivation)}finally{nativeFinished.close()}
  result={result:'PASS',directory,compiledReviewSha256:sha(await readFile(review)),compiledServerSha256:sha(await readFile(join(root,'apps/server/dist/server.cjs'))),actualNativeHostGuard:true,publishedPlanAndMediaShaChecked:true,metadataFromEarlierActualNativeProbe:true,noNewNativeProbeRun:true,quarantineAndPublicationAndReceiptsAndCursorAndExecutionOwnersPreservedDuringStaging:true,storageReservationReleased:true,legacyUnownedCursorRefused:true,missingNativeGuardRefused:true,compiledBackendAdmittedWithRetainedFenceAndStorageReservation:true,sharedDatabasePeerRefused:true,differentDatabaseNativeHostPeerRefused:true,normalProductShutdownHandlerReleasesStorageAndSignsClosedInstance:true,engineStarted:true,nativeIdleInitializationConfirmed:true,playingCursorResumeExercised:false,takeSent:false,physicalPgmValidated:false,activationPerformed:true,signedActivationAndArchivedOriginPreserved:true,nullOutputOnly:true}
}catch(error){result={...result,error:String(error)};throw error}
finally{source?.sqlite.close();if(backend&&backend.exitCode===null&&backend.signalCode===null){backend.kill('SIGKILL');await exited(backend)}await writeFile(join(directory,'backend.log'),backendLog);await writeFile(join(directory,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result))}
