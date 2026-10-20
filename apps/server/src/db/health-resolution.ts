import type Database from 'better-sqlite3'

export function validateHealthResolution(sqlite:Database.Database):void{
  const applied=sqlite.prepare('SELECT 1 FROM schema_migrations WHERE version=47').get()
  const columns=sqlite.prepare('PRAGMA table_info(health_events)').all() as Array<{name:string;type:string;notnull:number}>
  const tracked=['resolved_at','observation_ended_at'].map(name=>columns.find(row=>row.name===name))
  if(!applied){if(tracked.some(Boolean))throw new Error('Migração de resolução de incidentes incompleta.');return}
  if(tracked.some(row=>!row||row.type.toUpperCase()!=='TEXT'||row.notnull!==0))throw new Error('Schema de resolução de incidentes inválido.')
  const rows=sqlite.prepare('SELECT resolved_at,observation_ended_at FROM health_events WHERE resolved_at IS NOT NULL OR observation_ended_at IS NOT NULL').all() as Array<{resolved_at:string|null;observation_ended_at:string|null}>
  for(const row of rows)for(const time of [row.resolved_at,row.observation_ended_at])if(time!==null&&(!Number.isFinite(Date.parse(time))||new Date(time).toISOString()!==time))throw new Error('Horário de resolução de incidente inválido.')
}

/** Old acknowledgement never becomes recovery. Only exact prior signal IDs
 * with a matching measured-recovery event can backfill a resolved timestamp. */
export function migrateHealthResolution(sqlite:Database.Database):void{
  sqlite.transaction(()=>{
    if(sqlite.prepare('SELECT 1 FROM schema_migrations WHERE version=47').get())return
    sqlite.exec(`ALTER TABLE health_events ADD COLUMN resolved_at TEXT;
      ALTER TABLE health_events ADD COLUMN observation_ended_at TEXT;
      CREATE INDEX health_events_retention ON health_events(occurred_at,acknowledged_at,resolved_at);
      UPDATE health_events SET resolved_at=(SELECT recovery.occurred_at FROM health_events recovery
        WHERE recovery.id=substr(health_events.id,1,length(health_events.id)-6)||'recovered'
        AND recovery.component='SIGNAL' AND recovery.state=health_events.state||'_recovered')
      WHERE component='SIGNAL' AND id LIKE 'pgm-signal:%:active' AND state IN('black','freeze','silence');
      UPDATE health_events SET observation_ended_at=(SELECT ended.occurred_at FROM health_events ended
        WHERE ended.id=substr(health_events.id,1,length(health_events.id)-6)||'unobserved'
        AND ended.component='SIGNAL' AND ended.state=health_events.state||'_unobserved')
      WHERE component='SIGNAL' AND id LIKE 'pgm-signal:%:active' AND state IN('black','freeze','silence');`)
    sqlite.prepare('INSERT INTO schema_migrations VALUES(47,?,?)').run('durable-health-resolution',new Date().toISOString())
  }).immediate()
  validateHealthResolution(sqlite)
}
