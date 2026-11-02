import {randomUUID} from 'node:crypto'
import {eq} from 'drizzle-orm'
import {z} from 'zod'
import {assetMetadataETag,type AssetMetadataReview} from '@rplayout/protocol'
import type {Db} from '../db/client.js'
import {mediaAssets,operatorDecisions} from '../db/schema.js'
import {qcRevision} from '../db/qc-revisions.js'
import {AccessControl,type AccessRequest} from './access.js'
import {can} from './permissions.js'
import {CollaborativeEditError} from './collaborative-edit.js'

interface Authority {request:AccessRequest;ownerId:string|null}
const reject=(status:number,error:string):never=>{throw new CollaborativeEditError(status,{error})}
export const metadataPatch=z.object({title:z.string().trim().min(1).max(512).optional(),categoryId:z.string().trim().min(1).max(128).nullable().optional()}).strict().refine(value=>Object.keys(value).length>0)
export function captureAssetMetadataAuthority(db:Db,request:AccessRequest):Authority {
  return {request,ownerId:new AccessControl(db.$client).identity(request)?.id??null}
}
function authorize(db:Db,authority:Authority,write:boolean) {
  const access=new AccessControl(db.$client),identity=access.identity(authority.request)
  if((identity?.id??null)!==authority.ownerId||access.required()&&!identity||!can(access.role(authority.request),'PLAYLIST_EDIT'))reject(403,'A sessão ou permissão do acervo mudou; nada foi alterado.')
  const editable=identity?.channelIds===undefined||identity.channelIds===null
  if(write&&!editable)reject(403,'Título e categoria pertencem ao acervo compartilhado. Sua conta pode consultar, mas não alterar dados de todos os canais.')
  return {identity,editable}
}
function review(db:Db,assetId:string,canEdit:boolean):AssetMetadataReview {
  // Select only public fields: metadata review must not return paths, hashes,
  // QC notes, technical declarations or the media itself.
  const row=db.$client.prepare('SELECT title,category_id AS categoryId FROM media_assets WHERE id=?').get(assetId) as {title:string;categoryId:string|null}|undefined
  if(!row)reject(404,'Arquivo não encontrado no acervo.')
  if(typeof row!.title!=='string'||row!.categoryId!==null&&typeof row!.categoryId!=='string')reject(409,'Metadados salvos inválidos; nenhum valor foi presumido.')
  // Migration 23 already tracks every asset/QC change, same-value writes and
  // tombstones. Reuse its authoritative counter, with a distinct proof kind.
  return {assetId,...row!,revision:qcRevision(db,assetId),canEdit}
}
export function readAssetMetadata(db:Db,id:string,authority:Authority) {
  return db.transaction(()=>{const access=authorize(db,authority,false);return review(db,id,access.editable)})
}
export function editAssetMetadata(db:Db,id:string,body:unknown,header:unknown,authority:Authority) {
  const parsed=metadataPatch.safeParse(body)
  if(!parsed.success)reject(400,'Informe título e/ou categoria válidos. Metadados e decisão QC são operações separadas; nenhum campo extra é aceito.')
  const input=parsed.data!
  return db.transaction(tx=>{
    const access=authorize(db,authority,true),before=review(db,id,true)
    if(header===undefined)reject(428,'Confira título e categoria antes de salvar. Revisão original do acervo obrigatória.')
    const match=typeof header==='string'?/^"asset-metadata:([^"\s]+):([1-9]\d*)"$/.exec(header):null
    if(!match||match[1]!==encodeURIComponent(id)||!Number.isSafeInteger(Number(match[2])))reject(400,'Revisão do acervo inválida ou de outro arquivo/operação.')
    if(header!==assetMetadataETag(before))reject(409,'O arquivo, QC ou catálogo mudou desde a conferência. Campos preservados; reabra explicitamente antes de salvar.')
    tx.update(mediaAssets).set(input).where(eq(mediaAssets.id,id)).run()
    const current=review(db,id,true)
    tx.insert(operatorDecisions).values({id:randomUUID(),rundownId:'@library',kind:'ASSET_METADATA_CHANGED',actorUsername:access.identity?.username??null,createdAt:new Date().toISOString(),payload:{assetId:id,station:authority.request.ip,changedFields:Object.keys(input),before:{title:before.title,categoryId:before.categoryId},after:{title:current.title,categoryId:current.categoryId},reviewedRevision:before.revision,revision:current.revision,automaticTake:false}}).run()
    return {...current,applied:true as const,eTag:assetMetadataETag(current),automaticTake:false as const}
  },{behavior:'immediate'})
}
