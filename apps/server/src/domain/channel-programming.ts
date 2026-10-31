import { createHash, randomUUID } from 'node:crypto'
import { and, asc, eq, inArray, notInArray } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { channels, graphicTemplates, itemGraphics, liveSources, operatorDecisions, rundownItems, rundowns, secondaryEvents } from '../db/schema.js'
import { rundownMidnight } from './rundown-clock.js'

/** Programação multicanal (cópia e espelho). Quem pode: Supervisor/Admin com
 * acesso aos dois canais — conferido nas rotas. Aqui ficam as regras de dados. */
export class ChannelProgrammingError extends Error {
  constructor(message: string, readonly status = 409) { super(message) }
}

export interface MirrorRow { targetChannelId: string; sourceChannelId: string; createdBy: string | null; createdAt: string; lastSyncAt: string | null; lastSyncError: string | null; unlockedBy: string | null; unlockedAt: string | null; unlockReason: string | null; unlockExpiresAt: string | null }

const sameRate = (db: Db, a: string, b: string) => {
  const rows = db.select({ id: channels.id, num: channels.rateNum, den: channels.rateDen, archivedAt: channels.archivedAt }).from(channels).where(inArray(channels.id, [a, b])).all()
  if (rows.length !== 2 || rows.some(row => row.archivedAt)) throw new ChannelProgrammingError('Canal de origem ou destino não encontrado ou arquivado.', 404)
  const [x, y] = rows
  if (x!.num * y!.den !== y!.num * x!.den) throw new ChannelProgrammingError('Os canais têm cadências diferentes; a grade usa quadros e não pode ir de um para o outro sem conversão.')
}

/** Ids estáveis no destino: o espelho atualiza as mesmas linhas, então o item
 * no ar do canal B continua sendo o mesmo depois de uma nova publicação em A. */
const stableId = (prefix: string, ...parts: string[]) => `${prefix}-${createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 32)}`
export const mirrorRundownId = (targetChannelId: string, sourceRundownId: string) => stableId('espelho', targetChannelId, sourceRundownId)

interface CopyReport { rundownId: string; items: number; skippedGraphics: number; liveItems: number; unboundLive: number }

/** Copia (ou sincroniza) a grade de A para B dentro de uma transação. Grafismos
 * presos ao canal A não vão (B não pode usá-los); os globais e os de B vão. */
