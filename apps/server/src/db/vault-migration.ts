import type Database from 'better-sqlite3'
import { installationVault, SECRET_PREFIX } from '../domain/secret-vault.js'
import { protectedColumns } from './protected-columns.js'

function hasIncidentContextColumn(sqlite:Database.Database){
  const exists=(sqlite.prepare('PRAGMA table_info(health_events)').all() as {name:string}[]).some(row=>row.name==='context')
  if(!exists&&sqlite.prepare('SELECT 1 FROM schema_migrations WHERE version=48').get())throw new Error('Backup protegido incompleto: falta contexto de incidentes.')
  return exists
}

export function validateDatabaseSecrets(sqlite: Database.Database): { protectedSecrets: 'verified' | 'not-present'; vaultFingerprint?: string } {
  if (!sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name='vault_metadata' AND type='table'").get()) return { protectedSecrets: 'not-present' }
  const metadata = sqlite.prepare('SELECT key_fingerprint, scrub_pending FROM vault_metadata WHERE id=1').get() as { key_fingerprint: string; scrub_pending: number } | undefined
  const vault = installationVault(false)
  if (!metadata || metadata.key_fingerprint !== vault.fingerprint) throw new Error('Backup protegido requer a chave original da instalação.')
  if (metadata.scrub_pending) throw new Error('Limpeza de valores antigos pendente; conclua a migração antes do backup.')
  for (const [table, column] of protectedColumns) {
    if (!sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name=? AND type='table'").get(table)) {
      const introduced = table==='channel_cadence_conversions' ? 16 : table==='secondary_events' ? 11 : table==='integration_deliveries' ? 10 : null
      // Authenticate an older protected backup before schema upgrades. A
      // table absent despite its recorded migration is corruption, not legacy.
      if (introduced && !sqlite.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(introduced)) continue
      throw new Error('Backup protegido está incompleto: falta tabela '+table+'.')
    }
    const legacyDiagnostic = table === 'health_events' && !sqlite.prepare('SELECT 1 FROM schema_migrations WHERE version=12').get()
    if(table==='health_events'&&column==='context'&&!hasIncidentContextColumn(sqlite))continue
    for (const row of sqlite.prepare(`SELECT "${column}" AS value FROM "${table}" WHERE "${column}" IS NOT NULL`).all() as Array<{ value: string }>) {
      if (legacyDiagnostic && !row.value.startsWith(SECRET_PREFIX)) continue
      vault.decrypt(row.value, `${table}.${column}`)
    }
  }
  return { protectedSecrets: 'verified', vaultFingerprint: vault.fingerprint }
}

/** Called before application readers/writers start. A transaction preserves the
 * old database on failure; secure-delete + checkpoint + vacuum remove legacy
 * values from SQLite's free pages and journal, not just from selected rows. */
export function migrateSecretVault(sqlite: Database.Database,options:{deferCleanup?:boolean}={}) {
  sqlite.pragma('secure_delete = ON')
  // Acquire the write reservation before the first read. A deferred transaction
  // cannot upgrade an old WAL snapshot after another process commits.
  // Legacy rows must be read/authenticated/encrypted under this same lock too,
  // otherwise migration could overwrite a newer protected value.
  const cleanup=sqlite.transaction(() => {
    const hasMetadata = !!sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name='vault_metadata' AND type='table'").get()
    const metadata = hasMetadata ? sqlite.prepare('SELECT key_fingerprint, scrub_pending FROM vault_metadata WHERE id=1').get() as { key_fingerprint: string; scrub_pending: number } | undefined : undefined
    const rows = protectedColumns.map(([table, column]) => ({
      table, column,
      values: table==='health_events'&&column==='context'&&!hasIncidentContextColumn(sqlite)?[]:sqlite.prepare(`SELECT rowid AS row_id, "${column}" AS value FROM "${table}" WHERE "${column}" IS NOT NULL`).all() as Array<{ row_id: number; value: string }>,
    }))
    const hasEncrypted = rows.some(field => field.values.some(row => row.value.startsWith(SECRET_PREFIX)))
    const vault = installationVault(!metadata && !hasEncrypted)
    if (metadata && metadata.key_fingerprint !== vault.fingerprint) throw new Error('Chave do cofre incompatível com este banco. Restaure a chave original; os dados não foram substituídos.')
    for (const field of rows) for (const row of field.values) {
      if (row.value.startsWith(SECRET_PREFIX)) vault.decrypt(row.value, `${field.table}.${field.column}`)
    }
    const hasPlaintext = rows.some(field => field.values.some(row => !row.value.startsWith(SECRET_PREFIX)))
    // Normal reopening authenticates without rewriting metadata unnecessarily.
    if(metadata && !hasPlaintext && sqlite.prepare('SELECT 1 FROM schema_migrations WHERE version=9').get() && sqlite.prepare('SELECT 1 FROM schema_migrations WHERE version=12').get())return Boolean(metadata.scrub_pending)
    sqlite.exec('CREATE TABLE IF NOT EXISTS vault_metadata (id INTEGER PRIMARY KEY CHECK(id=1), key_fingerprint TEXT NOT NULL, scrub_pending INTEGER NOT NULL)')
    for (const field of rows) {
      if(!field.values.length)continue
      const update = sqlite.prepare(`UPDATE "${field.table}" SET "${field.column}"=? WHERE rowid=?`)
      for (const row of field.values) if (!row.value.startsWith(SECRET_PREFIX)) update.run(vault.encrypt(row.value, `${field.table}.${field.column}`), row.row_id)
    }
    sqlite.prepare('INSERT INTO vault_metadata VALUES (1,?,?) ON CONFLICT(id) DO UPDATE SET scrub_pending=max(scrub_pending,excluded.scrub_pending)').run(vault.fingerprint, hasPlaintext ? 1 : 0)
    sqlite.prepare('INSERT OR IGNORE INTO schema_migrations VALUES (9,?,?)').run('authenticated-secret-vault', new Date().toISOString())
    sqlite.prepare('INSERT OR IGNORE INTO schema_migrations VALUES (12,?,?)').run('protected-health-diagnostics', new Date().toISOString())
    return hasPlaintext || Boolean(metadata?.scrub_pending)
  }).immediate()
  if (cleanup&&!options.deferCleanup) finishVaultCleanup(sqlite)
  return cleanup
}
/** VACUUM must run after the admission/migration transaction commits. The
 * backend incarnation is already registered before this storage cleanup. */
export function finishVaultCleanup(sqlite:Database.Database){
    // Retry this cleanup on next startup if interrupted; never claim it finished
    // merely because the encrypted rows committed successfully.
    const checkpoint = sqlite.pragma('wal_checkpoint(TRUNCATE)') as Array<{ busy: number }>
    if (checkpoint.some(row => row.busy !== 0)) throw new Error('Migração protegida concluída, mas o banco está em uso por outro processo. Feche a outra instância para concluir a limpeza dos valores antigos.')
    sqlite.exec('VACUUM')
    sqlite.prepare('UPDATE vault_metadata SET scrub_pending=0 WHERE id=1').run()
    sqlite.pragma('wal_checkpoint(TRUNCATE)')
}
