import {createHash} from 'node:crypto'
import {z} from 'zod'
import {runLocalGraphicProbe} from './ha-local-graphic-probe.js'
import {localFileStamp,probeRuntimeHash} from './ha-local-probe.js'
import type {LocalMountCheck} from './ha-local-payload.js'
import {graphicProbeComposition} from './graphic-viewport.js'

const count=z.number().int().nonnegative().max(100000),hash=z.string().regex(/^[a-f0-9]{64}$/)
export const returnGraphicSummarySchema=z.object({required:count,rendered:count,failed:count,unavailable:count,blocked:count,visualApprovalPending:count,publicationAuthorized:z.literal(false)}).strict().refine(v=>v.required===v.rendered+v.failed+v.unavailable+v.blocked&&v.visualApprovalPending===v.required)
const frameSchema=z.object({version:z.literal(1),ok:z.literal(true),width:z.literal(1920),height:z.literal(1080),format:z.literal('RGBA'),decodedFrames:z.literal(1),pixelBytes:z.literal(1920*1080*4),pixelHash:hash,nonBlackPixels:z.number().int().nonnegative().max(1920*1080),compositionHash:hash,runtimeHash:hash,checkedAt:z.string().datetime(),editorialApproved:z.literal(false),publicationAuthorized:z.literal(false),nativePrepared:z.literal(false),authorityTransferred:z.literal(false)}).strict()
export const returnGraphicEvidenceSchema=z.object({version:z.literal(1),runtimeHash:hash.nullable(),entries:z.array(z.object({key:hash,revisionId:z.string().min(1).max(256),itemId:z.string().min(1).max(1024),compositionHash:hash.nullable(),status:z.enum(['BLOCKED','UNAVAILABLE','FAILED','RENDERED']),frame:frameSchema.nullable()}).strict().refine(v=>v.status==='RENDERED'?!!v.frame&&v.frame.compositionHash===v.compositionHash:v.frame===null)).max(100000)}).strict().refine(v=>new Set(v.entries.map(row=>row.key)).size===v.entries.length&&v.entries.every(row=>!row.frame||row.frame.runtimeHash===v.runtimeHash))
export type ReturnGraphicJob={check:LocalMountCheck;svg:string|null}
const sha=(value:string)=>createHash('sha256').update(value).digest('hex')
export function returnGraphicIdentity(revisionId:string,index:number,itemId:string,svg:string|null){
  const compositionHash=svg===null?null:sha(graphicProbeComposition(svg))
  return {compositionHash,key:sha(JSON.stringify([revisionId,index,itemId,compositionHash]))}
}
export function summarizeReturnGraphics(raw:unknown){
  const evidence=returnGraphicEvidenceSchema.parse(raw)
  return returnGraphicSummarySchema.parse({required:evidence.entries.length,rendered:evidence.entries.filter(row=>row.status==='RENDERED').length,failed:evidence.entries.filter(row=>row.status==='FAILED').length,unavailable:evidence.entries.filter(row=>row.status==='UNAVAILABLE').length,blocked:evidence.entries.filter(row=>row.status==='BLOCKED').length,visualApprovalPending:evidence.entries.length,publicationAuthorized:false})
}
/** One serial analysis under the owning media-review job. Only hashes/receipts
 * are persisted; neither SVG, pixel bytes nor machine paths go to the query. */
export async function reviewReturnGraphics(jobs:ReturnGraphicJob[],binary:string|null,signal:AbortSignal,alive:()=>void,runner:typeof runLocalGraphicProbe=runLocalGraphicProbe){
  if(jobs.length>100000)throw new Error('Composições excedem limite.')
  signal.throwIfAborted();alive()
  const runnable=jobs.some(job=>job.svg!==null&&!job.check.errors.length)
  let stamp:string|null=null,runtimeHash:string|null=null
  if(binary&&runnable)try{stamp=await localFileStamp(binary);runtimeHash=await probeRuntimeHash(binary)}catch{signal.throwIfAborted();alive();binary=null}
  const entries:z.infer<typeof returnGraphicEvidenceSchema>['entries']=[]
  // Reuse identical rendered compositions inside this job only, not across
  // runtime changes or historical requests; every reference retains its identity.
  const rendered=new Map<string,z.infer<typeof frameSchema>>()
  const failed=new Set<string>()
  for(let index=0;index<jobs.length;index++){
    signal.throwIfAborted();alive()
    const {check,svg}=jobs[index]!,revisionId=check.revisionId
    if(!revisionId)throw new Error('Composição sem revisão publicada.')
    const {compositionHash,key}=returnGraphicIdentity(revisionId,index,check.itemId,svg)
    let status:'BLOCKED'|'UNAVAILABLE'|'FAILED'|'RENDERED'='BLOCKED',frame:z.infer<typeof frameSchema>|null=null
    if(svg!==null&&!check.errors.length){
      if(!binary){status='UNAVAILABLE';check.warnings.push('LOCAL_GRAPHIC_RUNTIME_UNAVAILABLE')}
      else try{
        if(failed.has(compositionHash!))throw new Error('Composição já falhou neste runtime.')
        frame=rendered.get(compositionHash!)??frameSchema.parse(await runner(binary,svg,1920,1080,signal,alive))
        if(frame.runtimeHash!==runtimeHash||frame.compositionHash!==compositionHash)throw new Error('Render não corresponde à composição/runtime.')
        rendered.set(compositionHash!,frame);status='RENDERED';check.warnings.push('LOCAL_GRAPHIC_VISUAL_APPROVAL_PENDING')
      }catch{signal.throwIfAborted();alive();failed.add(compositionHash!);status='FAILED';frame=null;check.errors.push('LOCAL_GRAPHIC_RENDER_FAILED')}
    }
    entries.push({key,revisionId,itemId:check.itemId,compositionHash,status,frame})
  }
  if(binary&&runnable&&(await localFileStamp(binary)!==stamp||await probeRuntimeHash(binary)!==runtimeHash))throw new Error('Runtime gráfico mudou durante revisão.')
  signal.throwIfAborted();alive()
  const evidence=returnGraphicEvidenceSchema.parse({version:1,runtimeHash,entries})
  return {evidence,summary:summarizeReturnGraphics(evidence)}
}
