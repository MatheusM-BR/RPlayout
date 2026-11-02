import {spawn} from 'node:child_process'
import {constants,setPriority} from 'node:os'
import {z} from 'zod'
import {audioRoutingKey,validateAudioRouting} from '@rplayout/protocol'
import {readReturnBus,returnBusConfigSchema} from './ha-return-bus-reading.js'
import {localFileStamp,probeRuntimeHash} from './ha-local-probe.js'
import {verifyReturnLocalMediaBytes} from './ha-return-local-media.js'
import {mediaProcessEnvironment} from './media-process-environment.js'
import type {ReturnAudioMount} from './ha-return-audio-mounts.js'

const integer=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
export const returnAudioReadingSchema=z.object({ok:z.literal(true),integratedLufs:z.number().finite(),lra:z.number().finite().nonnegative(),truePeakDbtp:z.number().finite(),sampleFrames:integer.min(19200),rate:z.literal(48000),channels:z.literal(2),trim:z.object({inNs:integer,outNs:integer}).strict()}).strict()
function expectedFrames(trim:ReturnAudioMount['trim']){
  if(!Number.isSafeInteger(trim.inNs)||!Number.isSafeInteger(trim.outNs)||trim.inNs<0||trim.outNs-trim.inNs<400_000_000)throw new Error('Corte de áudio inválido para medição.')
  return Number(BigInt(trim.outNs-trim.inNs)*48000n/1_000_000_000n)
}
/** Require actual PCM sample coverage of exactly the requested half-open cut.
 * Native success/exit alone, whole-file loudness or first-track metadata fail. */
export function readReturnAudioMount(raw:unknown,trim:ReturnAudioMount['trim']){
  const expected=expectedFrames(trim),reading=returnAudioReadingSchema.parse(raw)
  if(reading.trim.inNs!==trim.inNs||reading.trim.outNs!==trim.outNs||Math.abs(reading.sampleFrames-expected)>1)throw new Error('PCM não cobre integralmente o corte selecionado.')
  return reading
}
export const returnPostGainConfig=z.object({gainDb:z.number().finite().min(-60).max(12),ceilingDbtp:z.number().finite().min(-30).max(0),tailPolicy:z.literal('COMPENSATE_AND_FLUSH').optional()}).strict()
const postProcessing={gainDb:z.number().finite().min(-60).max(12),ceilingDbtp:z.number().finite().min(-30).max(0),lookaheadMs:z.literal(5),releaseMs:z.literal(50),limiterReductionDb:z.number().finite().nonnegative(),initialState:z.literal('RESET'),busQualified:z.literal(false),transitionQualified:z.literal(false),publicationAuthorized:z.literal(false)}
export const returnPostGainReadingSchema=returnAudioReadingSchema.extend({processing:z.discriminatedUnion('kind',[
  z.object({...postProcessing,kind:z.literal('ISOLATED_POSTGAIN_LIMITED_STEREO'),tailFlushed:z.literal(false)}).strict(),
  z.object({...postProcessing,kind:z.literal('ISOLATED_POSTGAIN_FLUSHED_STEREO'),tailFlushed:z.literal(true),startupFramesRemoved:z.literal(240),flushedFrames:z.literal(240)}).strict(),
])}).strict()
export function readReturnPostGainAudioMount(raw:unknown,trim:ReturnAudioMount['trim'],configuration:unknown){
  const config=returnPostGainConfig.parse(configuration),reading=returnPostGainReadingSchema.parse(raw),{processing,...pcm}=reading
  readReturnAudioMount(pcm,trim)
  if(processing.gainDb!==config.gainDb||processing.ceilingDbtp!==config.ceilingDbtp)throw new Error('Ganho/teto medidos não correspondem à decisão.')
  if(processing.kind!==(config.tailPolicy?'ISOLATED_POSTGAIN_FLUSHED_STEREO':'ISOLATED_POSTGAIN_LIMITED_STEREO'))throw new Error('Política de cauda não corresponde à medição solicitada.')
  return reading
}
export function runReturnAudioMount(binary:string,mount:ReturnAudioMount,signal:AbortSignal,alive:()=>void,timeoutMs=16*60_000){
  return runReturnAudioProbe(binary,mount,signal,alive,raw=>readReturnAudioMount(raw,mount.trim),timeoutMs).then(proof=>({...proof,preGainMeasured:true as const}))
}
export async function runReturnPostGainAudioMount(binary:string,mount:ReturnAudioMount,configuration:unknown,signal:AbortSignal,alive:()=>void,timeoutMs=16*60_000){
  const config=returnPostGainConfig.parse(configuration)
  const proof=await runReturnAudioProbe(binary,mount,signal,alive,raw=>readReturnPostGainAudioMount(raw,mount.trim,config),timeoutMs,config)
  return {...proof,postGainMeasured:true as const,isolatedLimiterRendered:true as const,transitionQualified:false as const}
}
/** Local file chosen by server plan; isolated native analysis at low priority.
 * Parent pipe stays open, so server crash aborts the helper, not just the timer. */
