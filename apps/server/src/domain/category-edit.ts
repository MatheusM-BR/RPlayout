import {randomUUID} from 'node:crypto'
import {z} from 'zod'
import {categoryETag,type CategoryReview} from '@rplayout/protocol'
import {eq} from 'drizzle-orm'
import type {Db} from '../db/client.js'
import {categories,mediaAssets,operatorDecisions} from '../db/schema.js'
import {AccessControl,type AccessRequest} from './access.js'
import {can} from './permissions.js'
import {CollaborativeEditError} from './collaborative-edit.js'
const fail=(status:number,error:string):never=>{throw new CollaborativeEditError(status,{error})}
interface Authority {request:AccessRequest;ownerId:string|null}
export function categoryAuthority(db:Db,request:AccessRequest):Authority{return {request,ownerId:new AccessControl(db.$client).identity(request)?.id??null}}
function authorize(db:Db,authority:Authority,write:boolean){
  const access=new AccessControl(db.$client),identity=access.identity(authority.request)
  if((identity?.id??null)!==authority.ownerId||access.required()&&!identity||!can(access.role(authority.request),'PLAYLIST_EDIT'))fail(403,'A sessão ou permissão mudou; categorias preservadas.')
  const editable=identity?.channelIds===undefined||identity.channelIds===null
  if(write&&!editable)fail(403,'Categorias são compartilhadas. Conta limitada a canais não pode alterar o acervo global.')
  return {identity,editable}
}
function read(db:Db,id:string,canEdit:boolean):CategoryReview{
  if(!id.trim()||id.length>128||/[\x00-\x1f\x7f]/.test(id))fail(400,'Nome de categoria inválido.')
  const version=db.$client.prepare('SELECT version FROM category_revision WHERE singleton=1').get() as {version:number}|undefined
  if(!version||!Number.isSafeInteger(version.version)||version.version<1)fail(409,'Revisão de categorias indisponível; nenhuma versão presumida.')
  const saved=db.$client.prepare('SELECT color FROM categories WHERE id=?').get(id) as {color:string}|undefined
  if(saved&&!/^#[0-9a-f]{6}$/i.test(saved.color))fail(409,'Cor salva inválida; solicite reparo explícito.')
  const count=db.$client.prepare('SELECT COUNT(*) AS n FROM media_assets WHERE category_id=?').get(id) as {n:number}
  return {id,color:saved?.color??'#5570ab',items:count.n,stored:Boolean(saved),revision:version!.version,canEdit}
}
export function readCategory(db:Db,id:string,authority:Authority){return db.transaction(()=>read(db,id,authorize(db,authority,false).editable))}
export function editCategory(db:Db,id:string,action:'SET'|'DELETE',body:unknown,header:unknown,authority:Authority){
  const parsed=(action==='SET'?z.object({color:z.string().regex(/^#[0-9a-f]{6}$/i)}).strict():z.object({}).strict()).safeParse(body??{})
  if(!parsed.success)fail(400,'Informe somente uma cor #rrggbb ou uma remoção sem campos extras.')
  return db.transaction(tx=>{
    const access=authorize(db,authority,true),before=read(db,id,true)
    if(header===undefined)fail(428,'Confira a categoria e seus arquivos antes de alterar; revisão original obrigatória.')
    const match=typeof header==='string'?/^"category:([^"\s]+):([1-9]\d*)"$/.exec(header):null
    if(!match||match[1]!==encodeURIComponent(id)||!Number.isSafeInteger(Number(match[2])))fail(400,'Conferência inválida ou de outra categoria/operação.')
    if(header!==categoryETag(before))fail(409,'Categorias ou vínculos de arquivos mudaram. Campos preservados; reabra a conferência.')
    let soltos=0
    if(action==='SET'){
      const color=(parsed.data as {color:string}).color
      if(before.stored)tx.update(categories).set({color}).where(eq(categories.id,id)).run()
      else tx.insert(categories).values({id,color,createdAt:new Date().toISOString()}).run()
    }else{
      if(!before.stored&&!before.items)fail(404,'Categoria não existe; nada foi removido.')
      tx.delete(categories).where(eq(categories.id,id)).run()
      soltos=tx.update(mediaAssets).set({categoryId:null}).where(eq(mediaAssets.categoryId,id)).run().changes
    }
    const after=read(db,id,true)
    tx.insert(operatorDecisions).values({id:randomUUID(),rundownId:'@library',kind:action==='SET'?'CATEGORY_COLOR_CHANGED':'CATEGORY_REMOVED',actorUsername:access.identity?.username??null,createdAt:new Date().toISOString(),payload:{categoryId:id,station:authority.request.ip,before,after,soltos,automaticTake:false}}).run()
    return {...after,applied:true as const,soltos,eTag:categoryETag(after),automaticTake:false as const}
  },{behavior:'immediate'})
}
