import { mkdir, readdir, unlink, mkdtemp, stat, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { validateDatabaseSecrets } from '../db/vault-migration.js'
import {validateAudioBus} from '../db/audio-bus.js'
import {validateChannelConfiguration} from '../db/channel-configuration.js'
import {validatePresetConfiguration} from '../db/preset-configuration.js'
import {validateQcRevisions} from '../db/qc-revisions.js'
import {validateEditorialRevisions} from '../db/editorial-revisions.js'
import {validateTrimCadence} from '../db/trim-cadence.js'

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
  readonly validation: RestoreValidation
}

export interface RestoreValidation {
  readonly integrity: 'ok'
  readonly foreignKeys: 'ok'
  readonly tables: Readonly<Record<string, number>>
  readonly restoredAt: string
  readonly protectedSecrets: 'verified' | 'not-present'
  readonly vaultFingerprint?: string
  readonly keyRecovery?: string
}

/** Exercises SQLite restore in a new isolated database, never the live path. */
export async function validateBackupRestore(file: string): Promise<RestoreValidation> {
  const directory = await mkdtemp(join(tmpdir(), 'rplayout-restore-check-'))
  let source: Database.Database | null = null
  let restored: Database.Database | null = null
  try {
    source = new Database(file, { readonly: true, fileMustExist: true })
    await source.backup(join(directory, 'restored.db'))
    restored = new Database(join(directory, 'restored.db'), { readonly: true, fileMustExist: true })
    const integrity = restored.pragma('integrity_check', { simple: true })
    if (integrity !== 'ok') throw new Error(`Backup não restaurável: ${String(integrity)}`)
    if ((restored.pragma('foreign_key_check') as unknown[]).length > 0) throw new Error('Backup contém referências inválidas (foreign keys).')
    const tables: Record<string, number> = {}
    for (const row of restored.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as Array<{ name: string }>) {
      const identifier = '"' + row.name.replaceAll('"', '""') + '"'
      const count = (restored.prepare(`SELECT count(*) AS n FROM ${identifier}`).get() as { n: number }).n
      const original = (source.prepare(`SELECT count(*) AS n FROM ${identifier}`).get() as { n: number }).n
      if (count !== original) throw new Error(`Restauração incompleta da tabela ${row.name}.`)
      tables[row.name] = count
    }
    const secrets = validateDatabaseSecrets(restored)
    validateEditorialRevisions(restored)
    validateTrimCadence(restored)
    validateAudioBus(restored)
    validateChannelConfiguration(restored)
    validatePresetConfiguration(restored)
    validateQcRevisions(restored)
    return { integrity: 'ok', foreignKeys: 'ok', tables, restoredAt: new Date().toISOString(), ...secrets,
      ...(secrets.protectedSecrets === 'verified' ? { keyRecovery: 'Preserve a chave fora do banco. No Windows, vault.json só pode ser aberto pelo usuário Windows original; outra máquina/conta exige RPLAYOUT_VAULT_KEY compartilhada previamente configurada.' } : {}),
    }
  } finally {
    restored?.close(); source?.close()
    // Exact new temporary directory owned by this validation, not media/backups.
    await rm(directory, { recursive: true, force: true })
  }
}

export async function backupDatabase(
  sqlite: Database.Database,
  directory: string,
): Promise<BackupResult> {
  await mkdir(directory, { recursive: true })

  // Nome ordenável por data: quem lista a pasta vê a ordem sem abrir nada.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const file = join(directory, `${PREFIX}${stamp}-${randomUUID()}.db`)
  await sqlite.backup(file)
  const validation = await validateBackupRestore(file)

  const removed = await prune(directory)
  return { file, bytes: (await stat(file)).size, removed, validation }
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
