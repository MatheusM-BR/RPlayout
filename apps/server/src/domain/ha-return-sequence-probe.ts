import {audioRoutingKey} from '@rplayout/protocol'
import type {ReturnBusJob} from './ha-return-bus-plan.js'
import {returnSequenceConfigurations,readReturnSequence} from './ha-return-sequence-reading.js'
import {runPrivateAudioHelper} from './ha-private-audio-helper.js'
import {localFileStamp,probeRuntimeHash} from './ha-local-probe.js'
import {verifyReturnLocalMediaBytes} from './ha-return-local-media.js'
/** Private trusted ordered server jobs, not HTTP-provided paths/configurations. */
export async function runReturnSequence(binary:string,jobs:readonly ReturnBusJob[],signal:AbortSignal,alive:()=>void,timeoutMs=16*60_000){
  signal.throwIfAborted();alive()
  const configs=returnSequenceConfigurations.parse(jobs.map(job=>job.configuration))
  if(jobs.some((job,index)=>job.mount.role!=='MASTER'||job.mount.outputPair!==1||configs[index]!.audioTrack!==job.mount.audioTrack||audioRoutingKey(configs[index]!.routing)!==audioRoutingKey(job.mount.routing)||configs[index]!.trim.inNs!==job.mount.trim.inNs||configs[index]!.trim.outNs!==job.mount.trim.outNs))throw new Error('Sequência exige montagens master/cortes correspondentes.')
  const native=JSON.stringify({items:jobs.map((job,index)=>({path:job.mount.path,configuration:configs[index]}))})
  // Conservative Windows command-line bound, including JSON quoting expansion.
  if(native.length>12000||Buffer.byteLength(native)>60000||binary.length>4096)throw new Error('Sequência excede transporte atual; não truncar ou dividir com RESET.')
  const files=new Map<string,{hash:string;stamp:string}>()
  for(const job of jobs){
    const path=job.mount.path,hash=job.mount.contentHash,prior=files.get(path)
    if(prior){if(prior.hash!==hash)throw new Error('Mesmo arquivo com versões divergentes.');continue}
    files.set(path,{hash,stamp:await verifyReturnLocalMediaBytes(path,hash,signal,alive)})
  }
  const runtimeStamp=await localFileStamp(binary),runtimeHash=await probeRuntimeHash(binary)
  const raw=await runPrivateAudioHelper(binary,['--sequence',native],signal,alive,timeoutMs,1024*1024)
  signal.throwIfAborted();alive();const reading=readReturnSequence(raw,configs)
  for(const[path,identity]of files)if(await verifyReturnLocalMediaBytes(path,identity.hash,signal,alive)!==identity.stamp)throw new Error('Arquivo mudou durante render contínuo.')
  if(await localFileStamp(binary)!==runtimeStamp||await probeRuntimeHash(binary)!==runtimeHash)throw new Error('Runtime mudou durante render contínuo.')
  signal.throwIfAborted();alive()
  return {jobKeys:jobs.map(job=>job.key),contentHashes:jobs.map(job=>job.mount.contentHash),runtimeHash,checkedAt:new Date().toISOString(),reading,continuousCutsRendered:true as const,operationalSelectorQualified:false as const,nativeTransitionQualified:false as const,avQualified:false as const,editorialApproved:false as const,publicationAuthorized:false as const}
}
