import {randomUUID,createHash} from 'node:crypto'
import {isAbsolute,resolve} from 'node:path'
import {realpathSync,statSync} from 'node:fs'
import {z} from 'zod'
import {rootCatalogETag,rootAddETag,type RootCatalogReview,type RootAddReview} from '@rplayout/protocol'
import type {Db} from '../db/client.js'
import {mediaRoots,operatorDecisions} from '../db/schema.js'
import {eq} from 'drizzle-orm'
import {AccessControl,type AccessRequest} from './access.js'
import {can} from './permissions.js'
import {CollaborativeEditError} from './collaborative-edit.js'
import {contem,labelFor} from './roots.js'
const fail=(status:number,error:string):never=>{throw new CollaborativeEditError(status,{error})}
interface Authority {request:AccessRequest;ownerId:string|null}
export function rootAuthority(db:Db,request:AccessRequest):Authority{return {request,ownerId:new AccessControl(db.$client).identity(request)?.id??null}}
export function rootAccess(db:Db,authority:Authority,write:boolean){
  const access=new AccessControl(db.$client),identity=access.identity(authority.request)
  if((identity?.id??null)!==authority.ownerId||access.required()&&!identity||!can(access.role(authority.request),'PLAYLIST_EDIT'))fail(403,'A sessão ou permissão mudou; pastas preservadas.')
  const editable=identity?.channelIds===undefined||identity.channelIds===null
  if(write&&!editable)fail(403,'O acervo é compartilhado. Conta limitada a canais não pode alterar pastas globais.')
  return {identity,editable}
}
function read(db:Db,canEdit:boolean):RootCatalogReview{
  const row=db.$client.prepare('SELECT version FROM root_revision WHERE singleton=1').get() as {version:number}|undefined
  if(!row||!Number.isSafeInteger(row.version)||row.version<1)fail(409,'Revisão das pastas indisponível; nenhuma versão presumida.')
  const roots=db.select().from(mediaRoots).all().map(root=>{let present=false;try{present=statSync(root.path).isDirectory()}catch{}return {id:root.id,path:root.path,label:root.label,present}}).sort((a,b)=>a.label.localeCompare(b.label,'pt-BR'))
  return {revision:row!.version,canEdit,roots}
}
function candidate(path:string):RootAddReview['candidate']{
  if(!path.trim()||path.length>4096||path.includes('\0')||!isAbsolute(path.trim()))fail(400,'Escolha um caminho absoluto de pasta no servidor.')
  const normalized=resolve(path.trim())
  try{
    const realPath=realpathSync.native(normalized),info=statSync(realPath,{bigint:true})
    if(!info.isDirectory())fail(400,'O caminho escolhido não é uma pasta.')
    return {path:normalized,realPath,fingerprint:createHash('sha256').update(JSON.stringify([normalized,realPath,String(info.dev),String(info.ino)])).digest('hex')}
  }catch(error){if(error instanceof CollaborativeEditError)throw error;return fail(409,'Pasta não encontrada ou indisponível no servidor. Campos preservados; confira o caminho e a conexão.')}
}
function addRead(db:Db,path:string,canEdit:boolean):RootAddReview{return {...read(db,canEdit),candidate:candidate(path)}}
export function readRootCatalog(db:Db,authority:Authority){return db.transaction(()=>read(db,rootAccess(db,authority,false).editable))}
export function readRootAdd(db:Db,path:string,authority:Authority){return db.transaction(()=>addRead(db,path,rootAccess(db,authority,false).editable))}
function proof(header:unknown,expected:string,adding:boolean){
  if(header===undefined)fail(428,'Confira as pastas antes de alterar; revisão original obrigatória.')
  if(typeof header!=='string'||!(adding?/^"root-add:[1-9]\d*:[a-f0-9]{64}"$/:/^"roots:[1-9]\d*"$/).test(header))fail(400,'Conferência inválida ou de outra operação.')
  if(header!==expected)fail(409,'A lista ou a pasta mudou. Campos preservados; reabra a conferência.')
}
export function addRootConferred(db:Db,body:unknown,header:unknown,authority:Authority,scanAvailable=false){
  const parsed=z.object({path:z.string().min(1).max(4096),label:z.string().max(256).optional()}).strict().safeParse(body)
  if(!parsed.success)fail(400,'Informe somente caminho e nome da pasta, sem campos extras.')
  return db.transaction(tx=>{
    const actor=rootAccess(db,authority,true),before=addRead(db,parsed.data!.path,true)
    proof(header,rootAddETag(before),true)
    for(const root of before.roots){
      let actual=root.path;try{actual=realpathSync.native(root.path)}catch{}
      if(contem(root.path,before.candidate.path)||contem(before.candidate.path,root.path)||contem(actual,before.candidate.realPath)||contem(before.candidate.realPath,actual))fail(409,'Essa pasta já está no acervo ou se sobrepõe a uma pasta cadastrada.')
    }
    const root={id:randomUUID(),path:before.candidate.path,label:parsed.data!.label?.trim()||labelFor(before.candidate.path),createdAt:new Date().toISOString()}
    tx.insert(mediaRoots).values(root).run()
    // The new folder and its targeted quick scan are one durable operation.
    // A busy/uncertain worker does not prevent registration: FIFO protects it.
    const scanBatchId=scanAvailable?randomUUID():null
    if(scanBatchId){
      db.$client.prepare('INSERT INTO ingest_batches(id,roots,measure,state,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(scanBatchId,JSON.stringify([root.path]),0,'PENDING',root.createdAt,root.createdAt)
      tx.insert(operatorDecisions).values({id:'root-scan:'+root.id,rundownId:'@library',kind:'MEDIA_SCAN_QUEUED',actorUsername:actor.identity?.username??null,createdAt:root.createdAt,payload:{batchId:scanBatchId,rootId:root.id,roots:[root.path],measure:false,reason:'NEW_ROOT',station:authority.request.ip,automaticTake:false}}).run()
    }
    const after=read(db,true)
    tx.insert(operatorDecisions).values({id:randomUUID(),rundownId:'@library',kind:'MEDIA_ROOT_ADDED',actorUsername:actor.identity?.username??null,createdAt:new Date().toISOString(),payload:{station:authority.request.ip,rootId:root.id,path:root.path,label:root.label,scanBatchId,beforeRevision:before.revision,afterRevision:after.revision,automaticTake:false}}).run()
    return {root:{id:root.id,path:root.path,label:root.label,present:true},review:after,scanBatchId,applied:true as const,automaticTake:false as const}
  },{behavior:'immediate'})
}
export function removeRootConferred(db:Db,id:string,body:unknown,header:unknown,authority:Authority){
  if(!z.object({}).strict().safeParse(body??{}).success)fail(400,'Remoção de pasta não aceita campos extras.')
  return db.transaction(tx=>{
    const actor=rootAccess(db,authority,true),before=read(db,true);proof(header,rootCatalogETag(before),false)
    const root=before.roots.find(row=>row.id===id)
    if(!root)fail(404,'Pasta não encontrada; nada foi removido.')
    if(before.roots.length<=1)fail(409,'O acervo precisa de pelo menos uma pasta.')
    tx.delete(mediaRoots).where(eq(mediaRoots.id,id)).run()
    const after=read(db,true)
    tx.insert(operatorDecisions).values({id:randomUUID(),rundownId:'@library',kind:'MEDIA_ROOT_REMOVED',actorUsername:actor.identity?.username??null,createdAt:new Date().toISOString(),payload:{station:authority.request.ip,root,beforeRevision:before.revision,afterRevision:after.revision,filesDeleted:false,assetsDeleted:false,automaticTake:false}}).run()
    return {ok:true as const,applied:true as const,review:after,automaticTake:false as const}
  },{behavior:'immediate'})
}
