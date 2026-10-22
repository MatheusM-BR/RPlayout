import type Database from 'better-sqlite3'

// The factory catalog is shared, not owned by a channel named "G". Existing
// installations are adopted as-is: absence may represent an intentional delete.
const table = `CREATE TABLE graphics_initialization(scope TEXT PRIMARY KEY NOT NULL CHECK(scope='G'),state TEXT NOT NULL CHECK(state IN ('PENDING','INITIALIZED')),initialized_at TEXT,CHECK((state='PENDING' AND initialized_at IS NULL) OR (state='INITIALIZED' AND typeof(initialized_at)='text' AND length(initialized_at)>0)))`
const triggers = {
  graphics_initialization_no_reset: `BEFORE UPDATE ON graphics_initialization WHEN OLD.state='INITIALIZED' BEGIN SELECT RAISE(ABORT,'Factory graphics initialization cannot be reset'); END`,
  graphics_initialization_no_delete: `BEFORE DELETE ON graphics_initialization BEGIN SELECT RAISE(ABORT,'Factory graphics initialization cannot be deleted'); END`,
}
const normalize = (value: string) => value.replace(/\s+/g, ' ').trim()

export function validateGraphicsInitialization(sqlite: Database.Database): void {
  if (!sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get() || !sqlite.prepare('SELECT 1 FROM schema_migrations WHERE version=29').get()) return
  const saved = sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='graphics_initialization'").get() as {sql: string} | undefined
  if (!saved || normalize(saved.sql) !== normalize(table)) throw new Error('Registro de inicialização das artes ausente ou adulterado. Restaure backup validado.')
  for (const [name, body] of Object.entries(triggers)) {
    const saved = sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?").get(name) as {sql: string} | undefined
    if (!saved || normalize(saved.sql) !== normalize(`CREATE TRIGGER ${name} ${body}`)) throw new Error('Proteção da inicialização das artes ausente ou adulterada.')
  }
  const rows = sqlite.prepare('SELECT * FROM graphics_initialization').all() as {scope: string; state: string; initialized_at: unknown}[]
  const row = rows[0]
  if (rows.length !== 1 || row?.scope !== 'G' || !(row.state === 'PENDING' && row.initialized_at === null || row.state === 'INITIALIZED' && typeof row.initialized_at === 'string' && row.initialized_at.length > 0)) throw new Error('Registro de inicialização das artes incompleto ou inválido; nenhuma recriação presumida.')
}

export function migrateGraphicsInitialization(sqlite: Database.Database, freshDatabase: boolean): void {
  sqlite.transaction(() => {
    if (sqlite.prepare('SELECT 1 FROM schema_migrations WHERE version=29').get()) return
    sqlite.exec(`${table};`)
    sqlite.prepare('INSERT INTO graphics_initialization VALUES(?,?,?)').run('G', freshDatabase ? 'PENDING' : 'INITIALIZED', freshDatabase ? null : new Date().toISOString())
    for (const [name, body] of Object.entries(triggers)) sqlite.exec(`CREATE TRIGGER ${name} ${body}`)
    sqlite.prepare('INSERT INTO schema_migrations VALUES(29,?,?)').run('once-only-factory-graphics-initialization', new Date().toISOString())
  }).immediate()
  validateGraphicsInitialization(sqlite)
}
