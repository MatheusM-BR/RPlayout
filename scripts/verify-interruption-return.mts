import assert from 'node:assert/strict'
import {spawn,execFile,type ChildProcess} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdtemp,mkdir,readFile} from 'node:fs/promises'
import {tmpdir,hostname} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createHash,randomUUID} from 'node:crypto'
import {createServer} from 'node:net'
import {createRequire} from 'node:module'
import {operatorDecisions,outputProfiles} from '../apps/server/src/db/schema.js'
import {Interruptions} from '../apps/server/src/domain/interruptions.js'
import {InterruptionCommands} from '../apps/server/src/domain/interruption-commands.js'
import type {ItemView} from '../apps/server/src/domain/plan.js'

// Native local file/PGM evidence, not a physical live source or output test.
// Crash/unknown phase is injected durably, never by intercepting operator traffic.
const root=fileURLToPath(new URL('..',import.meta.url)),directory=await mkdtemp(join(tmpdir(),'RPlayout-interrupted-return-'))
const {eq}=createRequire(join(root,'apps/server/package.json'))('drizzle-orm') as typeof import('../apps/server/node_modules/drizzle-orm')
const media=join(directory,'media');await mkdir(media)
process.env.RPLAYOUT_VAULT_FILE=join(directory,'vault.json')
const gstRoot=process.env.GSTREAMER_1_0_ROOT_MSVC_X86_64??'C:/Program Files/gstreamer/1.0/msvc_x86_64',gstBin=join(gstRoot,'bin'),file=join(media,'RETORNO-ÇÃO.mp4')
const gstEnv={...process.env,GST_REGISTRY:join(directory,'gst-registry.bin'),GST_PLUGIN_SCANNER:join(gstRoot,'libexec/gstreamer-1.0/gst-plugin-scanner.exe'),GST_PLUGIN_PATH:join(gstRoot,'lib/gstreamer-1.0'),GST_PLUGIN_SYSTEM_PATH:join(gstRoot,'lib/gstreamer-1.0'),PATH:gstBin+';'+process.env.PATH}
await promisify(execFile)(join(gstBin,'gst-launch-1.0.exe'),['-q','videotestsrc','num-buffers=1500','!','video/x-raw,width=320,height=180,framerate=25/1','!','videoconvert','!','x264enc','speed-preset=ultrafast','!','h264parse','!','mp4mux','!','filesink',`location=${file.replaceAll('\\','/')}`],{timeout:60_000,windowsHide:true,env:gstEnv})
const {openDatabase}=await import('../apps/server/src/db/client.js'),database=openDatabase(join(directory,'return.db'))
const reservation=createServer();await new Promise<void>(r=>reservation.listen(0,'127.0.0.1',r));const port=(reservation.address() as {port:number}).port;await new Promise<void>(r=>reservation.close(()=>r()))
const base=`http://127.0.0.1:${port}`,ownedEngines=new Set<number>();let child:ChildProcess|null=null,diagnostics=''
const alive=(pid:number)=>{try{process.kill(pid,0);return true}catch{return false}}
async function wait(message:string,check:()=>boolean|Promise<boolean>,timeout=20_000){const end=performance.now()+timeout;while(performance.now()<end){if(await check())return;await new Promise(r=>setTimeout(r,100))}throw new Error(message+'; '+diagnostics.slice(-2500))}
async function api(path:string,body?:object,status=200,headers:Record<string,string>={}){const reply=await fetch(base+path,{...(body?{method:'POST',body:JSON.stringify(body)}:{}),headers:{...(body?{'content-type':'application/json'}:{}),...headers},signal:AbortSignal.timeout(5000)});const result=await reply.json() as any;assert.equal(reply.status,status,`${path}: ${JSON.stringify(result)}`);return result}
async function start(expectedEngines:number){
  diagnostics='';child=spawn(process.execPath,[join(root,'apps/server/dist/server.cjs')],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...gstEnv,RPLAYOUT_INSTALL_ROOT:root,RPLAYOUT_DB:join(directory,'return.db'),RPLAYOUT_MEDIA:media,RPLAYOUT_THUMBS:join(directory,'thumbs'),RPLAYOUT_MEDIA_VERSIONS:join(directory,'versions'),RPLAYOUT_CACHE:join(directory,'cache'),RPLAYOUT_BACKUPS:join(directory,'backups'),RPLAYOUT_ENGINE:join(root,'apps/engine/target/release/rplayout-engine.exe'),RPLAYOUT_ENGINE_OUTPUT:'null',RPLAYOUT_MEDIAMTX:'',RPLAYOUT_DEVICES:'',RPLAYOUT_RELAY:'',RPLAYOUT_PROBE:'',RPLAYOUT_PROXY:'',RPLAYOUT_AUDIO_ANALYSIS:'',RPLAYOUT_N1_PEER:'',RPLAYOUT_BACKUP_HOURS:'0',RPLAYOUT_ADMIN_USER:'',RPLAYOUT_ADMIN_PASSWORD:'',RPLAYOUT_ROLE:'ADMIN',RPLAYOUT_CONTROL_TOKEN:'',HOST:'127.0.0.1',PORT:String(port),LOG_LEVEL:'warn'}})
  for(const stream of [child.stdout,child.stderr])stream?.on('data',chunk=>diagnostics=(diagnostics+String(chunk)).slice(-8000));child.on('error',error=>diagnostics+=error.message)
  await wait('Servidor não iniciou',async()=>{try{return(await api('/api/health')).engines===expectedEngines}catch{return false}})
}
async function engine(){const row=(await api('/api/processes')).processes.find((r:any)=>r.kind==='ENGINE'&&r.channelId==='ch');assert.ok(row?.pid);ownedEngines.add(row.pid);return row.pid as number}
async function stop(){const pid=child?.pid;child?.kill('SIGKILL');if(pid)await wait('Servidor próprio não encerrou',()=>!alive(pid),10_000);for(const id of ownedEngines)if(alive(id)){process.kill(id);await wait('Engine próprio não encerrou',()=>!alive(id),10_000)}child=null}
const row=async(id:string)=>(await api('/api/channels/ch/interruptions')).items.find((r:any)=>r.id===id)
try{
  const now=new Date().toISOString(),hash=createHash('sha256').update(await readFile(file)).digest('hex')
  database.sqlite.prepare('INSERT INTO channels(id,name,rate_num,rate_den,width,height,target_lufs,ceiling_dbtp,limiter_lookahead_ms,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run('ch','Retorno QA',25,1,320,180,-23,-1,5,now)
  // A real preview bus, with its publisher left on-demand/idle. No MediaMTX
  // receiver is started and delivery/browser playback is not claimed.
  database.db.insert(outputProfiles).values({id:'preview',channelId:'ch',name:'Preview QA',role:'PREVIEW',kind:'SRT',target:'',width:320,height:180,rateNum:15,rateDen:1,bitrateKbps:450,scan:'PROGRESSIVE',enabled:true,createdAt:now}).run()
  database.sqlite.prepare('INSERT INTO rundowns(id,channel_id,name,planned_start,date,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run('rd','ch','Grade QA',0,now.slice(0,10),now,now)
  database.sqlite.prepare('INSERT INTO media_assets(id,content_hash,path,title,kind,duration_frames,width,height,rate_num,rate_den,has_audio,qc_status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run('asset',hash,file,'VT QA','VIDEO',1500,320,180,25,1,0,'APPROVED',now)
  for(const [n,id] of ['vt','other'].entries())database.sqlite.prepare('INSERT INTO rundown_items(id,rundown_id,sort_order,title,type,media_id,anchor,on_overrun,min_duration,auto_next,loop,locked) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id,'rd',n,id,'VT','asset',JSON.stringify({kind:'FLOW'}),'PUSH',0,0,0,0)
  await start(1);await engine()
  const publication=(await api('/api/rundowns/rd/operational-simulation')).review
  await api('/api/rundowns/rd/operational-publish',{reviewToken:publication.token},201,{'if-match':`w/"${publication.editorialRevision}"`})
  await api('/api/channels/ch/transport',{action:'take',itemId:'vt'})
  await wait('Engine não reportou cursor',async()=>{const s=(await api('/api/n1/state')).channels[0].state;return s.onAir?.itemId==='vt'&&s.onAir.elapsed>25})
  const cursor=(await api('/api/n1/state')).channels[0].state.onAir.elapsed
  const view=(await api('/api/rundowns/rd')).view,entry=view.items.find((r:any)=>r.item.id==='vt') as ItemView
  assert.ok(entry)
  await api('/api/channels/ch/transport',{action:'take',itemId:'other'})
  const interruptions=new Interruptions(database.sqlite),id=interruptions.record('ch','rd',null,entry,Math.floor(cursor))!
  assert.ok(id);const proof=await row(id),requestId=randomUUID(),body={action:'RESUME',requestId,reviewToken:proof.reviewToken}
  const result=await api(`/api/channels/ch/interruptions/${id}`,body)
  assert.equal(result.run.nativeProgramConfirmed,true);assert.equal(result.run.physicalOutputValidated,false)
  assert.equal((await api('/api/n1/state')).channels[0].state.onAir.itemId,'vt')
  assert.equal((await api(`/api/channels/ch/interruptions/${id}`,body)).deduplicated,true)
  await wait('As-run não registrou retorno',()=>Boolean(database.sqlite.prepare('SELECT 1 FROM as_run WHERE item_id=? AND start_position_frames=?').get('vt',Math.floor(cursor))))
  const priorEngine=await engine()
  const insertion=async(mode:'NEXT'|'NOW')=>{
    const input={requestId:randomUUID(),mode,mediaId:'asset'},review=await api('/api/channels/ch/operational-insert/review',input)
    return {input,reviewToken:review.reviewToken,confirm:true}
  }
  await api('/api/channels/ch/transport',{action:'cue',itemId:'other'})
  const cueBefore=(await api('/api/n1/state')).channels[0].state.preview
  assert.deepEqual(cueBefore,{kind:'ITEM',id:'other'})
  const next=await insertion('NEXT'),nextResult=await api('/api/channels/ch/operational-insert',next)
  assert.equal(nextResult.run.phase,'CONFIRMED');assert.equal(nextResult.run.nativeProgramConfirmed,false)
  assert.equal((await api('/api/n1/state')).channels[0].state.onAir.itemId,'vt')
  assert.deepEqual((await api('/api/n1/state')).channels[0].state.preview,cueBefore,'NEXT substituiu CUE manual')
  assert.equal(nextResult.view.items.length,2);assert.equal(nextResult.executionView.items.length,3)
  assert.equal((await api('/api/channels/ch/operational-insert',next)).deduplicated,true)
  const nowInput=await insertion('NOW'),nowResult=await api('/api/channels/ch/operational-insert',nowInput)
  assert.equal(nowResult.run.nativeProgramConfirmed,true);assert.equal((await api('/api/n1/state')).channels[0].state.onAir.itemId,`urgent:${nowInput.input.requestId}`)
  assert.equal((await api('/api/channels/ch/operational-insert',nowInput)).deduplicated,true)
  assert.equal(await engine(),priorEngine,'Intervenção recriou engine ou derrubou o canal')
  assert.equal((database.sqlite.prepare('SELECT count(*) n FROM rundown_items').get() as any).n,2,'Intervenção publicou rascunho editorial')
  assert.ok(interruptions.list('ch').some(row=>row.item_id==='vt'&&row.state==='PENDING'))
  const stale=await insertion('NEXT')
  await api('/api/channels/ch/transport',{action:'take',itemId:'other'})
  await api('/api/channels/ch/operational-insert',stale,409)
  const unknownId=interruptions.record('ch','rd',null,entry,Math.floor(cursor))!,unknownRequest=randomUUID(),commands=new InterruptionCommands(database.db,database.sqlite)
  await commands.execute(unknownRequest,{channelId:'ch',interruptionId:unknownId,action:'RESUME',reviewToken:(await row(unknownId)).reviewToken},'QA',await engine(),()=>{},()=>{},async l=>{l.beforeTake();throw new Error('QA unknown TAKE outcome')})
  const journal=database.db.select().from(operatorDecisions).where(eq(operatorDecisions.id,`interruption-command:${unknownRequest}`)).get()!
  database.db.update(operatorDecisions).set({payload:{...journal.payload,owner:{host:hostname(),pid:child!.pid!,boot:randomUUID(),enginePid:await engine()}}}).where(eq(operatorDecisions.id,journal.id)).run()
  assert.equal((await row(unknownId)).canReconcile,false,'Processos vivos não podem ser roubados')
  await api('/api/channels/ch/transport',{action:'take',itemId:'vt'},409)
  await stop();await start(0)
  assert.equal((await api('/api/processes')).processes.some((r:any)=>r.kind==='ENGINE'&&r.pid),false)
  const pending=await row(unknownId);assert.equal(pending.state,'UNCERTAIN');assert.equal(pending.canReconcile,true)
  const ack=await api(`/api/channels/ch/interruptions/${unknownId}/acknowledge`,{requestId:unknownRequest,reviewToken:pending.reviewToken,confirm:true})
  assert.equal(ack.automaticTake,false)
  const checkpoint=JSON.parse((database.sqlite.prepare('SELECT payload FROM channel_checkpoints WHERE channel_id=?').get('ch') as any).payload)
  assert.equal(checkpoint.playing,false);assert.equal(checkpoint.itemId,null)
  await stop();await start(1);await engine()
  const state=(await api('/api/n1/state')).channels[0].state;assert.equal(state.onAir,null);assert.equal(state.playing,false)
  assert.equal((database.sqlite.prepare('SELECT state FROM interrupted_items WHERE id=?').get(unknownId) as any).state,'CLOSED_UNCERTAIN')
  // Real native PGM changes, followed by an injected audit persistence failure.
  // This is not a lost native ACK test: it exercises the post-cut unknown path.
  await api('/api/channels/ch/transport',{action:'take',itemId:'vt'})
  const failedInsertion=await insertion('NOW')
  database.sqlite.exec("CREATE TRIGGER qa_insert_audit BEFORE INSERT ON operator_decisions WHEN NEW.kind='OPERATIONAL_INSERT_COMMITTED' BEGIN SELECT RAISE(ABORT,'QA insertion audit failure'); END")
  await api('/api/channels/ch/operational-insert',failedInsertion,409)
  database.sqlite.exec('DROP TRIGGER qa_insert_audit')
  assert.equal((await api('/api/n1/state')).channels[0].state.onAir.itemId,`urgent:${failedInsertion.input.requestId}`)
  const insertStatus=await api(`/api/channels/ch/operational-insert/${failedInsertion.input.requestId}`)
  assert.equal(insertStatus.run.phase,'UNCERTAIN');assert.equal(insertStatus.automaticTake,false)
  assert.equal(insertStatus.configurationOperation.state,'UNCERTAIN')
  await stop();await start(0)
  const stoppedInsert=await api(`/api/channels/ch/operational-insert/${failedInsertion.input.requestId}`)
  assert.equal(stoppedInsert.run.phase,'UNCERTAIN');assert.equal(stoppedInsert.configurationOperation.reconcilable,true)
  assert.equal((await api('/api/processes')).processes.some((r:any)=>r.kind==='ENGINE'&&r.pid),false)
  const outputsReply=await fetch(base+'/api/channels/ch/outputs'),outputsProof=outputsReply.headers.get('etag')!
  assert.equal(outputsReply.status,200);assert.ok(outputsProof)
  const reconciled=await api('/api/channels/ch/configuration-operation/reconcile',{runId:stoppedInsert.configurationOperation.runId,confirm:true},200,{'if-match':outputsProof})
  assert.equal(reconciled.automaticTake,false)
  await api('/api/channels/ch/operational-insert',failedInsertion,409)
  await engine();assert.equal((await api('/api/n1/state')).channels[0].state.onAir,null)
  await stop();await start(1);await engine()
  assert.equal((await api('/api/n1/state')).channels[0].state.onAir,null)
  assert.equal((await api(`/api/channels/ch/operational-insert/${failedInsertion.input.requestId}`)).run.phase,'UNCERTAIN')
  console.log(JSON.stringify({result:'PASS',directory,port,evidence:'COMPILED_NATIVE_INSERT_NEXT_NOW_RETURN_AND_DURABLE_CRASH_FENCE',cursorFrames:Math.floor(cursor),insertNextPreservesPgm:true,insertNextPreservesManualCue:true,insertNowConfirmedNative:true,insertionDoesNotPublishDraft:true,insertionKeepsEngine:true,insertionDuplicateNotRetaken:true,staleInsertionRefused:true,duplicateDoesNotTake:true,asRunCursorRecorded:true,liveOwnersCannotBeStolen:true,restartDoesNotReplayUnknownTake:true,acknowledgementDoesNotResumeCursor:true,insertionAuditFailureAfterRealCutFenced:true,insertionRestartDoesNotReplay:true,insertionReconcilesStoppedWithoutTake:true,physicalOutputValidated:false,physicalLiveInputValidated:false}))
}finally{await stop();database.sqlite.close()}
