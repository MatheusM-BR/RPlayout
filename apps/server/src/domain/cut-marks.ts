import { randomUUID } from 'node:crypto'
import type { Db } from '../db/client.js'

/** Trecho de um VT que pode ser cortado para alinhar horário.
 * HEAD: começa no início (o VT pode entrar mais tarde no conteúdo).
 * TAIL: vai até o fim (o VT pode sair mais cedo).
 * MIDDLE: no meio; guardado, mas o motor ainda não pula trecho do meio. */
export type CutMarkKind = 'HEAD' | 'TAIL' | 'MIDDLE'
export interface CutMark { id: string; assetId: string; contentHash: string; fromMs: number; toMs: number; label: string | null; createdBy: string | null; createdAt: string; kind: CutMarkKind; savesMs: number; current: boolean }

/** Folga de um quadro a 25 fps para "encostar" no início ou no fim. */
const EDGE_MS = 40
export const MAX_MARKS_PER_VERSION = 20

export class CutMarkError extends Error { constructor(message: string, readonly status = 409) { super(message) } }

interface AssetRow { id: string; contentHash: string; durationNs: number | null; durationFrames: number; rateNum: number | null; rateDen: number | null }
function readAsset(db: Db, assetId: string): AssetRow | null {
  return (db.$client.prepare('SELECT id, content_hash AS contentHash, duration_ns AS durationNs, duration_frames AS durationFrames, rate_num AS rateNum, rate_den AS rateDen FROM media_assets WHERE id=?').get(assetId) as AssetRow | undefined) ?? null
}
/** Duração do arquivo em ms: a sondada (ns) ou, sem ela, quadros na cadência do arquivo. */
export function assetDurationMs(asset: Pick<AssetRow, 'durationNs' | 'durationFrames' | 'rateNum' | 'rateDen'>): number | null {
  if (asset.durationNs != null && Number.isFinite(asset.durationNs) && asset.durationNs > 0) return Math.round(asset.durationNs / 1e6)
  if (asset.rateNum && asset.rateDen && asset.durationFrames > 0) return Math.round(asset.durationFrames * 1000 * asset.rateDen / asset.rateNum)
  return null
}
export function classifyCut(fromMs: number, toMs: number, durationMs: number | null): CutMarkKind {
  if (fromMs <= EDGE_MS) return 'HEAD'
  if (durationMs !== null && toMs >= durationMs - EDGE_MS) return 'TAIL'
  return 'MIDDLE'
}

interface Row { id: string; assetId: string; contentHash: string; fromMs: number; toMs: number; label: string | null; createdBy: string | null; createdAt: string }
const select = 'SELECT id, asset_id AS assetId, content_hash AS contentHash, from_ms AS fromMs, to_ms AS toMs, label, created_by AS createdBy, created_at AS createdAt FROM asset_cut_marks'

function view(row: Row, asset: AssetRow | null): CutMark {
  const durationMs = asset ? assetDurationMs(asset) : null
  const kind = classifyCut(row.fromMs, row.toMs, durationMs)
  // HEAD e TAIL encostam na borda: o corte efetivo vai até a borda do arquivo.
  const savesMs = kind === 'HEAD' ? row.toMs : kind === 'TAIL' && durationMs !== null ? durationMs - row.fromMs : row.toMs - row.fromMs
  return { ...row, kind, savesMs, current: Boolean(asset && asset.contentHash === row.contentHash) }
}

export function listCutMarks(db: Db, assetIds: readonly string[], includeStale = false): CutMark[] {
  const result: CutMark[] = []
  for (const assetId of new Set(assetIds)) {
    const asset = readAsset(db, assetId)
    for (const row of db.$client.prepare(`${select} WHERE asset_id=? ORDER BY from_ms, id`).all(assetId) as Row[]) {
      const mark = view(row, asset)
      if (mark.current || includeStale) result.push(mark)
    }
  }
  return result
}

export function addCutMark(db: Db, input: { assetId: string; contentHash: string; fromMs: number; toMs: number; label?: string | null }, actor: string | null): CutMark {
  return db.transaction(() => {
    const asset = readAsset(db, input.assetId)
    if (!asset) throw new CutMarkError('Arquivo não encontrado.', 404)
    if (asset.contentHash !== input.contentHash) throw new CutMarkError('O arquivo mudou durante a marcação. Confira a versão atual antes de marcar.')
    const durationMs = assetDurationMs(asset)
    if (!Number.isSafeInteger(input.fromMs) || !Number.isSafeInteger(input.toMs) || input.fromMs < 0 || input.toMs <= input.fromMs) throw new CutMarkError('O fim do trecho tem de vir depois do início.', 400)
    if (durationMs === null) throw new CutMarkError('A duração do arquivo não foi sondada; analise o original antes de marcar cortes.')
    if (input.toMs > durationMs + EDGE_MS) throw new CutMarkError('O trecho passa do fim do arquivo.', 400)
    if (input.fromMs <= EDGE_MS && input.toMs >= durationMs - EDGE_MS) throw new CutMarkError('O trecho cobre o arquivo inteiro; para tirar o VT da grade, use "retirar".', 400)
    const count = (db.$client.prepare('SELECT count(*) AS n FROM asset_cut_marks WHERE asset_id=? AND content_hash=?').get(input.assetId, input.contentHash) as { n: number }).n
    if (count >= MAX_MARKS_PER_VERSION) throw new CutMarkError(`No máximo ${MAX_MARKS_PER_VERSION} marcações por versão do arquivo.`)
    const row: Row = { id: randomUUID(), assetId: input.assetId, contentHash: input.contentHash, fromMs: input.fromMs, toMs: Math.min(input.toMs, durationMs), label: input.label?.trim().slice(0, 80) || null, createdBy: actor, createdAt: new Date().toISOString() }
    db.$client.prepare('INSERT INTO asset_cut_marks(id,asset_id,content_hash,from_ms,to_ms,label,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)').run(row.id, row.assetId, row.contentHash, row.fromMs, row.toMs, row.label, row.createdBy, row.createdAt)
    return view(row, asset)
  }, { behavior: 'immediate' })
}

export function removeCutMark(db: Db, assetId: string, markId: string): void {
  const changes = db.$client.prepare('DELETE FROM asset_cut_marks WHERE id=? AND asset_id=?').run(markId, assetId).changes
  if (!changes) throw new CutMarkError('Marcação não encontrada.', 404)
}
