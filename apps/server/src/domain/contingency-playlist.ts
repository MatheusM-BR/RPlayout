import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { qcApproved, assessQc, type Channel, type MediaAsset } from '@rplayout/protocol'
import type { Db } from '../db/client.js'
import { operationalPlaylistRevisions, qcDecisions, rundowns } from '../db/schema.js'
import { readOperationalPayload } from './operational-playlist.js'
import { applyQcDecisions } from './qc-workflow.js'
import { buildView } from './plan.js'
import {assertOperationalCadence} from './operational-cadence.js'

export type VerifiedCopyResolver = (asset: MediaAsset) => Promise<string | null>

/** Keep the configured frozen editions out of quota pruning across restarts.
 * Protection is not verification or authority to cut the program. */
export function configuredContingencyAssets(db: Db, channelId: string, revisionId: string): MediaAsset[] {
  const row = db.select().from(operationalPlaylistRevisions)
    .innerJoin(rundowns, eq(rundowns.id, operationalPlaylistRevisions.rundownId))
    .where(and(eq(operationalPlaylistRevisions.id, revisionId), eq(rundowns.channelId, channelId))).get()
  if (!row) return []
  const payload = readOperationalPayload(row.operational_playlist_revisions.payload)
  if (payload.rundown.channelId !== channelId) return []
  return (payload.assets ?? []).filter(asset => /^[a-f0-9]{64}$/i.test(asset.contentHash))
}

/** Resolve a frozen publication without calling runtime.load or touching CUE.
 * Contingency is deliberately limited to locally verified file playlists. */
export async function prepareContingencyPlaylist(db: Db, channel: Channel, revisionId: string,
  verifiedCopy: VerifiedCopyResolver, loop = true) {
  const [row] = await db.select().from(operationalPlaylistRevisions)
    .innerJoin(rundowns, eq(rundowns.id, operationalPlaylistRevisions.rundownId))
    .where(and(eq(operationalPlaylistRevisions.id, revisionId), eq(rundowns.channelId, channel.id)))
  if (!row) throw new Error('Revisão publicada não encontrada neste canal.')
  const revision = row.operational_playlist_revisions
  const payload = readOperationalPayload(revision.payload)
  assertOperationalCadence(db,channel,payload)
  if (payload.rundown.channelId !== channel.id || payload.rundown.id !== revision.rundownId) throw new Error('Publicação não corresponde ao canal/grade.')
  if (!revision.active) throw new Error('Esta revisão foi substituída. Selecione a publicação atual antes de preparar a contingência.')
  if (!payload.items.length) throw new Error('A playlist publicada está vazia.')
  if (loop) {
    if (!payload.rundown.loop) throw new Error('Ative o loop da grade e publique uma revisão antes de configurar a contingência.')
    if (payload.rundown.protectedZones?.length) throw new Error('A playlist de contingência não pode depender de zonas horárias.')
    if ((payload.secondaryEvents ?? []).some(event => ['SCTE_TRIGGER', 'DEVICE_AUTOMATION'].includes(event.type ?? ''))) throw new Error('A contingência não pode repetir automaticamente comandos externos ou SCTE.')
    for (const item of payload.items) {
      if (item.type === 'LIVE' || item.sourceRef || item.liveEndpoint || item.liveConfig?.sourceEndpoint || !item.mediaId) throw new Error('Contingência exige somente arquivos de vídeo, sem entradas ao vivo.')
      if (item.anchor.kind !== 'FLOW' || !item.autoNext || item.elastic) throw new Error('Contingência exige sequência contínua, avanço automático e duração fixa, sem horários obrigatórios.')
    }
  }
  const snapshot = new Map((payload.assets ?? []).map(asset => [asset.id, asset]))
  const approved = await applyQcDecisions(db, snapshot, channel.id)
  const pinned = new Map<string, MediaAsset>()
  for (const [id, asset] of approved) {
    const path = /^[a-f0-9]{64}$/i.test(asset.contentHash) ? await verifiedCopy(asset) : null
    pinned.set(id, { ...asset, path: path ?? asset.path,
      probeError: path ? asset.probeError : 'Versão publicada sem cópia local verificada. Prepare o cache ou aguarde o arquivamento.' })
  }
  // Decisions may have changed while hashing copies; apply them again before
  // returning a candidate. The transport also enforces QC at the actual TAKE.
  const qcFingerprint = () => {
    const ids = [...pinned.keys()], decisions = []
    for (let offset = 0; offset < ids.length; offset += 400) decisions.push(...db.select().from(qcDecisions)
      .where(inArray(qcDecisions.assetId, ids.slice(offset, offset + 400))).orderBy(asc(sql`rowid`)).all())
    return JSON.stringify(decisions)
  }
  const decisionsBefore = qcFingerprint()
  const assets = await applyQcDecisions(db, pinned, channel.id)
  if (qcFingerprint() !== decisionsBefore) throw new Error('QC mudou durante a preparação; confira e prepare novamente.')
  const view = buildView(payload.rundown, channel, payload.items, assets, null, null)
  if (loop) for (const entry of view.items) {
    const asset = entry.asset
    if (!asset || asset.kind !== 'VIDEO' || asset.ignored || asset.probeError || !qcApproved(asset.qcStatus ?? 'PENDING') ||
      (channel.qcProfile && !assessQc(asset, channel.qcProfile).playable) || entry.trim.out <= entry.trim.in) {
      throw new Error(`${entry.item.title}: ${asset?.probeError ?? 'vídeo sem aprovação QC/corte válido para contingência'}`)
    }
  }
  const isCurrent = () => Boolean(db.select({ active: operationalPlaylistRevisions.active }).from(operationalPlaylistRevisions)
    .where(eq(operationalPlaylistRevisions.id, revisionId)).get()?.active) && qcFingerprint() === decisionsBefore
  return { revision: { id: revision.id, revision: revision.revision, publishedAt: revision.publishedAt }, payload, view, assets, isCurrent }
}
