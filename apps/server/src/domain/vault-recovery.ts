import type Database from 'better-sqlite3'
import { dirname, join, resolve } from 'node:path'
import { installationVault, installationVaultProtection, parseRecoveryRecord, type RecoveryCost, type RecoveryRecord } from './secret-vault.js'
import { writePrivateConfig } from './private-config-file.js'

/** Senha de recuperação do cofre (r88-37).
 *
 * A chave de 32 bytes da instalação continua protegida pelo DPAPI do usuário
 * Windows (vault.json). Além disso, quando o administrador cadastra uma senha
 * de recuperação, a mesma chave fica embrulhada por ela (scrypt + AES-256-GCM)
 * em `vault_recovery` -- dentro do banco, logo dentro de todo backup -- e em
 * `vault-recovery.json` na pasta de dados. Em outra máquina, quem digita a
 * senha abre a chave e a ferramenta de restauração a re-embrulha com o DPAPI
 * local. A senha nunca é gravada, registrada em log nem devolvida. */
export const VAULT_RECOVERY_FILE = 'vault-recovery.json'
export const NOT_PORTABLE_WARNING = 'Backup não restaurável em outra máquina: cadastre a senha de recuperação do cofre.'

export type RecoveryState = 'ABSENT' | 'CONFIGURED' | 'MISMATCH'
export interface StoredRecovery { state: RecoveryState; revision: number; updatedAt: string | null; record: RecoveryRecord | null }

const hasTable = (sqlite: Database.Database) => !!sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name='vault_recovery' AND type='table'").get()

/** Lê o registro sem abrir nada. `MISMATCH`: embrulha outra chave (não serve). */
export function readVaultRecovery(sqlite: Database.Database, fingerprint: string): StoredRecovery {
  if (!hasTable(sqlite)) return { state: 'ABSENT', revision: 0, updatedAt: null, record: null }
  const row = sqlite.prepare('SELECT payload, revision, updated_at FROM vault_recovery WHERE id=1').get() as { payload: string; revision: number; updated_at: string } | undefined
  if (!row) return { state: 'ABSENT', revision: 0, updatedAt: null, record: null }
  const record = parseRecoveryRecord(row.payload)
  return { state: record.fingerprint === fingerprint ? 'CONFIGURED' : 'MISMATCH', revision: row.revision, updatedAt: row.updated_at, record }
}

/** Registro embrulhado de um backup, para a restauração em outra máquina. */
export function backupRecoveryRecord(sqlite: Database.Database): RecoveryRecord | null {
  if (!hasTable(sqlite)) return null
  const row = sqlite.prepare('SELECT payload FROM vault_recovery WHERE id=1').get() as { payload: string } | undefined
  return row ? parseRecoveryRecord(row.payload) : null
}

export const vaultRecoveryETag = (revision: number) => `"vault-recovery:${revision}"`

export interface VaultRecoveryStatus {
  configured: boolean; state: RecoveryState; revision: number; updatedAt: string | null
  localProtection: ReturnType<typeof installationVaultProtection>
  restorableElsewhere: boolean; warning: string | null
}
/** Status público: nada de senha, sal, chave, impressão ou texto cifrado. */
export function vaultRecoveryStatus(sqlite: Database.Database): VaultRecoveryStatus {
  const stored = readVaultRecovery(sqlite, installationVault(false).fingerprint)
  const restorable = stored.state === 'CONFIGURED' || installationVaultProtection() === 'ENVIRONMENT'
  return {
    configured: stored.state === 'CONFIGURED', state: stored.state, revision: stored.revision, updatedAt: stored.updatedAt,
    localProtection: installationVaultProtection(), restorableElsewhere: restorable,
    warning: stored.state === 'MISMATCH' ? 'Registro de recuperação pertence a outra chave; cadastre a senha de novo. ' + NOT_PORTABLE_WARNING : restorable ? null : NOT_PORTABLE_WARNING,
  }
}

export class VaultRecoveryConflict extends Error {}

export function recoveryFilePath(databaseFile: string) { return join(dirname(resolve(databaseFile)), VAULT_RECOVERY_FILE) }

/** Define/troca a senha. O custo do scrypt é pago antes da transação; a
 * gravação confere a revisão (If-Match) sob o lock de escrita. */
export async function setVaultRecoveryPassword(sqlite: Database.Database, input: {
  password: string; expectedRevision: number; actor: string | null; databaseFile: string | null; cost?: RecoveryCost; audit?: (revision: number) => void
}): Promise<{ revision: number; updatedAt: string; fileWritten: boolean }> {
  const vault = installationVault(false)
  const record = await vault.wrapForRecovery(input.password, input.cost)
  const updatedAt = new Date().toISOString()
  const revision = sqlite.transaction(() => {
    if (!hasTable(sqlite)) throw new VaultRecoveryConflict('Banco sem a migração da recuperação do cofre.')
    const current = readVaultRecovery(sqlite, vault.fingerprint)
    if (current.revision !== input.expectedRevision) throw new VaultRecoveryConflict('A senha de recuperação mudou desde a leitura; recarregue antes de trocar.')
    const next = current.revision + 1
    sqlite.prepare('INSERT INTO vault_recovery(id,payload,revision,updated_at) VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,revision=excluded.revision,updated_at=excluded.updated_at')
      .run(JSON.stringify(record), next, updatedAt)
    input.audit?.(next)
    return next
  }).immediate()
  let fileWritten = false
  if (input.databaseFile && input.databaseFile !== ':memory:') {
    // Cópia fora do banco (mesma pasta de dados). O banco é a fonte: o backup
    // leva o registro mesmo que esta cópia falhe.
    await writePrivateConfig(recoveryFilePath(input.databaseFile), JSON.stringify({ kind: 'rplayout-vault-recovery', record, revision, updatedAt }, null, 2))
    fileWritten = true
  }
  return { revision, updatedAt, fileWritten }
}
