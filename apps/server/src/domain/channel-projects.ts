import { and, desc, eq, getTableColumns, inArray } from 'drizzle-orm'
import type {AnySQLiteTable} from 'drizzle-orm/sqlite-core'
import { createHash, randomUUID } from 'node:crypto'
import {PROJECT_SECTIONS,projectRestoreETag,type ProjectRestoreReview,type ProjectCounts} from '@rplayout/protocol'
import {projectRevision} from '../db/project-revisions.js'
import {toAsset,toItem} from '../db/repo.js'
import type { Db } from '../db/client.js'
import {assertChannelAudioChange,assertPublishedAudio} from './audio-bus.js'
import {CollaborativeEditError} from './collaborative-edit.js'
import {assertProjectContract} from './project-contract.js'
import {
  channelProjectSnapshots,
  channels,
  destinations,
  graphicTemplates,
  guestKeys,
  liveSources,
  multiviewConfigs,
  outputProfiles,
  rundownItems,
  rundowns,
  scheduleRules,
  transmissionPresets,
  itemGraphics,
  secondaryEvents,
  operationalPlaylistRevisions,
  mediaAssets,
  playlistVersions,
  asRun,
  channelConfigurationVersions,
} from '../db/schema.js'

type ProjectPayload = Record<string, any>
type Transaction=Parameters<Parameters<Db['transaction']>[0]>[0]
export interface ProjectMutationHooks {
  /** Runs inside the immediate transaction, before reading/restoring any rows. */
  authorize:(tx:Transaction)=>void
  /** Throwing here rolls back data, revisions and the snapshot itself. Never include secrets. */
  audit:(tx:Transaction,details:Record<string,unknown>)=>void
}
function invalid(message:string):never{throw new CollaborativeEditError(400,{error:message})}
const groups={outputs:outputProfiles,presets:transmissionPresets,sources:liveSources,rules:scheduleRules,
  multiview:multiviewConfigs,destinations,guests:guestKeys,graphics:graphicTemplates,
  rundowns,items:rundownItems,cues:itemGraphics,secondaryEvents} as const
const jsonFields=new Set(['qcProfile','protectedZones','srtConfig','failoverConfig','cells','fields','categories','trim','audio','anchor','elastic','values','definition'])
const isObject=(value:unknown):value is Record<string,any>=>Boolean(value && typeof value==='object' && !Array.isArray(value))
const validJson=(value:unknown,depth=0):boolean=>depth<40 && (value===null || typeof value==='string' || typeof value==='boolean' ||
  typeof value==='number'&&Number.isFinite(value) || Array.isArray(value)&&value.every(item=>validJson(item,depth+1)) ||
  isObject(value)&&Object.entries(value).every(([key,item])=>!['__proto__','prototype','constructor'].includes(key)&&validJson(item,depth+1)))

/** Validate the saved DB-row contract before deletion, including tables without FKs.
 * This is storage/reference validation, not media QC or physical-output approval. */
function validateRow(table:AnySQLiteTable,row:unknown):asserts row is Record<string,any>{
  if(!isObject(row) || typeof row.id!=='string' || !row.id.trim())invalid('Projeto contém registro sem identificador válido.')
  const columns=getTableColumns(table)
  for(const key of Object.keys(row))if(!Object.hasOwn(columns,key))invalid('Projeto contém campo incompatível com o schema atual.')
  for(const [key,column] of Object.entries(columns)){
    const value=row[key]
    if(value===undefined){if(column.notNull&&!column.hasDefault)invalid('Projeto contém campo obrigatório ausente.');continue}
    if(value===null){if(column.notNull)invalid('Projeto contém campo obrigatório nulo.');continue}
    const valid=jsonFields.has(key)?validJson(value):column.dataType==='boolean'?typeof value==='boolean':
      column.dataType==='number'?typeof value==='number'&&Number.isFinite(value)&&(column.getSQLType()!=='integer'||Number.isSafeInteger(value)):
      typeof value==='string'
    if(!valid)invalid('Projeto contém tipo de campo inválido.')
  }
}

