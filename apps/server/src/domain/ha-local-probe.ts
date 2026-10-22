import {spawn} from 'node:child_process'
import {createHash} from 'node:crypto'
import {createReadStream} from 'node:fs'
import {lstat} from 'node:fs/promises'
import {constants,setPriority} from 'node:os'
import {z} from 'zod'
import {assessQc,type MediaAsset,type QcProfile} from '@rplayout/protocol'
import {mediaProcessEnvironment} from './media-process-environment.js'

const integer=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const positive=integer.positive()
export const localProbeSchema=z.object({
  ok:z.literal(true),durationNs:integer,decodedVideoBuffers:integer,decodedAudioBuffers:integer,
  videoCodec:z.string().max(256).optional(),
  video:z.object({width:positive.max(16384),height:positive.max(16384),rateNum:integer,rateDen:positive,interlaceMode:z.enum(['progressive','interleaved','mixed'])}).optional(),
  audio:z.object({rate:positive,channels:positive.max(64),integratedLufs:z.number().finite().optional(),lra:z.number().finite().nonnegative().optional(),truePeakDbtp:z.number().finite().optional()}).optional(),
  audioTracks:z.array(z.object({index:integer,rate:positive,channels:positive.max(64),language:z.string().max(128).optional()})).max(64).optional(),
})
export type LocalProbe=z.infer<typeof localProbeSchema>
export type LocalProbeRunner=(path:string,signal:AbortSignal)=>Promise<unknown>
export class LocalProbeError extends Error {}

export async function localFileStamp(path:string):Promise<string>{
  const info=await lstat(path,{bigint:true})
  if(!info.isFile()||info.isSymbolicLink())throw new LocalProbeError('Arquivo local indisponível ou caminho inválido.')
  return JSON.stringify([info.dev,info.ino,info.size,info.mtimeNs,info.ctimeNs].map(String))
}

/** Runtime identity is recorded separately from the media SHA. Refuse links,
 * changing executables and inherited RPlayout administrator/vault credentials. */
export async function probeRuntimeHash(binary:string):Promise<string>{
  const before=await localFileStamp(binary)
  const hash=createHash('sha256')
  for await(const chunk of createReadStream(binary))hash.update(chunk)
  if(before!==await localFileStamp(binary))throw new LocalProbeError('Sonda local mudou durante a validação.')
  return hash.digest('hex')
}

/** No thumbnail/output files, no shell, one bounded child at low priority.
 * Resolve/reject on close, after its handles have actually been released. */
export function runLocalProbe(binary:string,path:string,signal:AbortSignal,timeoutMs=15*60_000):Promise<unknown>{
  if(signal.aborted)return Promise.reject(new LocalProbeError('Análise local cancelada.'))
  return new Promise((done,fail)=>{
    const child=spawn(binary,[path],{windowsHide:true,env:mediaProcessEnvironment(),stdio:['ignore','pipe','pipe']})
    let failure:string|null=null,bytes=0
    const output:Buffer[]=[]
    const stop=(reason:string)=>{failure??=reason;child.kill()}
    const abort=()=>stop('Análise local cancelada.')
    const timeout=setTimeout(()=>stop('Análise local excedeu o limite de tempo.'),timeoutMs)
    signal.addEventListener('abort',abort,{once:true})
    if(signal.aborted)abort()
    child.once('spawn',()=>{try{if(child.pid)setPriority(child.pid,constants.priority.PRIORITY_LOW)}catch{}})
    child.stdout.on('data',(chunk:Buffer)=>{bytes+=chunk.length;if(bytes>1024*1024)stop('Resposta da sonda local excedeu o limite.');else output.push(chunk)})
    child.stderr.resume() // Native debug output may contain private paths; never expose it.
    child.once('error',()=>{failure??='Não foi possível executar a sonda local.'})
    child.once('close',code=>{
      clearTimeout(timeout);signal.removeEventListener('abort',abort)
      if(failure||code!==0)return fail(new LocalProbeError(failure??'Sonda local encerrou sem análise válida.'))
      try{done(localProbeSchema.parse(JSON.parse(Buffer.concat(output).toString('utf8').trim())))}catch{fail(new LocalProbeError('Sonda local não comprovou decodificação. Confira arquivo, runtime e versão da sonda.'))}
    })
  })
}

/** Never reuse published probe/loudness as local evidence or manufacture an
 * APPROVED decision. Policy QC and native decoding are independent gates. */
export function assessLocalProbe(asset:MediaAsset,raw:unknown,profile:QcProfile|undefined,checkedAt:string){
  const parsed=localProbeSchema.safeParse(raw)
  const probe=parsed.success?parsed.data:null
  const decoded=Boolean(probe&&(asset.kind==='VIDEO'?probe.video&&probe.video.rateNum>0&&probe.durationNs>0&&probe.decodedVideoBuffers>0:asset.kind==='STILL'?probe.video&&probe.decodedVideoBuffers>0:probe.audio&&probe.durationNs>0&&probe.decodedAudioBuffers>0)&&(!probe.audio||probe.decodedAudioBuffers>0))
  const loudnessFile=probe?.audio?.integratedLufs!==undefined&&probe.audio.lra!==undefined&&probe.audio.truePeakDbtp!==undefined?{
    integratedLufs:probe.audio.integratedLufs,lra:probe.audio.lra,truePeakDbtp:probe.audio.truePeakDbtp,scope:'FILE' as const,measuredAt:checkedAt,
  }:null
  const local:MediaAsset={...asset,durationNs:probe?.durationNs??null,probeError:decoded?null:'A sonda local não comprovou buffers decodificados de vídeo/áudio.',loudnessFile,
    probe:probe?.video?{codec:probe.videoCodec??null,width:probe.video.width,height:probe.video.height,rate:{num:probe.video.rateNum,den:probe.video.rateDen},interlaceMode:probe.video.interlaceMode,hasAudio:Boolean(probe.audio),audioChannels:probe.audio?.channels??0,audioTracks:probe.audioTracks??[]}:null,
  }
  const checks=assessQc(local,profile)
  return {decoded,probe,loudnessFile,checks}
}
