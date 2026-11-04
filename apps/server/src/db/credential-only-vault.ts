import type Database from 'better-sqlite3'
import { installationVault, type SecretVault } from '../domain/secret-vault.js'
import { sanitizeDiagnostic } from '../domain/sanitize-diagnostic.js'
import { formerlyProtectedColumns, protectedColumns, vaultPolicy, isEnvelope, needsEnvelope } from './protected-columns.js'
import { protectedColumnRows } from './vault-migration.js'

/** Migração 58 (r88-37): o cofre passa a cifrar só credencial.
 *
 * 1. Abre, com a chave atual, os envelopes das colunas que deixaram de ser
 *    segredo (e das colunas de credencial cujo valor não tem credencial, como
 *    um endereço NDI/OMT) e grava o texto em claro. Valor que embute
 *    credencial continua envelope.
 * 2. Cria `vault_recovery`: a chave embrulhada pela senha de recuperação, que
 *    viaja dentro de todo backup.
 *
 * Não reescreve `operator_decisions`: a auditoria é append-only (gatilhos de
 * imutabilidade, comandos de grafismo) e os selos de segurança são hash do
 * valor gravado. O histórico antigo continua envelope e abre com a chave, que
 * agora é recuperável pela senha; os registros novos já nascem em claro.
 *
 * Os gatilhos de revisão das tabelas tocadas (contadores editoriais, de
 * configuração, de projeto) são retirados e recriados com o MESMO texto dentro
 * da transação: trocar a codificação de um valor não é edição e não pode
 * invalidar grade publicada, ETags ou revisões abertas. */
export const VAULT_RECOVERY_TABLE = 'CREATE TABLE vault_recovery(id INTEGER PRIMARY KEY CHECK(id=1),payload TEXT NOT NULL,revision INTEGER NOT NULL CHECK(revision>0),updated_at TEXT NOT NULL)'
const appendOnly = new Set(['operator_decisions'])
const normalize = (text: string) => text.replace(/\s+/g, ' ').trim()

export function validateCredentialOnlyVault(sqlite: Database.Database) {
  const marked = sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name='schema_migrations' AND type='table'").get() && sqlite.prepare('SELECT 1 FROM schema_migrations WHERE version=58').get()
  const found = sqlite.prepare("SELECT sql FROM sqlite_master WHERE name='vault_recovery' AND type='table'").get() as { sql: string } | undefined
  if (!marked) { if (found) throw new Error('Recuperação do cofre sem registro de migração; preserve o banco.'); return }
  if (!found || normalize(found.sql) !== VAULT_RECOVERY_TABLE) throw new Error('Schema da recuperação do cofre ausente/adulterado.')
}

export interface ClearColumnsReport { cleared: Record<string, number>; keptEnvelope: Record<string, number> }

/** Converte envelopes para texto normal onde a política permite. Exportada
 * para os testes; a partida usa `migrateCredentialOnlyVault`. */
export function clearNonSecretEnvelopes(sqlite: Database.Database): ClearColumnsReport {
  const report: ClearColumnsReport = { cleared: {}, keptEnvelope: {} }
  const columns = [...protectedColumns, ...formerlyProtectedColumns].filter(([table, column]) => vaultPolicy(`${table}.${column}`) === 'IF_CREDENTIAL' && !appendOnly.has(table))
  let vault: SecretVault | null = null
  const updates: Array<{ table: string; column: string; rowId: number; value: string }> = []
  for (const [table, column] of columns) {
    if (!sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name=? AND type='table'").get(table)) continue
    if (!(sqlite.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>).some(row => row.name === column)) continue
    const context = `${table}.${column}`
    for (const row of protectedColumnRows(sqlite, table, column)) {
      if (!isEnvelope(row.value)) continue
      vault ??= installationVault(false)
      let plain = vault.decrypt(row.value, context)
      if (context === 'health_events.message') plain = sanitizeDiagnostic(plain)
      if (needsEnvelope(plain, context)) { report.keptEnvelope[context] = (report.keptEnvelope[context] ?? 0) + 1; continue }
      updates.push({ table, column, rowId: row.row_id, value: plain })
    }
  }
  if (!updates.length) return report
  const tables = [...new Set(updates.map(row => row.table))]
  const triggers = sqlite.prepare(`SELECT name, sql FROM sqlite_master WHERE type='trigger' AND sql IS NOT NULL AND tbl_name IN (${tables.map(() => '?').join(',')}) ORDER BY rowid`).all(...tables) as Array<{ name: string; sql: string }>
  for (const trigger of triggers) sqlite.exec(`DROP TRIGGER "${trigger.name.replaceAll('"', '""')}"`)
  for (const row of updates) {
    if (sqlite.prepare(`UPDATE "${row.table}" SET "${row.column}"=? WHERE rowid=?`).run(row.value, row.rowId).changes !== 1) throw new Error('Conversão do cofre não confirmou a linha; banco preservado.')
    const key = `${row.table}.${row.column}`
    report.cleared[key] = (report.cleared[key] ?? 0) + 1
  }
  for (const trigger of triggers) sqlite.exec(trigger.sql)
  const restored = sqlite.prepare(`SELECT count(*) AS n FROM sqlite_master WHERE type='trigger' AND tbl_name IN (${tables.map(() => '?').join(',')})`).get(...tables) as { n: number }
  if (restored.n !== triggers.length) throw new Error('Gatilhos não recriados na conversão do cofre; banco preservado.')
  return report
}

export function migrateCredentialOnlyVault(sqlite: Database.Database): ClearColumnsReport | null {
  const report = sqlite.transaction(() => {
    if (sqlite.prepare('SELECT 1 FROM schema_migrations WHERE version=58').get()) return null
    validateCredentialOnlyVault(sqlite)
    const result = clearNonSecretEnvelopes(sqlite)
    sqlite.exec(VAULT_RECOVERY_TABLE)
    sqlite.prepare('INSERT INTO schema_migrations VALUES(58,?,?)').run('credential-only-vault-and-recovery', new Date().toISOString())
    return result
  }).immediate()
  validateCredentialOnlyVault(sqlite)
  return report
}
