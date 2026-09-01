import { asc, eq } from 'drizzle-orm'
import { DEFAULT_FIT } from '@rplayout/protocol'
import type { Channel, MediaAsset, MediaProbe, Rundown, RundownItem } from '@rplayout/protocol'
import type { Db } from './client.js'
import { channels, mediaAssets, rundownItems, rundowns } from './schema.js'

type ChannelRow = typeof channels.$inferSelect
type AssetRow = typeof mediaAssets.$inferSelect
type RundownRow = typeof rundowns.$inferSelect
type ItemRow = typeof rundownItems.$inferSelect

export const toChannel = (row: ChannelRow): Channel => ({
  id: row.id,
  name: row.name,
  rate: { num: row.rateNum, den: row.rateDen },
  width: row.width,
  height: row.height,
  scan: row.scan,
  fieldOrder: row.fieldOrder,
  targetLufs: row.targetLufs,
  ceilingDbtp: row.ceilingDbtp,
  limiterLookaheadMs: row.limiterLookaheadMs,
  programSdiDeviceId: row.programSdiDeviceId,
  createdAt: row.createdAt,
})

export const toAsset = (row: AssetRow): MediaAsset => ({
  id: row.id,
  contentHash: row.contentHash,
  path: row.path,
  title: row.title,
  kind: row.kind,
  durationFrames: row.durationFrames,
  durationNs: row.durationNs ?? null,
  // Só há sonda quando há geometria: um arquivo que não abriu não tem nada
  // dentro para contar.
  probe:
    row.width !== null && row.height !== null
      ? {
          width: row.width,
          height: row.height,
          rate: { num: row.rateNum ?? 25, den: row.rateDen ?? 1 },
          interlaceMode: (row.interlaceMode ?? 'progressive') as MediaProbe['interlaceMode'],
          hasAudio: row.hasAudio ?? false,
          audioChannels: row.audioChannels ?? 0,
        }
      : null,
  probeError: row.probeError ?? null,
  categoryId: row.categoryId,
  defaultTrim: row.defaultTrim ?? null,
  defaultAudio: row.defaultAudio ?? null,
  loudnessFile: row.loudnessFile ?? null,
  suggestedTrim: row.suggestedTrim ?? null,
  createdAt: row.createdAt,
})

export const toRundown = (row: RundownRow): Rundown => ({
  id: row.id,
  channelId: row.channelId,
  name: row.name,
  plannedStart: row.plannedStart,
  loop: row.loop,
  date: row.date,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

export const toItem = (row: ItemRow): RundownItem => ({
  id: row.id,
  rundownId: row.rundownId,
  order: row.sortOrder,
  type: row.type,
  title: row.title,
  mediaId: row.mediaId,
  sourceRef: row.sourceRef,
  trim: row.trim ?? null,
  audio: row.audio ?? null,
  durationOverride: row.durationOverride,
  minDuration: row.minDuration,
  anchor: row.anchor,
  onOverrun: row.onOverrun,
  elastic: row.elastic ?? null,
  blockId: row.blockId,
  // Coluna acrescentada depois: item antigo é pillarbox, como sempre foi.
  fit: row.fit ?? DEFAULT_FIT,
  locked: row.locked,
  autoNext: row.autoNext,
  loop: row.loop,
  notes: row.notes,
})

export async function listChannels(db: Db): Promise<Channel[]> {
  return (await db.select().from(channels).orderBy(asc(channels.name))).map(toChannel)
}

export async function getChannel(db: Db, id: string): Promise<Channel | null> {
  const [row] = await db.select().from(channels).where(eq(channels.id, id))
  return row ? toChannel(row) : null
}

export async function listAssets(db: Db): Promise<MediaAsset[]> {
  return (await db.select().from(mediaAssets).orderBy(asc(mediaAssets.title))).map(toAsset)
}

export async function assetMap(db: Db): Promise<Map<string, MediaAsset>> {
  const all = await listAssets(db)
  return new Map(all.map((a) => [a.id, a]))
}

export async function listRundowns(db: Db, channelId?: string): Promise<Rundown[]> {
  const query = db.select().from(rundowns)
  const rows = channelId
    ? await query.where(eq(rundowns.channelId, channelId)).orderBy(asc(rundowns.date))
    : await query.orderBy(asc(rundowns.date))
  return rows.map(toRundown)
}

export async function getRundown(db: Db, id: string): Promise<Rundown | null> {
  const [row] = await db.select().from(rundowns).where(eq(rundowns.id, id))
  return row ? toRundown(row) : null
}

export async function listItems(db: Db, rundownId: string): Promise<RundownItem[]> {
  const rows = await db
    .select()
    .from(rundownItems)
    .where(eq(rundownItems.rundownId, rundownId))
    .orderBy(asc(rundownItems.sortOrder))
  return rows.map(toItem)
}

export async function getItem(db: Db, id: string): Promise<RundownItem | null> {
  const [row] = await db.select().from(rundownItems).where(eq(rundownItems.id, id))
  return row ? toItem(row) : null
}

/**
 * Reescreve a ordem em passos de 10. Sobra espaço entre vizinhos para inserir
 * item sem renumerar a grade inteira a cada arrasto.
 */
export async function renumber(db: Db, rundownId: string, ids: readonly string[]): Promise<void> {
  for (const [index, id] of ids.entries()) {
    await db
      .update(rundownItems)
      .set({ sortOrder: (index + 1) * 10 })
      .where(eq(rundownItems.id, id))
  }
  await db
    .update(rundowns)
    .set({ updatedAt: new Date().toISOString() })
    .where(eq(rundowns.id, rundownId))
}