function validatePayload(tx:Transaction,channelId:string,value:unknown):ProjectPayload{
  if(!isObject(value) || value.version!==1 || !isObject(value.channel) || value.channel.id!==channelId)invalid('Projeto inválido ou incompatível com este canal.')
  const payload={...value,channel:{...value.channel,audioChannels:value.channel.audioChannels??2}} as ProjectPayload
  for(const key of Object.keys(payload))if(!['version','channel',...Object.keys(groups)].includes(key))invalid('Projeto contém seção desconhecida.')
  validateRow(channels,payload.channel)
  if(payload.channel.archivedAt)invalid('Um projeto não pode arquivar ou reativar o canal implicitamente.')
  for(const key of ['rateNum','rateDen','width','height'])if(!Number.isSafeInteger(payload.channel[key])||payload.channel[key]<=0)invalid('Formato/cadência inválido no projeto.')
  if(![2,8,16].includes(payload.channel.audioChannels))invalid('Barramento de áudio inválido no projeto.')
  const ids:Record<string,Set<string>>={}
  for(const [key,table] of Object.entries(groups)){
    // Earlier v1 captures did not include secondary events/cues. Other sections
    // must exist: a truncated snapshot must not silently empty the channel.
    const rows=payload[key]??(['cues','secondaryEvents'].includes(key)?[]:undefined)
    if(!Array.isArray(rows))invalid('Projeto contém seção ausente ou inválida.')
    payload[key]=rows;ids[key]=new Set()
    for(const row of rows){
      validateRow(table,row)
      if(ids[key]!.has(row.id))invalid('Projeto contém identificadores duplicados.')
      ids[key]!.add(row.id)
      if(!['items','cues'].includes(key)&&row.channelId!==channelId)invalid('Registro do projeto não pertence a este canal.')
      const existing=tx.select().from(table).where(eq(table.id,row.id)).get() as Record<string,any>|undefined
      if(existing){
        const owner=key==='items'?tx.select().from(rundowns).where(eq(rundowns.id,existing.rundownId)).get()?.channelId:
          key==='cues'?tx.select({channelId:rundowns.channelId}).from(rundownItems).innerJoin(rundowns,eq(rundownItems.rundownId,rundowns.id)).where(eq(rundownItems.id,existing.itemId)).get()?.channelId:existing.channelId
        if(owner!==channelId)invalid('Identificador do projeto já pertence a outro canal ou entidade compartilhada.')
      }
    }
  }
  const templateAllowed=(id:unknown):boolean=>typeof id==='string'&&(ids.graphics!.has(id)||tx.select().from(graphicTemplates).where(eq(graphicTemplates.id,id)).get()?.channelId===null)
  if(payload.channel.slateTemplateId&&!templateAllowed(payload.channel.slateTemplateId))invalid('Slate do projeto não pertence ao canal nem a modelo compartilhado.')
  for(const row of payload.items){
    if(!ids.rundowns!.has(row.rundownId))invalid('Item do projeto aponta para grade fora deste projeto.')
    for(const key of ['mediaId','liveFallbackMediaId'])if(row[key]&&!tx.select({id:mediaAssets.id}).from(mediaAssets).where(eq(mediaAssets.id,row[key])).get())invalid('Mídia referenciada pelo projeto não existe no acervo; nenhuma restauração foi aplicada.')
  }
  for(const row of payload.sources)if(row.pairedSourceId&&!ids.sources!.has(row.pairedSourceId))invalid('Par de fonte ao vivo aponta para fora deste projeto.')
  for(const row of payload.cues)if(!ids.items!.has(row.itemId)||!templateAllowed(row.templateId))invalid('Deixa de grafismo aponta para item/modelo fora deste canal.')
  for(const row of payload.secondaryEvents){
    const definition=row.definition
    if(!ids.items!.has(row.itemId)||!isObject(definition)||definition.id!==row.id||definition.rundownItemId!==row.itemId||
      definition.channelId!==undefined&&definition.channelId!==channelId||definition.templateId&&!templateAllowed(definition.templateId))invalid('Evento secundário tem vínculo incompatível com este canal/item/modelo.')
  }
  // Deleting channel-owned templates cascades cues. Refuse any foreign use,
  // including malformed legacy rows; never remove someone else's editorial data.
  const ownTemplates=tx.select({id:graphicTemplates.id}).from(graphicTemplates).where(eq(graphicTemplates.channelId,channelId)).all().map(row=>row.id)
  if(ownTemplates.length){
    const foreign=tx.select({channelId:rundowns.channelId}).from(itemGraphics).innerJoin(rundownItems,eq(itemGraphics.itemId,rundownItems.id)).innerJoin(rundowns,eq(rundownItems.rundownId,rundowns.id)).where(inArray(itemGraphics.templateId,ownTemplates)).all()
    if(foreign.some(row=>row.channelId!==channelId))invalid('Modelos deste canal são usados por outro canal; a restauração não pode apagar essas deixas.')
    const otherEvents=tx.select().from(secondaryEvents).all().filter(row=>row.channelId!==channelId)
    const otherSlates=tx.select().from(channels).all().filter(row=>row.id!==channelId)
    if(otherEvents.some(row=>ownTemplates.includes(row.definition?.templateId??''))||otherSlates.some(row=>ownTemplates.includes(row.slateTemplateId??'')))invalid('Modelos deste canal são usados por outro canal; preserve esses vínculos antes de restaurar.')
  }
  assertProjectContract(tx,payload)
  return payload
}

