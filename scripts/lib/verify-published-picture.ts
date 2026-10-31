import assert from 'node:assert/strict'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {readFile,writeFile} from 'node:fs/promises'
import {join} from 'node:path'

/** Consume the real loopback media bus. Opening ACK/decoder metadata alone is
 * not picture proof. Native readers are finite and never address another host. */
export async function verifyPublishedPicture(options:{gstBin:string;directory:string;path:string;width:number;height:number;environment:NodeJS.ProcessEnv;label:string;videoOnly?:boolean}){
  assert.match(options.path,/^[a-z0-9-]+\/(pvw|pgm|mon|qc)$/)
  assert.match(options.label,/^[a-z0-9-]+$/)
  const {gstBin,directory,path,environment,label}=options,run=promisify(execFile)
  const jpeg=join(directory,`${label}-frames.jpg`),finalJpeg=join(directory,`${label}-last.jpg`),gray=join(directory,`${label}-last.gray`)
  // A reader joining a running H.264 stream can start mid-GOP. Request/wait
  // for an access-unit keyframe and observe 3s (longer than the 2s GOP), not
  // avdec's early reference-concealment placeholders. Picture threshold stays
  // strict; this is not a claim of browser startup latency.
  // Recovery checks decode audio with a separate, frequency-validated reader.
  // Do not make this picture reader await another track's independent EOS.
  const audioTail=options.videoOnly?[]:['r.','!','application/x-rtp,media=audio','!','queue','!','identity','eos-after=150','!','fakesink','sync=false','async=false']
  await run(join(gstBin,'gst-launch-1.0.exe'),['-q','rtspsrc','name=r',`location=rtsp://127.0.0.1:8554/${path}`,'latency=120','protocols=tcp','r.','!','application/x-rtp,media=video,encoding-name=H264','!','queue','!','rtph264depay','request-keyframe=true','wait-for-keyframe=true','!','video/x-h264,alignment=au','!','h264parse','!','avdec_h264','!','videoconvert','!','jpegenc','!','identity','eos-after=76','!','filesink',`location=${jpeg.replaceAll('\\','/')}`,...audioTail],{env:environment,windowsHide:true,timeout:30000})
  const bytes=await readFile(jpeg),start=bytes.lastIndexOf(Buffer.from([0xff,0xd8])),last=bytes.subarray(start)
  assert.ok(start>=0&&last.length>1000)
  let size:{width:number;height:number}|null=null
  for(let at=2;at+8<last.length;){assert.equal(last[at],0xff);const marker=last[at+1]!,length=last.readUInt16BE(at+2);if([0xc0,0xc1,0xc2].includes(marker)){size={width:last.readUInt16BE(at+7),height:last.readUInt16BE(at+5)};break}assert.ok(length>=2);at+=length+2}
  assert.deepEqual(size,{width:options.width,height:options.height})
  await writeFile(finalJpeg,last)
  await run(join(gstBin,'gst-launch-1.0.exe'),['-q','filesrc',`location=${finalJpeg.replaceAll('\\','/')}`,'!','jpegdec','!','videoconvert','!','video/x-raw,format=GRAY8','!','filesink',`location=${gray.replaceAll('\\','/')}`],{env:environment,windowsHide:true,timeout:15000})
  const pixels=await readFile(gray),mean=pixels.reduce((sum,value)=>sum+value,0)/pixels.length
  const deviation=Math.sqrt(pixels.reduce((sum,value)=>sum+(value-mean)**2,0)/pixels.length)
  assert.ok(deviation>10,`Published bus must contain picture, not uniform placeholder (mean=${mean}, deviation=${deviation})`)
  return {path,...size,deviation,mean,jpegBytes:last.length,receiverSettlingFrames:75}
}
