import {randomUUID} from 'node:crypto'
import {asc, eq, sql} from 'drizzle-orm'
import type {Db} from '../db/client.js'
import {operatorDecisions} from '../db/schema.js'

/**
 * "Silêncio intencional": o arquivo não tem áudio na origem (um VT de
 * encerramento mudo, por exemplo), e o QC diz isso. Com a marca, a sonda do
 * PGM não alerta silêncio enquanto esse arquivo está no ar; sem a marca, o
 * alerta continua -- agrupado (`pgm-signal-incidents.ts`).
 *
 * A marca é do **arquivo naquela versão** (`contentHash`): trocou o conteúdo,
 * a marca não vale. Fica registrada como decisão do operador (trilha de
 * auditoria, a última vale), e não numa coluna nova de `media_assets`: uma
 * migração faria o banco ser recusado pela r88-35 (HA com reserva na versão
 * anterior e volta de versão). A API expõe o campo no arquivo
 * (`intentionalSilence` em GET /api/assets/:id/qc).
 */
export const INTENTIONAL_SILENCE_DECISION = 'ASSET_INTENTIONAL_SILENCE'

const caches = new WeakMap<Db, Map<string, string>>()

function load(db: Db): Map<string, string> {
  let cache = caches.get(db)
  if (cache) return cache
  cache = new Map()
  const rows = db.select().from(operatorDecisions).where(eq(operatorDecisions.kind, INTENTIONAL_SILENCE_DECISION)).orderBy(asc(operatorDecisions.createdAt), asc(sql`rowid`)).all()
  for (const row of rows) {
    const payload = row.payload as { assetId?: unknown; contentHash?: unknown; on?: unknown }
    if (typeof payload.assetId !== 'string' || typeof payload.contentHash !== 'string') continue
    if (payload.on === true) cache.set(payload.assetId, payload.contentHash); else cache.delete(payload.assetId)
  }
  caches.set(db, cache)
  return cache
}

/** O arquivo, nesta versão, está marcado como silêncio intencional? */
export function isIntentionalSilence(db: Db, asset: { id: string; contentHash: string } | null | undefined): boolean {
  if (!asset) return false
  return load(db).get(asset.id) === asset.contentHash
}

/** Marca ou desmarca, com decisão auditada. */
export function setIntentionalSilence(db: Db, asset: { id: string; contentHash: string }, on: boolean, actor: string | null, channelId: string | null): void {
  const cache = load(db)
  db.insert(operatorDecisions).values({ id: randomUUID(), rundownId: '@qc', itemId: null, kind: INTENTIONAL_SILENCE_DECISION, actorUsername: actor, createdAt: new Date().toISOString(),
    payload: { assetId: asset.id, contentHash: asset.contentHash, on, channelId } }).run()
  if (on) cache.set(asset.id, asset.contentHash); else cache.delete(asset.id)
}

/**
 * Leitura de áudio que a sonda do PGM recebe: com o arquivo no ar marcado
 * como silêncio intencional, nenhuma (a sonda não decide silêncio).
 */
export function probeAudioDbfs(db: Db, peakDbfs: readonly number[] | null | undefined, onAirAsset: { id: string; contentHash: string } | null | undefined): number | undefined {
  if (!peakDbfs || !peakDbfs.length) return undefined
  if (isIntentionalSilence(db, onAirAsset)) return undefined
  return Math.max(...peakDbfs)
}