function capture(db: Pick<Db,'select'>, channelId: string): ProjectPayload | null {
  const channel = db.select().from(channels).where(eq(channels.id, channelId)).get()
  if (!channel) return null
  const projectRundowns = db.select().from(rundowns).where(eq(rundowns.channelId, channelId)).all()
  const rundownIds = projectRundowns.map((row) => row.id)
  const items = rundownIds.length ? db.select().from(rundownItems).where(inArray(rundownItems.rundownId, rundownIds)).all() : []
  const itemIds=items.map(item=>item.id)
  const [outputs, presets, sources, rules, multiview, destinationsRows, guests, graphics, cues, events] = [
    db.select().from(outputProfiles).where(eq(outputProfiles.channelId, channelId)).all(),
    db.select().from(transmissionPresets).where(eq(transmissionPresets.channelId, channelId)).all(),
    db.select().from(liveSources).where(eq(liveSources.channelId, channelId)).all(),
    db.select().from(scheduleRules).where(eq(scheduleRules.channelId, channelId)).all(),
    db.select().from(multiviewConfigs).where(eq(multiviewConfigs.channelId, channelId)).all(),
    db.select().from(destinations).where(eq(destinations.channelId, channelId)).all(),
    db.select().from(guestKeys).where(eq(guestKeys.channelId, channelId)).all(),
    db.select().from(graphicTemplates).where(eq(graphicTemplates.channelId, channelId)).all(),
    itemIds.length ? db.select().from(itemGraphics).where(inArray(itemGraphics.itemId,itemIds)).all() : [],
    db.select().from(secondaryEvents).where(eq(secondaryEvents.channelId,channelId)).all(),
  ]
  return { version: 1, channel, outputs, presets, sources, rules, multiview, destinations: destinationsRows, guests, graphics, rundowns: projectRundowns, items, cues, secondaryEvents:events }
}

export async function saveChannelProject(db: Db, channelId: string, label: string,hooks?:ProjectMutationHooks) {
  return db.transaction(tx=>{
  hooks?.authorize(tx)
  const payload = capture(tx, channelId)
  if (!payload) throw new Error('Canal não encontrado para salvar o projeto.')
  // A consistent snapshot is not necessarily usable: refuse a malformed
  // current configuration before calling it a restoration point.
  validatePayload(tx,channelId,payload)
  const snapshot = { id: randomUUID(), channelId, label: label.trim() || 'Ponto manual', payload, createdAt: new Date().toISOString() }
  tx.insert(channelProjectSnapshots).values(snapshot).run()
  hooks?.audit(tx,{projectId:snapshot.id,snapshotVersion:1})
  return { id: snapshot.id, label: snapshot.label, createdAt: snapshot.createdAt }
  },{behavior:'immediate'})
}

export async function listChannelProjects(db: Db, channelId: string) {
  return db.select({ id: channelProjectSnapshots.id, label: channelProjectSnapshots.label, createdAt: channelProjectSnapshots.createdAt })
    .from(channelProjectSnapshots).where(eq(channelProjectSnapshots.channelId, channelId)).orderBy(desc(channelProjectSnapshots.createdAt))
}

