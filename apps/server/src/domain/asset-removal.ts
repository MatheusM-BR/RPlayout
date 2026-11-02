import {randomUUID} from 'node:crypto'
import {asc,eq,inArray,and,isNotNull} from 'drizzle-orm'
import {z} from 'zod'
import {assetRemovalETag,hasVideoFileSuffix,type AssetRemovalOperation,type AssetRemovalReview,type AssetRemovalImpact} from '@rplayout/protocol'
import type {Db} from '../db/client.js'
import type {ChannelRuntime} from '../app.js'
import {mediaAssets,operationalPlaylistRevisions,channelProjectSnapshots,channelCadenceConversions,operatorDecisions,rundownItems,secondaryEvents,itemGraphics} from '../db/schema.js'
import {assetRemovalRevision} from '../db/asset-removal-revisions.js'
import {accountRevision} from '../db/account-revisions.js'
import {qcRevision} from '../db/qc-revisions.js'
import {EditorialVersions} from '../db/editorial-revisions.js'
import {configurationRevision} from '../db/channel-configuration.js'
import {AccessControl,type AccessRequest} from './access.js'
import {can} from './permissions.js'
import {CollaborativeEditError} from './collaborative-edit.js'
import {installationVault} from './secret-vault.js'
import {readOperationalPayload} from './operational-playlist.js'
import {parseChannelCheckpoint} from './checkpoints.js'
import {readExecutionOwner} from '../db/execution-ownership.js'

interface Authority {request:AccessRequest;ownerId:string|null}
interface Context {db:Db;runtimes:ReadonlyMap<string,ChannelRuntime>}
const reject=(status:number,error:string):never=>{throw new CollaborativeEditError(status,{error})}
const bodySchema=z.object({assetIds:z.array(z.string().min(1).max(256)).min(1).max(1000),removeEditorialUses:z.boolean()}).strict()
export function captureAssetRemovalAuthority(db:Db,request:AccessRequest):Authority{
  return {request,ownerId:new AccessControl(db.$client).identity(request)?.id??null}
}
function authorize(db:Db,authority:Authority){
  const access=new AccessControl(db.$client),identity=access.identity(authority.request)
  if((identity?.id??null)!==authority.ownerId||access.required()&&!identity||!can(access.role(authority.request),'PLAYLIST_EDIT'))reject(403,'A sessão ou permissão do acervo mudou; nada foi removido.')
  if(identity?.channelIds!==undefined&&identity.channelIds!==null)reject(403,'Esta conferência abrange o acervo compartilhado e todos os canais. Sua conta não pode remover globalmente.')
  return {identity,station:authority.request.ip,revision:accountRevision(db.$client,identity?'U:'+identity.id:'G'),sessions:accountRevision(db.$client,identity?'S:'+identity.id:'G')}
}
/** Walk only known media-reference fields, not arbitrary strings or generic
 * IDs (which also identify channels, sources and editorial items). */
