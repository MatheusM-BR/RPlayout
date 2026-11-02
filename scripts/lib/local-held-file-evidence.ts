import assert from 'node:assert/strict'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
import {assertMovingPublishedGray,graySequenceStatistics} from './held-picture-evidence.js'
import {stereoToneStatistics,syntheticToneSpectrum,syntheticToneWindows} from './verify-published-audio.js'

/** Decode the actual local encoded publisher file. Fixed 25fps/48kHz QA only.
 * Samples establish held picture/silence and later movement/tone, not exact
 * PTS alignment, original-frame restoration, wire compatibility or longevity. */
export async function verifyLocalHeldFile(options:{directory:string;gstBin:string;environment:NodeJS.ProcessEnv}){
  const {directory,gstBin,environment}=options,path=join(directory,'published-held-take.mkv')
  const video=join(directory,'published.gray'),audio=join(directory,'published.f32')
  const native=(file:string)=>file.replaceAll('\\','/')
  const decode=(branch:string[])=>promisify(execFile)(join(gstBin,'gst-launch-1.0.exe'),['-q','filesrc',`location=${native(path)}`,'!','decodebin','name=d','d.','!','queue',...branch],{env:environment,windowsHide:true,timeout:30000})
  await decode(['!','videoconvert','!','video/x-raw,format=GRAY8,width=320,height=180','!','filesink',`location=${native(video)}`])
  await decode(['!','audioconvert','!','audioresample','!','audio/x-raw,format=F32LE,rate=48000,channels=2,layout=interleaved','!','filesink',`location=${native(audio)}`])
  const pixels=await readFile(video),pcm=await readFile(audio),size=320*180
  assert.equal(pixels.length%size,0);assert.equal(pcm.length%8,0)
  assert.ok(pixels.length>=size*100&&pcm.length>=48000*8*4,'At least four seconds of actual decoded publisher output required')
  // Ignore encoder startup. File output opens only after confirmed paused
  // admission, then remains held >=1.2s before CUE/TAKE in the parent fixture.
  const held=graySequenceStatistics(pixels.subarray(size*10,size*25),320,180)
  assert.ok(held.minDeviation>10,'HELD image must not be a uniform placeholder')
  assert.ok(Math.max(...held.differences)<1,'Early decoded published image must remain held')
  const silence=stereoToneStatistics(pcm.subarray(48000*8/5,48000*8))
  assert.ok(silence.rms.every(value=>value<0.0001),'HELD output must not replay audio')
  const movement=assertMovingPublishedGray(pixels.subarray(pixels.length-size*50),320,180)
  const tail=pcm.subarray(pcm.length-48000*8*2),statistics=stereoToneStatistics(tail)
  const spectrum=syntheticToneSpectrum(tail),windows=syntheticToneWindows(tail,spectrum.frequencyHz)
  for(let channel=0;channel<2;channel++){
    assert.ok(statistics.rms[channel]!>0.01&&statistics.rms[channel]!<0.15,'Later actual publisher audio must have finite tone energy')
    assert.ok(Math.abs(spectrum.frequencyHz[channel]!-997)<15&&windows.concentratedWindows[channel]!>=4,'TAKE must publish current 997Hz tone, not silence or mixed/stale audio')
  }
  const hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex')
  return {path,encodedSha256:hash(await readFile(path)),videoSha256:hash(pixels),audioSha256:hash(pcm),videoFrames:pixels.length/size,audioFrames:pcm.length/8,held,silence,movement,tone:{statistics,spectrum,windows},exactPtsAlignmentValidated:false}
}
