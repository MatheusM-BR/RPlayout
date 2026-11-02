import assert from 'node:assert/strict'
import {spawn,execFile,type ChildProcess} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdtemp,readFile,writeFile,stat} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {createHash,randomUUID} from 'node:crypto'
import {createServer} from 'node:net'
import {createSocket} from 'node:dgram'
import {createServer as httpServer,request as forward,type Server} from 'node:http'
import {compensationDeltaFrames} from '../apps/web/src/domain/compensation-input.js'
import {verifyPublishedPicture} from './lib/verify-published-picture.js'

// Compiled API/native selectors + actual local media. No physical publisher,
// browser or production DB. The file-backed LIVE fixture is not NDI/OMT/SDI.
const root=fileURLToPath(new URL('..',import.meta.url)),directory=await mkdtemp(join(root,'scratch','priority-playout-'))
const fillerDelta=process.argv.includes('--decimal-compensation')?compensationDeltaFrames('FILLER','2,5',{num:25,den:1}):25
const fillerNominal=50+fillerDelta
const serverArgument=process.argv.find(value=>value.startsWith('--server-binary='))
const serverBinary=serverArgument?resolve(serverArgument.slice('--server-binary='.length)):join(root,'apps/server/dist/server.cjs')
await readFile(serverBinary)
const compensationActors=process.argv.includes('--compensation-actors')
const compensationRace=process.argv.includes('--compensation-race')||compensationActors
const cueProtectionNative=process.argv.includes('--cue-protection-native')
const browserInsertion=process.argv.includes('--browser-insertion')
const cueNominalFrames=cueProtectionNative?500:50
const browserAllActions=process.argv.includes('--browser-all-actions')
const browserCompensation=process.argv.includes('--browser-compensation')||compensationRace||cueProtectionNative||browserInsertion
const dropCompensationReply=process.argv.includes('--drop-compensation-reply')
assert.ok(!dropCompensationReply||browserCompensation,'Fault relay requires isolated visual compensation mode')
assert.ok(!cueProtectionNative||!compensationRace&&!dropCompensationReply&&!browserAllActions,'Select the directed CUE mode separately')
assert.ok(!browserInsertion||!compensationRace&&!dropCompensationReply&&!browserAllActions&&!cueProtectionNative,'Select insertion browser mode separately')
if(cueProtectionNative){
  // Fixed documented broker ports must be free. Never borrow or stop an
  // operational broker, even when its configuration looks compatible.
  for(const port of [1935,8554,8888,8889,9997]){
    const socket=createServer();await new Promise<void>((resolve,reject)=>{socket.once('error',reject);socket.listen(port,'127.0.0.1',resolve)})
    await new Promise<void>(resolve=>socket.close(()=>resolve()))
  }
  const udp=createSocket('udp4');await new Promise<void>((resolve,reject)=>{udp.once('error',reject);udp.bind(8890,'127.0.0.1',resolve)});udp.close()
}
const gstRoot=process.env.GSTREAMER_1_0_ROOT_MSVC_X86_64??'C:/Program Files/gstreamer/1.0/msvc_x86_64',gstBin=join(gstRoot,'bin')
const environment={...process.env,PATH:gstBin+';'+process.env.PATH,GST_PLUGIN_PATH:join(gstRoot,'lib/gstreamer-1.0'),GST_PLUGIN_SYSTEM_PATH:join(gstRoot,'lib/gstreamer-1.0'),GST_PLUGIN_SCANNER:join(gstRoot,'libexec/gstreamer-1.0/gst-plugin-scanner.exe'),GST_REGISTRY:join(directory,'registry.bin')}
for(const name of Object.keys(environment))if(name.startsWith('RPLAYOUT_'))delete environment[name]
if(serverArgument)Object.assign(environment,{NODE_PATH:join(root,'apps/server/node_modules')})
const file=join(directory,'Programação-ação-ÇÃO.mkv')
await promisify(execFile)(join(gstBin,'gst-launch-1.0.exe'),['-q','matroskamux','name=m','!','filesink',`location=${file.replaceAll('\\','/')}`,
  'videotestsrc','num-buffers=1500','pattern=ball','!','video/x-raw,width=320,height=180,framerate=25/1','!','videoconvert','!','vp8enc','deadline=1','threads=2','!','queue','!','m.',
  'audiotestsrc','num-buffers=2813','samplesperbuffer=1024','volume=0.05','!','audio/x-raw,rate=48000,channels=2','!','audioconvert','!','vorbisenc','!','queue','!','m.'],{env:environment,windowsHide:true,timeout:60_000})