function writeRundownCopy(db: Db, options: { sourceRundownId: string; targetChannelId: string; targetRundownId: string; name: string; date?: string; upsert: boolean }): CopyReport {
  return db.transaction(tx => {
    const source = tx.select().from(rundowns).where(eq(rundowns.id, options.sourceRundownId)).get()
    if (!source) throw new ChannelProgrammingError('A grade de origem não existe.', 404)
    if (source.channelId === options.targetChannelId) throw new ChannelProgrammingError('Origem e destino são o mesmo canal; use "copiar grade" da Playlist.')
    sameRate(tx as unknown as Db, source.channelId, options.targetChannelId)
    const date = options.date ?? source.date
    if (rundownMidnight(date) === null) throw new ChannelProgrammingError('Data de calendário inválida.', 400)
    const now = new Date().toISOString()
    const existing = tx.select().from(rundowns).where(eq(rundowns.id, options.targetRundownId)).get()
    if (existing && existing.channelId !== options.targetChannelId) throw new ChannelProgrammingError('Identificador de grade em uso por outro canal.')
    if (existing && !options.upsert) throw new ChannelProgrammingError('Já existe uma grade com este identificador.')
    const fields = { name: options.name, date, plannedStart: source.plannedStart, loop: source.loop, protectedZones: source.protectedZones, updatedAt: now }
    if (existing) tx.update(rundowns).set(fields).where(eq(rundowns.id, options.targetRundownId)).run()
    else tx.insert(rundowns).values({ id: options.targetRundownId, channelId: options.targetChannelId, ...fields, publicationRequired: false, createdAt: now }).run()

    const rows = tx.select().from(rundownItems).where(eq(rundownItems.rundownId, source.id)).orderBy(asc(rundownItems.sortOrder), asc(rundownItems.id)).all()
    const itemId = (id: string) => options.upsert ? stableId('espelho-item', options.targetChannelId, id) : randomUUID()
    const items = new Map(rows.map(row => [row.id, itemId(row.id)]))
    const blocks = new Map<string, string>()
    const keep = [...items.values()]
    // Sincronização: remove do destino o que saiu da origem (cascata leva os grafismos).
    if (existing) {
      const stale = keep.length ? tx.select({ id: rundownItems.id }).from(rundownItems).where(and(eq(rundownItems.rundownId, options.targetRundownId), notInArray(rundownItems.id, keep))).all() : tx.select({ id: rundownItems.id }).from(rundownItems).where(eq(rundownItems.rundownId, options.targetRundownId)).all()
      if (stale.length) {
        tx.delete(secondaryEvents).where(and(eq(secondaryEvents.channelId, options.targetChannelId), inArray(secondaryEvents.itemId, stale.map(row => row.id)))).run()
        tx.delete(rundownItems).where(inArray(rundownItems.id, stale.map(row => row.id))).run()
      }
    }
    // Fonte cadastrada é do canal: no destino vale a fonte de mesmo tipo e
    // endereço; sem equivalente, o item fica só com a referência (sourceRef).
    const sources = tx.select({ id: liveSources.id, channelId: liveSources.channelId, kind: liveSources.kind, targetUrl: liveSources.targetUrl }).from(liveSources).where(inArray(liveSources.channelId, [source.channelId, options.targetChannelId])).all()
    const mapSource = (id: string | null) => {
      if (!id) return null
      const origin = sources.find(row => row.id === id && row.channelId === source.channelId)
      return origin ? sources.find(row => row.channelId === options.targetChannelId && row.kind === origin.kind && row.targetUrl === origin.targetUrl)?.id ?? null : null
    }
    let liveItems = 0, unboundLive = 0
    for (const row of rows) {
      if (row.blockId && !blocks.has(row.blockId)) blocks.set(row.blockId, options.upsert ? stableId('espelho-bloco', options.targetChannelId, row.blockId) : randomUUID())
      if (row.type === 'LIVE' || row.sourceRef) liveItems++
      const configuredSourceId = mapSource(row.configuredSourceId)
      if (row.configuredSourceId && !configuredSourceId) unboundLive++
      const values = { ...row, id: items.get(row.id)!, rundownId: options.targetRundownId, blockId: row.blockId ? blocks.get(row.blockId)! : null, configuredSourceId }
      const found = existing ? tx.select({ id: rundownItems.id }).from(rundownItems).where(eq(rundownItems.id, values.id)).get() : undefined
      if (found) tx.update(rundownItems).set(values).where(eq(rundownItems.id, values.id)).run()
      else tx.insert(rundownItems).values(values).run()
    }
    let skippedGraphics = 0
    if (rows.length) {
      const sourceIds = [...items.keys()]
      if (existing) tx.delete(itemGraphics).where(inArray(itemGraphics.itemId, keep)).run()
      const usable = new Set(tx.select({ id: graphicTemplates.id, channelId: graphicTemplates.channelId }).from(graphicTemplates).all()
        .filter(row => row.channelId === null || row.channelId === options.targetChannelId).map(row => row.id))
      for (const cue of tx.select().from(itemGraphics).where(inArray(itemGraphics.itemId, sourceIds)).all()) {
        if (!usable.has(cue.templateId)) { skippedGraphics++; continue }
        tx.insert(itemGraphics).values({ ...cue, id: randomUUID(), itemId: items.get(cue.itemId)!, createdAt: now }).run()
      }
      if (existing) tx.delete(secondaryEvents).where(and(eq(secondaryEvents.channelId, options.targetChannelId), inArray(secondaryEvents.itemId, keep))).run()
      for (const event of tx.select().from(secondaryEvents).where(and(eq(secondaryEvents.channelId, source.channelId), inArray(secondaryEvents.itemId, sourceIds))).all()) {
        const eventId = randomUUID(), target = items.get(event.itemId)!
        tx.insert(secondaryEvents).values({ ...event, id: eventId, channelId: options.targetChannelId, itemId: target, definition: { ...event.definition, id: eventId, rundownItemId: target }, createdAt: now, updatedAt: now }).run()
      }
    }
    return { rundownId: options.targetRundownId, items: rows.length, skippedGraphics, liveItems, unboundLive }
  })
}

