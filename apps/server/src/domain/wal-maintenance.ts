import { statSync } from 'node:fs'

interface PragmaRunner { pragma(sql: string, options?: Record<string, unknown>): unknown }
const size = (file: string): number => { try { return statSync(file).size } catch { return 0 } }
type CheckpointRow = { busy?: number; log?: number; checkpointed?: number }
const firstRow = (rows: unknown): CheckpointRow => (Array.isArray(rows) ? rows[0] as CheckpointRow : undefined) ?? {}

/** Checkpoint periódico do WAL. O checkpoint automático do SQLite (1000
 * páginas) não encolhe o arquivo, e com leitura longa em curso ele pode não
 * completar: o -wal só cresce.
 *
 * Sempre começa por PASSIVE, que nunca espera ninguém. Acima do teto, e só se
 * o PASSIVE copiou tudo (log == checkpointed), tenta TRUNCATE para devolver o
 * arquivo a zero. O TRUNCATE pega o lock de escrita e, com leitor aberto,
 * esperaria o busy_timeout inteiro (5 s) segurando quem escreve: por isso roda
 * com busy_timeout 0 só durante a chamada (o valor anterior volta no fim). Se
 * houver leitor, responde busy na hora e a próxima passada tenta de novo. */
export function walMaintenance(sqlite: PragmaRunner, walFile: string, truncateBytes: number): { mode: 'PASSIVE' | 'TRUNCATE'; busy: boolean; walBytesBefore: number; walBytesAfter: number } {
  const walBytesBefore = size(walFile)
  const passive = firstRow(sqlite.pragma('wal_checkpoint(PASSIVE)'))
  const wantsTruncate = Number.isFinite(truncateBytes) && truncateBytes > 0 && walBytesBefore > truncateBytes
  const complete = !passive.busy && typeof passive.log === 'number' && passive.log >= 0 && passive.log === passive.checkpointed
  if (!wantsTruncate || !complete) return { mode: 'PASSIVE', busy: Boolean(passive.busy) || (wantsTruncate && !complete), walBytesBefore, walBytesAfter: size(walFile) }
  const previous = Number(sqlite.pragma('busy_timeout', { simple: true }))
  sqlite.pragma('busy_timeout = 0')
  let truncate: CheckpointRow
  try { truncate = firstRow(sqlite.pragma('wal_checkpoint(TRUNCATE)')) }
  finally { sqlite.pragma(`busy_timeout = ${Number.isFinite(previous) && previous >= 0 ? Math.trunc(previous) : 5000}`) }
  return { mode: 'TRUNCATE', busy: Boolean(truncate.busy), walBytesBefore, walBytesAfter: size(walFile) }
}
