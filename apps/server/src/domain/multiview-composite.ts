import {randomUUID} from 'node:crypto'
import {and,desc,eq} from 'drizzle-orm'
import {z} from 'zod'
import {autoMultiviewCells,multiviewLayoutUnits,type MultiviewCellSource,type MultiviewComposition,type MultiviewCompositeLayout,type MultiviewQuality} from '@rplayout/protocol'
import type {Db} from '../db/client.js'
import {channels,liveSources,operatorDecisions} from '../db/schema.js'
import {CollaborativeEditError} from './collaborative-edit.js'
import {configuredSourceEndpoint} from './item-source-binding.js'

/**
 * Layout salvo do multiview composto, por canal.
 *
 * Sem migração: cada gravação é uma decisão em `operator_decisions`
 * (`@multiview`, item = canal), que já é o registro de auditoria. A última
 * vale. Quando os branches forem integrados, a migração 59 pode trazer uma
 * tabela própria lendo estas linhas.
 */
const SCOPE='@multiview',KIND='MULTIVIEW_COMPOSITE'
export const multiviewLayoutIds=['MV_PGM_PVW','MV_2X2','MV_3X3','MV_4X4','MV_1_PLUS_5'] as const satisfies readonly MultiviewCompositeLayout[]
export const multiviewQualityIds=['REFERENCIA','PADRAO','LEVE'] as const satisfies readonly MultiviewQuality[]
const cellSchema=z.discriminatedUnion('kind',[
  z.object({kind:z.literal('pgm')}).strict(),z.object({kind:z.literal('pvw')}).strict(),z.object({kind:z.literal('next')}).strict(),
  z.object({kind:z.literal('qc')}).strict(),z.object({kind:z.literal('contingency')}).strict(),z.object({kind:z.literal('empty')}).strict(),
  z.object({kind:z.literal('source'),id:z.string().min(1).max(256)}).strict(),
])
export const compositeEditSchema=z.object({
  layout:z.enum(multiviewLayoutIds),
  quality:z.enum(multiviewQualityIds).optional(),
  /** Nulo/ausente: preenchimento automático (PGM, PVW, entradas, NEXT, QC, contingência). */
  cells:z.array(cellSchema).max(16).nullable().optional(),
}).strict()
export type CompositeEdit=z.infer<typeof compositeEditSchema>

export interface SavedComposite {
  layout:MultiviewCompositeLayout
  quality:MultiviewQuality
  cells:MultiviewCellSource[]|null
  revision:number
  savedAt:string|null
  savedBy:string|null
}
export const DEFAULT_COMPOSITE:SavedComposite={layout:'MV_PGM_PVW',quality:'PADRAO',cells:null,revision:0,savedAt:null,savedBy:null}

type Reader=Pick<Db,'select'>
const storedSchema=compositeEditSchema.extend({quality:z.enum(multiviewQualityIds),revision:z.number().int().min(1)})
export function readComposite(db:Reader,channelId:string):SavedComposite{
  const row=db.select().from(operatorDecisions).where(and(eq(operatorDecisions.rundownId,SCOPE),eq(operatorDecisions.itemId,channelId),eq(operatorDecisions.kind,KIND)))
    .orderBy(desc(operatorDecisions.createdAt),desc(operatorDecisions.id)).limit(1).get()
  if(!row)return DEFAULT_COMPOSITE
  const parsed=storedSchema.safeParse(row.payload)
  // Registro ilegível não derruba o monitor: volta ao padrão e a revisão
  // continua a partir dele, para a próxima gravação não colidir.
  if(!parsed.success)return {...DEFAULT_COMPOSITE,revision:Number((row.payload as {revision?:unknown})?.revision)||0}
  return {layout:parsed.data.layout,quality:parsed.data.quality,cells:parsed.data.cells??null,revision:parsed.data.revision,savedAt:row.createdAt,savedBy:row.actorUsername}
}

export const compositeETag=(channelId:string,revision:number)=>`"mvc:${encodeURIComponent(channelId)}:${revision}"`

function reject(status:number,error:string):never{throw new CollaborativeEditError(status,{error})}

export interface CompositeSaveHooks {
  /** Reconfere sessão, papel e escopo dentro da transação. */
  authorize:(tx:Reader,channelId:string)=>void
  /** Trocar o nível muda o custo de codificação na máquina do ar. */
  canChangeQuality:boolean
  actor:string|null
}

