import assert from 'node:assert/strict'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {readFile} from 'node:fs/promises'
import {join} from 'node:path'

/** Synthetic sine verification only, not a loudness/PCM fidelity certificate. */
export function stereoToneStatistics(bytes:Buffer,rate=48000){
  assert.ok(bytes.length>=4800*8&&bytes.length%8===0,'Complete finite F32LE stereo required')
  const frames=bytes.length/8,skip=Math.min(4800,Math.floor(frames/4)),count=frames-skip
  const energy=[0,0],crossings=[0,0];let previous=[0,0]
  for(let frame=0;frame<frames;frame++)for(let channel=0;channel<2;channel++){
    const value=bytes.readFloatLE(frame*8+channel*4);assert.ok(Number.isFinite(value),'Non-finite PCM')
    // Fixed stereo arrays and channel < 2 above; assertions are type-only.
    if(frame>=skip){energy[channel]!+=value*value;if(frame>skip&&previous[channel]!<=0&&value>0)crossings[channel]!++}
    previous[channel]=value
  }
  return {frames,analyzedFrames:count,rate,rms:energy.map(sum=>Math.sqrt(sum/count)),frequencyHz:crossings.map(counted=>counted*rate/count)}
}
/** Blind dominant-tone estimate for synthetic 100–2000 Hz fixtures. Zero
 * crossings remain diagnostic: small codec noise can add spurious crossings.
 * A Hann window and energy concentration reject noise/mixed/stale tones. */
export function syntheticToneSpectrum(bytes:Buffer,rate=48000){
  const stats=stereoToneStatistics(bytes,rate),skip=stats.frames-stats.analyzedFrames,n=Math.min(stats.analyzedFrames,Math.floor(rate/2))
  const frequencyHz:number[]=[],toneEnergyRatio:number[]=[]
  for(let channel=0;channel<2;channel++){
    const samples=new Float64Array(n);let windowSum=0
    for(let i=0;i<n;i++){const window=0.5-0.5*Math.cos(2*Math.PI*i/(n-1));windowSum+=window;samples[i]=bytes.readFloatLE((i+skip)*8+channel*4)*window}
    const power=(hz:number)=>{const coefficient=2*Math.cos(2*Math.PI*hz/rate);let a=0,b=0;for(const sample of samples){const next=sample+coefficient*a-b;b=a;a=next}return Math.max(0,a*a+b*b-coefficient*a*b)}
    let peak=100,maximum=-1
    // No coarse-grid holes at Hann spectral nulls: <= one Fourier bin.
    for(let hz=100;hz<=2000;hz+=2){const value=power(hz);if(value>maximum){maximum=value;peak=hz}}
    const coarse=peak
    for(let hz=Math.max(100,coarse-2);hz<=Math.min(2000,coarse+2);hz+=0.5){const value=power(hz);if(value>maximum){maximum=value;peak=hz}}
    frequencyHz.push(peak);toneEnergyRatio.push(stats.rms[channel]!>0?2*maximum/(windowSum*windowSum*stats.rms[channel]!**2):0)
  }
  return {method:'HANN_GOERTZEL_BLIND_100_2000_HZ' as const,frequencyHz,toneEnergyRatio}
}
/** Phase-independent presence check, not a continuity/fidelity certificate.
 * Require concentrated energy in >=4/5 temporal windows on EACH channel;
 * one codec/join phase discontinuity cannot turn a correct sine into noise. */
export function syntheticToneWindows(bytes:Buffer,frequencyHz:readonly number[],rate=48000){
  const stats=stereoToneStatistics(bytes,rate),skip=stats.frames-stats.analyzedFrames
  const size=Math.floor(Math.min(stats.analyzedFrames,rate/2)/5),ratios:number[][]=[[],[]]
  assert.equal(frequencyHz.length,2)
  for(let c=0;c<2;c++)for(let window=0;window<5;window++){
    let a=0,b=0,sum=0,energy=0;const coefficient=2*Math.cos(2*Math.PI*frequencyHz[c]!/rate)
    for(let i=0;i<size;i++){const v=bytes.readFloatLE((skip+window*size+i)*8+c*4),w=0.5-0.5*Math.cos(2*Math.PI*i/(size-1));const next=v*w+coefficient*a-b;b=a;a=next;sum+=w;energy+=v*v}
    ratios[c]!.push(energy>0?2*Math.max(0,a*a+b*b-coefficient*a*b)/(sum*sum*energy/size):0)
  }
  return {method:'FIVE_TEMPORAL_HANN_WINDOWS' as const,ratios,concentratedWindows:ratios.map(values=>values.filter(value=>value>0.85).length)}
}
export async function verifyPublishedAudio(options:{gstBin:string;directory:string;path:string;environment:NodeJS.ProcessEnv;label:string;expectedHz:number}){
  assert.match(options.path,/^[a-z0-9-]+\/(pvw|pgm|mon|qc)$/);assert.match(options.label,/^[a-z0-9-]+$/)
  const {gstBin,directory,path,environment,label,expectedHz}=options,output=join(directory,label+'-audio.f32')
  await promisify(execFile)(join(gstBin,'gst-launch-1.0.exe'),['-q','rtspsrc','name=r',`location=rtsp://127.0.0.1:8554/${path}`,'latency=120','protocols=tcp',
    // Picture has its own finite reader. Do not make complete PCM wait for a
    // second track's independent EOS (which can stall RTSP reader shutdown).
    'r.','!','application/x-rtp,media=audio,encoding-name=OPUS','!','queue','!','rtpopusdepay','!','opusdec','!','audioconvert','!','audio/x-raw,format=F32LE,rate=48000,channels=2,layout=interleaved','!','identity','eos-after=31','!','filesink',`location=${output.replaceAll('\\','/')}`],{env:environment,windowsHide:true,timeout:30000})
  const bytes=await readFile(output),statistics=stereoToneStatistics(bytes),spectrum=syntheticToneSpectrum(bytes),toneWindows=syntheticToneWindows(bytes,spectrum.frequencyHz)
  for(let channel=0;channel<2;channel++){assert.ok(statistics.rms[channel]!>0.01&&statistics.rms[channel]!<0.15,'Actual decoded tone energy required');assert.ok(Math.abs(spectrum.frequencyHz[channel]!-expectedHz)<15&&toneWindows.concentratedWindows[channel]!>=4,`Dominant tone must be current ${expectedHz} Hz with >85% energy in >=4/5 windows, not stale, mixed or silent: ${JSON.stringify({statistics,spectrum,toneWindows})}`)}
  return {path,expectedHz,...statistics,spectrum,toneWindows}
}
