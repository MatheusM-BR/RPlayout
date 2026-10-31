import assert from 'node:assert/strict'
import {spawn,type ChildProcess} from 'node:child_process'
import {existsSync} from 'node:fs'
import {mkdtemp} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {randomUUID} from 'node:crypto'

// Native live source replacement over the REAL engine pipe with two local SRT
// test senders (primary/backup). Own temporary DB, own engine, null outputs.
// Proves IPC + decode + durable journal/checkpoint; NOT broadcast output,
// external NDI/OMT, DeckLink or remote clients.
const workspace=fileURLToPath(new URL('..',import.meta.url))
const windows=process.platform==='win32'
const directory=await mkdtemp(join(tmpdir(),'RPlayout-live-replacement-'))
process.env.RPLAYOUT_VAULT_FILE=join(directory,'vault.json')
process.env.RPLAYOUT_ENGINE??=[resolve(workspace,'apps/engine/target/release/rplayout-engine'+(windows?'.exe':'')),resolve(workspace,'apps/engine/target/debug/rplayout-engine'+(windows?'.exe':''))].find(existsSync)
assert.ok(process.env.RPLAYOUT_ENGINE&&existsSync(process.env.RPLAYOUT_ENGINE),'Engine compilado não encontrado; defina RPLAYOUT_ENGINE.')
const gstLaunch=windows?join(process.env.GSTREAMER_1_0_ROOT_MSVC_X86_64??'C:/Program Files/gstreamer/1.0/msvc_x86_64','bin','gst-launch-1.0.exe'):'gst-launch-1.0'
const ports={primary:19000+Math.floor(Math.random()*400),backup:0};ports.backup=ports.primary+500
const senders:ChildProcess[]=[]
function sender(port:number,pattern:string,freq:number){
 const child=spawn(gstLaunch,['-q','videotestsrc','is-live=true',`pattern=${pattern}`,'!','video/x-raw,width=320,height=180,framerate=25/1','!','videoconvert','!',
  'x264enc','tune=zerolatency','speed-preset=ultrafast','key-int-max=25','!','h264parse','config-interval=-1','!','mpegtsmux','name=m','alignment=7','!',`srtsink`,`uri=srt://127.0.0.1:${port}?mode=listener`,'wait-for-connection=false',
  'audiotestsrc','is-live=true',`freq=${freq}`,'!','audioconvert','!','audio/x-raw,channels=2,rate=48000','!','avenc_aac','!','aacparse','!','m.'],{stdio:['ignore','ignore','pipe'],windowsHide:true})
 let errors='';child.stderr?.on('data',chunk=>{errors=(errors+String(chunk)).slice(-4000)})
 child.on('exit',code=>{if(code)console.error(`Emissor SRT ${port} saiu ${code}: ${errors}`)})
 senders.push(child);return child
}
sender(ports.primary,'smpte',440);sender(ports.backup,'ball',880)
const primaryUrl=`srt://127.0.0.1:${ports.primary}?mode=caller&latency=120`,backupUrl=`srt://127.0.0.1:${ports.backup}?mode=caller&latency=120`

