import type Database from 'better-sqlite3'

// Extend, rather than rewrite, migration 21's validated contract. Preset ABA
// must invalidate the same snapshot used for channel/output configuration.
const triggers:Record<string,string>={}
for(const action of ['INSERT','UPDATE','DELETE'] as const){
  const row=action==='DELETE'?'OLD':'NEW'
  triggers[`channel_configuration_preset_${action.toLowerCase()}`]=`${action==='DELETE'?'BEFORE':'AFTER'} ${action} ON transmission_presets BEGIN
    ${action==='UPDATE'?`INSERT INTO channel_configuration_versions SELECT OLD.channel_id,1 WHERE OLD.channel_id<>NEW.channel_id ON CONFLICT(channel_id) DO UPDATE SET version=version+1;`:''}
    INSERT INTO channel_configuration_versions VALUES(${row}.channel_id,1) ON CONFLICT(channel_id) DO UPDATE SET version=version+1;
  END`
}
const normalize=(sql:string)=>sql.replace(/\s+/g,' ').trim()
export function validatePresetConfiguration(sqlite:Database.Database):void{
  if(!sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get() || !sqlite.prepare('SELECT 1 FROM schema_migrations WHERE version=22').get())return
  for(const [name,body] of Object.entries(triggers)){
    const stored=sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?").get(name) as {sql:string}|undefined
    if(!stored || normalize(stored.sql)!==normalize(`CREATE TRIGGER ${name} ${body}`))throw new Error(`Proteção de preset ${name} ausente ou alterada. Restaure um backup validado.`)
  }
}
export function migratePresetConfiguration(sqlite:Database.Database):void{
  if(!sqlite.prepare('SELECT 1 FROM schema_migrations WHERE version=22').get())sqlite.transaction(()=>{
    for(const [name,body] of Object.entries(triggers))sqlite.exec(`CREATE TRIGGER ${name} ${body}`)
    // Invalidate snapshots opened before presets were covered by the counter.
    sqlite.exec('UPDATE channel_configuration_versions SET version=version+1 WHERE channel_id IN (SELECT id FROM channels)')
    sqlite.prepare('INSERT INTO schema_migrations VALUES(22,?,?)').run('preset-channel-configuration-revisions',new Date().toISOString())
  })()
  validatePresetConfiguration(sqlite)
}
