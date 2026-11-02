import assert from 'node:assert/strict'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdtemp,readFile,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'
const root=fileURLToPath(new URL('..',import.meta.url)),directory=await mkdtemp(join(tmpdir(),'RPlayout-proxy-recipe-'))
const gst=process.env.GSTREAMER_1_0_ROOT_MSVC_X86_64??'C:/Program Files/gstreamer/1.0/msvc_x86_64'
const env={...process.env,PATH:join(gst,'bin')+';'+process.env.PATH,GST_PLUGIN_PATH:join(gst,'lib/gstreamer-1.0'),GST_PLUGIN_SYSTEM_PATH:join(gst,'lib/gstreamer-1.0'),GST_PLUGIN_SCANNER:join(gst,'libexec/gstreamer-1.0/gst-plugin-scanner.exe'),GST_REGISTRY:join(directory,'registry.bin')}
const run=promisify(execFile),binary=join(root,'apps/engine/target/release/rplayout-proxy.exe'),probe=join(root,'apps/engine/target/release/rplayout-probe.exe')
const cases=[]
for(const [label,width,height,outWidth,outHeight]of [['16x9',640,360,426,240],['4x3',640,480,320,240],['vertical',360,640,136,240]] as const){
  const source=join(directory,`São José Çãó-${label}.mp4`),output=join(directory,`${label}.proxy.mp4`)
  await run(join(gst,'bin/gst-launch-1.0.exe'),['-q','videotestsrc','num-buffers=50','pattern=smpte','!',`video/x-raw,width=${width},height=${height},framerate=25/1`,'!','x264enc','tune=zerolatency','speed-preset=ultrafast','!','h264parse','!','queue','!','m.video_0','audiotestsrc','num-buffers=94','!','audioconvert','!','avenc_aac','!','aacparse','!','queue','!','m.audio_0','mp4mux','name=m','!','filesink',`location=${source.replaceAll('\\','/')}`],{env,windowsHide:true,timeout:30000})
  const receipt=JSON.parse((await run(binary,[source,output],{env,windowsHide:true,timeout:30000})).stdout.trim().split('\n').at(-1)!)
  assert.equal(receipt.ok,true);assert.equal(receipt.recipe,'picture-raster-v2')
  const decoded=JSON.parse((await run(probe,[output,'--no-loudness'],{env,windowsHide:true,timeout:30000})).stdout.trim().split('\n').at(-1)!)
  assert.equal(decoded.ok,true);assert.equal(decoded.video.width,outWidth);assert.equal(decoded.video.height,outHeight)
  assert.equal(decoded.video.rateNum/decoded.video.rateDen,10);assert.ok(decoded.decodedVideoBuffers>0&&decoded.decodedAudioBuffers>0)
  cases.push({label,sourceRaster:[width,height],proxyRaster:[outWidth,outHeight],receipt,decodedVideoBuffers:decoded.decodedVideoBuffers,decodedAudioBuffers:decoded.decodedAudioBuffers})
}
const result={result:'PASS',directory,compiledProxySha256:createHash('sha256').update(await readFile(binary)).digest('hex'),cases,compiledServerWorkflowValidated:false,browserSafeAreasValidated:false,physicalInputsValidated:false}
await writeFile(join(directory,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result))
