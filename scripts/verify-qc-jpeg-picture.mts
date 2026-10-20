import assert from 'node:assert/strict'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdtemp,readFile,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'

// Actual release CLI output, not metadata guesses or geometry-only tests.
const root=fileURLToPath(new URL('..',import.meta.url)),directory=await mkdtemp(join(tmpdir(),'RPlayout-QC-JPEG-picture-'))
const gst=process.env.GSTREAMER_1_0_ROOT_MSVC_X86_64??'C:/Program Files/gstreamer/1.0/msvc_x86_64'
const env={...process.env,PATH:join(gst,'bin')+';'+process.env.PATH,GST_PLUGIN_PATH:join(gst,'lib/gstreamer-1.0'),GST_PLUGIN_SYSTEM_PATH:join(gst,'lib/gstreamer-1.0'),GST_PLUGIN_SCANNER:join(gst,'libexec/gstreamer-1.0/gst-plugin-scanner.exe'),GST_REGISTRY:join(directory,'registry.bin')}
const run=promisify(execFile),probe=join(root,'apps/engine/target/release/rplayout-probe.exe'),cases=[]
function jpegRaster(bytes:Buffer){
  assert.equal(bytes.readUInt16BE(0),0xffd8)
  let offset=2
  while(offset<bytes.length){
    assert.equal(bytes[offset++],0xff)
    while(bytes[offset]===0xff)offset++
    const marker=bytes[offset++];assert.notEqual(marker,0xda,'JPEG has no dimensions before scan')
    const length=bytes.readUInt16BE(offset);assert.ok(length>=2&&offset+length<=bytes.length)
    if([0xc0,0xc1,0xc2].includes(marker!))return [bytes.readUInt16BE(offset+5),bytes.readUInt16BE(offset+3)]
    offset+=length
  }
  throw new Error('JPEG has no raster')
}
for(const [label,width,height,par,requested,outWidth,outHeight]of [
  ['16x9',640,360,'1/1',3840,640,360],
  ['4x3',640,480,'1/1',3840,640,480],
  ['vertical-UHD',2160,3840,'1/1',3840,1216,2160],
  ['SD-anamorphic',720,576,'16/15',320,320,240],
] as const){
  const source=join(directory,`São José Çãó-${label}.mkv`),output=join(directory,`${label}.jpg`)
  await run(join(gst,'bin/gst-launch-1.0.exe'),['-q','videotestsrc','num-buffers=12','pattern=smpte','!',`video/x-raw,width=${width},height=${height},framerate=25/1,pixel-aspect-ratio=${par}`,'!','x264enc','tune=zerolatency','speed-preset=ultrafast','!','h264parse','!','matroskamux','!','filesink',`location=${source.replaceAll('\\','/')}`],{env,windowsHide:true,timeout:30000})
  const receipt=JSON.parse((await run(probe,[source,'--no-loudness','--thumbnail',output,'--largura',String(requested)],{env,windowsHide:true,timeout:30000})).stdout.trim().split('\n').at(-1)!)
  assert.equal(receipt.ok,true)
  const raster=jpegRaster(await readFile(output));assert.deepEqual(raster,[outWidth,outHeight])
  assert.ok(raster[0]!<=3840&&raster[1]!<=2160)
  cases.push({label,sourceRaster:[width,height],par,requestedWidth:requested,jpegRaster:raster})
}
const result={result:'PASS',directory,probeSha256:createHash('sha256').update(await readFile(probe)).digest('hex'),cases,browserFallbackValidated:false,compiledHttpValidated:false,physicalSignalValidated:false}
await writeFile(join(directory,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result))
