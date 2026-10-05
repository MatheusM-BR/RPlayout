import { and, desc, eq, inArray } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import type { Db } from '../db/client.js'
import {assertChannelAudioChange} from './audio-bus.js'
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
} from '../db/schema.js'

type ProjectPayload = Record<string, any>

async function capture(db: Db, channelId: string): Promise<ProjectPayload | null> {
  const [channel] = await db.select().from(channels).where(eq(channels.id, channelId))
  if (!channel) return null
  const projectRundowns = await db.select().from(rundowns).where(eq(rundowns.channelId, channelId))
  const rundownIds = projectRundowns.map((row) => row.id)
  const items = rundownIds.length ? await db.select().from(rundownItems).where(inArray(rundownItems.rundownId, rundownIds)) : []
  const itemIds=items.map(item=>item.id)
  const [outputs, presets, sources, rules, multiview, destinationsRows, guests, graphics, cues, events] = await Promise.all([
    db.select().from(outputProfiles).where(eq(outputProfiles.channelId, channelId)),
    db.select().from(transmissionPresets).where(eq(transmissionPresets.channelId, channelId)),
    db.select().from(liveSources).where(eq(liveSources.channelId, channelId)),
    db.select().from(scheduleRules).where(eq(scheduleRules.channelId, channelId)),
    db.select().from(multiviewConfigs).where(eq(multiviewConfigs.channelId, channelId)),
    db.select().from(destinations).where(eq(destinations.channelId, channelId)),
    db.select().from(guestKeys).where(eq(guestKeys.channelId, channelId)),
    db.select().from(graphicTemplates).where(eq(graphicTemplates.channelId, channelId)),
    itemIds.length ? db.select().from(itemGraphics).where(inArray(itemGraphics.itemId,itemIds)) : Promise.resolve([]),
    db.select().from(secondaryEvents).where(eq(secondaryEvents.channelId,channelId)),
  ])
  return { version: 1, channel, outputs, presets, sources, rules, multiview, destinations: destinationsRows, guests, graphics, rundowns: projectRundowns, items, cues, secondaryEvents:events }
}

export async function saveChannelProject(db: Db, channelId: string, label: string) {
  const payload = await capture(db, channelId)
  if (!payload) throw new Error('Canal não encontrado para salvar o projeto.')
  const snapshot = { id: randomUUID(), channelId, label: label.trim() || 'Ponto manual', payload, createdAt: new Date().toISOString() }
  await db.insert(channelProjectSnapshots).values(snapshot)
  return { id: snapshot.id, label: snapshot.label, createdAt: snapshot.createdAt }
}

export async function listChannelProjects(db: Db, channelId: string) {
  return db.select({ id: channelProjectSnapshots.id, label: channelProjectSnapshots.label, createdAt: channelProjectSnapshots.createdAt })
    .from(channelProjectSnapshots).where(eq(channelProjectSnapshots.channelId, channelId)).orderBy(desc(channelProjectSnapshots.createdAt))
}

/** Restaura somente entidades pertencentes ao canal selecionado. */
export async function restoreChannelProject(db: Db, channelId: string, snapshotId: string) {
  const [snapshot] = await db.select().from(channelProjectSnapshots)
    .where(eq(channelProjectSnapshots.id, snapshotId))
  if (!snapshot || snapshot.channelId !== channelId) throw new Error('Ponto de restauração não pertence a este canal.')
  const payload = snapshot.payload as ProjectPayload
  if (payload.version !== 1 || payload.channel?.id !== channelId) throw new Error('Projeto inválido ou incompatível com este canal.')
  const existingRundowns = await db.select({ id: rundowns.id }).from(rundowns).where(eq(rundowns.channelId, channelId))
  const ids = existingRundowns.map((row) => row.id)
  const snapshotIds = new Set((payload.rundowns ?? []).map((row: any) => row.id))
  const removedIds = ids.filter(id => !snapshotIds.has(id))
  if (removedIds.length && (await db.select({id:operationalPlaylistRevisions.id}).from(operationalPlaylistRevisions).where(inArray(operationalPlaylistRevisions.rundownId,removedIds)).limit(1)).length) throw new Error('A restauração removeria uma grade com histórico publicado. Preserve essa grade; nenhuma revisão operacional será apagada para restaurar o projeto.')
  const [current] = await db.select().from(channels).where(eq(channels.id,channelId))
  if (!current) throw new Error('Canal não encontrado.')
  const rateChanged = BigInt(current.rateNum) * BigInt(payload.channel.rateDen) !== BigInt(payload.channel.rateNum) * BigInt(current.rateDen)
  if (rateChanged && ids.length && (await db.select({id:operationalPlaylistRevisions.id}).from(operationalPlaylistRevisions).where(inArray(operationalPlaylistRevisions.rundownId,ids)).limit(1)).length) throw new Error('O projeto tem outra cadência e este canal possui revisões publicadas em quadros. A restauração não pode reinterpretar esse histórico.')
  db.transaction((tx) => {
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
    for (const row of payload.rundowns ?? []) tx.insert(rundowns).values(row).onConflictDoUpdate({target:rundowns.id,set:row}).run()
    for (const [table, rows] of [[outputProfiles, payload.outputs], [transmissionPresets, payload.presets], [liveSources, payload.sources], [scheduleRules, payload.rules], [multiviewConfigs, payload.multiview], [destinations, payload.destinations], [guestKeys, payload.guests], [graphicTemplates, payload.graphics], [rundownItems, payload.items], [itemGraphics,payload.cues], [secondaryEvents,payload.secondaryEvents]] as const) {
      if (Array.isArray(rows) && rows.length) tx.insert(table).values(rows as never).run()
    }
    assertChannelAudioChange(tx,channelId,payload.channel.audioChannels??2)
  })
  return { label: snapshot.label, createdAt: snapshot.createdAt, rundowns: Array.isArray(payload.rundowns) ? payload.rundowns.length : 0 }
}
