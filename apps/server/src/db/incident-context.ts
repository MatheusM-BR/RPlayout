import type Database from 'better-sqlite3'
import {IncidentContextSchema} from '@rplayout/protocol'
import {installationVault} from '../domain/secret-vault.js'

export function validateIncidentContexts(sqlite:Database.Database){
  const applied=sqlite.prepare('SELECT 1 FROM schema_migrations WHERE version=48').get()
  const column=(sqlite.prepare('PRAGMA table_info(health_events)').all() as {name:string;type:string;notnull:number}[]).find(row=>row.name==='context')
  if(!applied){if(column)throw new Error('Migração de contexto de incidentes incompleta.');return}
  if(!column||column.type.toUpperCase()!=='TEXT'||column.notnull!==0)throw new Error('Schema de contexto de incidentes inválido.')
  for(const row of sqlite.prepare('SELECT channel_id,context FROM health_events WHERE context IS NOT NULL').all() as {channel_id:string|null;context:string}[]){
    const context=IncidentContextSchema.safeParse(JSON.parse(installationVault(false).decrypt(row.context,'health_events.context')))
    if(!context.success||context.data.channelId!==row.channel_id)throw new Error('Contexto de incidente inválido ou de outro canal.')
  }
}
export function migrateIncidentContexts(sqlite:Database.Database){
  sqlite.transaction(()=>{
    if(sqlite.prepare('SELECT 1 FROM schema_migrations WHERE version=48').get())return
    sqlite.exec('ALTER TABLE health_events ADD COLUMN context TEXT; CREATE INDEX health_events_channel_page ON health_events(channel_id,occurred_at,id); CREATE INDEX health_events_channel_pending ON health_events(channel_id,acknowledged_at,severity);')
    sqlite.prepare('INSERT INTO schema_migrations VALUES(48,?,?)').run('durable-incident-context',new Date().toISOString())
  }).immediate()
  validateIncidentContexts(sqlite)
}
