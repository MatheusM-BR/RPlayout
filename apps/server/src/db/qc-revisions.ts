import type Database from 'better-sqlite3'
import { randomInt } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type { Db } from './client.js'
import { qcReviewVersions } from './schema.js'

const maximum = Number.MAX_SAFE_INTEGER
const tableSql = `CREATE TABLE qc_review_versions(asset_id TEXT PRIMARY KEY NOT NULL,
  version INTEGER NOT NULL CHECK(typeof(version)='integer' AND version BETWEEN 1 AND ${maximum}))`
const bump = (id: string) => `INSERT INTO qc_review_versions VALUES(${id},1)
  ON CONFLICT(asset_id) DO UPDATE SET version=version+1;`
const triggers: Record<string, string> = {}
for (const table of ['media_assets', 'qc_decisions']) for (const action of ['INSERT', 'UPDATE', 'DELETE']) {
  const field = table === 'media_assets' ? 'id' : 'asset_id', row = action === 'DELETE' ? 'OLD' : 'NEW'
  triggers[`qc_review_${table}_${action.toLowerCase()}`] = `${action === 'DELETE' ? 'BEFORE' : 'AFTER'} ${action} ON ${table} BEGIN
    ${action === 'UPDATE' ? `INSERT INTO qc_review_versions SELECT OLD.${field},1 WHERE OLD.${field}<>NEW.${field} ON CONFLICT(asset_id) DO UPDATE SET version=version+1;` : ''}
    ${bump(`${row}.${field}`)} END`
}
const normalize = (sql: string) => sql.replace(/\s+/g, ' ').trim()
export function validateQcRevisions(sqlite: Database.Database): void {
  if (!sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get() || !sqlite.prepare('SELECT 1 FROM schema_migrations WHERE version=23').get()) return
  const table = sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='qc_review_versions'").get() as { sql: string } | undefined
  if (!table || normalize(table.sql) !== normalize(tableSql)) throw new Error('Contrato das revisões QC ausente ou alterado. Restaure um backup validado.')
  for (const [name, body] of Object.entries(triggers)) {
    const stored = sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?").get(name) as { sql: string } | undefined
    if (!stored || normalize(stored.sql) !== normalize(`CREATE TRIGGER ${name} ${body}`)) throw new Error(`Proteção QC ${name} ausente ou alterada. Restaure um backup validado.`)
  }
  if (sqlite.prepare("SELECT 1 FROM qc_review_versions WHERE typeof(version)<>'integer' OR version<1 OR version>? LIMIT 1").get(maximum)) throw new Error('Revisão QC inválida.')
  if (sqlite.prepare('SELECT 1 FROM media_assets a WHERE NOT EXISTS(SELECT 1 FROM qc_review_versions v WHERE v.asset_id=a.id) LIMIT 1').get()) throw new Error('Revisões QC incompletas.')
}
export function migrateQcRevisions(sqlite: Database.Database): void {
  if (!sqlite.prepare('SELECT 1 FROM schema_migrations WHERE version=23').get()) sqlite.transaction(() => {
    const baseline = randomInt(2 ** 40, 2 ** 48)
    sqlite.exec(`${tableSql}; INSERT INTO qc_review_versions SELECT id,${baseline} FROM media_assets;`)
    for (const [name, body] of Object.entries(triggers)) sqlite.exec(`CREATE TRIGGER ${name} ${body}`)
    sqlite.prepare('INSERT INTO schema_migrations VALUES(23,?,?)').run('durable-qc-review-revisions', new Date().toISOString())
  })()
  validateQcRevisions(sqlite)
}
/** Tombstones intentionally have no asset FK: removal/reinsertion isn't ABA. */
export function qcRevision(db: Pick<Db, 'select'>, assetId: string): number {
  const row = db.select().from(qcReviewVersions).where(eq(qcReviewVersions.assetId, assetId)).get()
  if (!row || !Number.isSafeInteger(row.version) || row.version < 1) throw new Error('Revisão QC ausente/inválida; nenhuma versão será presumida.')
  return row.version
}
