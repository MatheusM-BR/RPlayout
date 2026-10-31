import {asc,eq,inArray} from 'drizzle-orm'
import {timingSafeEqual} from 'node:crypto'
import type {EditScope,EditScopeReview} from '@rplayout/protocol'
import type {Db} from '../db/client.js'
import {channels,mediaAssets,rundownItems,rundowns} from '../db/schema.js'
import {readScopeTargets} from './scopes.js'
import {CollaborativeEditError} from './collaborative-edit.js'
import {installationVault} from './secret-vault.js'

export const isWideScope=(scope:EditScope)=>scope==='ALL_RUNDOWNS'||scope==='ASSET_DEFAULT'
export interface ScopeOwner {itemId:string;rundownId:string;channelId:string;archivedAt:string|null}
function canonical(value:unknown):unknown{
  if(Array.isArray(value))return value.map(canonical)
  if(value && typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,entry])=>[key,canonical(entry)]))
  return value
}

/** Caller owns one read/write transaction for rows, authorization and versions.
 * Do not issue a new token as part of applying an old proposal. */
export function inspectEditScope(db:Pick<Db,'select'>,itemId:string,scope:EditScope,revisionOf:(id:string)=>number,authorize:(owners:ScopeOwner[])=>void):EditScopeReview{
  if(!db.select({id:rundownItems.id}).from(rundownItems).where(eq(rundownItems.id,itemId)).get())throw new CollaborativeEditError(404,{error:'Item não encontrado.'})
  const targets=readScopeTargets(db,itemId,scope)
  if(scope==='ASSET_DEFAULT' && !targets.mediaId)throw new CollaborativeEditError(400,{error:'Item sem arquivo não tem padrão de acervo.'})
  const items=db.select().from(rundownItems).where(scope==='ASSET_DEFAULT'?eq(rundownItems.mediaId,targets.mediaId!):inArray(rundownItems.id,targets.ids)).orderBy(asc(rundownItems.id)).all()
  const gradeIds=[...new Set(items.map(item=>item.rundownId))]
  const grades=db.select().from(rundowns).where(inArray(rundowns.id,gradeIds)).orderBy(asc(rundowns.id)).all()
  const channelIds=[...new Set(grades.map(grade=>grade.channelId))]
  const channelRows=db.select().from(channels).where(inArray(channels.id,channelIds)).orderBy(asc(channels.id)).all()
  const gradeMap=new Map(grades.map(row=>[row.id,row])),channelMap=new Map(channelRows.map(row=>[row.id,row]))
  if(grades.length!==gradeIds.length || channelRows.length!==channelIds.length)throw new CollaborativeEditError(409,{error:'Os proprietários do escopo mudaram; atualize a revisão dos alvos.'})
  const ownership=items.map(item=>{const grade=gradeMap.get(item.rundownId)!;return {itemId:item.id,rundownId:grade.id,channelId:grade.channelId,archivedAt:channelMap.get(grade.channelId)!.archivedAt}})
  authorize(ownership)
  const asset=targets.mediaId?db.select().from(mediaAssets).where(eq(mediaAssets.id,targets.mediaId)).get()??null:null
  if(targets.mediaId && !asset)throw new CollaborativeEditError(409,{error:'A mídia deste escopo não existe mais.'})
  const versions=grades.map(grade=>({id:grade.id,version:revisionOf(grade.id)}))
  const token=installationVault().reviewIdentity(JSON.stringify(canonical({itemId,scope,targets,items,grades,channelRows,asset,versions})),'scoped-edit:v1')
  return {itemId,scope,sourceRevision:revisionOf(targets.rundownId),token,itemsAffected:targets.ids.length,assetUpdated:scope==='ASSET_DEFAULT',references:items.length,
    owners:grades.map(grade=>({rundownId:grade.id,rundownName:grade.name,date:grade.date,channelId:grade.channelId,channelName:channelMap.get(grade.channelId)!.name,count:items.filter(item=>item.rundownId===grade.id).length}))}
}
export function requireScopeReview(review:EditScopeReview,supplied:string|undefined):void{
  if(!isWideScope(review.scope))return
  if(!supplied)throw new CollaborativeEditError(428,{error:'SCOPE_REVIEW_REQUIRED',message:'Confira os canais e dias afetados antes de aplicar este escopo. Nenhum dado foi alterado.'})
  const actual=Buffer.from(review.token),expected=Buffer.from(supplied)
  if(actual.length!==expected.length || !timingSafeEqual(actual,expected))throw new CollaborativeEditError(409,{error:'SCOPE_REVIEW_SUPERSEDED',message:'Os alvos, a mídia ou outra grade mudaram depois da revisão deste escopo. Confira novamente os canais e dias afetados; nenhum dado foi alterado.'})
}
