import { and, asc, desc, eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import type { Db } from '../db/client.js'
import { channels, graphicTemplates, itemGraphics, rundownItems,rundowns, operationalPlaylistRevisions, secondaryEvents,operatorDecisions,externalDevices } from '../db/schema.js'
import { buildView } from './plan.js'
import {readEditorialState} from './editorial-state.js'
import {operationalReview,requireOperationalReview} from './operational-review.js'
import {CollaborativeEditError} from './collaborative-edit.js'
import { freezeDeviceAutomation } from './device-automation.js'
import {assertOperationalCadence} from './operational-cadence.js'
import {assertPublishedAudio} from './audio-bus.js'
import {resolveTrim,resolveAudio,type Channel,type Rundown,type RundownItem,type MediaAsset,type ResolveResult,type GraphicTemplate,type ItemGraphic,type OperationalReview} from '@rplayout/protocol'

export interface OperationalPayload {
  editorialRevision?:number
  rate?:import('@rplayout/protocol').Rate
  audioChannels?:2|8|16
  version: 1
  rundown: Rundown
  items: RundownItem[]
  assets?: MediaAsset[]
  graphics?: { templates: GraphicTemplate[]; cues: ItemGraphic[] }
  secondaryEvents?: import('@rplayout/protocol').SecondaryEvent[]
  schedule: ResolveResult
  restoredFrom?: { id: string; revision: number }
  operation?: { kind: 'LIVE_DURATION'; itemId: string; deltaFrames: number; elapsedFrames: number; previousFrames: number; newFrames: number; at: string }
    | {kind:'INSERT';mode:'NEXT'|'NOW';requestId:string;itemId:string;sourceRevisionId:string;at:string}
    | {kind:'COMPENSATION';action:string;itemId:string;deltaFrames:number;sourceRevisionId:string;at:string}
    | {kind:'ALIGNMENT';focusItemId:string;actions:unknown[];sourceRevisionId:string;at:string}
}

export function readOperationalPayload(payload: Record<string, unknown>): OperationalPayload {
  if (payload.version !== 1 || !payload.rundown || !Array.isArray(payload.items) || !payload.schedule) {
    throw new Error('Revisão operacional inválida. A execução não pode substituir silenciosamente um plano publicado por uma grade editável.')
  }
  return payload as unknown as OperationalPayload
}

/** All editorial dependencies, equipment and active revision share one SQL
 * snapshot. No await may splice rows from different writers into a plan. */
export function inspectOperationalPlaylist(db:Db,rundownId:string,channelId?:string) {
  return db.transaction(tx=>{
  const state=readEditorialState(db,rundownId)
  if(!state || channelId!==undefined && state.channel.id!==channelId)throw new CollaborativeEditError(404,{error:'Grade ativa não encontrada neste canal.'})
  const {rundown,channel,items,assets}=state
  assertPublishedAudio(channel.audioChannels??2,items,[...assets.values()],channel.rate)
  const view = buildView(rundown, channel, items, assets, null, null)
  if(view.schedule.conflicts.some(conflict=>conflict.message.includes('medição de áudio')))throw new CollaborativeEditError(409,{error:'O corte operacional não corresponde à medição de áudio. Meça novamente antes de publicar.'})
  const used = new Set(items.flatMap(item=>[item.mediaId,item.liveFallbackMediaId,item.liveConfig?.fallbackMediaId]).filter(Boolean))
  const rows = tx.select().from(itemGraphics)
    .innerJoin(rundownItems, eq(itemGraphics.itemId, rundownItems.id))
    .innerJoin(graphicTemplates, eq(itemGraphics.templateId, graphicTemplates.id))
    .where(eq(rundownItems.rundownId, rundownId)).orderBy(asc(itemGraphics.atSeconds), asc(itemGraphics.id)).all()
  const templates = new Map(rows.map(row => [row.graphic_templates.id, row.graphic_templates]))
  const secondary = tx.select().from(secondaryEvents).innerJoin(rundownItems,eq(secondaryEvents.itemId,rundownItems.id))
    .where(eq(rundownItems.rundownId,rundownId)).orderBy(asc(secondaryEvents.id)).all()
  const templateIds = new Set(secondary.map(row=>row.secondary_events.definition.templateId).filter(Boolean))
  for (const template of tx.select().from(graphicTemplates).orderBy(asc(graphicTemplates.id)).all()) if (templateIds.has(template.id)) templates.set(template.id,template)
  const cues = rows.map(row => ({ ...row.item_graphics, templateName: row.graphic_templates.name }))
  const payload:OperationalPayload={ version: 1,editorialRevision:state.editorialRevision,rate:channel.rate,audioChannels:channel.audioChannels??2, rundown:{...rundown,publicationRequired:false}, items, assets: [...assets.values()].filter((asset) => used.has(asset.id)).sort((a,b)=>a.id.localeCompare(b.id)), graphics: { templates: [...templates.values()].sort((a,b)=>a.id.localeCompare(b.id)), cues }, secondaryEvents:secondary.map(row=>freezeDeviceAutomation(tx,row.secondary_events.definition)), schedule: view.schedule }
  const review=operationalReview({operation:'PUBLISH',rundownId,channelId:channel.id,editorialRevision:state.editorialRevision,activeRevisionId:state.revision?.id??null},{payload,channel,active:state.revision})
  return {payload,active:state.revision,review,channel}
  })
}
export async function simulateOperationalPlaylist(db: Db, channel: Channel, rundownId: string): Promise<OperationalPayload> {
  return inspectOperationalPlaylist(db,rundownId,channel.id).payload
}
export type OperationalGuard=(review:OperationalReview,payload:OperationalPayload)=>void

export function inspectOperationalRollback(db:Db,rundownId:string,revisionId:string) {
  return db.transaction(tx=>{
    // A broken unpublished automation/timing must not disable rollback.
    const current=readEditorialState(db,rundownId)
    if(!current)throw new Error('Grade ativa não encontrada neste canal.')
    const source=tx.select().from(operationalPlaylistRevisions).where(and(eq(operationalPlaylistRevisions.rundownId,rundownId),eq(operationalPlaylistRevisions.id,revisionId))).get()
    if(!source)throw new Error('Revisão não encontrada nesta grade.')
    const payload=readOperationalPayload(source.payload)
    assertOperationalCadence(tx,current.channel,payload)
    const deviceIds=new Set((payload.secondaryEvents??[]).map(event=>event.deviceConfig?.deviceId).filter(Boolean))
    const devices=tx.select().from(externalDevices).orderBy(asc(externalDevices.id)).all().filter(device=>deviceIds.has(device.id))
    const review=operationalReview({operation:'ROLLBACK',rundownId,channelId:current.channel.id,editorialRevision:current.editorialRevision,activeRevisionId:current.revision?.id??null,sourceRevisionId:source.id},{channel:current.channel,source,active:current.revision,devices})
    return {payload,review,source,active:current.revision,channel:current.channel}
  })
}

export function diffOperationalGraphics(previous: OperationalPayload | null, next: OperationalPayload): string[] {
  const previousCues = previous?.graphics?.cues ?? []
  const nextCues = next.graphics?.cues ?? []
  const ids = new Set([...previousCues, ...nextCues].map(cue => cue.itemId))
  for (const event of [...previous?.secondaryEvents ?? [],...next.secondaryEvents ?? []]) if (event.rundownItemId) ids.add(event.rundownItemId)
  const contract = (payload: OperationalPayload | null, itemId: string) =>
    (payload?.graphics?.cues ?? []).filter(cue => cue.itemId === itemId).map(cue => ({ cue, template: payload?.graphics?.templates.find(template => template.id === cue.templateId) }))
  const secondaryContract = (payload:OperationalPayload|null,itemId:string) => (payload?.secondaryEvents ?? []).filter(event=>event.rundownItemId===itemId)
    .map(event => ({event, template:payload?.graphics?.templates.find(template=>template.id===event.templateId)}))
  return [...ids].filter(id => JSON.stringify([contract(previous,id),secondaryContract(previous,id)]) !== JSON.stringify([contract(next,id),secondaryContract(next,id)]))
}

/** Aviso de nova revisão ativa, entregue depois que a transação terminou
 * (better-sqlite3 é síncrono: no setImmediate ela já foi confirmada ou
 * desfeita, e quem escuta confere se a revisão existe). Usado pelo espelho
 * multicanal para não depender de cada caminho de publicação lembrar dele. */
export type RevisionChange = 'PUBLISH' | 'ROLLBACK' | 'LIVE_DURATION' | 'INSERT' | 'COMPENSATION' | 'ALIGNMENT' | 'ADJUST'
export interface RevisionEvent { rundownId: string; revisionId: string; revision: number; change: RevisionChange; actor: string | null }
const revisionListeners = new Set<(event: RevisionEvent) => void>()
export function onOperationalRevision(listener: (event: RevisionEvent) => void): () => void {
  revisionListeners.add(listener)
  return () => { revisionListeners.delete(listener) }
}
const revisionChange = (payload: OperationalPayload, auditKind: string | undefined): RevisionChange =>
  auditKind === 'OPERATIONAL_PLAYLIST_ROLLBACK' ? 'ROLLBACK'
  : auditKind === 'OPERATIONAL_PLAYLIST_PUBLISHED' ? 'PUBLISH'
  : payload.operation?.kind ?? 'ADJUST'

export function persistRevision(db: Pick<Db, 'transaction'>, rundownId: string, payload: OperationalPayload, actor: string | null,audit?:{kind:string;payload:Record<string,unknown>}) {
  const row = persistRevisionRow(db, rundownId, payload, actor, audit)
  if (revisionListeners.size) {
    const event: RevisionEvent = { rundownId, revisionId: row.id, revision: row.revision, change: revisionChange(payload, audit?.kind), actor }
    setImmediate(() => { for (const listener of revisionListeners) { try { listener(event) } catch { /* quem escuta registra o próprio erro */ } } })
  }
  return row
}

function persistRevisionRow(db: Pick<Db, 'transaction'>, rundownId: string, payload: OperationalPayload, actor: string | null,audit?:{kind:string;payload:Record<string,unknown>}) {
  return db.transaction((tx) => {
    const grade=tx.select().from(rundowns).where(eq(rundowns.id,rundownId)).get()
    const channel=grade && tx.select().from(channels).where(eq(channels.id,grade.channelId)).get()
    if(!channel || channel.archivedAt)throw new Error('Canal ativo não encontrado para publicação.')
    assertOperationalCadence(tx,{id:channel.id,rate:{num:channel.rateNum,den:channel.rateDen}},payload)
    // Allocate the number in the same SQLite transaction as activation. Two
    // operators publishing simultaneously cannot receive the same revision.
    const previous = tx.select({ revision: operationalPlaylistRevisions.revision })
      .from(operationalPlaylistRevisions).where(eq(operationalPlaylistRevisions.rundownId, rundownId))
      .orderBy(desc(operationalPlaylistRevisions.revision)).limit(1).get()
    const now = new Date().toISOString()
    const row = { id: randomUUID(), rundownId, revision: (previous?.revision ?? 0) + 1,
      state: 'PUBLISHED' as const, active: true, payload: payload as unknown as Record<string, unknown>,
      publishedBy: actor, publishedAt: now, activatedAt: now }
    tx.update(operationalPlaylistRevisions).set({ active: false, state: 'SUPERSEDED' })
      .where(eq(operationalPlaylistRevisions.rundownId, rundownId)).run()
    tx.insert(operationalPlaylistRevisions).values(row).run()
    tx.update(rundowns).set({publicationRequired:false}).where(eq(rundowns.id,rundownId)).run()
    if(audit)tx.insert(operatorDecisions).values({id:randomUUID(),rundownId,itemId:null,kind:audit.kind,payload:{...audit.payload,revisionId:row.id,revision:row.revision},actorUsername:actor,createdAt:now}).run()
    return row
  },{behavior:'immediate'})
}

/** Operational intervention, not an implicit publication of editorial edits.
 * Read, change and allocate the revision under one SQLite write transaction. */
export function adjustPublishedLiveDuration(db: Pick<Db,'transaction'>, channel: Channel, rundownId: string, itemId: string, deltaFrames: number, elapsedFrames: number, actor: string | null) {
  if (!Number.isSafeInteger(deltaFrames) || !Number.isSafeInteger(elapsedFrames) || elapsedFrames < 0) throw new Error('Ajuste de duração inválido.')
  return db.transaction(tx => {
    const active = tx.select().from(operationalPlaylistRevisions).where(and(eq(operationalPlaylistRevisions.rundownId, rundownId), eq(operationalPlaylistRevisions.active, true))).get()
    if (!active) throw new Error('Publique a playlist operacional antes de ajustar o live no ar.')
    const payload = readOperationalPayload(active.payload)
    assertOperationalCadence(tx,channel,payload)
    const current = payload.items.find(item => item.id === itemId)
    if (!current || !(current.type === 'LIVE' || current.sourceRef || current.liveEndpoint)) throw new Error('O item no ar não é uma entrada ao vivo.')
    const previousFrames = current.liveConfig?.estimatedDuration ?? current.liveEstimatedDuration ?? current.durationOverride ?? 0
    const minimum = elapsedFrames + Math.ceil(channel.rate.num / channel.rate.den)
    const newFrames = Math.max(minimum, previousFrames + deltaFrames)
    const oldMax = current.liveConfig?.maxDuration ?? current.liveMaxDuration
    const maxDuration = oldMax && oldMax > 0 ? Math.max(newFrames, oldMax + deltaFrames) : oldMax
    const items = payload.items.map(item => item.id !== itemId ? item : { ...item, durationOverride: newFrames, liveEstimatedDuration: newFrames, liveMaxDuration: maxDuration,
      liveConfig: item.liveConfig ? { ...item.liveConfig, estimatedDuration: newFrames, maxDuration } : item.liveConfig })
    const assets = new Map((payload.assets ?? []).map(asset => [asset.id, asset]))
    const schedule = buildView(payload.rundown, channel, items, assets, null, null).schedule
    const next = { ...payload, items, schedule, operation: { kind: 'LIVE_DURATION' as const, itemId, deltaFrames: newFrames - previousFrames, elapsedFrames, previousFrames, newFrames, at: new Date().toISOString() } }
    assertOnAirMediaUnchanged(payload, next, itemId)
    return persistRevision(tx, rundownId, next, actor)
  })
}

/** Publica uma fotografia operacional: itens, regras e timing resolvido. */
export async function publishOperationalPlaylist(
  db: Db,
  channel: Channel,
  rundownId: string,
  actor: string | null,
  onAirItemId: string | null = null,
  guard?:OperationalGuard,
) {
  const captured=await Promise.resolve(inspectOperationalPlaylist(db,rundownId,channel.id))
  return commitOperationalPublication(db,channel,rundownId,actor,captured,onAirItemId,guard)
}

/** Synchronous entry for an atomic editorial job + publication commit. Never
 * await a Promise inside better-sqlite3's transaction callback. */
export function publishOperationalPlaylistNow(db:Db,channel:Channel,rundownId:string,actor:string|null,guard?:OperationalGuard) {
  return commitOperationalPublication(db,channel,rundownId,actor,inspectOperationalPlaylist(db,rundownId,channel.id),null,guard)
}
function commitOperationalPublication(db:Db,channel:Channel,rundownId:string,actor:string|null,captured:ReturnType<typeof inspectOperationalPlaylist>,onAirItemId:string|null,guard?:OperationalGuard) {
  return db.transaction(()=>{
    const current=inspectOperationalPlaylist(db,rundownId,channel.id)
    assertOperationalCadence(db,current.channel,captured.payload)
    assertOperationalCadence(db,channel,current.payload)
    guard?.(current.review,current.payload)
    requireOperationalReview(current.review,captured.review.token)
    if(current.active && onAirItemId)assertOnAirMediaUnchanged(readOperationalPayload(current.active.payload),current.payload,onAirItemId)
    return persistRevision(db,rundownId,current.payload,actor,{kind:'OPERATIONAL_PLAYLIST_PUBLISHED',payload:{editorialRevision:current.review.editorialRevision,itemCount:current.payload.items.length,conflicts:current.payload.schedule.conflicts.length}})
  },{behavior:'immediate'})
}

/** Timing may be adjusted, but an active decoder/media contract is protected. */
export function assertOnAirMediaUnchanged(previous: Pick<OperationalPayload, 'items' | 'assets' | 'rate'>, next: Pick<OperationalPayload, 'items' | 'assets' | 'rate'>, onAirId: string) {
  const old = previous.items.find((item) => item.id === onAirId)
  const updated = next.items.find((item) => item.id === onAirId)
  if (!old || !updated) throw new Error('A revisão não preserva o item no ar. Faça a troca de PGM antes de ativá-la.')
  const protectedFields = ['mediaId', 'sourceRef', 'configuredSourceId', 'trim', 'audio', 'fit', 'audioTrack', 'liveSourceType', 'liveEndpoint', 'liveFallbackMediaId'] as const
  if (protectedFields.some((field) => JSON.stringify(old[field]) !== JSON.stringify(updated[field]))) throw new Error('A mídia, fonte, cortes ou áudio do item no ar mudaram. Ative esta revisão após a troca de PGM.')
  if(['sourceType','sourceEndpoint','fallbackMediaId'].some(field=>JSON.stringify(old.liveConfig?.[field as keyof NonNullable<typeof old.liveConfig>])!==JSON.stringify(updated.liveConfig?.[field as keyof NonNullable<typeof updated.liveConfig>])))throw new Error('A fonte ou fallback do live no ar mudou. Ative esta revisão após a troca de PGM.')
  const oldAsset = previous.assets?.find((asset) => asset.id === old.mediaId)
  const newAsset = next.assets?.find((asset) => asset.id === updated.mediaId)
  if (oldAsset && newAsset && oldAsset.contentHash !== newAsset.contentHash) throw new Error('A versão da mídia no ar mudou; publique depois de trocar o PGM.')
  if(old.mediaId && (!oldAsset || !newAsset))throw new Error('A mídia do item no ar não está preservada nesta revisão.')
  if(oldAsset && newAsset){
    const rate=previous.rate??next.rate
    const before=rate?resolveTrim(old.trim,oldAsset,rate).value:[old.trim,oldAsset.defaultTrim,oldAsset.defaultTrimRate]
    const after=rate?resolveTrim(updated.trim,newAsset,rate).value:[updated.trim,newAsset.defaultTrim,newAsset.defaultTrimRate]
    if(JSON.stringify(before)!==JSON.stringify(after) || JSON.stringify(resolveAudio(old.audio,oldAsset,old.audioTrack??0).value)!==JSON.stringify(resolveAudio(updated.audio,newAsset,updated.audioTrack??0).value))throw new Error('O corte ou áudio herdado da mídia no ar mudou. Publique depois de trocar o PGM.')
  }
}

export async function listOperationalPlaylists(db: Db, rundownId: string) {
  return db.select({
    id: operationalPlaylistRevisions.id,
    revision: operationalPlaylistRevisions.revision,
    state: operationalPlaylistRevisions.state,
    active: operationalPlaylistRevisions.active,
    publishedBy: operationalPlaylistRevisions.publishedBy,
    publishedAt: operationalPlaylistRevisions.publishedAt,
    activatedAt: operationalPlaylistRevisions.activatedAt,
  }).from(operationalPlaylistRevisions)
    .where(eq(operationalPlaylistRevisions.rundownId, rundownId))
    .orderBy(desc(operationalPlaylistRevisions.revision))
}

export async function activeOperationalPlaylist(db: Db, rundownId: string) {
  const [row] = await db.select().from(operationalPlaylistRevisions)
    .where(and(eq(operationalPlaylistRevisions.rundownId, rundownId), eq(operationalPlaylistRevisions.active, true)))
    .orderBy(desc(operationalPlaylistRevisions.revision))
    .limit(1)
  return row ?? null
}

export async function rollbackOperationalPlaylist(db: Db, rundownId: string, revisionId: string, actor: string | null, onAirItemId: string | null = null,guard?:OperationalGuard) {
  const captured=await Promise.resolve(inspectOperationalRollback(db,rundownId,revisionId))
  return db.transaction(()=>{
  const current=inspectOperationalRollback(db,rundownId,revisionId),{source,payload}=current
  guard?.(current.review,payload)
  requireOperationalReview(current.review,captured.review.token)
  if (current.active && onAirItemId) assertOnAirMediaUnchanged(readOperationalPayload(current.active.payload), payload, onAirItemId)
  if (onAirItemId && !payload.items.some((item) => item.id === onAirItemId)) {
    throw new Error('A revisão não contém o item no ar. Faça a troca de PGM antes de ativar este rollback.')
  }
  // Rollback creates a new revision; neither old history nor editorial edits
  // are erased. Its origin remains explicit for as-run and audit comparison.
  return persistRevision(db, rundownId, { ...payload, restoredFrom: { id: source.id, revision: source.revision } }, actor,{kind:'OPERATIONAL_PLAYLIST_ROLLBACK',payload:{restoredFrom:source.id,reviewedEditorialRevision:current.review.editorialRevision}})
  },{behavior:'immediate'})
}

export function diffOperationalItems(published: readonly RundownItem[], editorial: readonly RundownItem[]) {
  const old = new Map(published.map((item) => [item.id, item]))
  const current = new Map(editorial.map((item) => [item.id, item]))
  return {
    added: editorial.filter((item) => !old.has(item.id)).map((item) => item.id),
    removed: published.filter((item) => !current.has(item.id)).map((item) => item.id),
    changed: editorial.filter((item) => old.has(item.id)).flatMap((item) => {
      const previous = old.get(item.id)!
      const fields = Object.keys(item).filter((key) => JSON.stringify(item[key as keyof RundownItem]) !== JSON.stringify(previous[key as keyof RundownItem]))
      return fields.length ? [{ itemId: item.id, fields }] : []
    }),
  }
}