async function runReturnAudioProbe<T>(binary:string,mount:ReturnAudioMount,signal:AbortSignal,alive:()=>void,parse:(raw:unknown)=>T,timeoutMs:number,postGain?:z.infer<typeof returnPostGainConfig>,nativeConfiguration?:unknown){
  signal.throwIfAborted();alive()
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>16*60_000)throw new Error('Prazo de medição inválido.')
  if(!binary||!Number.isInteger(mount.audioTrack)||mount.audioTrack<0||mount.audioTrack>63||validateAudioRouting(mount.routing))throw new Error('Runtime/trilha/mix não admitidos.')
  expectedFrames(mount.trim)
  const stamp=await verifyReturnLocalMediaBytes(mount.path,mount.contentHash,signal,alive),runtimeStamp=await localFileStamp(binary),runtimeHash=await probeRuntimeHash(binary)
  signal.throwIfAborted();alive()
  const raw=await new Promise<unknown>((done,fail)=>{
    const child=spawn(binary,[mount.path,JSON.stringify(nativeConfiguration??{audioTrack:mount.audioTrack,routing:mount.routing,trim:mount.trim,...(postGain?{postGain}:{})}),'--parent-pipe'],{windowsHide:true,env:mediaProcessEnvironment(),stdio:['pipe','pipe','pipe']})
    let failed=false,bytes=0;const chunks:Buffer[]=[]
    const stop=()=>{failed=true;child.kill()},timeout=setTimeout(stop,timeoutMs),ownership=setInterval(()=>{try{signal.throwIfAborted();alive()}catch{stop()}},250)
    signal.addEventListener('abort',stop,{once:true});if(signal.aborted)stop()
    child.once('spawn',()=>{try{if(child.pid)setPriority(child.pid,constants.priority.PRIORITY_LOW)}catch{}})
    child.once('error',()=>{failed=true});child.stdin.once('error',stop)
    child.stdout.on('data',(chunk:Buffer)=>{bytes+=chunk.length;if(bytes>65536)stop();else chunks.push(chunk)})
    child.stderr.resume()
    child.once('close',code=>{
      clearTimeout(timeout);clearInterval(ownership);signal.removeEventListener('abort',stop)
      if(failed||code!==0)return fail(new Error('Montagem de áudio não comprovada.'))
      try{done(JSON.parse(Buffer.concat(chunks).toString('utf8')))}catch{fail(new Error('Medidor não forneceu resposta válida.'))}
    })
  })
  signal.throwIfAborted();alive()
  const reading=parse(raw)
  if(await verifyReturnLocalMediaBytes(mount.path,mount.contentHash,signal,alive)!==stamp||await localFileStamp(binary)!==runtimeStamp||await probeRuntimeHash(binary)!==runtimeHash)throw new Error('Arquivo/runtime mudou durante medição da montagem.')
  signal.throwIfAborted();alive()
  return {mountKey:mount.key,contentHash:mount.contentHash,audioTrack:mount.audioTrack,routing:mount.routing,trim:mount.trim,runtimeHash,checkedAt:new Date().toISOString(),reading,postGainQualified:false as const,busQualified:false as const,editorialApproved:false as const,publicationAuthorized:false as const}
}

/** Private server plan only; no path/config supplied by a browser request. */
export async function runReturnBusMount(binary:string,mount:ReturnAudioMount,configuration:unknown,signal:AbortSignal,alive:()=>void,timeoutMs=16*60_000){
  const config=returnBusConfigSchema.parse(configuration)
  if(mount.role!=='MASTER'||mount.outputPair!==1||config.audioTrack!==mount.audioTrack||audioRoutingKey(config.routing)!==audioRoutingKey(mount.routing)||config.trim.inNs!==mount.trim.inNs||config.trim.outNs!==mount.trim.outNs)throw new Error('Sonda de bus exige montagem master e corte correspondentes.')
  const proof=await runReturnAudioProbe(binary,mount,signal,alive,raw=>readReturnBus(raw,config),timeoutMs,undefined,config)
  return {...proof,isolatedBusRendered:true as const,transitionQualified:false as const,avQualified:false as const}
}
