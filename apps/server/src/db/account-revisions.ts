import type Database from 'better-sqlite3'
import {randomInt} from 'node:crypto'
const maximum = Number.MAX_SAFE_INTEGER
const table = `CREATE TABLE account_versions(scope TEXT PRIMARY KEY NOT NULL CHECK(scope='G' OR ((scope LIKE 'U:%' OR scope LIKE 'S:%') AND length(scope)>2)),version INTEGER NOT NULL CHECK(typeof(version)='integer' AND version BETWEEN 1 AND ${maximum}))`
const bump = (scope: string) => `INSERT INTO account_versions VALUES(${scope},1) ON CONFLICT(scope) DO UPDATE SET version=version+1;`
const triggers: Record<string,string> = {}
for (const [target, key] of [['users','id'],['user_access','user_id'],['sessions','user_id']] as const) for (const action of ['INSERT','UPDATE','DELETE'] as const) {
  const prefix = target === 'sessions' ? 'S:' : 'U:', row = action === 'DELETE' ? 'OLD' : 'NEW'
  const body = `${target === 'sessions' ? '' : bump("'G'")}
    ${action === 'UPDATE' ? `INSERT INTO account_versions SELECT '${prefix}'||OLD.${key},1 WHERE OLD.${key} IS NOT NEW.${key} ON CONFLICT(scope) DO UPDATE SET version=version+1;` : ''}
    ${bump(`'${prefix}'||${row}.${key}`)}
    ${target === 'users' ? `INSERT OR IGNORE INTO account_versions VALUES('S:'||${row}.${key},1);` : ''}`
  triggers[`account_revision_${target}_${action.toLowerCase()}`] = `${action === 'INSERT' ? 'AFTER' : 'BEFORE'} ${action} ON ${target} BEGIN ${body} END`
}
const normalize = (value: string) => value.replace(/\s+/g,' ').trim()
export function validateAccountRevisions(sqlite: Database.Database): void {
  if (!sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get() || !sqlite.prepare('SELECT 1 FROM schema_migrations WHERE version=30').get()) return
  const saved = sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='account_versions'").get() as {sql:string} | undefined
  if (!saved || normalize(saved.sql) !== normalize(table)) throw new Error('Revisões de contas ausentes ou adulteradas. Restaure backup validado.')
  for (const [name,body] of Object.entries(triggers)) {
    const saved = sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?").get(name) as {sql:string} | undefined
    if (!saved || normalize(saved.sql) !== normalize(`CREATE TRIGGER ${name} ${body}`)) throw new Error('Proteção das revisões de contas ausente ou adulterada.')
  }
  if (sqlite.prepare("SELECT 1 FROM account_versions WHERE typeof(version)<>'integer' OR version<1 OR version>? OR NOT(scope='G' OR ((scope LIKE 'U:%' OR scope LIKE 'S:%') AND length(scope)>2)) LIMIT 1").get(maximum)) throw new Error('Revisão de contas inválida.')
  for (const {scope} of [{scope:'G'},...sqlite.prepare("SELECT 'U:'||id AS scope FROM users UNION SELECT 'S:'||id FROM users UNION SELECT 'U:'||user_id FROM user_access UNION SELECT 'S:'||user_id FROM sessions").all() as {scope:string}[]]) {
    if (!sqlite.prepare('SELECT 1 FROM account_versions WHERE scope=?').get(scope)) throw new Error('Revisões de contas incompletas.')
  }
}
export function migrateAccountRevisions(sqlite: Database.Database): void {
  sqlite.transaction(() => {
    if (sqlite.prepare('SELECT 1 FROM schema_migrations WHERE version=30').get()) return
    const baseline = randomInt(2**40,2**48)
    sqlite.exec(`${table};`)
    sqlite.prepare('INSERT INTO account_versions VALUES(?,?)').run('G',baseline)
    sqlite.exec(`INSERT OR IGNORE INTO account_versions SELECT 'U:'||id,${baseline} FROM users;
      INSERT OR IGNORE INTO account_versions SELECT 'S:'||id,${baseline} FROM users;
      INSERT OR IGNORE INTO account_versions SELECT 'U:'||user_id,${baseline} FROM user_access;
      INSERT OR IGNORE INTO account_versions SELECT 'S:'||user_id,${baseline} FROM sessions;`)
    for (const [name,body] of Object.entries(triggers)) sqlite.exec(`CREATE TRIGGER ${name} ${body}`)
    sqlite.prepare('INSERT INTO schema_migrations VALUES(30,?,?)').run('durable-account-and-session-reviews',new Date().toISOString())
  }).immediate()
  validateAccountRevisions(sqlite)
}
export function accountRevision(sqlite: Database.Database, scope: string): number {
  const row = sqlite.prepare('SELECT version FROM account_versions WHERE scope=?').get(scope) as {version:number} | undefined
  if (!row || !Number.isSafeInteger(row.version) || row.version < 1) throw new Error('Revisão de contas ausente/inválida; nenhuma versão presumida.')
  return row.version
}
