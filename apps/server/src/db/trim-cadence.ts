import type Database from 'better-sqlite3'

const invalid = `NOT (
  (NEW.default_trim_rate_num IS NULL AND NEW.default_trim_rate_den IS NULL) OR
  (NEW.default_trim IS NOT NULL AND typeof(NEW.default_trim_rate_num)='integer'
   AND typeof(NEW.default_trim_rate_den)='integer' AND NEW.default_trim_rate_num>0
   AND NEW.default_trim_rate_den>0 AND NEW.default_trim_rate_num<=9007199254740991
   AND NEW.default_trim_rate_den<=9007199254740991
   AND NEW.default_trim_rate_num>=NEW.default_trim_rate_den
   AND NEW.default_trim_rate_num<=240.0*NEW.default_trim_rate_den)
)`
const triggers = Object.fromEntries(['INSERT','UPDATE'].map(operation => [
  `media_trim_cadence_${operation.toLowerCase()}`,
  `BEFORE ${operation} ON media_assets WHEN ${invalid} BEGIN SELECT RAISE(ABORT,'Cadência do corte padrão inválida.'); END`,
]))
const normalize = (value: string) => value.replace(/\s+/g,' ').trim().replace(/;$/,'').toLowerCase()

/** A recorded migration with missing structure is corruption, not old data. */
export function validateTrimCadence(sqlite: Database.Database): void {
  if (!sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get()
    || !sqlite.prepare('SELECT 1 FROM schema_migrations WHERE version=19').get()) return
  const columns = sqlite.pragma('table_info(media_assets)') as {name:string;type:string}[]
  for (const name of ['default_trim_rate_num','default_trim_rate_den']) {
    if (!columns.some(column => column.name===name && column.type.toUpperCase()==='INTEGER')) throw new Error(`Banco incompleto: falta ${name} da migração 19.`)
  }
  for (const [name,body] of Object.entries(triggers)) {
    const row = sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?").get(name) as {sql:string}|undefined
    if (!row || normalize(row.sql)!==normalize(`CREATE TRIGGER ${name} ${body}`)) throw new Error(`Proteção ${name} ausente ou alterada. Restaure um backup validado.`)
  }
  const condition = invalid.replaceAll('NEW.','')
  if (sqlite.prepare(`SELECT 1 FROM media_assets WHERE ${condition} LIMIT 1`).get()) throw new Error('Banco contém cadência de corte padrão inválida. Restaure um backup validado.')
}

/** Old defaults retain unknown units; only a reviewed new edit assigns FPS. */
export function migrateTrimCadence(sqlite: Database.Database): void {
  if (!sqlite.prepare('SELECT 1 FROM schema_migrations WHERE version=19').get()) {
    sqlite.transaction(() => {
      sqlite.exec('ALTER TABLE media_assets ADD COLUMN default_trim_rate_num INTEGER; ALTER TABLE media_assets ADD COLUMN default_trim_rate_den INTEGER')
      for (const [name,body] of Object.entries(triggers)) sqlite.exec(`CREATE TRIGGER ${name} ${body}`)
      sqlite.prepare('INSERT INTO schema_migrations VALUES(19,?,?)').run('shared-trim-explicit-cadence',new Date().toISOString())
    })()
  }
  validateTrimCadence(sqlite)
}