function inspectRestore(tx:Transaction,channelId:string,snapshotId:string){
  const snapshot = tx.select().from(channelProjectSnapshots)
    .where(eq(channelProjectSnapshots.id, snapshotId)).get()
  if (!snapshot || snapshot.channelId !== channelId) throw new Error('Ponto de restauração não pertence a este canal.')
  const payload = validatePayload(tx,channelId,snapshot.payload)
  const existingRundowns = tx.select({ id: rundowns.id }).from(rundowns).where(eq(rundowns.channelId, channelId)).all()
  const ids = existingRundowns.map((row) => row.id)
  const snapshotIds = new Set((payload.rundowns ?? []).map((row: any) => row.id))
  const removedIds = ids.filter(id => !snapshotIds.has(id))
  if (removedIds.length && tx.select({id:operationalPlaylistRevisions.id}).from(operationalPlaylistRevisions).where(inArray(operationalPlaylistRevisions.rundownId,removedIds)).get()) throw new Error('A restauração removeria uma grade com histórico publicado. Preserve essa grade; nenhuma revisão operacional será apagada para restaurar o projeto.')
  if(removedIds.length&&(tx.select({id:playlistVersions.id}).from(playlistVersions).where(inArray(playlistVersions.rundownId,removedIds)).get()||tx.select({id:asRun.id}).from(asRun).where(inArray(asRun.rundownId,removedIds)).get()))throw new Error('A restauração removeria uma grade com histórico de importação/as-run. Preserve essa grade; nenhum histórico será apagado para restaurar o projeto.')
  const current = tx.select().from(channels).where(eq(channels.id,channelId)).get()
  if (!current) throw new Error('Canal não encontrado.')
  if(current.archivedAt)throw new Error('Canal arquivado: reative-o explicitamente antes de restaurar um projeto.')
  const rateChanged = BigInt(current.rateNum) * BigInt(payload.channel.rateDen) !== BigInt(payload.channel.rateNum) * BigInt(current.rateDen)
  if (rateChanged && ids.length && tx.select({id:operationalPlaylistRevisions.id}).from(operationalPlaylistRevisions).where(inArray(operationalPlaylistRevisions.rundownId,ids)).get()) throw new Error('O projeto tem outra cadência e este canal possui revisões publicadas em quadros. A restauração não pode reinterpretar esse histórico.')
  const assetIds=[...new Set<string>(payload.items.flatMap((row:any)=>[row.mediaId,row.liveFallbackMediaId].filter(Boolean)))]
  const assets=assetIds.length?tx.select().from(mediaAssets).where(inArray(mediaAssets.id,assetIds)).all():[]
  assertPublishedAudio(payload.channel.audioChannels,payload.items.map(toItem),assets.map(toAsset))
  return {snapshot,payload,current,ids,removedIds}
}
const counts=(payload:ProjectPayload):ProjectCounts=>Object.fromEntries(PROJECT_SECTIONS.map(key=>[key,payload[key].length])) as ProjectCounts
const format=(channel:ProjectPayload)=>({width:channel.width,height:channel.height,rateNum:channel.rateNum,rateDen:channel.rateDen,audioChannels:channel.audioChannels??2})
function makeReview(tx:Transaction,channelId:string,snapshotId:string,actorId:string|null,inspection:ReturnType<typeof inspectRestore>):ProjectRestoreReview{
  const {snapshot,payload,current,ids,removedIds}=inspection
  const revision=projectRevision(tx,channelId)
  const configurationRevision=tx.select().from(channelConfigurationVersions).where(eq(channelConfigurationVersions.channelId,channelId)).get()?.version
  if(!configurationRevision||!Number.isSafeInteger(configurationRevision))throw new Error('Revisão de configuração ausente ou inválida.')
  // Private snapshot content is bound to this proof, never returned to the browser.
  const token=createHash('sha256').update(JSON.stringify({channelId,snapshotId,revision,configurationRevision,actorId,payload:snapshot.payload})).digest('hex')
  return {channelId,projectId:snapshotId,projectRevision:revision,configurationRevision,token,label:snapshot.label,createdAt:snapshot.createdAt,
    replacing:counts(capture(tx,channelId)!),restoring:counts(payload),removedRundowns:removedIds.length,
    preservedPublications:ids.length?tx.select({id:operationalPlaylistRevisions.id}).from(operationalPlaylistRevisions).where(inArray(operationalPlaylistRevisions.rundownId,ids)).all().length:0,
    enabledOutputs:payload.outputs.filter((row:any)=>row.enabled).length,enabledDestinations:payload.destinations.filter((row:any)=>row.enabled).length,enabledGuests:payload.guests.filter((row:any)=>row.enabled).length,
    formatBefore:format(current),formatAfter:format(payload.channel),requiresStoppedProgram:true,automaticTake:false,physicalOutputValidated:false}
}
/** Read-only: no lease, engine change, audit write or implicit TAKE. */
export function reviewChannelProject(db:Db,channelId:string,snapshotId:string,actorId:string|null,authorize?:(tx:Transaction)=>void):ProjectRestoreReview{
  return db.transaction(tx=>{authorize?.(tx);return makeReview(tx,channelId,snapshotId,actorId,inspectRestore(tx,channelId,snapshotId))})
}
export interface ProjectRestoreGuard {header:string|string[]|undefined;token:unknown;actorId:string|null}
/** The original review is mandatory and checked inside the same write transaction. */
export async function restoreChannelProject(db: Db, channelId: string, snapshotId: string,guard:ProjectRestoreGuard,hooks?:ProjectMutationHooks) {
  return db.transaction(tx=>{
    hooks?.authorize(tx)
    if(!guard?.header||guard.token===undefined)throw new CollaborativeEditError(428,{error:'Confira o projeto antes de confirmar a restauração.'})
    const header=guard.header
    const match=typeof header==='string'?/^"project:([^"\s]+):([^"\s]+):([1-9]\d*)"$/.exec(header):null
    if(!match||match[1]!==encodeURIComponent(channelId)||match[2]!==encodeURIComponent(snapshotId)||!Number.isSafeInteger(Number(match[3]))||typeof guard.token!=='string'||!/^[a-f0-9]{64}$/.test(guard.token))invalid('Conferência de projeto inválida ou de outro canal/projeto.')
    if(header!==projectRestoreETag({channelId,projectId:snapshotId,projectRevision:projectRevision(tx,channelId)}))throw new CollaborativeEditError(409,{error:'O projeto ou suas dependências mudaram. Reabra a conferência; nada foi restaurado.'})
    const inspection=inspectRestore(tx,channelId,snapshotId)
    const approved=makeReview(tx,channelId,snapshotId,guard.actorId,inspection)
    if(approved.token!==guard.token)throw new CollaborativeEditError(409,{error:'A conferência não pertence à sessão/configuração atual. Reabra a conferência.'})
    const {snapshot,payload,ids,removedIds}=inspection
    tx.delete(secondaryEvents).where(eq(secondaryEvents.channelId,channelId)).run()
    if (ids.length) tx.delete(rundownItems).where(inArray(rundownItems.rundownId, ids)).run()
    if (removedIds.length) tx.delete(rundowns).where(and(eq(rundowns.channelId,channelId),inArray(rundowns.id,removedIds))).run()
    tx.delete(outputProfiles).where(eq(outputProfiles.channelId, channelId)).run()
    tx.delete(transmissionPresets).where(eq(transmissionPresets.channelId, channelId)).run()
    tx.delete(liveSources).where(eq(liveSources.channelId, channelId)).run()
    tx.delete(scheduleRules).where(eq(scheduleRules.channelId, channelId)).run()
    tx.delete(multiviewConfigs).where(eq(multiviewConfigs.channelId, channelId)).run()
    tx.delete(destinations).where(eq(destinations.channelId, channelId)).run()
    tx.delete(guestKeys).where(eq(guestKeys.channelId, channelId)).run()
    tx.delete(graphicTemplates).where(eq(graphicTemplates.channelId, channelId)).run()
    tx.update(channels).set({...payload.channel,audioChannels:payload.channel.audioChannels??2}).where(eq(channels.id, channelId)).run()
    for (const row of payload.rundowns) {
      if(ids.includes(row.id))tx.update(rundowns).set(row).where(and(eq(rundowns.id,row.id),eq(rundowns.channelId,channelId))).run()
      else tx.insert(rundowns).values(row).run()
    }
    for (const [table, rows] of [[outputProfiles, payload.outputs], [transmissionPresets, payload.presets], [liveSources, payload.sources], [scheduleRules, payload.rules], [multiviewConfigs, payload.multiview], [destinations, payload.destinations], [guestKeys, payload.guests], [graphicTemplates, payload.graphics], [rundownItems, payload.items], [itemGraphics,payload.cues], [secondaryEvents,payload.secondaryEvents]] as const) {
      if (Array.isArray(rows) && rows.length) tx.insert(table).values(rows as never).run()
    }
    assertChannelAudioChange(tx,channelId,payload.channel.audioChannels??2)
  hooks?.audit(tx,{projectId:snapshotId,reviewedProjectRevision:approved.projectRevision,reviewedConfigurationRevision:approved.configurationRevision,editorialRestore:true,operationalHistoryPreserved:true,rundowns:payload.rundowns.length,automaticTake:false})
  return { label: snapshot.label, createdAt: snapshot.createdAt, rundowns: Array.isArray(payload.rundowns) ? payload.rundowns.length : 0 }
  },{behavior:'immediate'})
}
