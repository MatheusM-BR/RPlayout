import type Database from 'better-sqlite3'
import { installationVault, SECRET_PREFIX } from '../domain/secret-vault.js'
import { envelopeColumns, protectedColumns, needsEnvelope, isEnvelope } from './protected-columns.js'

function hasIncidentContextColumn(sqlite:Database.Database){
  const exists=(sqlite.prepare('PRAGMA table_info(health_events)').all() as {name:string}[]).some(row=>row.name==='context')
  if(!exists&&sqlite.prepare('SELECT 1 FROM schema_migrations WHERE version=48').get())throw new Error('Backup protegido incompleto: falta contexto de incidentes.')
  return exists
}

/** Protected columns can hold tens of megabytes (one audit row per HTTP
 * mutation). The storage process answers through a fixed shared buffer, so a
 * single SELECT of a whole column failed startup once the audit grew past it.
 * Read by rowid pages; the result is the same rows in the same order. */
export function protectedColumnRows(sqlite:Database.Database,table:string,column:string,budgetBytes=4*2**20):Array<{row_id:number;value:string}>{
  // Plan each page from value lengths (small reply), then fetch a rowid range
  // whose values fit the budget. A too-large reply poisons the storage
  // connection, so it must be avoided, not retried.
  const sizes=sqlite.prepare(`SELECT rowid AS row_id, length("${column}") AS bytes FROM "${table}" WHERE "${column}" IS NOT NULL AND rowid > ? ORDER BY rowid LIMIT 5000`)
  const values=sqlite.prepare(`SELECT rowid AS row_id, "${column}" AS value FROM "${table}" WHERE "${column}" IS NOT NULL AND rowid >= ? AND rowid <= ? ORDER BY rowid`)
  const rows:Array<{row_id:number;value:string}>=[]
  let last=Number.MIN_SAFE_INTEGER
  for(;;){
    const plan=sizes.all(last) as Array<{row_id:number;bytes:number}>
    if(!plan.length)return rows
    let total=0,end=0
    while(end<plan.length&&(end===0||total+plan[end]!.bytes<=budgetBytes)){total+=plan[end]!.bytes;end++}
    const first=plan[0]!.row_id,lastPlanned=plan[end-1]!.row_id
    rows.push(...values.all(first,lastPlanned) as Array<{row_id:number;value:string}>)
    last=lastPlanned
  }
}

export function validateDatabaseSecrets(sqlite: Database.Database): { protectedSecrets: 'verified' | 'not-present'; vaultFingerprint?: string } {
  if (!sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name='vault_metadata' AND type='table'").get()) return { protectedSecrets: 'not-present' }
  const metadata = sqlite.prepare('SELECT key_fingerprint, scrub_pending FROM vault_metadata WHERE id=1').get() as { key_fingerprint: string; scrub_pending: number } | undefined
  const vault = installationVault(false)
  if (!metadata || metadata.key_fingerprint !== vault.fingerprint) throw new Error('Backup protegido requer a chave original da instalação.')
  if (metadata.scrub_pending) throw new Error('Limpeza de valores antigos pendente; conclua a migração antes do backup.')
  // Todo envelope, em qualquer coluna que já foi protegida, é autenticado com a
  // chave (backup antigo, histórico append-only). Texto em claro só é aceito
  // onde a política permite: credencial em claro é backup incompleto.
  for (const [table, column] of envelopeColumns) {
    if (!sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name=? AND type='table'").get(table)) {
      const introduced = table==='channel_cadence_conversions' ? 16 : table==='secondary_events' ? 11 : table==='integration_deliveries' ? 10 : null
      // Authenticate an older protected backup before schema upgrades. A
      // table absent despite its recorded migration is corruption, not legacy.
      if (introduced && !sqlite.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(introduced)) continue
      throw new Error('Backup protegido está incompleto: falta tabela '+table+'.')
    }
    const legacyDiagnostic = table === 'health_events' && !sqlite.prepare('SELECT 1 FROM schema_migrations WHERE version=12').get()
    if(table==='health_events'&&column==='context'&&!hasIncidentContextColumn(sqlite))continue
    const context = `${table}.${column}`
    for (const row of protectedColumnRows(sqlite, table, column)) {
      if (isEnvelope(row.value)) { vault.decrypt(row.value, context); continue }
      if (legacyDiagnostic) continue
      if (needsEnvelope(row.value, context)) throw new Error('Backup contém credencial sem proteção em '+context+'; conclua a migração do cofre antes do backup.')
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
    const read = (columns: readonly (readonly [string, string])[]) => columns.map(([table, column]) => ({
      table, column,
      values: !sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name=? AND type='table'").get(table)||table==='health_events'&&column==='context'&&!hasIncidentContextColumn(sqlite)?[]:protectedColumnRows(sqlite, table, column),
    }))
    const rows = read(protectedColumns)
    // Envelopes antigos em colunas que deixaram de ser segredo também provam
    // que existe uma chave: nunca criar chave nova por cima deles.
    const former = read(envelopeColumns.filter(([table,column]) => !protectedColumns.some(([t,c]) => t===table&&c===column)))
    const hasEncrypted = [...rows, ...former].some(field => field.values.some(row => isEnvelope(row.value)))
    const vault = installationVault(!metadata && !hasEncrypted)
    if (metadata && metadata.key_fingerprint !== vault.fingerprint) throw new Error('Chave do cofre incompatível com este banco. Restaure a chave original; os dados não foram substituídos.')
    for (const field of [...rows, ...former]) for (const row of field.values) {
      if (isEnvelope(row.value)) vault.decrypt(row.value, `${field.table}.${field.column}`)
    }
    // Só credencial em claro precisa de envelope; endereço NDI/OMT ou caminho
    // de arquivo é texto normal e não dispara regravação nem limpeza.
    const hasPlaintext = rows.some(field => field.values.some(row => needsEnvelope(row.value, `${field.table}.${field.column}`)))
    // Normal reopening authenticates without rewriting metadata unnecessarily.
    if(metadata && !hasPlaintext && sqlite.prepare('SELECT 1 FROM schema_migrations WHERE version=9').get() && sqlite.prepare('SELECT 1 FROM schema_migrations WHERE version=12').get())return Boolean(metadata.scrub_pending)
    sqlite.exec('CREATE TABLE IF NOT EXISTS vault_metadata (id INTEGER PRIMARY KEY CHECK(id=1), key_fingerprint TEXT NOT NULL, scrub_pending INTEGER NOT NULL)')
    for (const field of rows) {
      if(!field.values.length)continue
      const context = `${field.table}.${field.column}`
      const update = sqlite.prepare(`UPDATE "${field.table}" SET "${field.column}"=? WHERE rowid=?`)
      for (const row of field.values) if (needsEnvelope(row.value, context)) update.run(vault.encrypt(row.value, context), row.row_id)
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
