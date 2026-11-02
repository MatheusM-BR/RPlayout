import type Database from 'better-sqlite3'

export function validateAudioBus(sqlite:Database.Database):void {
  if(!sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get() || !sqlite.prepare('SELECT 1 FROM schema_migrations WHERE version=20').get())return
  const table=sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='channels'").get() as {sql:string}|undefined
  if(!table || !/audio_channels\s+INTEGER\s+NOT\s+NULL\s+DEFAULT\s+2\s+CHECK\s*\(\s*audio_channels\s+IN\s*\(2,8,16\)\s*\)/i.test(table.sql))throw new Error('Contrato do barramento de áudio ausente ou alterado. Restaure um backup validado.')
  if(sqlite.prepare('SELECT 1 FROM channels WHERE audio_channels NOT IN (2,8,16) OR typeof(audio_channels)<>\'integer\' LIMIT 1').get())throw new Error('Barramento de áudio inválido no banco.')
}
export function migrateAudioBus(sqlite:Database.Database):void {
  if(!sqlite.prepare('SELECT 1 FROM schema_migrations WHERE version=20').get())sqlite.transaction(()=>{
    sqlite.exec('ALTER TABLE channels ADD COLUMN audio_channels INTEGER NOT NULL DEFAULT 2 CHECK(audio_channels IN (2,8,16))')
    sqlite.prepare('INSERT INTO schema_migrations VALUES(20,?,?)').run('numbered-pgm-embedded-audio-bus',new Date().toISOString())
  })()
  validateAudioBus(sqlite)
}
