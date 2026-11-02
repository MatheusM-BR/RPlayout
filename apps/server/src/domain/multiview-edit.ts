import {randomUUID} from 'node:crypto'
import {eq,isNull} from 'drizzle-orm'
import {multiviewETag,multiviewScope,type MultiviewReview,type MultiviewLayout,type MultiviewCell} from '@rplayout/protocol'
import type {Db} from '../db/client.js'
import {channels,multiviewConfigs} from '../db/schema.js'
import {multiviewRevision} from '../db/multiview-revisions.js'
import {multiviewEditSchema,multiviewCellsSchema,multiviewLayoutSchema} from './multiview-schema.js'
import {sourceWire} from './source-wire.js'
import {CollaborativeEditError} from './collaborative-edit.js'
type Reader=Pick<Db,'select'>
type Transaction=Parameters<Parameters<Db['transaction']>[0]>[0]
export interface MultiviewHooks {authorize:(tx:Reader,channelId:string|null)=>void;audit:(tx:Transaction,details:Record<string,unknown>)=>void}
function reject(status:number,error:string):never{throw new CollaborativeEditError(status,{error})}
function scopeExists(tx:Reader,id:string|null){
  if(id===null)return
  const row=tx.select().from(channels).where(eq(channels.id,id)).get()
  if(!row)reject(404,'Canal não encontrado.')
  if(row.archivedAt)reject(409,'Canal arquivado: multiview não alterado.')
}
/** Look up by actual owner, NEVER a synthesized ID that may belong elsewhere.
 * Legacy IDs are preserved; duplicates are explicit conflicts, not auto-merged. */
export function storedMultiview(tx:Reader,id:string|null){
  const rows=tx.select().from(multiviewConfigs).where(id===null?isNull(multiviewConfigs.channelId):eq(multiviewConfigs.channelId,id)).all()
  if(rows.length>1)reject(409,'Há mais de um multiview neste escopo. Corrija o legado explicitamente; nenhuma configuração foi sobrescrita.')
  const row=rows[0]
  if(row&&(!multiviewLayoutSchema.safeParse(row.layout).success||!multiviewCellsSchema.safeParse(row.cells??[]).success))reject(409,'Configuração multiview salva inválida. Corrija o legado explicitamente antes de editar.')
  return row??null
}
export function readMultiviewReview(db:Db,id:string|null,authorize:(tx:Reader,id:string|null)=>void):MultiviewReview{
  return db.transaction(tx=>{
    authorize(tx,id);scopeExists(tx,id)
    const row=storedMultiview(tx,id)
    return sourceWire().publicValue({id:row?.id??null,channelId:id,layout:row?.layout??'GRID_2X2',cells:row?.cells??[],updatedAt:row?.updatedAt??null,revision:multiviewRevision(tx,id),storedTelemetryIsHistorical:true,automaticTake:false,physicalSignalValidated:false}) as MultiviewReview
  })
}
export function requireMultiviewRevision(header:unknown,id:string|null,revision:number){
  if(header===undefined)reject(428,'Confira o multiview antes de alterar. Revisão original obrigatória.')
  if(typeof header!=='string')reject(400,'Revisão multiview inválida.')
  const match=/^"multiview:([^:]+):([1-9]\d*)"$/.exec(header)
  let scope:string|undefined
  try{scope=match?decodeURIComponent(match[1]!):undefined}catch{}
  if(!match||scope!==multiviewScope(id)||!Number.isSafeInteger(Number(match[2])))reject(400,'Revisão não corresponde ao escopo do multiview.')
  if(Number(match[2])!==revision)reject(409,'Multiview, canal ou fontes mudaram desde a conferência. Reabra explicitamente; rascunho não aplicado.')
}
/** Internal save shares owner isolation; HTTP adds fresh authority/revision/audit. */
export function writeMultiview(tx:Transaction,id:string|null,layout:MultiviewLayout,cells:MultiviewCell[]|undefined){
  const existing=storedMultiview(tx,id),now=new Date().toISOString()
  const row={id:existing?.id??randomUUID(),channelId:id,layout,cells:cells??existing?.cells??[],updatedAt:now}
  if(existing)tx.update(multiviewConfigs).set({layout,cells:row.cells,updatedAt:now}).where(eq(multiviewConfigs.id,existing.id)).run()
  else tx.insert(multiviewConfigs).values(row).run()
  return row
}
export function editMultiview(db:Db,body:unknown,header:unknown,hooks:MultiviewHooks){
  const parsed=multiviewEditSchema.safeParse(body)
  if(!parsed.success)reject(400,'Layout/células inválidos. Confira campos, IDs e telemetria; nada foi gravado.')
  const id=parsed.data.channelId??null
  return db.transaction(tx=>{
    hooks.authorize(tx,id);scopeExists(tx,id)
    const before=multiviewRevision(tx,id);requireMultiviewRevision(header,id,before)
    const row=writeMultiview(tx,id,parsed.data.layout,parsed.data.cells),revision=multiviewRevision(tx,id)
    hooks.audit(tx,{channelId:id,configurationId:row.id,reviewedRevision:before,revision,layout:row.layout,cellsCount:row.cells.length,cellsReplaced:parsed.data.cells!==undefined,automaticTake:false,physicalSignalValidated:false})
    const review=sourceWire().publicValue({...row,revision,storedTelemetryIsHistorical:true,automaticTake:false,physicalSignalValidated:false}) as MultiviewReview
    return {...review,applied:true as const,eTag:multiviewETag(id,revision)}
  },{behavior:'immediate'})
}
