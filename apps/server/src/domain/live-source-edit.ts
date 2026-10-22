import {asc,eq} from 'drizzle-orm'
import {z} from 'zod'
import {liveSourceETag, type LiveSourceReview, type ManagedLiveSource} from '@rplayout/protocol'
import type {Db} from '../db/client.js'
import {channels,liveSources} from '../db/schema.js'
import {liveSourceRevision} from '../db/live-source-revisions.js'
import {CollaborativeEditError} from './collaborative-edit.js'
import {buildLiveSourceRecord,buildLiveSourceUpdates,type CreateLiveSourceInput,type LiveSourceRecord} from './srt.js'
import {sourceWire} from './source-wire.js'

const srt=z.object({mode:z.enum(['caller','listener','rendezvous']),host:z.string().default(''),port:z.number().int().min(1024).max(65535).default(9000),latencyMs:z.number().int().min(120).max(2000).default(800),passphrase:z.string().min(10).max(79).optional(),pbkeylen:z.union([z.literal(16),z.literal(24),z.literal(32)]).optional(),streamId:z.string().max(512).optional(),pollTimeoutMs:z.number().int().min(50).max(1000).optional()}).strict()
const failover=z.object({autoFailover:z.boolean(),maxLossPercent:z.number().finite().min(0).max(100),maxTimeoutMs:z.number().int().min(1).max(86_400_000),maxRttMs:z.number().int().min(1).max(86_400_000),switchDelayMs:z.number().int().min(0).max(86_400_000)}).strict().partial()
export const liveSourceCreateSchema=z.object({channelId:z.string().min(1),name:z.string().trim().min(1).max(200),kind:z.enum(['SRT','RTMP','SDI','NDI','OMT']),targetUrl:z.string().optional(),srtConfig:srt.optional(),role:z.enum(['PRIMARY','BACKUP']).default('PRIMARY'),pairedSourceId:z.string().min(1).optional(),autoFailover:z.boolean().default(true),failoverConfig:failover.optional(),enabled:z.boolean().default(true)}).strict()
// Owner changes require a separate workflow, never mass assignment through PUT.
export const liveSourceUpdateSchema=liveSourceCreateSchema.omit({channelId:true}).partial().extend({pairedSourceId:z.string().min(1).nullable().optional(),srtConfig:srt.nullable().optional(),failoverConfig:failover.nullable().optional()}).strict().refine(value=>Object.keys(value).length>0)
type Transaction=Parameters<Parameters<Db['transaction']>[0]>[0]
type Reader=Pick<Db,'select'>
export interface LiveSourceEditHooks {
  authorize:(tx:Reader,channelId:string)=>void
  audit:(tx:Transaction,details:Record<string,unknown>)=>void
}
function error(status:number,message:string):never{throw new CollaborativeEditError(status,{error:message})}
function channel(db:Reader,id:string):void {
  const row=db.select().from(channels).where(eq(channels.id,id)).get()
  if(!row)error(404,'Canal não encontrado.')
  if(row.archivedAt)error(409,'Canal arquivado: nenhuma entrada foi alterada.')
}
export function requireLiveSourceRevision(header:unknown,id:string,current:number):void {
  if(header===undefined)error(428,'Confira as entradas antes de alterar. A revisão original é obrigatória; nenhum dado foi alterado.')
  if(typeof header!=='string')error(400,'Revisão de entradas inválida.')
  const match=/^"sources:([^:]+):([1-9]\d*)"$/.exec(header)
  let owner:string|undefined
  try{owner=match?decodeURIComponent(match[1]!):undefined}catch{}
  if(!match||owner!==id||!Number.isSafeInteger(Number(match[2])))error(400,'Revisão não corresponde ao canal destas entradas.')
  if(Number(match[2])!==current)error(409,'As entradas ou o canal mudaram desde a conferência. Reabra a lista explicitamente; seu rascunho não foi aplicado.')
}
function validateConnection(row:LiveSourceRecord):void {
  if(!row.targetUrl.trim())error(400,'Selecione ou informe uma entrada antes de salvar.')
  if(row.kind==='SRT'||row.kind==='RTMP'){
    let url:URL
    try{url=new URL(row.targetUrl)}catch{error(400,'Informe um endereço completo da entrada.')}
    if(!url.hostname||!(row.kind==='SRT'?['srt:']:['rtmp:','rtmps:']).includes(url.protocol))error(400,'Endereço incompatível com o protocolo da entrada.')
  }else if(row.kind==='SDI'){
    if(!/^(?:sdi:)?\d+$/.test(row.targetUrl))error(400,'Selecione o número do conector SDI.')
  }else if(/^(?:sdi|ndi|omt|srt|rtmp|rtmps):/i.test(row.targetUrl)&&!row.targetUrl.toLowerCase().startsWith(row.kind.toLowerCase()+':'))error(400,'A fonte selecionada não corresponde ao protocolo da entrada.')
  if(row.kind!=='SRT'&&row.srtConfig)error(400,'Configuração SRT não pertence ao protocolo selecionado.')
}
function validatePair(tx:Reader,row:LiveSourceRecord):void {
  if(row.pairedSourceId){
    const paired=tx.select().from(liveSources).where(eq(liveSources.id,row.pairedSourceId)).get()
    if(!paired||paired.channelId!==row.channelId||paired.id===row.id||paired.role===row.role)error(400,'O par deve existir no mesmo canal, com papel primário/reserva distinto.')
  }
  const incoming=tx.select().from(liveSources).where(eq(liveSources.pairedSourceId,row.id)).all()
  if(incoming.some(peer=>peer.channelId!==row.channelId||peer.role===row.role))error(409,'Outra entrada está vinculada a esta. Corrija o par antes de alterar seu papel.')
}
const publicSource=(row:LiveSourceRecord)=>sourceWire().publicValue(row) as unknown as ManagedLiveSource
export function readLiveSourceReview(db:Db,id:string,authorize:(tx:Reader,id:string)=>void):LiveSourceReview {
  return db.transaction(tx=>{
    authorize(tx,id);channel(tx,id)
    const sources=tx.select().from(liveSources).where(eq(liveSources.channelId,id)).orderBy(asc(liveSources.createdAt),asc(liveSources.id)).all().map(publicSource)
    return {channelId:id,revision:liveSourceRevision(tx,id),sources,automaticTake:false,physicalSignalValidated:false}
  })
}
export function editLiveSource(db:Db,operation:'CREATE'|'UPDATE'|'DELETE',id:string|undefined,body:unknown,header:unknown,hooks:LiveSourceEditHooks){
  return db.transaction(tx=>{
    const parsed=operation==='CREATE'?liveSourceCreateSchema.safeParse(body):operation==='UPDATE'?liveSourceUpdateSchema.safeParse(body):null
    if(parsed&&!parsed.success)error(400,'Parâmetros da entrada inválidos. Confira nome, protocolo, conexão e limites; nenhuma alteração aplicada.')
    const existing=id?tx.select().from(liveSources).where(eq(liveSources.id,id)).get():undefined
    if(operation!=='CREATE'&&!existing)error(404,'Entrada ao vivo não encontrada.')
    const channelId=operation==='CREATE'?(parsed!.data as CreateLiveSourceInput).channelId:existing!.channelId
    hooks.authorize(tx,channelId);channel(tx,channelId)
    const before=liveSourceRevision(tx,channelId)
    requireLiveSourceRevision(header,channelId,before)
    let saved:LiveSourceRecord|null=null
    if(operation==='DELETE'){
      if(tx.select({id:liveSources.id}).from(liveSources).where(eq(liveSources.pairedSourceId,id!)).get())error(409,'Entrada usada como par de reserva. Desvincule o par explicitamente antes de remover.')
      tx.delete(liveSources).where(eq(liveSources.id,id!)).run()
    }else if(operation==='CREATE'){
      const row=buildLiveSourceRecord(parsed!.data as CreateLiveSourceInput) as LiveSourceRecord
      validateConnection(row);validatePair(tx,row)
      tx.insert(liveSources).values(row).run();saved=row
    }else{
      const input=parsed!.data as z.infer<typeof liveSourceUpdateSchema>
      // Switching away from SRT explicitly removes its old protocol parameters.
      const updates=buildLiveSourceUpdates(existing!,{...input,srtConfig:input.srtConfig??undefined})
      if(input.srtConfig===null||input.kind&&input.kind!=='SRT')updates.srtConfig=null
      const row={...existing!,...updates} as LiveSourceRecord
      validateConnection(row);validatePair(tx,row)
      tx.update(liveSources).set(updates).where(eq(liveSources.id,id!)).run();saved=row
    }
    const revision=liveSourceRevision(tx,channelId)
    hooks.audit(tx,{channelId,sourceId:saved?.id??id,operation,reviewedRevision:before,revision,changedFields:operation==='UPDATE'?Object.keys(parsed!.data!):[],automaticTake:false,physicalSignalValidated:false})
    return {source:saved?publicSource(saved):null,channelId,revision,eTag:liveSourceETag(channelId,revision),applied:true as const,automaticTake:false as const,physicalSignalValidated:false as const}
  },{behavior:'immediate'})
}
