import assert from 'node:assert/strict'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdtemp,readFile,writeFile,readdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'
const root=fileURLToPath(new URL('..',import.meta.url)),directory=await mkdtemp(join(tmpdir(),'RPlayout-QC-accurate-frame-'))
const gst=process.env.GSTREAMER_1_0_ROOT_MSVC_X86_64??'C:/Program Files/gstreamer/1.0/msvc_x86_64'
const env={...process.env,PATH:join(gst,'bin')+';'+process.env.PATH,GST_PLUGIN_PATH:join(gst,'lib/gstreamer-1.0'),GST_PLUGIN_SYSTEM_PATH:join(gst,'lib/gstreamer-1.0'),GST_PLUGIN_SCANNER:join(gst,'libexec/gstreamer-1.0/gst-plugin-scanner.exe'),GST_REGISTRY:join(directory,'registry.bin')}
const run=promisify(execFile),probe=join(root,'apps/engine/target/release/rplayout-probe.exe'),source=join(directory,'São José ação GOP longo.mkv'),sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex')
// Moving content; a single 125-frame GOP so interior requests cannot be
// satisfied by the leading keyframe. No scene-change keyframes.
await run(join(gst,'bin/gst-launch-1.0.exe'),['-q','videotestsrc','num-buffers=125','pattern=ball','!','video/x-raw,width=640,height=360,framerate=25/1','!','x264enc','tune=zerolatency','speed-preset=ultrafast','key-int-max=125','option-string=scenecut=0','!','h264parse','!','matroskamux','!','filesink',`location=${source.replaceAll('\\','/')}`],{env,windowsHide:true,timeout:30000})
const cases=[]
for(const position of [0,5,17,23]){
  const prefix=join(directory,`quality-${position}`),start=performance.now()
  const receipt=JSON.parse((await run(probe,[source,'--no-loudness','--thumbnail',prefix,'--fita','24','--only-frame',String(position),'--largura','640'],{env,windowsHide:true,timeout:30000})).stdout.trim().split('\n').at(-1)!)
  assert.equal(receipt.ok,true);assert.equal(receipt.frameRecipe,'qc-frame-v3');assert.equal(receipt.thumbnail,'1')
  assert.equal(typeof receipt.framePtsNs,'number');assert.equal(typeof receipt.requestedPositionNs,'number')
  assert.ok(Math.abs(receipt.framePtsNs-receipt.requestedPositionNs)<=40_000_000,JSON.stringify(receipt))
  const files=(await readdir(directory)).filter(name=>name.startsWith(`quality-${position}-`))
  assert.deepEqual(files,[`quality-${position}-${position}.jpg`])
  const bytes=await readFile(join(directory,files[0]!));assert.equal(bytes.readUInt16BE(0),0xffd8);assert.equal(bytes.readUInt16BE(bytes.length-2),0xffd9)
  cases.push({position,requestedPositionNs:receipt.requestedPositionNs,framePtsNs:receipt.framePtsNs,jpegSha256:sha(bytes),elapsedMs:Math.round(performance.now()-start),generatedFrames:files.length})
}
assert.equal(new Set(cases.map(entry=>entry.jpegSha256)).size,4,'Different positions must not reuse the leading keyframe')
assert.equal((await readdir(directory)).some(name=>name.includes('.part-')),false)
const result={result:'PASS',directory,probeSha256:sha(await readFile(probe)),cases,compiledHttpValidated:false,browserValidated:false,physicalInputsValidated:false}
await writeFile(join(directory,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result))