export function saveComposite(db:Db,channelId:string,body:unknown,ifMatch:unknown,hooks:CompositeSaveHooks):SavedComposite{
  const parsed=compositeEditSchema.safeParse(body)
  if(!parsed.success)reject(400,'Layout de multiview inválido; nada foi gravado.')
  if(ifMatch===undefined)reject(428,'Confira o multiview antes de salvar. Revisão original obrigatória.')
  return db.transaction(tx=>{
    hooks.authorize(tx,channelId)
    const channel=tx.select().from(channels).where(eq(channels.id,channelId)).get()
    if(!channel)reject(404,'Canal não encontrado.')
    if(channel.archivedAt)reject(409,'Canal arquivado: multiview não alterado.')
    const current=readComposite(tx,channelId)
    const quality=parsed.data.quality??current.quality
    if(quality!==current.quality&&!hooks.canChangeQuality)reject(403,'Trocar o nível do multiview (custo de codificação no ar) exige Supervisor ou acima.')
    if(ifMatch!==compositeETag(channelId,current.revision))reject(409,'O multiview deste canal mudou desde a conferência. Reabra; nada foi gravado.')
    const cells=parsed.data.cells??null
    if(cells){
      if(cells.length>multiviewLayoutUnits(parsed.data.layout).length)reject(400,'Mais células que o layout comporta.')
      const own=new Set(tx.select({id:liveSources.id}).from(liveSources).where(eq(liveSources.channelId,channelId)).all().map(row=>row.id))
      if(cells.some(cell=>cell.kind==='source'&&!own.has(cell.id)))reject(400,'Célula aponta para entrada que não é deste canal.')
    }
    const revision=current.revision+1,now=new Date().toISOString()
    const payload={layout:parsed.data.layout,quality,cells,revision}
    tx.insert(operatorDecisions).values({id:randomUUID(),rundownId:SCOPE,itemId:channelId,kind:KIND,payload,actorUsername:hooks.actor,createdAt:now}).run()
    return {layout:parsed.data.layout,quality,cells,revision,savedAt:now,savedBy:hooks.actor}
  },{behavior:'immediate'})
}

/** O que o engine recebe: células salvas ou o preenchimento automático. */
/**
 * Composição como vai para o engine (ingest único por entrada): cada célula
 * de entrada leva o endereço do cadastro, e o engine recebe a entrada num
 * receptor compartilhado mesmo fora de PGM/PVW. Entrada desativada ou
 * desconhecida vai sem endereço: só aparece onde já estiver aberta. O
 * endereço nunca é gravado nem volta ao navegador.
 */
export function engineComposition(composition:MultiviewComposition,sources:ReadonlyArray<{id:string;kind:string;targetUrl:string;enabled:boolean}>,options:{ingestShared:boolean}):MultiviewComposition{
  // Sem receptor compartilhado (RPLAYOUT_INGEST_SHARED=0, o padrão), o engine
  // só acha a entrada onde ela já está aberta e não usa o endereço: ele não vai
  // (pode levar passphrase SRT), só o id.
  if(!options.ingestShared)return {...composition,cells:composition.cells.map(cell=>cell.kind==='source'?{kind:'source',id:cell.id}:cell)}
  const byId=new Map(sources.filter(source=>source.enabled&&source.targetUrl).map(source=>[source.id,configuredSourceEndpoint(source)]))
  return {...composition,cells:composition.cells.map(cell=>{
    if(cell.kind!=='source')return cell
    const endpoint=byId.get(cell.id)
    return endpoint?{kind:'source',id:cell.id,endpoint}:{kind:'source',id:cell.id}
  })}
}

export function effectiveComposition(saved:SavedComposite,sources:ReadonlyArray<{id:string;role:string;enabled:boolean;createdAt?:string}>):MultiviewComposition{
  const ordered=[...sources].filter(source=>source.enabled).sort((a,b)=>(a.role==='BACKUP'?1:0)-(b.role==='BACKUP'?1:0))
  const size=multiviewLayoutUnits(saved.layout).length
  const cells=saved.cells?[...saved.cells.slice(0,size)]:autoMultiviewCells(saved.layout,ordered.map(source=>source.id))
  while(cells.length<size)cells.push({kind:'empty'})
  return {layout:saved.layout,quality:saved.quality,cells}
}