function references(value:unknown,depth=0,revisionIds=false):Set<string>{
  if(depth>40)throw new Error('Referências salvas excedem o limite de conferência.')
  const found=new Set<string>()
  if(Array.isArray(value)){for(const child of value)for(const id of references(child,depth+1,revisionIds))found.add(id)}
  else if(value&&typeof value==='object')for(const [key,child]of Object.entries(value)){
    if((revisionIds?['revisionId','sourceRevisionId','targetRevisionId','loopRevisionId']:['mediaId','media_id','liveFallbackMediaId','live_fallback_media_id','fallbackMediaId','assetId']).includes(key)&&typeof child==='string')found.add(child)
    if(!revisionIds&&key==='assets'&&Array.isArray(child))for(const row of child)if(row&&typeof row==='object'&&typeof row.id==='string')found.add(row.id)
    for(const id of references(child,depth+1,revisionIds))found.add(id)
  }
  return found
}
function snapshot(context:Context,operation:AssetRemovalOperation,id:string|null,actor:ReturnType<typeof authorize>):AssetRemovalReview{
  const {db,runtimes}=context,sqlite=db.$client
  const assets=db.select().from(mediaAssets).where(operation==='REMOVE'?eq(mediaAssets.id,id!):and(isNotNull(mediaAssets.probeError),eq(mediaAssets.kind,'VIDEO'))).orderBy(asc(mediaAssets.id)).all().filter(row=>operation==='REMOVE'||hasVideoFileSuffix(row.path))
  if(operation==='REMOVE'&&!assets.length)reject(404,'Arquivo não encontrado no acervo.')
  const items=sqlite.prepare(`SELECT i.id,i.title,i.media_id,i.live_fallback_media_id,i.rundown_id,r.name AS rundown_name,r.channel_id,c.name AS channel_name,c.archived_at FROM rundown_items i LEFT JOIN rundowns r ON r.id=i.rundown_id LEFT JOIN channels c ON c.id=r.channel_id ORDER BY i.id`).all() as Array<{id:string;title:string;media_id:string|null;live_fallback_media_id:string|null;rundown_id:string;rundown_name:string|null;channel_id:string|null;channel_name:string|null;archived_at:string|null}>
  const publications=db.select().from(operationalPlaylistRevisions).orderBy(asc(operationalPlaylistRevisions.id)).all().map(row=>({row,payload:readOperationalPayload(row.payload),refs:references(row.payload)}))
  const projects=db.select().from(channelProjectSnapshots).orderBy(asc(channelProjectSnapshots.id)).all().map(row=>({id:row.id,refs:references(row.payload)}))
  const conversions=db.select().from(channelCadenceConversions).orderBy(asc(channelCadenceConversions.id)).all().map(row=>({id:row.id,refs:references(row.snapshot)}))
  const interruptions=sqlite.prepare("SELECT id,channel_id,specification,state FROM interrupted_items WHERE state IN ('PENDING','RESUMING','UNCERTAIN') ORDER BY id").all() as Array<{id:string;channel_id:string;specification:string;state:string}>
  const policies=sqlite.prepare('SELECT channel_id,payload FROM channel_operational_policies ORDER BY channel_id').all() as Array<{channel_id:string;payload:string}>
  const checkpoints=(sqlite.prepare('SELECT channel_id,payload FROM channel_checkpoints ORDER BY channel_id').all() as Array<{channel_id:string;payload:string}>).map(row=>parseChannelCheckpoint(JSON.parse(row.payload),row.channel_id))
  const open=sqlite.prepare('SELECT id,channel_id,item_id,media_id,revision_id FROM as_run WHERE ended_at IS NULL ORDER BY id').all() as Array<{id:string;channel_id:string;item_id:string|null;media_id:string|null;revision_id:string|null}>
  const owners=(sqlite.prepare('SELECT channel_id FROM execution_owner_slots ORDER BY channel_id').all() as {channel_id:string}[]).map(row=>readExecutionOwner(sqlite,row.channel_id)!)
  const protections=db.select().from(operatorDecisions).where(inArray(operatorDecisions.kind,['PLAYLIST_BOUNDARY','CHANNEL_CONFIGURATION_SLOT','INTERRUPTION_COMMAND','OPERATIONAL_INSERT_COMMAND'])).orderBy(asc(operatorDecisions.id)).all().filter(row=>{
    const boundary=row.kind==='PLAYLIST_BOUNDARY',configuration=row.kind==='CHANNEL_CONFIGURATION_SLOT'
    const channelId=boundary?(row.payload.plan as {channelId?:unknown}|undefined)?.channelId:row.payload.channelId
    const phase=boundary||configuration?row.payload.state:row.payload.phase
    const active=configuration?['APPLYING','UNCERTAIN']:boundary?['QUEUED','PREPARING','SWITCHING','UNCERTAIN']:['PREPARING','SWITCHING','UNCERTAIN']
    const terminal=configuration?['IDLE']:boundary?['CONFIRMED','FAILED','CANCELLED']:row.kind==='INTERRUPTION_COMMAND'?['CONFIRMED','FAILED','CLOSED_UNCERTAIN']:['CONFIRMED','FAILED']
    if(typeof phase!=='string')return reject(409,'Registro durável de operação inválido. Corrija explicitamente; nenhum canal foi presumido livre.')
    if(typeof channelId!=='string'||!channelId||![...active,...terminal].includes(phase))reject(409,'Registro durável de operação inválido. Corrija explicitamente; nenhum canal foi presumido livre.')
    return active.includes(phase)
  })
  // Include only stable protection state, never elapsed frames, meters or
  // polling timestamps. GET does not load/refresh a runtime or create an air ID.
  const runtimeProof=[...runtimes.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([channelId,runtime])=>{
    const state=runtime.transport.state(),execution=runtime.executionView
    const pending=runtime.transport instanceof Object&&'hasPendingCommand'in runtime.transport?Boolean((runtime.transport as {hasPendingCommand:()=>boolean}).hasPendingCommand()):false
    const ready=runtime.reconfigurationStatus(),boundary=runtime.boundaryStatus().history.filter(row=>!['CONFIRMED','FAILED','CANCELLED'].includes(row.state))
    const protectedIds=new Set(runtime.cachePins().map(row=>row.id))
    const selected=[state.onAir?.itemId,state.preparedItemId,state.preparingItemId,state.preview?.kind==='ITEM'?state.preview.id:null]
    for(const entry of execution?.items??[])if(selected.includes(entry.item.id))for(const assetId of references(entry.item))protectedIds.add(assetId)
    if(state.preview?.kind==='ASSET')protectedIds.add(state.preview.id)
    const unavailable=!ready.ready||pending||boundary.length>0||runtime.contingencyPending||Boolean(runtime.contingencyState?.active)||runtime.transport.commandRevision===undefined
    return {channelId,revision:runtime.operationalRevision?.id??null,pid:runtime.transport.processId(),command:runtime.transport.commandRevision?.()??null,playing:state.playing,onAir:state.onAir?{id:state.onAir.itemId,start:state.onAir.startedAt}:null,preview:state.preview,prepared:state.preparedItemId,preparing:state.preparingItemId,unavailable,reason:ready.reason,boundary:boundary.map(row=>({id:row.id,state:row.state})),protectedIds:[...protectedIds].sort(),viewRefs:[...references(execution?.items.map(row=>row.item)??[])].sort()}
  })
  const impacts:AssetRemovalImpact[]=assets.map(asset=>{
    const uses=items.filter(row=>row.media_id===asset.id||row.live_fallback_media_id===asset.id).map(row=>{
      if(!row.channel_id||!row.channel_name||!row.rundown_name)reject(409,'Há referência editorial sem grade/canal válido. Corrija o legado antes de remover.')
      return {itemId:row.id,itemTitle:row.title,rundownId:row.rundown_id,rundownName:row.rundown_name!,channelId:row.channel_id!,channelName:row.channel_name!,action:row.media_id===asset.id?'REMOVE_ITEM' as const:'CLEAR_FALLBACK' as const,editorialRevision:new EditorialVersions(sqlite).read(row.rundown_id)}
    })
    const blockers=new Set<string>(),pub=publications.filter(row=>row.refs.has(asset.id)),historical=sqlite.prepare('SELECT count(*) AS n FROM as_run WHERE media_id=? AND ended_at IS NOT NULL').get(asset.id) as {n:number}
    if(owners.some(owner=>(owner.phase!=='RELEASED'||owner.spawning||owner.enginePids.length>0)&&runtimes.get(owner.channelId)?.executionOwnerId!==owner.id))blockers.add('Há execução nativa de outra instância ou parada ainda inconclusiva. PGM/PVW/preroll estrangeiros não foram presumidos livres; remova pelo servidor dono após conferir o impacto.')
    if(items.some(row=>(row.media_id===asset.id||row.live_fallback_media_id===asset.id)&&row.archived_at))blockers.add('Referência em canal arquivado: revise o canal antes de remover.')
    if(protections.some(row=>uses.some(use=>use.channelId===(row.payload.channelId??(row.payload.plan as {channelId?:string}|undefined)?.channelId))||references(row.payload).has(asset.id)||pub.some(published=>references(row.payload,0,true).has(published.row.id))))blockers.add('Comando durável de configuração, inserção, retorno ou passagem sem conclusão; confira sua resolução.')
    if(pub.some(({row,payload})=>row.active||!Array.isArray(payload.assets)))blockers.add('Mídia referenciada por publicação ativa ou por revisão legada sem cópia congelada do acervo.')
    if(operation==='PRUNE'&&projects.some(row=>row.refs.has(asset.id)))blockers.add('Mídia necessária para restaurar um projeto salvo. Remoção definitiva do registro não permitida.')
    if(operation==='PRUNE'&&conversions.some(row=>row.refs.has(asset.id)))blockers.add('Mídia referenciada por histórico de conversão de cadência.')
    if(interruptions.some(row=>references(JSON.parse(row.specification)).has(asset.id)))blockers.add('VT interrompido aguardando retorno ou resolução de incerteza.')
    const relevantItems=new Set(uses.map(row=>row.itemId)),referencedRevision=(revisionId:string|null)=>pub.some(row=>row.row.id===revisionId)
    if(open.some(row=>row.media_id===asset.id||relevantItems.has(row.item_id??'')||referencedRevision(row.revision_id)))blockers.add('Execução as-run ainda aberta: confirme seu encerramento antes de remover.')
    for(const checkpoint of checkpoints)if(checkpoint.playing&&(relevantItems.has(checkpoint.itemId??'')||referencedRevision(checkpoint.revisionId))||checkpoint.contingency&&(relevantItems.has(checkpoint.contingency.itemId??'')||referencedRevision(checkpoint.contingency.revisionId)||referencedRevision(checkpoint.contingency.loopRevisionId)))blockers.add('Mídia protegida por checkpoint de PGM/retorno de contingência.')
    for(const policy of policies){const value=JSON.parse(policy.payload);if(referencedRevision(value.loopRevisionId))blockers.add('Publicação vinculada à política de contingência do canal.')}
    for(const runtime of runtimeProof){
      if(runtime.protectedIds.includes(asset.id))blockers.add('Mídia em PGM, PVW/CUE, preroll ou proteção de passagem de playlist.')
      if(runtime.unavailable&&(runtime.viewRefs.includes(asset.id)||uses.some(row=>row.channelId===runtime.channelId)))blockers.add('Canal com comando pendente, recuperação ou troca sem conclusão; aguarde antes de remover.')
    }
    return {assetId:asset.id,title:asset.title,revision:assetRemovalRevision(sqlite,'A:'+asset.id),uses,blockers:[...blockers].sort(),publishedReferences:pub.length,historicalReferences:historical.n}
  })
  const channels=[...new Set(impacts.flatMap(asset=>asset.uses.map(use=>use.channelId)))].sort().map(id=>({id,revision:configurationRevision(db,id)}))
  const proof={operation,id,actor:{id:actor.identity?.id??null,revision:actor.revision,sessions:actor.sessions,station:actor.station},impacts,channels,
    // Channel-specific QC changes only qc_decisions, not media_assets. Its
    // authoritative counter must participate too, including same-value/ABA.
    qcRevisions:assets.map(asset=>({id:asset.id,revision:qcRevision(db,asset.id)})),
    publications:assetRemovalRevision(sqlite,'PUBLICATIONS'),references:assetRemovalRevision(sqlite,'REFERENCES'),protections:assetRemovalRevision(sqlite,'PROTECTIONS'),
    prune:operation==='PRUNE'?assetRemovalRevision(sqlite,'PRUNE'):null,runtimeProof,interruptions,open,owners,
    checkpoints:checkpoints.map(row=>({channelId:row.channelId,playing:row.playing,itemId:row.itemId,revisionId:row.revisionId,contingency:row.contingency?{...row.contingency,elapsed:undefined}:null}))}
  const token=installationVault().reviewIdentity(JSON.stringify(proof),'asset-removal-review:v1')
  return {operation,assetId:id,token,assets:impacts,filesPreserved:true,historyPreserved:true,automaticTake:false}
}
export function readAssetRemoval(context:Context,operation:AssetRemovalOperation,id:string|null,authority:Authority){
  return context.db.transaction(()=>snapshot(context,operation,id,authorize(context.db,authority)))
}
export function applyAssetRemoval(context:Context,operation:AssetRemovalOperation,id:string|null,body:unknown,header:unknown,authority:Authority){
  const parsed=bodySchema.safeParse(body)
  if(!parsed.success||new Set(parsed.data?.assetIds).size!==parsed.data?.assetIds.length)reject(400,'Escolha arquivos únicos e confirme explicitamente os vínculos editoriais. Nenhum campo extra ou force é aceito.')
  return context.db.transaction(tx=>{
    const actor=authorize(context.db,authority),before=snapshot(context,operation,id,actor)
    if(header===undefined)reject(428,'Confira o impacto antes de remover. Conferência original obrigatória.')
    const match=typeof header==='string'?/^"asset-removal:([^"\s]+):([A-Za-z0-9_-]{43})"$/.exec(header):null
    if(!match||match[1]!==encodeURIComponent(operation==='REMOVE'?'A:'+id:'PRUNE'))reject(400,'Conferência inválida ou de outra operação/arquivo.')
    if(header!==assetRemovalETag(before))reject(409,'O acervo, seus vínculos, permissões ou operação mudaram. Seleção preservada; reabra explicitamente antes de confirmar.')
    const input=parsed.data!,selected=before.assets.filter(asset=>input.assetIds.includes(asset.assetId))
    if(selected.length!==input.assetIds.length||operation==='REMOVE'&&(selected.length!==1||input.assetIds[0]!==id))reject(400,'Seleção não pertence à conferência original.')
    if(selected.some(asset=>asset.blockers.length))reject(409,'Há mídia protegida na seleção. Nenhum arquivo ou vínculo foi removido.')
    if(!input.removeEditorialUses&&selected.some(asset=>asset.uses.length))reject(409,'Confirme os itens e fallbacks mostrados na conferência antes de remover.')
    const removedItems=new Set(selected.flatMap(asset=>asset.uses.filter(use=>use.action==='REMOVE_ITEM').map(use=>use.itemId))),fallbacks=new Set(selected.flatMap(asset=>asset.uses.filter(use=>use.action==='CLEAR_FALLBACK').map(use=>use.itemId)))
    for(const itemId of removedItems){tx.delete(secondaryEvents).where(eq(secondaryEvents.itemId,itemId)).run();tx.delete(itemGraphics).where(eq(itemGraphics.itemId,itemId)).run();tx.delete(rundownItems).where(eq(rundownItems.id,itemId)).run()}
    for(const itemId of fallbacks)if(!removedItems.has(itemId))tx.update(rundownItems).set({liveFallbackMediaId:null}).where(eq(rundownItems.id,itemId)).run()
    for(const asset of selected)if(operation==='PRUNE')tx.delete(mediaAssets).where(eq(mediaAssets.id,asset.assetId)).run();else tx.update(mediaAssets).set({ignored:true}).where(eq(mediaAssets.id,asset.assetId)).run()
    tx.insert(operatorDecisions).values({id:randomUUID(),rundownId:'@library',kind:'ASSET_REMOVAL_APPLIED',actorUsername:actor.identity?.username??null,createdAt:new Date().toISOString(),payload:{operation,station:authority.request.ip,assets:selected,removedItems:[...removedItems],clearedFallbacks:[...fallbacks].filter(id=>!removedItems.has(id)),filesPreserved:true,historyPreserved:true,automaticTake:false}}).run()
    return {applied:true as const,removed:selected.length,removedItems:removedItems.size,clearedFallbacks:[...fallbacks].filter(id=>!removedItems.has(id)).length,filesPreserved:true as const,historyPreserved:true as const,automaticTake:false as const}
  },{behavior:'immediate'})
}
