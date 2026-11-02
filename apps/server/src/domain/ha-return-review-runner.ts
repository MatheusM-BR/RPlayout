import {Worker} from 'node:worker_threads'
import {dirname,resolve} from 'node:path'
import {existsSync} from 'node:fs'
import {storageProcessFiles} from '../db/process-database.js'
import type {HaSnapshot} from './ha-replication.js'
import type {inspectReturnedDatabase} from './ha-return-db-review.js'
import {haProtectedBridgeProof} from './ha-protected-bridge.js'
import type {z} from 'zod'
import {haRekeyReviewContext} from './ha-rekeyed-fields-review.js'
import {haReturnCandidateJob,type materializeReturnCandidate} from './ha-return-candidate.js'
import {haReturnCandidateOriginRequest,type readReturnCandidateOrigin} from './ha-return-candidate-origin.js'
import {haReturnBoundCandidateJob,type materializeBoundReturnCandidate} from './ha-return-bound-candidate.js'
import {haReturnMediaCandidateJob,type materializeReturnMediaCandidate} from './ha-return-media-candidate.js'

export async function runReturnReview(file:string,channelId:string,baseline:HaSnapshot,signal:AbortSignal,rekeyed?:z.infer<typeof haRekeyReviewContext>):Promise<ReturnType<typeof inspectReturnedDatabase>>{return runWorker(file,channelId,baseline,signal,undefined,undefined,rekeyed?haRekeyReviewContext.parse(rekeyed):undefined) as Promise<ReturnType<typeof inspectReturnedDatabase>>}
export async function runReturnHistoryExtraction(file:string,channelId:string,records:Array<{id:string;receivedHash:string}>,signal:AbortSignal):Promise<Array<Record<string,unknown>>>{return runWorker(file,channelId,null,signal,records) as Promise<Array<Record<string,unknown>>>}
export async function runReturnVariantExtraction(file:string,channelId:string,records:Array<{id:string;receivedHash:string|null}>,signal:AbortSignal):Promise<Array<Record<string,unknown>|null>>{return runWorker(file,channelId,null,signal,records) as Promise<Array<Record<string,unknown>|null>>}
export async function runExportProtectedBridge(file:string,exportId:string,pairingKey:string,signal:AbortSignal){return haProtectedBridgeProof.parse(await runWorker(file,'',null,signal,undefined,{mode:'EXPORT_BRIDGE',exportId,pairingKey}))}
export async function runImportProtectedBridge(file:string,exportId:string,pairingKey:string,proof:z.infer<typeof haProtectedBridgeProof>,signal:AbortSignal){return runWorker(file,'',null,signal,undefined,{mode:'IMPORT_BRIDGE',exportId,pairingKey,proof:haProtectedBridgeProof.parse(proof)})}
export async function runReturnCandidate(file:string,candidateFile:string,job:z.infer<typeof haReturnCandidateJob>,signal:AbortSignal):Promise<ReturnType<typeof materializeReturnCandidate>>{return runWorker(file,job.request.channelId,null,signal,undefined,undefined,undefined,{file:candidateFile,job:haReturnCandidateJob.parse(job)}) as Promise<ReturnType<typeof materializeReturnCandidate>>}
export async function runReturnCandidateOrigin(file:string,request:z.infer<typeof haReturnCandidateOriginRequest>,signal:AbortSignal):Promise<ReturnType<typeof readReturnCandidateOrigin>>{return runWorker(file,request.channelId,null,signal,undefined,undefined,undefined,undefined,haReturnCandidateOriginRequest.parse(request)) as Promise<ReturnType<typeof readReturnCandidateOrigin>>}
export async function runBoundReturnCandidate(file:string,targetFile:string,job:z.infer<typeof haReturnBoundCandidateJob>,signal:AbortSignal):Promise<ReturnType<typeof materializeBoundReturnCandidate>>{return runWorker(file,job.candidate.channelId,null,signal,undefined,undefined,undefined,undefined,undefined,{file:targetFile,job:haReturnBoundCandidateJob.parse(job)}) as Promise<ReturnType<typeof materializeBoundReturnCandidate>>}
export async function runReturnMediaCandidate(file:string,targetFile:string,job:z.infer<typeof haReturnMediaCandidateJob>,signal:AbortSignal):Promise<ReturnType<typeof materializeReturnMediaCandidate>>{const parsed=haReturnMediaCandidateJob.parse(job);if(Buffer.byteLength(JSON.stringify(parsed))>32*1024*1024)throw new Error('Job privado de mídia excede limite.');return runWorker(file,job.candidate.channelId,null,signal,undefined,undefined,undefined,undefined,undefined,undefined,{file:targetFile,job:parsed}) as Promise<ReturnType<typeof materializeReturnMediaCandidate>>}
async function runWorker(file:string,channelId:string,baseline:HaSnapshot|null,signal:AbortSignal,records?:Array<{id:string;receivedHash:string|null}>,bridge?:{mode:'EXPORT_BRIDGE'|'IMPORT_BRIDGE';exportId:string;pairingKey:string;proof?:z.infer<typeof haProtectedBridgeProof>},rekeyed?:z.infer<typeof haRekeyReviewContext>,candidate?:{file:string;job:z.infer<typeof haReturnCandidateJob>},candidateOrigin?:z.infer<typeof haReturnCandidateOriginRequest>,boundCandidate?:{file:string;job:z.infer<typeof haReturnBoundCandidateJob>},mediaCandidate?:{file:string;job:z.infer<typeof haReturnMediaCandidateJob>}):Promise<unknown>{
  signal.throwIfAborted()
  const binary=resolve(dirname(storageProcessFiles().bridge),'ha-return-review-worker.cjs')
  if(!existsSync(binary))throw new Error('Auxiliar de revisão ausente; nova build completa necessária.')
  if(Buffer.byteLength(JSON.stringify(baseline))>32*1024*1024)throw new Error('Visão do principal excede limite de revisão; não truncar como pronta.')
  const worker=new Worker(binary,{workerData:{file,channelId,baseline,records,...bridge,rekeyed,candidate,candidateOrigin,boundCandidate,mediaCandidate},...(candidate?{env:{...process.env,RPLAYOUT_STORAGE_MODE:'INLINE'}}:{}),resourceLimits:{maxOldGenerationSizeMb:512}})
  let report:unknown=null
  try{return await new Promise((resolveReport,reject)=>{
    const cancelled=()=>{void worker.terminate();reject(new Error('Revisão cancelada.'))}
    const timeout=setTimeout(cancelled,120000)
    const clear=()=>{clearTimeout(timeout);signal.removeEventListener('abort',cancelled)}
    signal.addEventListener('abort',cancelled,{once:true})
    worker.on('message',value=>{if(value?.ok===true&&value.report)report=value.report;else{clear();reject(new Error('Banco recebido não passou pela revisão técnica.'))}})
    worker.once('error',()=>{clear();reject(new Error('Auxiliar de revisão falhou; nenhum dado instalado.'))})
    worker.once('exit',code=>{clear();if(code===0&&report&&!signal.aborted)resolveReport(report);else reject(new Error('Revisão terminou sem confirmação.'))})
    if(signal.aborted)cancelled()
  })}finally{await worker.terminate()}
}
