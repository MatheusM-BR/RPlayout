import assert from 'node:assert/strict'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdtemp} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {EngineTransport} from '../apps/server/src/domain/engine.js'
import type {RundownView} from '../apps/server/src/domain/plan.js'
import type {Channel} from '@rplayout/protocol'

// Actual server transport + native engine, synthetic URI with real decoded
// video/audio. No API/UI, physical inputs, network publishers or production DB.
const root=fileURLToPath(new URL('..',import.meta.url))
const directory=await mkdtemp(join(tmpdir(),'RPlayout-decoder-wire-'))
const gstRoot=process.env.GSTREAMER_1_0_ROOT_MSVC_X86_64??'C:/Program Files/gstreamer/1.0/msvc_x86_64'
process.env.PATH=join(gstRoot,'bin')+';'+process.env.PATH
process.env.GST_REGISTRY=join(directory,'registry.bin')
const file=join(directory,'Fonte-ação.mkv')
await promisify(execFile)(join(gstRoot,'bin/gst-launch-1.0.exe'),['-q',
  'videotestsrc','num-buffers=1000','!','video/x-raw,width=160,height=90,framerate=25/1','!',
  'videoconvert','!','vp8enc','deadline=1','!','mux.',
  'audiotestsrc','num-buffers=2000','samplesperbuffer=960','!',
  'audio/x-raw,rate=48000,channels=2','!','audioconvert','!','vorbisenc','!','mux.',
  'matroskamux','name=mux','!','filesink',`location=${file.replaceAll('\\','/')}`],
  {windowsHide:true,timeout:60000})
const source=pathToFileURL(file).href
const checkTakeFailure=process.argv.includes('--take-failure')
const audioOnly=join(directory,'Fonte-sem-video.mka')
if(checkTakeFailure)await promisify(execFile)(join(gstRoot,'bin/gst-launch-1.0.exe'),['-q',
  'audiotestsrc','num-buffers=500','!','audioconvert','!','vorbisenc','!',
  'matroskamux','!','filesink',`location=${audioOnly.replaceAll('\\','/')}`],{windowsHide:true,timeout:30000})
const channel={id:'decoder-wire-local',name:'Isolated decoder wire',width:320,height:180,
  rate:{num:25,den:1},scan:'PROGRESSIVE',fieldOrder:'TFF',audioChannels:2,ceilingDbtp:-1} as Channel
const view={channel,rundown:{id:'local',channelId:channel.id,loop:false},
  items:[{item:{id:'live',type:'LIVE',title:'Synthetic live URI',sourceRef:source,autoNext:false,durationOverride:3000},
    asset:null,trim:{in:0,out:0},gainDb:0},...(checkTakeFailure?[{item:{id:'no-video',type:'LIVE',title:'Real audio-only decoder',sourceRef:pathToFileURL(audioOnly).href,autoNext:false,durationOverride:3000},asset:null,trim:{in:0,out:0},gainDb:0}]:[])],
  schedule:{items:[{id:'live',state:'SCHEDULED',duration:3000},...(checkTakeFailure?[{id:'no-video',state:'SCHEDULED',duration:3000}]:[])]}} as unknown as RundownView
