import { and, asc, eq } from 'drizzle-orm'
import { assessQc, qcApproved, type Channel, type MediaAsset } from '@rplayout/protocol'
import type { Db } from '../db/client.js'
import { operationalPlaylistRevisions, rundowns } from '../db/schema.js'
import type { CacheAssetInput } from './continuity-cache.js'
import { readOperationalPayload } from './operational-playlist.js'
import { applyQcDecisions } from './qc-workflow.js'
import type { App } from '../app.js'
import { getChannel } from '../db/repo.js'
import { cacheSequence } from './cache-plan.js'
import {assertOperationalCadence} from './operational-cadence.js'
import { rundownMidnight } from './rundown-clock.js'

export const distinctCacheAssets = (assets: readonly CacheAssetInput[]) =>
  [...new Map(assets.map(asset => [asset.contentHash.toLowerCase(),asset])).values()]

/** Prefetch is a storage plan, not an authorization to switch daily playlists
 * or an assertion of uninterrupted offline transmission. Only published
 * timing, pinned versions and current per-channel QC decisions are consumed. */
export async function publishedCachePlan(db: Db, channel: Channel, now = new Date(),
  archive?: (id: string, hash: string) => Promise<string | null>) {
  const from = now.getTime(), criticalEnd = from + 48*3600_000, extendedEnd = from + 7*24*3600_000
  if (!Number.isFinite(from)) throw new Error('Data inválida para preparar o cache.')
  const rows = await db.select({ revision:operationalPlaylistRevisions }).from(operationalPlaylistRevisions)
    .innerJoin(rundowns,eq(rundowns.id,operationalPlaylistRevisions.rundownId))
    // Editorial dates can be edited after publication. Filter by the frozen
    // snapshot below; using today's rundown date would silently move storage.
    .where(and(eq(rundowns.channelId,channel.id),eq(operationalPlaylistRevisions.active,true)))
    .orderBy(asc(rundowns.date),asc(rundowns.plannedStart),asc(operationalPlaylistRevisions.id))
  const assets48h: CacheAssetInput[] = [], assets7d: CacheAssetInput[] = []
  const revisions: Array<{id:string; rundownId:string; date:string; revision:number}> = []
  let blockedItems = 0, unversionedItems = 0
  for (const { revision } of rows) {
    const payload = readOperationalPayload(revision.payload)
    assertOperationalCadence(db,channel,payload)
    if (payload.rundown.channelId !== channel.id || payload.rundown.id !== revision.rundownId) throw new Error('Revisão de cache não pertence à grade/canal informado.')
    const base = rundownMidnight(payload.rundown.date), fps = channel.rate.num/channel.rate.den
    if (base === null || !Number.isFinite(fps) || fps <= 0) throw new Error('Data/cadência inválida em revisão publicada.')
    if (base >= extendedEnd || payload.schedule.items.every(timing=>base+(timing.start+Math.max(0,timing.duration))/fps*1000 <= from)) continue
    const assets = await applyQcDecisions(db,new Map((payload.assets ?? []).map(asset=>[asset.id,asset])),channel.id)
    const items = new Map(payload.items.map(item=>[item.id,item]))
    let included = false
    for (const timing of payload.schedule.items) {
      if (!Number.isFinite(timing.start) || !Number.isFinite(timing.duration) || timing.duration < 0) continue
      const start = base + timing.start/fps*1000, end = start + timing.duration/fps*1000
      if (end <= from || start >= extendedEnd) continue
      included = true
      const item = items.get(timing.id), asset = item?.mediaId ? assets.get(item.mediaId) : null
      if (!item || item.type==='LIVE' || item.eventType==='LIVE' || item.sourceRef || item.liveEndpoint || !asset) continue
      if (!/^[a-f0-9]{64}$/i.test(asset.contentHash)) { unversionedItems++; continue }
      if (asset.ignored || !qcApproved(asset.qcStatus) || !assessQc(asset,channel.qcProfile ?? undefined).playable || asset.path.includes('://')) { blockedItems++; continue }
      if (timing.state === 'DROPPED' || timing.duration === 0) continue
      const path = await archive?.(asset.id,asset.contentHash) ?? asset.path
      const pinned: MediaAsset = { ...asset,path }
      assets7d.push(pinned)
      if (start < criticalEnd) assets48h.push(pinned)
    }
    if (included) revisions.push({id:revision.id,rundownId:revision.rundownId,date:payload.rundown.date,revision:revision.revision})
  }
  return { assets48h:distinctCacheAssets(assets48h), assets7d:distinctCacheAssets(assets7d),
    revisions, blockedItems, unversionedItems, from:now.toISOString(), criticalUntil:new Date(criticalEnd).toISOString(), extendedUntil:new Date(extendedEnd).toISOString() }
}

export async function channelCachePlan(app: Pick<App,'db'|'runtimes'|'mediaWorkflow'>, channelId:string, now = new Date()) {
  const channel = await getChannel(app.db,channelId)
  if (!channel) throw new Error('Canal não encontrado.')
  const runtime = app.runtimes.get(channelId)
  const sequence = cacheSequence(runtime?.operationalRevision ? runtime.executionView : null,runtime?.transport.state().onAir ?? null)
  const plan = await publishedCachePlan(app.db,channel,now,(id,hash)=>app.mediaWorkflow.archived(id,hash))
  // Even a late/old loaded edition must not lose its current decoder files.
  const assets48h = distinctCacheAssets([...plan.assets48h,
    ...sequence.flatMap(entry=>entry.asset ? [entry.asset] : []),...(runtime?.cachePins() ?? [])])
  return { ...plan,assets48h,assets7d:distinctCacheAssets([...plan.assets7d,...assets48h]),runtime,sequence,channelId }
}

export async function warmChannelCache(app: Pick<App,'db'|'runtimes'|'mediaWorkflow'|'continuityCache'>, channelId:string, now = new Date()) {
  const context = await channelCachePlan(app,channelId,now)
  const result = await app.continuityCache.warmSchedule(context.assets48h,context.assets7d,{owner:`channel:${channelId}`})
  await context.runtime?.refreshCachedMediaPaths()
  return { context,result }
}