const mediaHash=createHash('sha256').update(await readFile(file)).digest('hex')
process.env.RPLAYOUT_VAULT_FILE=join(directory,'vault.json')
const {openDatabase}=await import('../apps/server/src/db/client.js')
const {channels,rundowns,rundownItems,mediaAssets,outputProfiles,operationalPlaylistRevisions,secondaryEvents}=await import('../apps/server/src/db/schema.js')
const database=openDatabase(join(directory,'priority.db')),stamp=new Date().toISOString()
if(browserInsertion){
  const {mediaRoots}=await import('../apps/server/src/db/schema.js')
  database.db.insert(mediaRoots).values({id:'fixture-root',path:directory,label:'Acervo isolado',createdAt:stamp}).run()
}
let browserToken=''
const actorTokens:string[]=[]
if(browserCompensation){
  const {hashPassword}=await import('../apps/server/src/domain/auth.js'),{sessionDigest}=await import('../apps/server/src/domain/access.js')
  browserToken=randomUUID()+randomUUID()
  database.sqlite.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run('compensation-verifier','compensation-verifier',await hashPassword('Local-compensation-QA-20261012'),'ADMIN',1,stamp)
  database.sqlite.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(sessionDigest(browserToken),'compensation-verifier','2099-01-01',stamp)
  actorTokens.push(browserToken)
  if(compensationActors){
    const token=randomUUID()+randomUUID()
    database.sqlite.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run('compensation-verifier-two','compensation-verifier-two',await hashPassword('Local-compensation-second-QA'),'ADMIN',1,stamp)
    database.sqlite.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(sessionDigest(token),'compensation-verifier-two','2099-01-01',stamp)
    actorTokens.push(token)
  }
}
database.db.insert(channels).values({id:'priority',name:'Priority isolated',width:320,height:180,rateNum:25,rateDen:1,targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,createdAt:stamp}).run()
database.db.insert(rundowns).values({id:'rd',channelId:'priority',name:'Priority fixture',date:'2026-10-06',plannedStart:0,loop:false,createdAt:stamp,updatedAt:stamp}).run()
database.db.insert(mediaAssets).values({id:'asset',title:'Real VT',path:file,contentHash:mediaHash,kind:'VIDEO',durationFrames:1500,durationNs:60_000_000_000,width:320,height:180,rateNum:25,rateDen:1,hasAudio:true,interlaceMode:'progressive',qcStatus:'APPROVED',createdAt:stamp}).run()
database.db.insert(rundownItems).values({id:'vt',rundownId:'rd',sortOrder:0,title:'Published VT',type:'VT',mediaId:'asset',minDuration:0,anchor:{kind:'FLOW'},onOverrun:'PUSH',autoNext:false,loop:false,locked:false}).run()
database.db.insert(rundownItems).values({id:'live',rundownId:'rd',sortOrder:1,title:'Priority live',type:'LIVE',sourceRef:pathToFileURL(file).href,durationOverride:750,liveAutoFollowOnEnd:false,minDuration:0,anchor:{kind:'HARD_TIME',at:0},onOverrun:'PUSH',autoNext:false,loop:false,locked:false}).run()
database.db.insert(rundownItems).values({id:'filler',rundownId:'rd',sortOrder:2,title:'Finite filler',type:'FILLER',mediaId:'asset',durationOverride:cueNominalFrames,trim:{in:0,out:cueNominalFrames},elastic:{min:25,max:cueProtectionNative?1000:300},minDuration:25,anchor:{kind:'FLOW'},onOverrun:'PUSH',autoNext:true,loop:false,locked:false}).run()
for(const [offset,id] of ['optional','soft','mandatory','protected','trim-vt'].entries())database.db.insert(rundownItems).values({id,rundownId:'rd',sortOrder:offset+3,title:id,type:id==='protected'?'FILLER':'VT',mediaId:'asset',durationOverride:id==='trim-vt'?125:75,trim:{in:0,out:id==='trim-vt'?125:75},elastic:id==='protected'?{min:25,max:200}:null,minDuration:id==='trim-vt'?75:25,optional:id==='optional',trimmable:id==='trim-vt',anchor:{kind:'FLOW'},onOverrun:'PUSH',autoNext:id==='trim-vt',loop:false,locked:false}).run()
database.db.insert(outputProfiles).values({id:'disabled',channelId:'priority',name:'No external output',kind:'RTMP',target:'',role:'PROGRAM',enabled:false,createdAt:stamp}).run()
const listener=createServer();await new Promise<void>(resolve=>listener.listen(0,'127.0.0.1',resolve))
const port=(listener.address() as {port:number}).port;await new Promise<void>(resolve=>listener.close(()=>resolve()))
let server:ChildProcess|null=null,logs='',result:Record<string,unknown>|null=null,failure:unknown=null
let replyRelay:Server|null=null,replyDropped=false
const relayEvents:Array<{method:string;path:string;status?:number;replyDropped?:boolean}>=[]
const relaySockets=new Set<import('node:net').Socket>()
const nativePids=new Set<number>()
const mountedEventsOnly=process.argv.includes('--mounted-duration-events')
const recoveryOnly=process.argv.includes('--resolved-cut-recovery')||mountedEventsOnly
let recoveryObservations:Record<string,unknown>|null=null
async function api(path:string,body?:object,status=200,headers:Record<string,string>={}){
  const response=await fetch(`http://127.0.0.1:${port}${path}`,{method:body?'POST':'GET',...(body?{body:JSON.stringify(body)}:{}),headers:{...(browserToken?{cookie:'rplayout_session='+browserToken}:{}),...(body?{'content-type':'application/json'}:{}),...headers},signal:AbortSignal.timeout(30_000)})
  const data=await response.json() as any;assert.equal(response.status,status,JSON.stringify(data));return data
}
async function wait(label:string,predicate:()=>Promise<boolean>,timeout=30_000){
  const deadline=performance.now()+timeout
  while(performance.now()<deadline){if(await predicate())return;assert.ok(server?.exitCode===null&&server?.signalCode===null,logs);await new Promise(resolve=>setTimeout(resolve,100))}
  throw new Error(label+'\n'+logs)
}
const snapshot=()=>api('/api/rundowns/rd')
async function startReplyRelay():Promise<number>{
  const relay=httpServer((request,response)=>{
    const path=request.url??'/'
    const upstream=forward({hostname:'127.0.0.1',port,path,method:request.method,headers:request.headers},received=>{
      if(request.method==='POST'&&path==='/api/channels/priority/compensation'&&received.statusCode===200&&!replyDropped){
        replyDropped=true;received.resume()
        received.once('end',()=>{
          relayEvents.push({method:'POST',path,status:200,replyDropped:true})
          // Deliver headers, but no usable receipt. A disconnect before headers
          // can trigger browser POST retry instead of the UI uncertainty path.
          response.writeHead(200,{'content-type':'application/json','cache-control':'no-store'})
          response.end('{"truncatedReceipt":')
        })
      }else{
        if(path.includes('/compensation'))relayEvents.push({method:request.method??'GET',path,status:received.statusCode})
        response.writeHead(received.statusCode??502,received.headers);received.pipe(response)
      }
    })
    upstream.on('error',()=>{if(!response.headersSent)response.writeHead(502);response.end()})
    request.pipe(upstream)
  })
  relay.on('connection',socket=>{relaySockets.add(socket);socket.once('close',()=>relaySockets.delete(socket))})
  relay.on('upgrade',(request,socket,head)=>{
    const upstream=forward({hostname:'127.0.0.1',port,path:request.url,headers:request.headers})
    upstream.on('upgrade',(response,target,targetHead)=>{
      relaySockets.add(target);target.once('close',()=>relaySockets.delete(target))
      socket.write(`HTTP/1.1 ${response.statusCode} ${response.statusMessage}\r\n`+Object.entries(response.headers).map(([key,value])=>`${key}: ${value}`).join('\r\n')+'\r\n\r\n')
      if(targetHead.length)socket.write(targetHead);if(head.length)target.write(head)
      target.pipe(socket);socket.pipe(target)
    })
    upstream.on('error',()=>socket.destroy());upstream.end()
  })
  await new Promise<void>(resolve=>relay.listen(0,'127.0.0.1',resolve));replyRelay=relay
  return (relay.address() as {port:number}).port
}
// Use the owning DB's protected JSON mapping, never JSON.parse ciphertext.
const revisions=()=>database.db.select().from(operationalPlaylistRevisions).all().filter(row=>row.rundownId==='rd').sort((a,b)=>a.revision-b.revision) as {id:string;revision:number;payload:any}[]
const alive=(pid:number)=>{try{process.kill(pid,0);return true}catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH')return false;throw error}}
function launchOwnServer(){
  server=spawn(process.execPath,[serverBinary],{cwd:directory,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...environment,RPLAYOUT_INSTALL_ROOT:root,RPLAYOUT_DB:join(directory,'priority.db'),RPLAYOUT_VAULT_FILE:join(directory,'vault.json'),RPLAYOUT_MEDIA:directory,RPLAYOUT_THUMBS:join(directory,'thumbs'),RPLAYOUT_MEDIA_VERSIONS:join(directory,'versions'),RPLAYOUT_CACHE_DIR:join(directory,'cache'),RPLAYOUT_BACKUP_DIR:join(directory,'backups'),RPLAYOUT_ENGINE:join(root,'apps/engine/target/release/rplayout-engine.exe'),RPLAYOUT_ENGINE_OUTPUT:'null',RPLAYOUT_MEDIAMTX:cueProtectionNative?join(root,'release/runtime-base-r30/mediamtx/mediamtx.exe'):'',RPLAYOUT_MEDIAMTX_BIND:'127.0.0.1',RPLAYOUT_PROBE:'',RPLAYOUT_PROXY:'',RPLAYOUT_AUDIO_ANALYSIS:'',RPLAYOUT_DEVICES:'',RPLAYOUT_RELAY:'',RPLAYOUT_ADMIN_USER:'',RPLAYOUT_ADMIN_PASSWORD:'',RPLAYOUT_CONTROL_TOKEN:'',RPLAYOUT_ROLE:'ADMIN',RPLAYOUT_BACKUP_HOURS:'0',HOST:'127.0.0.1',PORT:String(port),LOG_LEVEL:'warn'}})
  for(const stream of [server.stdout,server.stderr])stream?.on('data',chunk=>{logs=(logs+String(chunk)).slice(-12000)})
}
async function stopOwnServer(){
  if(server?.exitCode===null&&server.signalCode===null){
    try{for(const row of (await api('/api/processes')).processes??[])if((row.kind==='ENGINE'||cueProtectionNative)&&Number.isSafeInteger(row.pid)&&row.pid!==server.pid)nativePids.add(row.pid)}catch{}
    const current=server,exited=new Promise<void>(resolve=>current.once('exit',()=>resolve()));current.kill('SIGKILL')
    let timer:ReturnType<typeof setTimeout>|undefined
    try{await Promise.race([exited,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Owned server did not exit')),10000)})])}finally{if(timer)clearTimeout(timer)}
  }
  const deadline=performance.now()+10000
  while([...nativePids].some(alive)&&performance.now()<deadline)await new Promise(resolve=>setTimeout(resolve,50))
  assert.ok([...nativePids].every(pid=>!alive(pid)),'Owning server EOF did not drain native family; no historical PID kill attempted')
  nativePids.clear()
}
try{
  launchOwnServer()
  await wait('Compiled server not ready',async()=>{try{return (await api('/api/health')).ok}catch{return false}})
  if(browserCompensation){
    assert.ok(!recoveryOnly,'Visual compensation is separate from recovery verification')
    const instant=new Date(),midnight=new Date(instant);midnight.setHours(0,0,0,0)
    const date=`${instant.getFullYear()}-${String(instant.getMonth()+1).padStart(2,'0')}-${String(instant.getDate()).padStart(2,'0')}`
    const start=Math.floor((instant.getTime()-midnight.getTime())/40)
    database.sqlite.prepare('UPDATE rundowns SET date=?,planned_start=? WHERE id=?').run(date,start,'rd')
    database.sqlite.prepare('UPDATE rundown_items SET loop=1 WHERE id=?').run('vt')
    database.sqlite.prepare('UPDATE rundown_items SET anchor=? WHERE id=?').run(JSON.stringify({kind:'HARD_TIME',at:start+90000}),'live')
    if(browserAllActions){
      database.sqlite.prepare('UPDATE rundown_items SET anchor=? WHERE id=?').run(JSON.stringify({kind:'SOFT',at:start+100000,tolerance:5000,priority:2}),'soft')
      database.sqlite.prepare('UPDATE rundown_items SET anchor=? WHERE id=?').run(JSON.stringify({kind:'FIXED',at:start+110000}),'mandatory')
      database.sqlite.prepare('UPDATE rundown_items SET anchor=? WHERE id=?').run(JSON.stringify({kind:'FIXED',at:start+120000}),'protected')
      database.sqlite.prepare('UPDATE rundowns SET protected_zones=? WHERE id=?').run(JSON.stringify([{id:'qa-zone',label:'Protected QA slot',from:start+120000,to:start+120075,priority:1}]),'rd')
    }
    const inspection=await api('/api/rundowns/rd/operational-simulation')
    const publication=await api('/api/rundowns/rd/operational-publish',{reviewToken:inspection.review.token},201,{'if-match':`w/"${inspection.review.editorialRevision}"`})
    await api('/api/channels/priority/transport',{action:'take',itemId:'vt'})
    await wait('Visual native PGM not confirmed',async()=>(await snapshot()).live.transport.onAir?.itemId==='vt')
      if(cueProtectionNative){
        const original=revisions()[0]!,frozen=JSON.stringify(original.payload),baseline=(await snapshot()).live.transport.onAir
        const compensationInput={itemId:'filler',expectedFrames:cueNominalFrames,action:'FILLER',deltaFrames:25}
        const beforeCue=await api('/api/channels/priority/compensation-review',compensationInput)
        const refusalRequest={input:compensationInput,reviewToken:beforeCue.reviewToken,requestId:randomUUID()}
        const compensationCount=()=>database.sqlite.prepare("SELECT count(*) n FROM operator_decisions WHERE kind='OPERATIONAL_COMPENSATION'").get()!.n
        const readCuePicture=async(label:string)=>{
          await api('/api/channels/priority/watching',{bus:'pvw'})
          const path=(await snapshot()).monitors.preview
          await wait('Own subscribed PVW not published',async()=>{
            try{const response=await fetch(`http://127.0.0.1:9997/v3/paths/get/${path}`,{signal:AbortSignal.timeout(3000)});return response.ok&&(await response.json() as any).ready}catch{return false}
          })
          try{return await verifyPublishedPicture({gstBin,directory,path,width:320,height:180,environment,label})}
          catch(error){recoveryObservations={phase:'CUE_PICTURE',label,previewSnapshot:await snapshot()};throw error}
        }
        const assertPreserved=async(expectedCue:string|null)=>{
          const state=(await snapshot()).live.transport
          assert.equal(state.mode,'NATIVE');assert.equal(state.onAir.itemId,baseline.itemId);assert.equal(state.onAir.startedAt,baseline.startedAt)
          assert.ok(state.onAir.elapsed>=baseline.elapsed)
          assert.deepEqual(state.preview,expectedCue?{kind:'ITEM',id:expectedCue}:null)
          assert.equal(JSON.stringify(revisions()[0]!.payload),frozen)
        }
        await api('/api/channels/priority/transport',{action:'cue',itemId:'filler'})
        await assertPreserved('filler')
        const picture=await readCuePicture('protected-cue')
        const cueRefusal=await api('/api/channels/priority/compensation',refusalRequest,409)
        assert.match(cueRefusal.error,/CUE/);assert.equal(compensationCount(),0);assert.equal(revisions().length,1)
        assert.match((await api('/api/channels/priority/compensation-review',compensationInput,409)).error,/CUE/)
        await assertPreserved('filler')
        database.sqlite.prepare('UPDATE rundown_items SET duration_override=?,trim=? WHERE id=?').run(cueNominalFrames+25,JSON.stringify({in:0,out:cueNominalFrames+25}),'filler')
        const changed=await api('/api/rundowns/rd/operational-simulation')
        const publicationRefusal=await api('/api/rundowns/rd/operational-publish',{reviewToken:changed.review.token},409,{'if-match':`w/"${changed.review.editorialRevision}"`})
        assert.match(publicationRefusal.error,/CUE/);assert.equal(revisions().length,1);await assertPreserved('filler')
        database.sqlite.prepare('UPDATE rundown_items SET duration_override=?,trim=? WHERE id=?').run(cueNominalFrames,JSON.stringify({in:0,out:cueNominalFrames}),'filler')
        database.sqlite.prepare('UPDATE rundown_items SET title=? WHERE id=?').run('Urgent title only','vt')
        const safeReview=await api('/api/rundowns/rd/operational-simulation')
        const safe=await api('/api/rundowns/rd/operational-publish',{reviewToken:safeReview.review.token},201,{'if-match':`w/"${safeReview.review.editorialRevision}"`})
        assert.equal(safe.revision,2);assert.equal(safe.executionUpdated,true);await assertPreserved('filler')
        await api('/api/channels/priority/transport',{action:'cue'});await assertPreserved(null)
        const reviewed=await api('/api/channels/priority/compensation-review',compensationInput)
        const committed=await api('/api/channels/priority/compensation',{input:compensationInput,reviewToken:reviewed.reviewToken,requestId:randomUUID()})
        assert.equal(committed.revision,3);assert.equal(compensationCount(),1)
        assert.equal(revisions().at(-1)!.payload.items.find((row:any)=>row.id==='filler').durationOverride,cueNominalFrames+25)
        await api('/api/channels/priority/transport',{action:'cue',itemId:'filler'});await assertPreserved('filler')
        const secondPicture=await readCuePicture('adjusted-cue')
        const rollbackVersion=(await api('/api/rundowns/rd/operational-simulation')).review.editorialRevision
        const rollback=await api(`/api/rundowns/rd/operational-rollback-review?revisionId=${original.id}`,undefined,200,{'if-match':`w/"${rollbackVersion}"`})
        const rollbackRequest={revisionId:original.id,reviewToken:rollback.review.token}
        const rollbackRefusal=await api('/api/rundowns/rd/operational-rollback',rollbackRequest,409,{'if-match':`w/"${rollbackVersion}"`})
        assert.match(rollbackRefusal.error,/CUE/);assert.equal(revisions().length,3);await assertPreserved('filler')
        await api('/api/channels/priority/transport',{action:'cue'});await assertPreserved(null)
        const restored=await api('/api/rundowns/rd/operational-rollback',rollbackRequest,200,{'if-match':`w/"${rollbackVersion}"`})
        assert.equal(restored.revision,4);await assertPreserved(null)
        assert.equal(revisions().at(-1)!.payload.restoredFrom.id,original.id)
        assert.equal(database.sqlite.prepare('SELECT title FROM rundown_items WHERE id=?').get('vt')!.title,'Urgent title only')
        await api('/api/channels/priority/transport',{action:'stop'})
        result={result:'PASS',evidence:'COMPILED_NATIVE_ACTUAL_PVW_CUE_COMPENSATION_PUBLICATION_ROLLBACK_PROTECTION',directory,port,picture,secondPicture,pgmItem:baseline.itemId,pgmStartedAt:baseline.startedAt,cueCompensationRefused:true,cuePublicationRefused:true,compatibleUrgentPublicationPreservesCueAndPgm:true,cueRollbackRefused:true,clearCueAllowsReviewedCompensationAndRollback:true,originalRevisionImmutable:true,editorialPreserved:true,revisionCount:4,compensationCount:1,serverSha256:createHash('sha256').update(await readFile(serverBinary)).digest('hex'),engineSha256:createHash('sha256').update(await readFile(join(root,'apps/engine/target/release/rplayout-engine.exe'))).digest('hex'),browserValidated:false,physicalInputsValidated:false,physicalOutputValidated:false}
      }else if(compensationRace){
      const beforeSnapshot=await snapshot(),before=beforeSnapshot.live.transport.onAir
      assert.equal(beforeSnapshot.live.transport.mode,'NATIVE')
      const requests=[]
      const requestTokens=new Map<string,string>()
      for(const [index,deltaFrames] of [25,50].entries()){
        const input={itemId:'filler',expectedFrames:50,action:'FILLER',deltaFrames}
        const token=actorTokens[compensationActors?index:0]!
        const reviewed=await api('/api/channels/priority/compensation-review',input,200,{cookie:'rplayout_session='+token})
        const request={input,reviewToken:reviewed.reviewToken,requestId:randomUUID()}
        requests.push(request);requestTokens.set(request.requestId,token)
      }
      const outcomes=await Promise.all(requests.map(async body=>{
        const began=performance.now()
        const response=await fetch(`http://127.0.0.1:${port}/api/channels/priority/compensation`,{method:'POST',headers:{cookie:'rplayout_session='+requestTokens.get(body.requestId),'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(30000)})
        const value=await response.json()
        return {requestId:body.requestId,status:response.status,body:value,roundTripMs:Math.round((performance.now()-began)*100)/100}
      }))
      assert.deepEqual(outcomes.map(row=>row.status).sort(),[200,409],JSON.stringify(outcomes))
      const winner=outcomes.find(row=>row.status===200)!,loser=outcomes.find(row=>row.status===409)!
      const winnerHeaders={cookie:'rplayout_session='+requestTokens.get(winner.requestId)},loserHeaders={cookie:'rplayout_session='+requestTokens.get(loser.requestId)}
      const receipt=await api(`/api/channels/priority/compensation/${winner.requestId}`,undefined,200,winnerHeaders)
      assert.equal(receipt.state,'RECORDED');assert.equal(receipt.revision,2)
      assert.equal((await api(`/api/channels/priority/compensation/${loser.requestId}`,undefined,200,loserHeaders)).state,'NOT_RECORDED')
      if(compensationActors)assert.equal((await api(`/api/channels/priority/compensation/${winner.requestId}`,undefined,200,loserHeaders)).state,'NOT_RECORDED')
      const replay=await api('/api/channels/priority/compensation',requests.find(row=>row.requestId===winner.requestId)!,200,winnerHeaders)
      assert.equal(replay.deduplicated,true);assert.equal(replay.revision,2)
      const auditCount=database.sqlite.prepare('SELECT count(*) n FROM operator_decisions WHERE kind=?').get('OPERATIONAL_COMPENSATION')!.n
      assert.equal(auditCount,1);assert.equal(revisions().length,2)
      const after=(await snapshot()).live.transport.onAir
      assert.equal(after.itemId,before.itemId);assert.equal(after.startedAt,before.startedAt)
      assert.ok(after.elapsed>=before.elapsed)
      assert.equal(database.sqlite.prepare('SELECT duration_override frames FROM rundown_items WHERE id=?').get('filler')!.frames,50)
      const final=revisions().at(-1)!.payload.items.find((row:any)=>row.id==='filler').durationOverride
      const expected=50+requests.find(row=>row.requestId===winner.requestId)!.input.deltaFrames
      assert.equal(final,expected)
      result={result:'PASS',evidence:'COMPILED_NATIVE_COMPENSATION_HTTP_RACE',directory,port,outcomes,distinctActors:compensationActors,remoteNetworkMeasured:false,winnerReceipt:receipt,auditCount,revisionCount:2,finalFillerFrames:final,editorialFillerFrames:50,replayDeduplicated:true,pgmItem:after.itemId,pgmStartedAt:after.startedAt,browserValidated:false,physicalInputsValidated:false}
    }else{
    const stopFile=join(root,'scratch',`compensation-visual-stop-${randomUUID()}.json`),expires=performance.now()+600000
    const browserPort=dropCompensationReply?await startReplyRelay():port
    console.log(JSON.stringify({status:'BROWSER_REVIEW_READY',directory,url:`http://127.0.0.1:${browserPort}/`,fixtureUser:'compensation-verifier',fixturePassword:'Local-compensation-QA-20261012',stopFile,expiresInMs:600000,physicalOutputsEnabled:false,revisionId:publication.id,dropFirstSuccessfulCompensationReply:dropCompensationReply}))
    await wait('Visual stop or finite expiry',async()=>{if(performance.now()>=expires)return true;try{await stat(stopFile);return true}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return false;throw error}},605000)
    await api('/api/channels/priority/transport',{action:'stop'})
    result={result:'VISUAL_FIXTURE_COMPLETED',directory,port,browserValidated:false,physicalInputsValidated:false,automatedPrioritySuiteExecuted:false,browserInsertion,replyDropped,relayEvents,serverSha256:createHash('sha256').update(await readFile(serverBinary)).digest('hex')}
    }
  }else if(recoveryOnly){
    const instant=new Date(),midnight=new Date(instant);midnight.setHours(0,0,0,0)
    const date=`${instant.getFullYear()}-${String(instant.getMonth()+1).padStart(2,'0')}-${String(instant.getDate()).padStart(2,'0')}`
    const plannedStart=Math.floor((instant.getTime()-midnight.getTime())/40)+125
    database.db.insert(rundowns).values({id:'recovery-rd',channelId:'priority',name:'Resolved cut recovery',date,plannedStart,loop:false,createdAt:stamp,updatedAt:stamp}).run()
    for(const [order,id] of ['recovery-vt','recovery-boundary'].entries())database.db.insert(rundownItems).values({id,rundownId:'recovery-rd',sortOrder:order,title:id,type:'VT',mediaId:'asset',durationOverride:1250,trim:{in:0,out:1250},minDuration:750,trimmable:id==='recovery-vt',anchor:id==='recovery-boundary'?{kind:'FIXED',at:plannedStart+750}:{kind:'FLOW'},onOverrun:'PUSH',autoNext:id==='recovery-vt',loop:false,locked:false}).run()
    if(mountedEventsOnly)database.db.insert(secondaryEvents).values({id:'mounted-end-event',channelId:'priority',itemId:'recovery-vt',definition:{id:'mounted-end-event',channelId:'priority',rundownItemId:'recovery-vt',name:'Before actual mounted end',targetLayer:'STATION_LOGO',type:'GRAPHICS_OVERLAY',triggerMode:'OFFSET_BEFORE_END',offsetFrames:100,templateId:'',payload:{title:'MOUNTED END'},enabled:true},createdAt:stamp,updatedAt:stamp}).run()
    const inspect=await api('/api/rundowns/recovery-rd/operational-simulation')
    const revision=await api('/api/rundowns/recovery-rd/operational-publish',{reviewToken:inspect.review.token},201,{'if-match':`w/"${inspect.review.editorialRevision}"`})
    await api('/api/channels/priority/load-rundown',{rundownId:'recovery-rd'})
    const recoverySnapshot=()=>api('/api/rundowns/recovery-rd')
    assert.equal((await recoverySnapshot()).executionView.schedule.items.find((row:any)=>row.id==='recovery-vt').duration,750)
    await api('/api/channels/priority/transport',{action:'take',itemId:'recovery-vt'})
    const saved=()=>JSON.parse((database.sqlite.prepare('SELECT payload FROM channel_checkpoints WHERE channel_id=?').get('priority') as {payload:string}).payload)
    await wait('Mounted native crop not checkpointed',async()=>{const row=saved();return row.playing&&row.elapsed>=25&&row.programTrim?.out===750})
    const before=saved(),expectedCut={in:0,out:750,contentHash:mediaHash}
    recoveryObservations={before}
    assert.deepEqual(before.programTrim,expectedCut)
    if(mountedEventsOnly){
      const active=await recoverySnapshot(),onAir=active.live.transport.onAir,row=active.executionView.schedule.items.find((item:any)=>item.id==='recovery-vt')
      assert.equal(onAir.mountedDuration,750)
      assert.equal(row.mountedDuration,750);assert.equal(row.duration,750);assert.equal(row.plannedDuration,1250)
      const eventRuns=()=>database.sqlite.prepare("SELECT * FROM secondary_event_runs WHERE event_id='mounted-end-event' AND mode='FIRE'").all() as any[]
      await wait('End-relative graphic not fired at mounted duration',async()=>eventRuns().some(row=>row.state==='EXECUTED'),35000)
      const fired=eventRuns()[0]!
      assert.equal(eventRuns().length,1);assert.equal(fired.executionId??fired.execution_id,before.executionId)
      assert.ok(fired.frames>=650&&fired.frames<=675,'Before-end event must use750-100, not1250-100')
      await wait('Mounted event fixture did not reach EOS750',async()=>Boolean(database.sqlite.prepare("SELECT id FROM as_run WHERE item_id='recovery-vt' AND ended_by='EOS' AND execution_kind='NATIVE'").get()),10000)
      const exited=database.sqlite.prepare("SELECT * FROM as_run WHERE item_id='recovery-vt' AND ended_by='EOS' AND execution_kind='NATIVE'").get() as any
      assert.ok(Math.abs(exited.end_position_frames-750)<=2)
      result={result:'PASS',evidence:'COMPILED_NATIVE_MOUNTED_DURATION_SCHEDULE_AND_BEFORE_END_EVENT',directory,port,nominalFrames:1250,mountedFrames:750,transportMountedDuration:750,scheduleMountedDuration:750,scheduleDuration:row.duration,schedulePlannedDuration:row.plannedDuration,eventTriggerExpectedFrames:650,eventTriggerActualFrames:fired.frames,secondaryFireCount:1,nativeEndCursor:exited.end_position_frames,browserValidated:false,physicalInputsValidated:false}
    }else{
    const native=(await api('/api/processes')).processes.find((row:any)=>row.id==='engine:priority'&&row.channelId==='priority')
    assert.ok(Number.isSafeInteger(native?.pid)&&native.pid>0&&native.pid!==process.pid&&native.pid!==server!.pid)
    const nativePid=native.pid
    // Pin the process handle, verify it is a child of THIS live server, then
    // terminate that handle. Never kill a PID retained from an earlier run.
    const killScript=`$recoveryProcess=Get-Process -Id ${nativePid} -ErrorAction Stop; $null=$recoveryProcess.Handle; $recoveryIdentity=Get-CimInstance Win32_Process -Filter 'ProcessId = ${nativePid}'; if($recoveryIdentity.ParentProcessId -ne ${server!.pid}){throw 'Not an owned engine child'}; $recoveryProcess.Kill()`
    await promisify(execFile)('powershell.exe',['-NoProfile','-NonInteractive','-Command',killScript],{windowsHide:true,timeout:10000})
    await wait('Watchdog did not restore exact mounted cut',async()=>{const state=(await recoverySnapshot()).live.transport;const current=(await api('/api/processes')).processes.find((row:any)=>row.id==='engine:priority');return current.pid!==nativePid&&state.onAir?.itemId==='recovery-vt'&&state.onAir.elapsed>=before.elapsed&&state.programTrim?.out===750})
    await wait('Watchdog checkpoint not durable',async()=>saved().programTrim?.out===750&&saved().elapsed>=before.elapsed+25)
    const afterWatchdog=saved();assert.equal(afterWatchdog.executionId,before.executionId);assert.equal(afterWatchdog.revisionId,revision.id)
    recoveryObservations.afterWatchdog=afterWatchdog
    await stopOwnServer();const beforeRestart=saved();assert.deepEqual(beforeRestart.programTrim,expectedCut)
    launchOwnServer();await wait('Compiled server restart not ready',async()=>{try{return (await api('/api/health')).ok}catch{return false}})
    await wait('Durable checkpoint did not restore original native crop',async()=>{const state=(await recoverySnapshot()).live.transport;return state.onAir?.itemId==='recovery-vt'&&state.onAir.elapsed>=beforeRestart.elapsed&&state.programTrim?.out===750})
    await wait('Restart identity/crop not persisted',async()=>saved().executionId===before.executionId&&saved().programTrim?.out===750)
    const afterRestart=saved();assert.equal(afterRestart.revisionId,revision.id)
    recoveryObservations.afterRestart=afterRestart
    await wait('Recovered clip did not reach mounted EOS',async()=>Boolean(database.sqlite.prepare("SELECT id FROM as_run WHERE item_id='recovery-vt' AND ended_by='EOS' AND execution_kind='NATIVE'").get()),35000)
    const finalExit=database.sqlite.prepare("SELECT * FROM as_run WHERE item_id='recovery-vt' AND ended_by='EOS' AND execution_kind='NATIVE'").get() as any
    assert.ok(Math.abs(finalExit.end_position_frames-750)<=2,'Recovered native EOS must retain 750, not nominal 1250')
    await api('/api/channels/priority/transport',{action:'take',itemId:'recovery-vt'})
    await wait('Second occurrence not checkpointed',async()=>saved().playing&&saved().itemId==='recovery-vt'&&saved().executionId!==before.executionId)
    await stopOwnServer()
    const legacy=saved();delete legacy.programTrim
    database.sqlite.prepare('UPDATE channel_checkpoints SET payload=? WHERE channel_id=?').run(JSON.stringify(legacy),'priority')
    const preservedLegacy=JSON.stringify(legacy)
    launchOwnServer();await wait('Legacy server restart not ready',async()=>{try{return (await api('/api/health')).ok}catch{return false}})
    await wait('Legacy checkpoint refusal missing',async()=>{const snapshot=await recoverySnapshot();return snapshot.live.transport.playing===false&&snapshot.live.alerts.some((row:any)=>row.message.includes('Checkpoint antigo'))})
    await new Promise(resolve=>setTimeout(resolve,2200))
    assert.equal(JSON.stringify(saved()),preservedLegacy,'Empty ticks after refusal must not erase predecessor cursor')
    await api('/api/channels/priority/transport',{action:'stop'})
    await wait('Explicit acknowledged STOP did not clear preserved checkpoint',async()=>saved().playing===false&&saved().itemId===null)
    result={result:'PASS',evidence:'COMPILED_NATIVE_RESOLVED_CROP_WATCHDOG_AND_SERVER_RESTART',directory,port,revisionId:revision.id,executionId:before.executionId,nominalFrames:1250,resolvedFrames:750,beforeFrames:before.elapsed,watchdogFrames:afterWatchdog.elapsed,restartedFrames:afterRestart.elapsed,nativeEndCursor:finalExit.end_position_frames,mediaHash,watchdogPreservesMountedCrop:true,serverRestartPreservesMountedCrop:true,executionIdentityPreserved:true,legacyCheckpointRefusedWithoutOverwrite:true,explicitStopClearsPreservedCheckpoint:true,browserValidated:false,physicalInputsValidated:false}
    }
  }else{
  // Bind the absolute date and anchor only after bootstrap, avoiding a stale
  // anchor caused by fixture generation/runtime startup. Real wall-clock cut.
  const instant=new Date(),midnight=new Date(instant);midnight.setHours(0,0,0,0)
  const date=`${instant.getFullYear()}-${String(instant.getMonth()+1).padStart(2,'0')}-${String(instant.getDate()).padStart(2,'0')}`
  const start=Math.floor((instant.getTime()-midnight.getTime())/40),anchor=start+375
  database.sqlite.prepare('UPDATE rundowns SET date=?,planned_start=? WHERE id=?').run(date,start,'rd')
  database.sqlite.prepare('UPDATE rundown_items SET anchor=? WHERE id=?').run(JSON.stringify({kind:'HARD_TIME',at:anchor}),'live')
  database.sqlite.prepare('UPDATE rundown_items SET anchor=? WHERE id=?').run(JSON.stringify({kind:'SOFT',at:start+5000,tolerance:250,priority:2}),'soft')
  database.sqlite.prepare('UPDATE rundown_items SET anchor=? WHERE id=?').run(JSON.stringify({kind:'FIXED',at:start+10000}),'mandatory')
  database.sqlite.prepare('UPDATE rundown_items SET anchor=? WHERE id=?').run(JSON.stringify({kind:'FIXED',at:start+12000}),'protected')
  database.sqlite.prepare('UPDATE rundowns SET protected_zones=? WHERE id=?').run(JSON.stringify([{id:'protected-zone',label:'Finite protected filler',from:start+12000,to:start+12075,priority:1}]),'rd')
  const inspection=await api('/api/rundowns/rd/operational-simulation')
  assert.ok(inspection.simulated.schedule)
  const publication=await api('/api/rundowns/rd/operational-publish',{reviewToken:inspection.review.token},201,{'if-match':`w/"${inspection.review.editorialRevision}"`})
  const first=revisions()[0]!,frozen=JSON.stringify(first.payload)
  assert.equal(first.id,publication.id)
  await api('/api/channels/priority/transport',{action:'take',itemId:'vt'})
  await wait('VT not confirmed',async()=>(await snapshot()).live.transport.onAir?.itemId==='vt')
  // Editorial drift cannot silently replace the already published plan.
  database.sqlite.prepare('UPDATE rundown_items SET title=? WHERE id=?').run('Unpublished title','vt')
  assert.equal(JSON.stringify(revisions()[0]!.payload),frozen)
  const active=await snapshot()
  assert.equal(active.executionView.items.find((row:any)=>row.item.id==='vt').item.title,'Published VT')
  await wait('Hard-time live did not interrupt VT automatically',async()=>(await snapshot()).live.transport.onAir?.itemId==='live',35_000)
  await wait('Native live signal not measured',async()=>(await snapshot()).live.transport.liveSources.some((row:any)=>row.busSignals?.pgm?.videoRecent))
  const pending=await api('/api/channels/priority/interruptions'),interruption=pending.items.find((row:any)=>row.item_id==='vt')
  assert.ok(interruption,'Confirmed priority cut must persist VT return')
  assert.ok(interruption.frames>0&&interruption.frames<1500)
  assert.equal(interruption.revision_id,first.id)
  await wait('As-run did not persist actual priority exit',async()=>Boolean(database.sqlite.prepare("SELECT id FROM as_run WHERE item_id='vt' AND ended_by='LIVE_PRIORITY' AND execution_kind='NATIVE'").get()))
  const exit=database.sqlite.prepare("SELECT * FROM as_run WHERE item_id='vt' AND ended_by='LIVE_PRIORITY'").get() as any
  assert.equal(exit.revision_id,first.id);assert.equal(exit.media_hash,mediaHash)
  assert.equal(exit.end_position_frames,interruption.frames)
  // Publish a reviewed urgent editorial change during live PGM. Two operators
  // confirming the same review must create just one edition, without a TAKE.
  const urgentInspection=await api('/api/rundowns/rd/operational-simulation')
  const beforeUrgent=revisions().length,pgmBeforeUrgent=(await snapshot()).live.transport.onAir
  const urgentAttempt=async()=>{
    const response=await fetch(`http://127.0.0.1:${port}/api/rundowns/rd/operational-publish`,{method:'POST',headers:{'content-type':'application/json','if-match':`w/"${urgentInspection.review.editorialRevision}"`},body:JSON.stringify({reviewToken:urgentInspection.review.token}),signal:AbortSignal.timeout(30000)})
    return {status:response.status,body:await response.json() as any}
  }
  const urgentResults=await Promise.all([urgentAttempt(),urgentAttempt()])
  assert.deepEqual(urgentResults.map(row=>row.status).sort(),[201,409])
  const urgentAccepted=urgentResults.find(row=>row.status===201)!.body
  assert.equal(urgentAccepted.applied,true);assert.equal(urgentAccepted.executionUpdated,true);assert.equal(urgentAccepted.refreshError,null)
  assert.equal(revisions().length,beforeUrgent+1)
  const pgmAfterUrgent=(await snapshot()).live.transport.onAir
  assert.equal(pgmAfterUrgent.itemId,pgmBeforeUrgent.itemId);assert.equal(pgmAfterUrgent.startedAt,pgmBeforeUrgent.startedAt)
  assert.equal(revisions().at(-1)!.payload.items.find((item:any)=>item.id==='vt').title,'Unpublished title')
  assert.equal(JSON.stringify(revisions()[0]!.payload),frozen)
  const durationReview=await api('/api/channels/priority/live-duration-review?itemId=live&expectedFrames=750&deltaSeconds=120')
  const durationRequest={input:durationReview.input,reviewToken:durationReview.reviewToken,requestId:randomUUID()}
  const adjusted=await api('/api/channels/priority/live-duration',durationRequest)
  const replay=await api('/api/channels/priority/live-duration',durationRequest)
  assert.equal(replay.deduplicated,true);assert.equal(replay.revision,adjusted.revision)
  assert.equal(adjusted.live.transport.onAir.itemId,'live')
  assert.equal(JSON.stringify(revisions()[0]!.payload),frozen)
  const revised=revisions().at(-1)!.payload
  assert.equal(revised.operation.kind,'LIVE_DURATION');assert.equal(revised.operation.deltaFrames,3000)
  assert.ok(revised.schedule);assert.equal(revised.items.find((item:any)=>item.id==='live').durationOverride,3750)
  const compensationInput={itemId:'filler',expectedFrames:50,action:'FILLER',deltaFrames:fillerDelta}
  const compensationReview=await api('/api/channels/priority/compensation-review',compensationInput)
  const compensationRequest={input:compensationInput,reviewToken:compensationReview.reviewToken,requestId:randomUUID()}
  const compensated=await api('/api/channels/priority/compensation',compensationRequest)
  const compensatedReplay=await api('/api/channels/priority/compensation',compensationRequest)
  assert.equal(compensatedReplay.deduplicated,true);assert.equal(compensatedReplay.revision,compensated.revision)
  assert.equal((await snapshot()).live.transport.onAir.itemId,'live')
  const filler=revisions().at(-1)!.payload.items.find((item:any)=>item.id==='filler')
  assert.equal(filler.durationOverride,fillerNominal);assert.equal(filler.trim.out,fillerNominal)
  const rollbackVersion=(await api('/api/rundowns/rd/operational-simulation')).review.editorialRevision
  const rollback=await api(`/api/rundowns/rd/operational-rollback-review?revisionId=${encodeURIComponent(first.id)}`,undefined,200,{'if-match':`w/"${rollbackVersion}"`})
  const restored=await api('/api/rundowns/rd/operational-rollback',{revisionId:first.id,reviewToken:rollback.review.token},200,{'if-match':`w/"${rollback.review.editorialRevision}"`})
  assert.equal(restored.live.transport.onAir.itemId,'live')
  assert.equal(revisions().at(-1)!.payload.restoredFrom.id,first.id)
  const beforeReturn=await api('/api/channels/priority/interruptions'),reviewed=beforeReturn.items.find((row:any)=>row.id===interruption.id)
  const resumed=await api(`/api/channels/priority/interruptions/${interruption.id}`,{action:'RESUME',requestId:randomUUID(),reviewToken:reviewed.reviewToken})
  assert.equal(resumed.ok,true)
  await wait('VT resume not confirmed',async()=>(await snapshot()).live.transport.onAir?.itemId==='vt')
  await wait('Resumed as-run did not persist cursor',async()=>Boolean(database.sqlite.prepare("SELECT id FROM as_run WHERE item_id='vt' AND start_position_frames=?").get(interruption.frames)))
  assert.equal((await api('/api/channels/priority/interruptions')).items.length,0)
  assert.equal(JSON.stringify(revisions()[0]!.payload),frozen)
  // Output-null fixture has no preview bus. Prove executable trim on PGM,
  // not an invented CUE approval: reapply on the restored frozen edition.
  const finalReview=await api('/api/channels/priority/compensation-review',compensationInput)
  await api('/api/channels/priority/compensation',{input:compensationInput,reviewToken:finalReview.reviewToken,requestId:randomUUID()})
  const beforeProtected=revisions().length,protectedState=(await snapshot()).live.transport.onAir
  const refusal=await api('/api/channels/priority/compensation-review',{itemId:'protected',expectedFrames:75,action:'FILLER',deltaFrames:25},409)
  assert.match(refusal.error,/protegida/)
  assert.equal(revisions().length,beforeProtected)
  assert.equal((await snapshot()).live.transport.onAir.itemId,protectedState.itemId)
  const mandatoryAnchor=JSON.stringify(revisions().at(-1)!.payload.items.find((item:any)=>item.id==='mandatory').anchor)
  const immutableTimeRefusal=await api('/api/channels/priority/compensation-review',{itemId:'mandatory',expectedFrames:75,action:'ACCEPT_DELAY',deltaFrames:75},409)
  assert.match(immutableTimeRefusal.error,/FIXED\/HARD_TIME/)
  async function compensate(input:object){
    const reviewed=await api('/api/channels/priority/compensation-review',input)
    const request={input,reviewToken:reviewed.reviewToken,requestId:randomUUID()}
    const applied=await api('/api/channels/priority/compensation',request)
    const repeated=await api('/api/channels/priority/compensation',request)
    assert.equal(repeated.deduplicated,true);assert.equal(repeated.revision,applied.revision)
    assert.equal((await snapshot()).live.transport.onAir.itemId,'vt')
    return applied
  }
  const softAnchor=revisions().at(-1)!.payload.items.find((item:any)=>item.id==='soft').anchor.at
  await compensate({itemId:'soft',expectedFrames:75,action:'ACCEPT_DELAY',deltaFrames:75})
  assert.equal(revisions().at(-1)!.payload.items.find((item:any)=>item.id==='soft').anchor.at,softAnchor+75)
  assert.equal(JSON.stringify(revisions().at(-1)!.payload.items.find((item:any)=>item.id==='mandatory').anchor),mandatoryAnchor)
  await compensate({itemId:'optional',expectedFrames:75,action:'DROP_OPTIONAL',deltaFrames:0})
  assert.equal(revisions().at(-1)!.payload.items.some((item:any)=>item.id==='optional'),false)
  await compensate({itemId:'trim-vt',expectedFrames:125,action:'TRIM',deltaFrames:-50})
  assert.equal(revisions().at(-1)!.payload.items.find((item:any)=>item.id==='trim-vt').trim.out,75)
  const fillerResolvedFrames=(await snapshot()).executionView.schedule.items.find((row:any)=>row.id==='filler').duration
  assert.equal(fillerResolvedFrames,300,'Elastic filler must execute the resolved duration, not only the nominal 75-frame cut')
  await api('/api/channels/priority/transport',{action:'take',itemId:'filler'})
  await wait('Adjusted filler never reached native PGM',async()=>(await snapshot()).live.transport.onAir?.itemId==='filler')
  await wait('Adjusted filler did not end at executable trim',async()=>Boolean(database.sqlite.prepare("SELECT id FROM as_run WHERE item_id='filler' AND ended_by='EOS' AND execution_kind='NATIVE'").get()),20000)
  const fillerExit=database.sqlite.prepare("SELECT * FROM as_run WHERE item_id='filler' AND ended_by='EOS' AND execution_kind='NATIVE'").get() as any
  assert.ok(Math.abs(fillerExit.end_position_frames-fillerResolvedFrames)<=2,'Native filler EOS must match the resolved trim')
  const compensationRevision=revisions().at(-1)!
  assert.equal(fillerExit.revision_id,compensationRevision.id)
  assert.equal(compensationRevision.payload.items.find((item:any)=>item.id==='filler').trim.out,fillerNominal)
  await wait('Removed optional was not skipped after filler',async()=>(await snapshot()).live.transport.onAir?.itemId==='soft')
  assert.equal(database.sqlite.prepare("SELECT count(*) AS n FROM as_run WHERE item_id='optional'").get()!.n,0)
  await api('/api/channels/priority/transport',{action:'take',itemId:'trim-vt'})
  await wait('Trimmed VT never reached PGM',async()=>(await snapshot()).live.transport.onAir?.itemId==='trim-vt')
  await wait('Trimmed VT did not end at actual trim',async()=>Boolean(database.sqlite.prepare("SELECT id FROM as_run WHERE item_id='trim-vt' AND ended_by='EOS' AND execution_kind='NATIVE'").get()),15000)
  const trimExit=database.sqlite.prepare("SELECT * FROM as_run WHERE item_id='trim-vt' AND ended_by='EOS' AND execution_kind='NATIVE'").get() as any
  assert.ok(trimExit.end_position_frames>=65&&trimExit.end_position_frames<=80)
  assert.equal(trimExit.revision_id,compensationRevision.id)
  assert.equal(JSON.stringify(revisions()[0]!.payload),frozen)
  await api('/api/channels/priority/transport',{action:'stop'})
  // A separate schedule proves an automatic cut with NO manual trim/compensation.
  // Future planned start holds the 75-frame calculation during explicit TAKE;
  // recalculating the on-air projection must not change the mounted decoder.
  const automaticInstant=new Date(),automaticMidnight=new Date(automaticInstant);automaticMidnight.setHours(0,0,0,0)
  const automaticStart=Math.floor((automaticInstant.getTime()-automaticMidnight.getTime())/40)+125
  database.db.insert(rundowns).values({id:'auto-rd',channelId:'priority',name:'Automatic execution crop',date,plannedStart:automaticStart,loop:false,createdAt:stamp,updatedAt:stamp}).run()
  for(const [order,id] of ['auto-vt','auto-boundary'].entries())database.db.insert(rundownItems).values({id,rundownId:'auto-rd',sortOrder:order,title:id,type:'VT',mediaId:'asset',durationOverride:125,trim:{in:0,out:125},minDuration:75,trimmable:id==='auto-vt',anchor:id==='auto-boundary'?{kind:'FIXED',at:automaticStart+75}:{kind:'FLOW'},onOverrun:'PUSH',autoNext:id==='auto-vt',loop:false,locked:false}).run()
  const automaticReview=await api('/api/rundowns/auto-rd/operational-simulation')
  await api('/api/rundowns/auto-rd/operational-publish',{reviewToken:automaticReview.review.token},201,{'if-match':`w/"${automaticReview.review.editorialRevision}"`})
  await api('/api/channels/priority/load-rundown',{rundownId:'auto-rd'})
  const automaticBefore=await api('/api/rundowns/auto-rd')
  assert.equal(automaticBefore.executionView.items.find((row:any)=>row.item.id==='auto-vt').trim.out,125)
  assert.equal(automaticBefore.executionView.schedule.items.find((row:any)=>row.id==='auto-vt').duration,75)
  await api('/api/channels/priority/transport',{action:'take',itemId:'auto-vt'})
  await wait('Automatic scheduler cut did not reach native EOS',async()=>Boolean(database.sqlite.prepare("SELECT id FROM as_run WHERE item_id='auto-vt' AND ended_by='EOS' AND execution_kind='NATIVE'").get()),15000)
  const automaticExit=database.sqlite.prepare("SELECT * FROM as_run WHERE item_id='auto-vt' AND ended_by='EOS' AND execution_kind='NATIVE'").get() as any
  assert.ok(Math.abs(automaticExit.end_position_frames-75)<=2,'Automatic cut must actually stop at 75 frames, not nominal 125')
  assert.equal(database.sqlite.prepare("SELECT count(*) AS n FROM operator_decisions WHERE item_id='auto-vt' AND kind='OPERATIONAL_COMPENSATION'").get()!.n,0)
  await api('/api/channels/priority/transport',{action:'stop'})
  result={result:'PASS',evidence:'COMPILED_NATIVE_PRIORITY_INTERRUPTION_RESUME_AND_VERSIONED_TIMING',directory,port,revisionIds:revisions().map(row=>row.id),scheduledAnchorFrames:anchor,interruptedFrames:interruption.frames,mediaHash,editorialIsolation:true,immutableOriginalTiming:true,urgentConcurrentPublicationSingleCommit:true,urgentPublicationPreservesPgmOccurrence:true,priorityCut:true,asRunNativeCursor:true,liveDurationDeltaSeconds:120,fillerCompensationFrames:25,fillerNominalTrimOut:75,fillerResolvedFrames,fillerNativeEndCursor:fillerExit.end_position_frames,automaticTrimNominalFrames:125,automaticTrimResolvedFrames:75,automaticTrimNativeEndCursor:automaticExit.end_position_frames,compensationReplayDeduplicated:true,trimOriginalFrames:125,trimExecutableFrames:75,trimNativeEndCursor:trimExit.end_position_frames,optionalSkippedByNative:true,flexibleDelayFrames:75,mandatoryAnchorPreserved:true,protectedZoneRefusedWithoutMutation:true,rollbackPreservesPgm:true,resumeFromRecordedCursor:true,browserValidated:false,physicalInputsValidated:false,compensationCueValidated:false}
  }
}catch(error){failure=error;throw error}
finally{
  try{
    if(replyRelay){for(const socket of relaySockets)socket.destroy();await new Promise<void>(resolve=>replyRelay!.close(()=>resolve()))}
    await stopOwnServer()
  }finally{database.sqlite.close();if(failure)await writeFile(join(directory,'failure.json'),JSON.stringify({result:'FAIL',message:String(failure),logs,recoveryObservations},null,2))}
}
assert.ok(result)
if(process.argv.includes('--decimal-compensation'))result={...result,fillerCompensationFrames:fillerDelta,fillerNominalTrimOut:fillerNominal}
await writeFile(join(directory,'result.json'),JSON.stringify({...result,ownedCleanupConfirmed:true,historicalPidKills:false},null,2))
console.log(JSON.stringify({...result,ownedCleanupConfirmed:true,historicalPidKills:false}))
