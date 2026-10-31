import {randomUUID} from 'node:crypto'
import {asc,eq,isNull,or} from 'drizzle-orm'
import {fieldsUsedIn,graphicsETag,graphicsScope,type GraphicsReview} from '@rplayout/protocol'
import type {Db} from '../db/client.js'
import {channels,graphicTemplates,itemGraphics,secondaryEvents} from '../db/schema.js'
import {graphicsRevision} from '../db/graphics-revisions.js'
import {CollaborativeEditError} from './collaborative-edit.js'
import {createGraphicTemplate,updateGraphicTemplate,validGraphicTemplate} from './graphics-schema.js'
import {z} from 'zod'
type Reader=Pick<Db,'select'>
type Transaction=Parameters<Parameters<Db['transaction']>[0]>[0]
export interface GraphicsHooks {authorize:(tx:Reader,id:string|null)=>void;audit:(tx:Transaction,details:Record<string,unknown>)=>void}
function reject(status:number,error:string):never{throw new CollaborativeEditError(status,{error})}
function channel(tx:Reader,id:string|null,write:boolean){
  if(id===null)return null
  const row=tx.select().from(channels).where(eq(channels.id,id)).get()
  if(!row)reject(404,'Canal não encontrado.')
  if(write&&row.archivedAt)reject(409,'Canal arquivado: artes não alteradas.')
  return row
}
function review(tx:Reader,id:string|null):GraphicsReview{
  const row=channel(tx,id,false),templates=tx.select().from(graphicTemplates).where(id===null?isNull(graphicTemplates.channelId):or(isNull(graphicTemplates.channelId),eq(graphicTemplates.channelId,id))).orderBy(asc(graphicTemplates.name),asc(graphicTemplates.id)).all()
  if(templates.some(template=>!validGraphicTemplate.safeParse(template).success))reject(409,'Há arte salva inválida. Corrija o legado explicitamente; nenhuma arte foi omitida ou normalizada.')
  if(row?.slateTemplateId&&!templates.some(template=>template.id===row.slateTemplateId))reject(409,'A apresentação técnica referencia arte ausente ou de outro canal. Corrija explicitamente antes de conferir.')
  return {channelId:id,revision:graphicsRevision(tx,id),sharedRevision:graphicsRevision(tx,null),templates,slateTemplateId:row?.slateTemplateId??null,channelArchived:Boolean(row?.archivedAt),automaticTake:false,physicalOutputValidated:false}
}
export function readGraphicsReview(db:Db,id:string|null,authorize:GraphicsHooks['authorize']){
  return db.transaction(tx=>{authorize(tx,id);return review(tx,id)})
}
function requireReview(tx:Reader,id:string|null,header:unknown){
  if(header===undefined)reject(428,'Confira as artes antes de alterar. Revisão original obrigatória.')
  const match=typeof header==='string'?/^"graphics:([^:]+):([1-9]\d*):([1-9]\d*)"$/.exec(header):null
  let scope:string|undefined;try{scope=match?decodeURIComponent(match[1]!):undefined}catch{}
  if(!match||scope!==graphicsScope(id)||!Number.isSafeInteger(Number(match[2]))||!Number.isSafeInteger(Number(match[3])))reject(400,'Revisão de artes inválida ou de outro escopo.')
  const revisions={channelId:id,revision:graphicsRevision(tx,id),sharedRevision:graphicsRevision(tx,null)}
  if(header!==graphicsETag(revisions))reject(409,'Artes ou canal mudaram desde a conferência. Reabra explicitamente; seus campos não foram aplicados.')
  return revisions
}
function assertRemovable(tx:Reader,id:string){
  if(tx.select({id:channels.id}).from(channels).where(eq(channels.slateTemplateId,id)).get()||tx.select({id:itemGraphics.id}).from(itemGraphics).where(eq(itemGraphics.templateId,id)).get()||tx.select().from(secondaryEvents).all().some(row=>row.definition.templateId===id))reject(409,'Arte vinculada à apresentação técnica ou grade. Remova seus vínculos explicitamente antes de excluir; histórico publicado é preservado.')
}
export function editGraphicTemplate(db:Db,operation:'CREATE'|'UPDATE'|'DELETE',target:string|undefined,body:unknown,header:unknown,hooks:GraphicsHooks){
  return db.transaction(tx=>{
    const parsed=operation==='CREATE'?createGraphicTemplate.safeParse(body):operation==='UPDATE'?updateGraphicTemplate.safeParse(body):null
    if(parsed&&!parsed.success)reject(400,'Arte inválida. Confira nome, SVG, campos únicos e duração; nada foi gravado.')
    const existing=operation==='CREATE'?undefined:tx.select().from(graphicTemplates).where(eq(graphicTemplates.id,target!)).get()
    if(operation!=='CREATE'&&!existing)reject(404,'Arte não encontrada.')
    const id=existing?existing.channelId:(parsed!.data as z.infer<typeof createGraphicTemplate>).channelId??null
    hooks.authorize(tx,id);channel(tx,id,true);const before=requireReview(tx,id,header)
    let template:typeof graphicTemplates.$inferSelect|null=null
    if(operation==='DELETE'){assertRemovable(tx,target!);tx.delete(graphicTemplates).where(eq(graphicTemplates.id,target!)).run()}
    else{
      const input=parsed!.data as z.infer<typeof updateGraphicTemplate>,svg=input.svg??existing!.svg
      const declared=input.fields??existing?.fields??[],fields=operation==='CREATE'||input.svg!==undefined||input.fields!==undefined?fieldsUsedIn(svg).map(key=>declared.find(field=>field.key===key)??{key,label:key,defaultValue:''}):existing!.fields
      const {channelId:_owner,...editable}=parsed!.data as z.infer<typeof createGraphicTemplate>
      const next=existing?{...existing,...editable,fields}:{id:randomUUID(),channelId:id,...editable,svg,fields,createdAt:new Date().toISOString()}
      if(!validGraphicTemplate.safeParse(next).success)reject(400,'Conteúdo final da arte inválido; nada foi normalizado.')
      template=next as typeof graphicTemplates.$inferSelect
      if(existing)tx.update(graphicTemplates).set({...editable,fields}).where(eq(graphicTemplates.id,target!)).run()
      else tx.insert(graphicTemplates).values(template).run()
    }
    const current=review(tx,id)
    hooks.audit(tx,{channelId:id,templateId:template?.id??target,operation,reviewedRevision:before.revision,reviewedSharedRevision:before.sharedRevision,revision:current.revision,sharedRevision:current.sharedRevision,changedFields:operation==='UPDATE'?Object.keys(parsed!.data!):[],automaticTake:false,physicalOutputValidated:false})
    return {...current,template,applied:true as const,eTag:graphicsETag(current)}
  },{behavior:'immediate'})
}
export function editSlate(db:Db,id:string,body:unknown,header:unknown,hooks:GraphicsHooks){
  const parsed=z.object({templateId:z.string().min(1).nullable()}).strict().safeParse(body)
  if(!parsed.success)reject(400,'Escolha de apresentação técnica inválida.')
  return db.transaction(tx=>{
    hooks.authorize(tx,id);const row=channel(tx,id,true)!,before=requireReview(tx,id,header)
    if(parsed.data.templateId){
      const template=tx.select().from(graphicTemplates).where(eq(graphicTemplates.id,parsed.data.templateId)).get()
      if(!template||template.channelId!==null&&template.channelId!==id||!validGraphicTemplate.safeParse(template).success)reject(400,'Arte ausente, inválida ou de outro canal.')
    }
    tx.update(channels).set({slateTemplateId:parsed.data.templateId}).where(eq(channels.id,id)).run()
    const current=review(tx,id)
    hooks.audit(tx,{channelId:id,before:row.slateTemplateId,after:parsed.data.templateId,reviewedRevision:before.revision,reviewedSharedRevision:before.sharedRevision,revision:current.revision,sharedRevision:current.sharedRevision,automaticTake:false,physicalOutputValidated:false})
    return {...current,applied:true as const,eTag:graphicsETag(current)}
  },{behavior:'immediate'})
}