/** Cópia independente: depois cada canal segue sozinho. */
export function copyRundownToChannel(db: Db, options: { sourceRundownId: string; targetChannelId: string; date?: string; name?: string }): CopyReport {
  const source = db.select({ name: rundowns.name, date: rundowns.date, channelId: rundowns.channelId }).from(rundowns).where(eq(rundowns.id, options.sourceRundownId)).get()
  if (!source) throw new ChannelProgrammingError('A grade de origem não existe.', 404)
  if (mirrorOf(db, options.targetChannelId)) throw new ChannelProgrammingError('Este canal espelha outro; desligue o espelho antes de copiar uma grade para ele.')
  const origin = db.select({ name: channels.name }).from(channels).where(eq(channels.id, source.channelId)).get()
  return writeRundownCopy(db, { sourceRundownId: options.sourceRundownId, targetChannelId: options.targetChannelId, targetRundownId: randomUUID(), date: options.date, name: options.name ?? `${source.name} (cópia de ${origin?.name ?? 'outro canal'})`, upsert: false })
}

/** Destraves vencidos voltam a travar, com registro na auditoria. Roda antes
 * de qualquer leitura do espelho, então não depende de timer. */
export function expireMirrorUnlocks(db: Db, nowIso = new Date().toISOString()): string[] {
  const due = db.$client.prepare('SELECT target_channel_id AS id, source_channel_id AS source, unlocked_by AS by FROM channel_mirrors WHERE unlock_expires_at IS NOT NULL AND unlock_expires_at<=?').all(nowIso) as Array<{ id: string; source: string; by: string | null }>
  if (!due.length) return []
  // Sem transação própria: pode rodar dentro de outra (setMirror). O UPDATE
  // condicionado só retrava uma vez; a auditoria sai só de quem retravou.
  for (const row of due) {
    const changed = db.$client.prepare('UPDATE channel_mirrors SET unlocked_by=NULL, unlocked_at=NULL, unlock_reason=NULL, unlock_expires_at=NULL WHERE target_channel_id=? AND unlock_expires_at<=?').run(row.id, nowIso).changes
    if (changed) db.insert(operatorDecisions).values({ id: randomUUID(), rundownId: '@mirror', itemId: null, kind: 'MIRROR_RELOCK_AUTO', payload: { channelId: row.id, sourceChannelId: row.source, unlockedBy: row.by }, actorUsername: null, createdAt: nowIso }).run()
  }
  return due.map(row => row.id)
}

export function mirrorOf(db: Db, targetChannelId: string): MirrorRow | null {
  expireMirrorUnlocks(db)
  const row = db.$client.prepare('SELECT target_channel_id AS targetChannelId, source_channel_id AS sourceChannelId, created_by AS createdBy, created_at AS createdAt, last_sync_at AS lastSyncAt, last_sync_error AS lastSyncError, unlocked_by AS unlockedBy, unlocked_at AS unlockedAt, unlock_reason AS unlockReason, unlock_expires_at AS unlockExpiresAt FROM channel_mirrors WHERE target_channel_id=?').get(targetChannelId) as MirrorRow | undefined
  return row ?? null
}
export function mirrorsFrom(db: Db, sourceChannelId: string): MirrorRow[] {
  return db.$client.prepare('SELECT target_channel_id AS targetChannelId, source_channel_id AS sourceChannelId, created_by AS createdBy, created_at AS createdAt, last_sync_at AS lastSyncAt, last_sync_error AS lastSyncError, unlocked_by AS unlockedBy, unlocked_at AS unlockedAt, unlock_reason AS unlockReason, unlock_expires_at AS unlockExpiresAt FROM channel_mirrors WHERE source_channel_id=? ORDER BY target_channel_id').all(sourceChannelId) as MirrorRow[]
}

/** Liga (source) ou desliga (null) o espelho do canal alvo. Sem cadeias: um
 * canal espelhado não é origem de outro e vice-versa. */
export function setMirror(db: Db, targetChannelId: string, sourceChannelId: string | null, actor: string | null): MirrorRow | null {
  return db.transaction(() => {
    if (sourceChannelId === null) {
      db.$client.prepare('DELETE FROM channel_mirrors WHERE target_channel_id=?').run(targetChannelId)
      return null
    }
    if (sourceChannelId === targetChannelId) throw new ChannelProgrammingError('Um canal não pode espelhar a si mesmo.', 400)
    sameRate(db, sourceChannelId, targetChannelId)
    if (mirrorOf(db, sourceChannelId)) throw new ChannelProgrammingError('O canal de origem já espelha outro canal; escolha a origem principal.')
    if (mirrorsFrom(db, targetChannelId).length) throw new ChannelProgrammingError('Este canal é origem de outro espelho; desligue aquele espelho antes.')
    db.$client.prepare('INSERT INTO channel_mirrors(target_channel_id,source_channel_id,created_by,created_at) VALUES(?,?,?,?) ON CONFLICT(target_channel_id) DO UPDATE SET source_channel_id=excluded.source_channel_id,created_by=excluded.created_by,unlocked_by=NULL,unlocked_at=NULL,unlock_reason=NULL,unlock_expires_at=NULL,created_at=excluded.created_at,last_sync_at=NULL,last_sync_error=NULL')
      .run(targetChannelId, sourceChannelId, actor, new Date().toISOString())
    return mirrorOf(db, targetChannelId)
  }, { behavior: 'immediate' })
}