const [{openDatabase},{getChannel},{ChannelRuntime},{Checkpoints},{publishOperationalPlaylist},{ExecutionOwnership},schema]=await Promise.all([
 import('../apps/server/src/db/client.js'),import('../apps/server/src/db/repo.js'),import('../apps/server/src/app.js'),
 import('../apps/server/src/domain/checkpoints.js'),import('../apps/server/src/domain/operational-playlist.js'),
 import('../apps/server/src/domain/execution-ownership.js'),import('../apps/server/src/db/schema.js'),
])
const database=openDatabase(join(directory,'replacement.db'))
const ownership=new ExecutionOwnership(database.db)
let runtime:InstanceType<typeof ChannelRuntime>|null=null
async function waitFor(description:string,predicate:()=>boolean,timeout=30_000){
 const deadline=performance.now()+timeout
 while(performance.now()<deadline){
  runtime?.transport.tick();runtime?.transport.watchdog();runtime?.checkpoint(true)
  if(predicate())return
  await new Promise(resolve=>setTimeout(resolve,50))
 }
 throw new Error(`${description}: ${JSON.stringify(runtime?.transport.health())} ${JSON.stringify(runtime?.transport.state())}`)
}
const evidence:Record<string,unknown>={directory,engine:process.env.RPLAYOUT_ENGINE,platform:process.platform}
try{
 const now=new Date().toISOString()
 database.sqlite.prepare('INSERT INTO channels (id,name,rate_num,rate_den,width,height,target_lufs,ceiling_dbtp,limiter_lookahead_ms,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run('swap','Troca isolada',25,1,320,180,-23,-1,5,now)
 for(const [id,role,url,paired] of [['primary','PRIMARY',primaryUrl,'backup'],['backup','BACKUP',backupUrl,'primary']] as const)
  database.db.insert(schema.liveSources).values({id,channelId:'swap',name:id==='primary'?'Câmera Principal':'Câmera Reserva',kind:'SRT',targetUrl:url,role,pairedSourceId:paired,autoFailover:false,enabled:true,createdAt:now}).run()
 database.sqlite.prepare('INSERT INTO rundowns (id,channel_id,name,planned_start,date,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run('rd','swap','Grade',0,now.slice(0,10),now,now)
 database.db.insert(schema.rundownItems).values({id:'live',rundownId:'rd',sortOrder:0,title:'LIVE AÇÃO',type:'LIVE',sourceRef:primaryUrl,configuredSourceId:'primary',liveSourceType:'SRT',
  durationOverride:25*600,anchor:{kind:'FLOW'},onOverrun:'EXTEND',minDuration:0,autoNext:false,loop:false,locked:false} as never).run()
 const channel=(await getChannel(database.db,'swap'))!
 const revision=await publishOperationalPlaylist(database.db,channel,'rd','@process-test')
 const lease=ownership.claim('swap')
 runtime=new ChannelRuntime(channel,database.db,['null'],null,new Set(),new Map(),null,new Checkpoints(database.sqlite,lease),null,null,null,null,null,null,lease)
 await runtime.load('rd')
 await waitFor('Engine não ficou pronto',()=>runtime!.transport.health().ready)
 assert.equal(runtime.liveReplacementStatus()?.supported,true,'Engine real não anunciou o protocolo de troca')
 await runtime.transport.take('rd','live')
 await waitFor('Live principal não entrou no PGM',()=>runtime!.transport.state().onAir?.itemId==='live'&&(runtime!.transport.state().onAir?.elapsed??0)>=25)
 await waitFor('Ocorrência do as-run não abriu',()=>{try{runtime!.nativeReplacementSession({id:null,name:'qa'},()=>{});return runtime!.liveReplacementStatus()?.pgmSourceId==='primary'&&Boolean(runtime!.asRun.openOccurrence())}catch{return false}})
 const before=runtime.transport.state().onAir!
 const asRunBefore=runtime.asRun.openOccurrence()!
 const session=runtime.nativeReplacementSession({id:null,name:'qa'},()=>{})
 const key='qa-'+randomUUID()
 let prepared=await session.prepare(key,'backup')
 evidence.prepareFirstReceipt=prepared.receipt?.phase
 // Native opening is asynchronous: PREPARING first, READY via a later receipt.
 // Poll the durable journal; ask STATUS (lookup, never a new PREPARE) if idle.
 const readyBy=performance.now()+20_000
 while(prepared.receipt?.phase==='PREPARING'&&performance.now()<readyBy){
  await new Promise(resolve=>setTimeout(resolve,500));runtime.transport.tick()
  prepared={...prepared,...session.receipt(prepared.transactionId)}
  if(prepared.receipt?.phase==='PREPARING')prepared={...prepared,...await session.status(prepared.transactionId)}
 }
 evidence.prepare=prepared.receipt?.phase
 assert.equal(prepared.receipt?.phase,'READY','PREPARE não ficou pronto')
 assert.equal(runtime.transport.state().onAir?.itemId,'live');assert.equal(runtime.liveReplacementStatus()?.pgmSourceId,'primary','PREPARE não pode tocar o PGM')
 const committed=await session.commit(prepared.transactionId)
 evidence.commit=committed.receipt?.phase
 assert.equal(committed.nativeProgramConfirmed,true,'COMMIT não confirmado pelo engine real')
 await waitFor('PGM não passou à reserva',()=>runtime!.liveReplacementStatus()?.pgmSourceId==='backup')
 const after=runtime.transport.state().onAir!
 assert.equal(after.itemId,'live');assert.equal(after.startedAt,before.startedAt,'Relógio da live foi reiniciado')
 assert.equal(runtime.asRun.openOccurrence()?.id,asRunBefore.id,'A troca abriu outra ocorrência de as-run')
 await waitFor('Posição não avançou depois do corte',()=>(runtime!.transport.state().onAir?.elapsed??0)>=after.elapsed+25)
 const saved=new Checkpoints(database.sqlite).read('swap')!
 assert.equal(saved.version,2);assert.equal(saved.liveProgramBinding?.receipt.targetSourceId,'backup')
 assert.equal(runtime.transport.health().nativeLiveReplacement.selectionUncertain,false)
 // A replay of the same key answers from the journal: no second native cut.
 const replay=await session.prepare(key,'backup');assert.equal(replay.replayed,true)
 evidence.replayed=replay.replayed;evidence.revision=revision.id;evidence.checkpointVersion=saved.version;evidence.framesAfterCut=runtime.transport.state().onAir!.elapsed
 await runtime.transport.stop()
 await waitFor('STOP não esvaziou o PGM',()=>runtime!.transport.state().onAir===null)
 assert.equal(runtime.liveReplacementStatus()?.openTransactionId,null)
 console.log(JSON.stringify({result:'PASS',scope:'REAL_ENGINE_PIPE_SRT_LOCAL_TEST_SENDERS_NULL_OUTPUT; no broadcast output, external NDI/OMT, DeckLink or remote client',...evidence}))
}finally{
 if(runtime){const pid=runtime.transport.processId();runtime.close();const end=performance.now()+10_000;while(pid&&performance.now()<end){try{process.kill(pid,0)}catch{break};await new Promise(resolve=>setTimeout(resolve,50))}}
 ownership.close();database.sqlite.close()
 for(const child of senders)child.kill()
}
