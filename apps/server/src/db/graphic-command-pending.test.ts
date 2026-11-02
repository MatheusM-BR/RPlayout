import Database from 'better-sqlite3'
import {afterEach,it,expect} from 'vitest'
import {migrateGraphicCommandPending,validateGraphicCommandPending} from './graphic-command-pending.js'
const databases:Database.Database[]=[]
function fixture(){
  const db=new Database(':memory:');databases.push(db)
  db.exec('CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT,applied_at TEXT); CREATE TABLE operator_decisions(id TEXT PRIMARY KEY,rundown_id TEXT,kind TEXT,created_at TEXT,payload TEXT)')
  return db
}
function append(db:Database.Database,id:string,phase:string,scope='@graphics:a'){
  db.prepare('INSERT INTO operator_decisions VALUES(?,?,?,?,?)').run(id+':'+phase,scope,'GRAPHIC_COMMAND_'+phase,'now','opaque-fixture')
}
afterEach(()=>{for(const db of databases.splice(0))db.close()})
it('falha durante migração reverte tabelas/índices e não registra versão parcial',()=>{
  const db=fixture();append(db,'open','ACCEPTED')
  db.exec('CREATE TRIGGER graphic_command_pending_accept AFTER INSERT ON operator_decisions BEGIN SELECT 1; END')
  expect(()=>migrateGraphicCommandPending(db)).toThrow()
  expect(db.prepare("SELECT name FROM sqlite_master WHERE name IN ('graphic_command_pending','graphic_command_history','graphic_command_phase_identity')").all()).toEqual([])
  expect(db.prepare('SELECT 1 FROM schema_migrations WHERE version=49').get()).toBeUndefined()
  expect(db.prepare('SELECT count(*) n FROM operator_decisions').get()).toEqual({n:1})
})
it('migração preserva histórico e reconstrói somente aceites sem resultado terminal',()=>{
  const db=fixture()
  append(db,'open','ACCEPTED');append(db,'open','SENDING');append(db,'open','UNCERTAIN')
  append(db,'done','ACCEPTED');append(db,'done','CONFIRMED')
  append(db,'other','ACCEPTED','@graphics:b')
  const before=db.prepare('SELECT * FROM operator_decisions ORDER BY id').all()
  migrateGraphicCommandPending(db);migrateGraphicCommandPending(db)
  expect(db.prepare('SELECT * FROM graphic_command_pending ORDER BY id').all()).toEqual([{id:'open:ACCEPTED',scope:'@graphics:a'},{id:'other:ACCEPTED',scope:'@graphics:b'}])
  expect(db.prepare('SELECT * FROM operator_decisions ORDER BY id').all()).toEqual(before)
  expect(db.prepare('SELECT count(*) n FROM schema_migrations WHERE version=49').get()).toEqual({n:1})
})
it('projeção e terminal são atômicos; UNCERTAIN não libera e canal errado não encerra',()=>{
  const db=fixture();migrateGraphicCommandPending(db)
  append(db,'open','ACCEPTED');append(db,'open','UNCERTAIN')
  append(db,'open','CONFIRMED','@graphics:b')
  expect(db.prepare('SELECT count(*) n FROM graphic_command_pending').get()).toEqual({n:1})
  expect(()=>db.exec("DELETE FROM graphic_command_pending WHERE id='open:ACCEPTED'")).toThrow('Unresolved')
  expect(()=>db.transaction(()=>{append(db,'open','REVIEWED');throw new Error('ROLLBACK')})()).toThrow('ROLLBACK')
  expect(db.prepare('SELECT count(*) n FROM graphic_command_pending').get()).toEqual({n:1})
  append(db,'open','REVIEWED')
  expect(db.prepare('SELECT count(*) n FROM graphic_command_pending').get()).toEqual({n:0})
  expect(()=>validateGraphicCommandPending(db)).not.toThrow()
})
it('histórico gráfico é append-only, inclusive REPLACE; registros não gráficos continuam editáveis',()=>{
  const db=fixture();migrateGraphicCommandPending(db);append(db,'open','ACCEPTED')
  expect(()=>db.exec("UPDATE operator_decisions SET kind='OTHER' WHERE id='open:ACCEPTED'")).toThrow('append-only')
  expect(()=>db.exec("DELETE FROM operator_decisions WHERE id='open:ACCEPTED'")).toThrow('append-only')
  expect(()=>db.exec("INSERT OR REPLACE INTO operator_decisions VALUES('open:ACCEPTED','@graphics:a','OTHER','now','opaque')")).toThrow('replaced')
  db.exec("INSERT INTO operator_decisions VALUES('job','@jobs','MEDIA_JOB','now','opaque'); UPDATE operator_decisions SET payload='updated' WHERE id='job'; DELETE FROM operator_decisions WHERE id='job'")
})
it('admissão e backup recusam projeção divergente ou trigger alterado; legacy sem migração continua legível',()=>{
  const db=fixture();expect(()=>validateGraphicCommandPending(db)).not.toThrow()
  migrateGraphicCommandPending(db);append(db,'open','ACCEPTED')
  db.exec('DROP TRIGGER graphic_command_pending_guard_delete; DELETE FROM graphic_command_pending')
  expect(()=>validateGraphicCommandPending(db)).toThrow('Schema')
  // Even with original guards intact, missing membership is detected at admission.
  const original=new Database(':memory:');databases.push(original)
  original.exec('CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT,applied_at TEXT); CREATE TABLE operator_decisions(id TEXT PRIMARY KEY,rundown_id TEXT,kind TEXT,created_at TEXT,payload TEXT)')
  migrateGraphicCommandPending(original)
  original.exec('DROP TRIGGER graphic_command_pending_accept')
  append(original,'missing','ACCEPTED')
  const trigger=db.prepare("SELECT sql FROM sqlite_master WHERE name='graphic_command_pending_accept'").get() as {sql:string}
  original.exec(trigger.sql)
  expect(()=>validateGraphicCommandPending(original)).toThrow('diverge')
})
it('consulta de pendências usa índice por escopo sem varrer histórico concluído',()=>{
  const db=fixture();migrateGraphicCommandPending(db)
  db.transaction(()=>{for(let i=0;i<5000;i++){append(db,'done-'+i,'ACCEPTED');append(db,'done-'+i,'CONFIRMED')}})()
  append(db,'pending','ACCEPTED','@graphics:b')
  const plan=db.prepare('EXPLAIN QUERY PLAN SELECT id FROM graphic_command_pending WHERE scope=? LIMIT 1').all('@graphics:b') as {detail:string}[]
  expect(plan.some(row=>row.detail.includes('SEARCH')&&row.detail.includes('graphic_command_pending_scope'))).toBe(true)
  expect(db.prepare('SELECT id FROM graphic_command_pending WHERE scope=? LIMIT 1').get('@graphics:a')).toBeUndefined()
  expect(db.prepare('SELECT id FROM graphic_command_pending WHERE scope=? LIMIT 1').get('@graphics:b')).toEqual({id:'pending:ACCEPTED'})
  expect(()=>validateGraphicCommandPending(db)).not.toThrow()
})