/** Grade espelhada (somente leitura editorial) enquanto o espelho estiver ligado. */
export function isActiveMirrorRundown(db: Db, rundownId: string): boolean {
  if (!rundownId.startsWith('espelho-')) return false
  const row = db.select({ channelId: rundowns.channelId }).from(rundowns).where(eq(rundowns.id, rundownId)).get()
  return Boolean(row && mirrorOf(db, row.channelId))
}

/** Atualiza a grade espelhada de B com a grade publicada em A. */
export function syncMirrorRundown(db: Db, targetChannelId: string, sourceRundownId: string): CopyReport {
  const source = db.select({ name: rundowns.name, channelId: rundowns.channelId }).from(rundowns).where(eq(rundowns.id, sourceRundownId)).get()
  if (!source) throw new ChannelProgrammingError('A grade de origem não existe.', 404)
  const origin = db.select({ name: channels.name }).from(channels).where(eq(channels.id, source.channelId)).get()
  return writeRundownCopy(db, { sourceRundownId, targetChannelId, targetRundownId: mirrorRundownId(targetChannelId, sourceRundownId), name: `Espelho de ${origin?.name ?? 'outro canal'} — ${source.name}`, upsert: true })
}

export function recordMirrorSync(db: Db, targetChannelId: string, error: string | null): void {
  db.$client.prepare('UPDATE channel_mirrors SET last_sync_at=?, last_sync_error=? WHERE target_channel_id=?').run(new Date().toISOString(), error, targetChannelId)
}

/** Travado: o canal só põe no ar a grade espelhada. */
export function isMirrorLocked(db: Db, channelId: string): boolean {
  const mirror = mirrorOf(db, channelId)
  return Boolean(mirror && !mirror.unlockedAt)
}

/** Grade espelhada deste canal (gerada pelo espelho), ligada ou não. */
export function isMirrorRundownOf(db: Db, rundownId: string, channelId: string): boolean {
  if (!rundownId.startsWith('espelho-')) return false
  const row = db.select({ channelId: rundowns.channelId }).from(rundowns).where(eq(rundowns.id, rundownId)).get()
  return row?.channelId === channelId
}

export const MIRROR_LOCK_MESSAGE = 'Canal travado no espelho: só a grade espelhada pode ir ao ar. Em emergência, use DESTRAVAR na Playlist ou no Master (o motivo fica na auditoria).'

/** Destrava (com motivo) ou trava de novo o canal espelhado. */
export const UNLOCK_DURATIONS = { '1h': 3_600_000, '4h': 4 * 3_600_000, 'manual': null } as const
export type UnlockDuration = keyof typeof UNLOCK_DURATIONS
export function setMirrorUnlock(db: Db, channelId: string, unlock: { by: string | null; reason: string; duration?: UnlockDuration } | null): MirrorRow {
  const mirror = mirrorOf(db, channelId)
  if (!mirror) throw new ChannelProgrammingError('Este canal não espelha outro.', 404)
  if (unlock) {
    const reason = unlock.reason.trim()
    if (reason.length < 3) throw new ChannelProgrammingError('Informe o motivo do destrave.', 400)
    const now = Date.now(), span = UNLOCK_DURATIONS[unlock.duration ?? '4h']
    db.$client.prepare('UPDATE channel_mirrors SET unlocked_by=?, unlocked_at=?, unlock_reason=?, unlock_expires_at=? WHERE target_channel_id=?').run(unlock.by, new Date(now).toISOString(), reason.slice(0, 300), span === null ? null : new Date(now + span).toISOString(), channelId)
  } else db.$client.prepare('UPDATE channel_mirrors SET unlocked_by=NULL, unlocked_at=NULL, unlock_reason=NULL, unlock_expires_at=NULL WHERE target_channel_id=?').run(channelId)
  return mirrorOf(db, channelId)!
}