let resolveExit!:()=>void
const exited=new Promise<void>(resolve=>{resolveExit=resolve})
const transport=new EngineTransport(channel,()=>view,()=>null,{
  binary:join(root,'apps/engine/target/release/rplayout-engine.exe'),
  // Configures the preview bus; on-demand publisher remains idle throughout.
  outputs:['null'],preview:'srt://127.0.0.1:1?mode=caller',bitrateKbps:450,canRestartEngine:()=>false,
  onProcessExited:()=>resolveExit(),
})
async function wait(label:string,predicate:()=>boolean,timeout=20000){
  const end=performance.now()+timeout
  while(performance.now()<end){
    if(predicate())return
    await new Promise(resolve=>setTimeout(resolve,30))
  }
  throw new Error(`${label}: ${JSON.stringify({state:transport.state(),health:transport.health()})}`)
}
let completed=false
let recoveryConfirmed=false
let takeFailureConfirmed=false
const originalSignal=()=>transport.state().liveSources.find(row=>row.source===source)
try {
  await wait('native startup',()=>transport.health().ready)
  for(let opening=1;opening<=3;opening++){
    await transport.cue({kind:'SOURCE',source,title:'Same editorial source'})
    await wait(`fresh CUE ${opening}`,()=>originalSignal()?.busSignals?.pvw?.status==='SIGNAL_OK')
    assert.equal(transport.state().onAir,null,'Repeated QC CUE must never TAKE')
    assert.equal(transport.state().preview?.kind,'SOURCE')
    assert.equal(originalSignal()!.measurements!.pvw!.width,160)
    assert.equal(originalSignal()!.measurements!.pvw!.audioChannels,2)
  }
  await transport.cue(null)
  assert.equal(transport.state().preview,null)
  await transport.take('local','live')
  await wait('actual live PGM',()=>transport.state().onAir?.itemId==='live'
    && originalSignal()?.busSignals?.pgm?.status==='SIGNAL_OK')
  await transport.cue({kind:'SOURCE',source})
  await wait('independent QC/PVW with live PGM',()=>{
    const signals=originalSignal()?.busSignals
    return signals?.pgm?.status==='SIGNAL_OK'&&signals?.pvw?.status==='SIGNAL_OK'
  })
  assert.equal(transport.state().onAir?.itemId,'live')
  if(checkTakeFailure){
    const pid=transport.processId()
    await transport.take('local','no-video') // ACK only; no actual PGM swap.
    await wait('real pending TAKE failure',()=>!transport.hasPendingCommand()
      && transport.state().preparedItemId===null
      && transport.state().liveSources.find(row=>row.itemId==='no-video')?.state==='FAILED')
    assert.equal(transport.state().onAir?.itemId,'live')
    assert.equal(transport.processId(),pid)
    assert.match(transport.health().error??'',/TAKE recusado|vídeo|decoder|encerrou/)
    const previous=transport.state().liveSources.find(row=>row.source===source)
    assert.equal(previous?.busSignals?.pgm?.status,'SIGNAL_OK','Original decoder must still deliver actual video/audio')
    assert.equal(transport.state().preparedItemId,null,'Failed armed decoder must be discarded')
    takeFailureConfirmed=true
  }
  await transport.cue(null)
  assert.equal(originalSignal()?.busSignals?.pvw?.status,'UNMONITORED')
  assert.equal(transport.state().onAir?.itemId,'live')
  if(process.argv.includes('--recovery')){
    const pid=transport.processId()
    // Finite URI is deliberately configured as LIVE, not an editorial VT:
    // EOS must preserve PGM selection and reopen rather than advance the grade.
    await wait('real source EOS/loss',()=>originalSignal()?.busStates?.pgm==='LOST',70000)
    const lost=originalSignal()!.changedAt
    assert.equal(transport.state().onAir?.itemId,'live')
    await wait('fresh reopened live decoder',()=>{
      const row=originalSignal()
      return row?.busStates?.pgm==='ON_PGM'&&row.busSignals?.pgm?.status==='SIGNAL_OK'
        && row.changedAt!==lost && (row.measurements?.pgm?.receivedFrames??Infinity)<500
    })
    assert.equal(transport.processId(),pid,'Source retry must not restart the channel engine')
    assert.equal(transport.state().onAir?.itemId,'live','Live loss never advances the rundown')
    recoveryConfirmed=true
  }
  await transport.stop()
  await wait('STOP confirmed',()=>transport.state().onAir===null)
  assert.ok(transport.publishers().every(row=>row.health==='idle'),'No network publisher may activate')
  completed=true
}finally{
  transport.close()
  let timer:ReturnType<typeof setTimeout>|undefined
  try{await Promise.race([exited,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Own native engine did not exit')),10000)})])}
  finally{if(timer)clearTimeout(timer)}
}
assert.ok(completed)
console.log(JSON.stringify({result:'PASS',evidence:'SERVER_TRANSPORT_SOURCE_WITH_REAL_NATIVE_DECODER_IDENTITY',
  directory,repeatedCue:3,decodedVideoAudio:true,programPreservedDuringQc:true,previewClear:true,stopConfirmed:true,
  ownEngineExitConfirmed:true,compiledHttpServerValidated:false,browserValidated:false,physicalInputsValidated:false,
  sourceEosRecoveryValidated:recoveryConfirmed,takeFailureInjectionValidated:takeFailureConfirmed}))
