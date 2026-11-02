import assert from 'node:assert/strict'
import {execFile,spawn} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdtemp} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
const root=fileURLToPath(new URL('..',import.meta.url)),directory=await mkdtemp(join(tmpdir(),'RPlayout-mix-tracks-')),file=join(directory,'TRILHAS-ÇÃO.mkv')
const gstRoot=process.env.GSTREAMER_1_0_ROOT_MSVC_X86_64??'C:/Program Files/gstreamer/1.0/msvc_x86_64',gstBin=join(gstRoot,'bin')
const env={...process.env,GST_REGISTRY:join(directory,'registry.bin'),GST_PLUGIN_SCANNER:join(gstRoot,'libexec/gstreamer-1.0/gst-plugin-scanner.exe'),GST_PLUGIN_PATH:join(gstRoot,'lib/gstreamer-1.0'),GST_PLUGIN_SYSTEM_PATH:join(gstRoot,'lib/gstreamer-1.0'),PATH:gstBin+';'+process.env.PATH}
const run=promisify(execFile),args=['-q','matroskamux','name=m','!','filesink',`location=${file.replaceAll('\\','/')}`,'videotestsrc','num-buffers=150','!','video/x-raw,width=160,height=90,framerate=25/1','!','videoconvert','!','vp8enc','deadline=1','!','queue','!','m.video_0']
for(let i=0;i<2;i++)args.push('audiotestsrc','num-buffers=300','wave=sine','freq=300',`volume=${i===0?0.2:0.02}`,'!','audio/x-raw,format=F32LE,rate=48000,channels=2','!','queue','!',`m.audio_${i}`)
await run(join(gstBin,'gst-launch-1.0.exe'),args,{env,timeout:30_000,windowsHide:true})
async function measure(audioTrack:number,routing:object){const {stdout}=await run(join(root,'apps/engine/target/release/rplayout-audio-analysis.exe'),[file,JSON.stringify({audioTrack,routing})],{env,timeout:30_000,windowsHide:true});return JSON.parse(stdout)}
const first=await measure(0,{mode:'STEREO_1_2'}),second=await measure(1,{mode:'STEREO_1_2'})
assert.equal(first.ok,true);assert.equal(second.ok,true);assert.ok(Math.abs(first.integratedLufs-second.integratedLufs-20)<0.01);assert.ok(Math.abs(first.truePeakDbtp-second.truePeakDbtp-20)<0.01)
const inverted=await measure(0,{mode:'MATRIX',matrix:[[1,0],[0,-1]]});assert.equal(inverted.ok,true);assert.ok(Math.abs(inverted.integratedLufs-first.integratedLufs)<0.01)
const cancelled=await measure(0,{mode:'MATRIX',matrix:[[0.5,-0.5],[0.5,-0.5]]});assert.equal(cancelled.ok,true);assert.ok(cancelled.integratedLufs<=-60);assert.ok(cancelled.truePeakDbtp<=-60)
assert.equal((await measure(2,{mode:'DEFAULT'})).ok,false);assert.equal((await measure(0,{mode:'STEREO_3_4'})).ok,false)
const interrupted=await new Promise<{ok:boolean;reason:string}>((resolve,reject)=>{
  const child=spawn(join(root,'apps/engine/target/release/rplayout-audio-analysis.exe'),[file,JSON.stringify({audioTrack:0,routing:{mode:'STEREO_1_2'}}),'--parent-pipe'],{env,windowsHide:true})
  let output='';const timeout=setTimeout(()=>{child.kill();reject(new Error('Analisador não encerrou ao perder pipe do dono'))},10_000)
  child.stdout.on('data',chunk=>output+=String(chunk));child.stderr.resume();child.once('error',reject)
  child.once('exit',()=>{clearTimeout(timeout);try{resolve(JSON.parse(output))}catch{reject(new Error(output))}});child.stdin.end()
})
assert.equal(interrupted.ok,false);assert.ok(interrupted.reason.includes('servidor encerrou'))
console.log(JSON.stringify({result:'PASS',evidence:'RELEASE_ANALYZER_REAL_PCM_MULTIPLE_TRACKS_AND_MATRIX',directory,firstTrackLufs:first.integratedLufs,secondTrackLufs:second.integratedLufs,differenceLu:first.integratedLufs-second.integratedLufs,invertedLufs:inverted.integratedLufs,cancelledLufs:cancelled.integratedLufs,cancelledPeak:cancelled.truePeakDbtp,missingTrackRejected:true,missingPairRejected:true,parentPipeLossStopsDecoder:true,physicalSourceValidated:false}))
