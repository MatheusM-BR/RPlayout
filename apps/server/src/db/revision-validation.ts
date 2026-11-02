import type Database from 'better-sqlite3'

/** Read-only compatibility gate: old databases may omit the whole migration,
 * but a partial migration must never be mistaken for a legitimate old backup. */
export function hasRevisionMigration(sqlite: Database.Database, version: number, tables: readonly string[]): boolean {
  const migrations = sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get()
  if (migrations && sqlite.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(version)) return true
  if (tables.some(name => sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name))) {
    throw new Error(`Migração de revisões ${version} incompleta: registro ausente.`)
  }
  return false
}

export function validateSingletonRevision(sqlite: Database.Database, table: string, message: string): void {
  // Identifiers are fixed module constants, never a request or backup field.
  const rows = sqlite.prepare(`SELECT singleton,version FROM ${table}`).all() as {singleton: number; version: number}[]
  if (rows.length !== 1 || rows[0]!.singleton !== 1 || !Number.isSafeInteger(rows[0]!.version) || rows[0]!.version < 1) {
    throw new Error(message)
  }
}
