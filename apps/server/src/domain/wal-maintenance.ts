import { statSync } from 'node:fs'

interface PragmaRunner { pragma(sql: string, options?: Record<string, unknown>): unknown }
const size = (file: string): number => { try { return statSync(file).size } catch { return 0 } }

/** Checkpoint periódico do WAL. O checkpoint automático do SQLite (1000
 * páginas) não encolhe o arquivo, e com leitura longa em curso ele pode não
 * completar: o -wal só cresce. PASSIVE nunca espera ninguém; acima do teto,
 * TRUNCATE devolve o arquivo a zero (se houver leitor, o SQLite responde
 * busy e a próxima passada tenta de novo). */
export function walMaintenance(sqlite: PragmaRunner, walFile: string, truncateBytes: number): { mode: 'PASSIVE' | 'TRUNCATE'; busy: boolean; walBytesBefore: number; walBytesAfter: number } {
  const walBytesBefore = size(walFile)
  const mode = Number.isFinite(truncateBytes) && truncateBytes > 0 && walBytesBefore > truncateBytes ? 'TRUNCATE' : 'PASSIVE'
  const rows = sqlite.pragma(`wal_checkpoint(${mode})`) as Array<{ busy?: number }> | undefined
  return { mode, busy: Boolean(Array.isArray(rows) && rows[0]?.busy), walBytesBefore, walBytesAfter: size(walFile) }
}
