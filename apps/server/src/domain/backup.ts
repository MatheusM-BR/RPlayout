import { mkdir, readdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import type Database from 'better-sqlite3'

/**
 * Cópia de segurança do banco.
 *
 * Um playout guarda no banco a grade, o acervo medido, o as-run e o que o
 * sistema aprendeu -- perder isso é perder meses de operação, não uma tarde de
 * trabalho. A cópia usa a API de backup do SQLite, que copia um banco em uso
 * sem parar o servidor: parar para fazer backup é o mesmo que tirar do ar.
 */

/** Quantas cópias ficam. As mais velhas saem sozinhas. */
const KEEP = 10
const PREFIX = 'rplayout-'

export interface BackupResult {
  readonly file: string
  readonly bytes: number
  readonly removed: string[]
}

export async function backupDatabase(
  sqlite: Database.Database,
  directory: string,
): Promise<BackupResult> {
  await mkdir(directory, { recursive: true })

  // Nome ordenável por data: quem lista a pasta vê a ordem sem abrir nada.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const file = join(directory, `${PREFIX}${stamp}.db`)
  const { totalPages, ...rest } = await sqlite.backup(file)
  void rest

  const removed = await prune(directory)
  return { file, bytes: totalPages * 4096, removed }
}

/** Apaga as cópias que passaram do limite, das mais velhas para as mais novas. */
async function prune(directory: string): Promise<string[]> {
  const files = (await readdir(directory))
    .filter((name) => name.startsWith(PREFIX) && name.endsWith('.db'))
    .sort()

  const excess = files.slice(0, Math.max(0, files.length - KEEP))
  for (const name of excess) await unlink(join(directory, name))
  return excess
}

/** As cópias existentes, da mais nova para a mais velha. */
export async function listBackups(directory: string): Promise<string[]> {
  try {
    return (await readdir(directory))
      .filter((name) => name.startsWith(PREFIX) && name.endsWith('.db'))
      .sort()
      .reverse()
  } catch {
    // Pasta que nunca existiu não é erro: é backup que nunca foi feito.
    return []
  }
}
