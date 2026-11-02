import Database from 'better-sqlite3'
import {afterEach,beforeEach,expect,it} from 'vitest'
import {migrateHealthResolution,validateHealthResolution} from './health-resolution.js'
let db:Database.Database
beforeEach(()=>{db=new Database(':memory:');db.exec('CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT,applied_at TEXT);CREATE TABLE health_events(id TEXT PRIMARY KEY,component TEXT,state TEXT,occurred_at TEXT,acknowledged_at TEXT)')})
afterEach(()=>db.close())
it('migra sem transformar reconhecimento em resolução, backfill só evento correspondente',()=>{
  const insert=db.prepare('INSERT INTO health_events VALUES(?,?,?,?,?)')
  for(const [id,state]of [['pgm-signal:a:active','black'],['pgm-signal:b:active','freeze'],['pgm-signal:c:active','silence'],['pgm-signal:a:recovered','black_recovered'],['pgm-signal:b:unobserved','freeze_unobserved']])insert.run(id,'SIGNAL',state,'2026-10-10T00:00:00.000Z','2026-10-10T01:00:00.000Z')
  migrateHealthResolution(db);migrateHealthResolution(db)
  expect(db.prepare('SELECT resolved_at,observation_ended_at FROM health_events WHERE id=?').get('pgm-signal:a:active')).toEqual({resolved_at:'2026-10-10T00:00:00.000Z',observation_ended_at:null})
  expect(db.prepare('SELECT resolved_at,observation_ended_at FROM health_events WHERE id=?').get('pgm-signal:b:active')).toEqual({resolved_at:null,observation_ended_at:'2026-10-10T00:00:00.000Z'})
  expect(db.prepare('SELECT resolved_at FROM health_events WHERE id=?').get('pgm-signal:c:active')).toEqual({resolved_at:null})
  expect(db.prepare('SELECT count(*) AS n FROM schema_migrations WHERE version=47').get()).toEqual({n:1})
})
it('falha do registro reverte colunas e índice',()=>{
  db.exec("CREATE TRIGGER deny_migration BEFORE INSERT ON schema_migrations BEGIN SELECT RAISE(ABORT,'own migration failure'); END")
  expect(()=>migrateHealthResolution(db)).toThrow('own migration failure')
  expect((db.prepare('PRAGMA table_info(health_events)').all() as {name:string}[]).map(row=>row.name)).not.toContain('resolved_at')
  expect(db.prepare("SELECT 1 FROM sqlite_master WHERE name='health_events_retention'").get()).toBeUndefined()
})
it('valida backup legado sem alterar e rejeita registro incompleto/horário inválido',()=>{
  expect(()=>validateHealthResolution(db)).not.toThrow();migrateHealthResolution(db)
  db.prepare('INSERT INTO health_events(id,resolved_at) VALUES(?,?)').run('bad','not-a-date')
  expect(()=>validateHealthResolution(db)).toThrow('Horário')
  db.exec('DELETE FROM health_events;DELETE FROM schema_migrations')
  expect(()=>validateHealthResolution(db)).toThrow('incompleta')
})
