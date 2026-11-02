import assert from 'node:assert/strict'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdtemp,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
const root=fileURLToPath(new URL('..',import.meta.url)),directory=await mkdtemp(join(tmpdir(),'RPlayout-trim-loudness-')),file=join(directory,'TRECHO-ÇÃO.mkv')
const gstRoot=process.env.GSTREAMER_1_0_ROOT_MSVC_X86_64??'C:/Program Files/gstreamer/1.0/msvc_x86_64',gstBin=join(gstRoot,'bin')
const env={...process.env,GST_REGISTRY:join(directory,'registry.bin'),GST_PLUGIN_SCANNER:join(gstRoot,'libexec/gstreamer-1.0/gst-plugin-scanner.exe'),GST_PLUGIN_PATH:join(gstRoot,'lib/gstreamer-1.0'),GST_PLUGIN_SYSTEM_PATH:join(gstRoot,'lib/gstreamer-1.0'),PATH:gstBin+';'+process.env.PATH}
const run=promisify(execFile)
let result:Record<string,unknown>|null=null,failure:unknown=null
try{
  const args=['-q','matroskamux','name=m','!','filesink',`location=${file.replaceAll('\\','/')}`,'videotestsrc','num-buffers=100','!','video/x-raw,width=160,height=90,framerate=25/1','!','videoconvert','!','vp8enc','deadline=1','!','queue','!','m.video_0','concat','name=a','adjust-base=true','!','queue','!','m.audio_0']
  for(const volume of [0.2,0.02])args.push('audiotestsrc','num-buffers=20','samplesperbuffer=4800','wave=sine','freq=300',`volume=${volume}`,'!','audio/x-raw,format=F32LE,rate=48000,channels=2','!','queue','!','a.')
  await run(join(gstBin,'gst-launch-1.0.exe'),args,{env,timeout:30000,windowsHide:true})
  const measure=async(trim?:{inNs:number;outNs:number})=>JSON.parse((await run(join(root,'apps/engine/target/release/rplayout-audio-analysis.exe'),[file,JSON.stringify({audioTrack:0,routing:{mode:'STEREO_1_2'},...(trim?{trim}:{})})],{env,timeout:30000,windowsHide:true})).stdout)
  const full=await measure(),loud=await measure({inNs:0,outNs:2_000_000_000}),quiet=await measure({inNs:2_000_000_000,outNs:4_000_000_000})
  for(const reading of [full,loud,quiet])assert.equal(reading.ok,true,JSON.stringify(reading))
  assert.equal(full.sampleFrames,192000);assert.equal(loud.sampleFrames,96000);assert.equal(quiet.sampleFrames,96000)
  assert.ok(Math.abs(loud.integratedLufs-quiet.integratedLufs-20)<0.05)
  assert.ok(Math.abs(loud.truePeakDbtp-quiet.truePeakDbtp-20)<0.05)
  assert.deepEqual(quiet.trim,{inNs:2_000_000_000,outNs:4_000_000_000})
  const outside=await measure({inNs:2_000_000_000,outNs:5_000_000_000}),short=await measure({inNs:0,outNs:399_999_999}),empty=await measure({inNs:1_000_000_000,outNs:1_000_000_000})
  for(const reading of [outside,short,empty])assert.equal(reading.ok,false,JSON.stringify(reading))
  result={result:'PASS',evidence:'RELEASE_ANALYZER_SAMPLE_EXACT_REAL_PCM_TRIM',directory,full,loud,quiet,differenceLu:loud.integratedLufs-quiet.integratedLufs,outside,short,empty,apiIntegrationValidated:false,browserValidated:false,physicalOutputValidated:false}
}catch(error){failure=error}
const evidence=failure?{result:'FAIL',directory,error:String(failure),stack:failure instanceof Error?failure.stack:null}:result
await writeFile(join(directory,failure?'failure.json':'result.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));if(failure)process.exitCode=1
