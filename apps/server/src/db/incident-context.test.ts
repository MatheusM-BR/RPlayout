import Database from 'better-sqlite3'
import {afterEach,expect,it} from 'vitest'
import {mkdtempSync,readFileSync,copyFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {migrateIncidentContexts,validateIncidentContexts} from './incident-context.js'
import {openDatabase} from './client.js'
import {validateDatabaseSecrets} from './vault-migration.js'
import {validateBackupRestore} from '../domain/backup.js'
import {healthEvents} from './schema.js'
const opened:Database.Database[]=[]
afterEach(()=>{for(const db of opened.splice(0))if(db.open)db.close()})
function legacy(){const db=new Database(':memory:');opened.push(db);db.exec('CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT,applied_at TEXT); CREATE TABLE health_events(id TEXT PRIMARY KEY,channel_id TEXT,component TEXT,state TEXT,occurred_at TEXT,acknowledged_at TEXT,severity TEXT)');return db}
it('migração48 idempotente adiciona contexto nullable e índices de canal sem fabricar contexto antigo',()=>{
  const db=legacy();db.exec("INSERT INTO health_events(id,channel_id) VALUES('old','a')")
  migrateIncidentContexts(db);const changed=db.prepare('SELECT total_changes() AS n').get()
  migrateIncidentContexts(db);expect(db.prepare('SELECT total_changes() AS n').get()).toEqual(changed)
  expect(db.prepare('SELECT context FROM health_events').get()).toEqual({context:null})
  expect(db.prepare('SELECT count(*) AS n FROM schema_migrations WHERE version=48').get()).toEqual({n:1})
  expect(db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'health_events_channel_%'").all()).toHaveLength(2)
})
it('falha de registro48 desfaz coluna e índices',()=>{
  const db=legacy();db.exec("CREATE TRIGGER deny_48 BEFORE INSERT ON schema_migrations BEGIN SELECT RAISE(ABORT,'own fixture failure'); END")
  expect(()=>migrateIncidentContexts(db)).toThrow('own fixture failure')
  expect((db.prepare('PRAGMA table_info(health_events)').all() as {name:string}[]).some(row=>row.name==='context')).toBe(false)
  expect(db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'health_events_channel_%'").all()).toEqual([])
})
it('backup real anterior48 autentica segredos sem interpretar nome de coluna ausente como dado',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'RPlayout-incident-context-backup-')),file=join(directory,'legacy.db'),value=openDatabase(file);opened.push(value.sqlite)
  value.sqlite.exec('DROP INDEX health_events_channel_page; DROP INDEX health_events_channel_pending; ALTER TABLE health_events DROP COLUMN context; DELETE FROM schema_migrations WHERE version=48')
  expect(()=>validateDatabaseSecrets(value.sqlite)).not.toThrow();expect(()=>validateIncidentContexts(value.sqlite)).not.toThrow()
  value.sqlite.close();const before=readFileSync(file)
  await expect(validateBackupRestore(file)).resolves.toMatchObject({integrity:'ok'})
  expect(readFileSync(file)).toEqual(before)
})
it('contexto presente sem48 e48 registrado sem coluna são corrupção, não backup legado',()=>{
  const db=legacy();db.exec('ALTER TABLE health_events ADD COLUMN context TEXT')
  expect(()=>validateIncidentContexts(db)).toThrow('incompleta')
  db.exec("ALTER TABLE health_events DROP COLUMN context; INSERT INTO schema_migrations VALUES(48,'durable-incident-context','now')")
  expect(()=>validateIncidentContexts(db)).toThrow('Schema')
})
it('backup48 real preserva contexto cifrado e recusa cópia de outro canal sem tocar origem',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'RPlayout-incident-context-current-backup-')),file=join(directory,'original.db'),invalid=join(directory,'invalid.db'),value=openDatabase(file);opened.push(value.sqlite)
  value.db.insert(healthEvents).values({id:'fixture',channelId:'a',component:'SIGNAL',state:'freeze',occurredAt:new Date().toISOString(),context:{version:1,capturedAt:new Date().toISOString(),channelId:'a',rundownId:'rd',revisionId:'edition',executionId:'execution',itemId:'item',itemName:'Jornal São José',elapsedFrames:25,engine:{ready:false,processPresent:false},sources:[],outputs:[],sourcesTruncated:false,outputsTruncated:false,physicalSignalValidated:false}}).run()
  value.sqlite.close();const before=readFileSync(file)
  await expect(validateBackupRestore(file)).resolves.toMatchObject({integrity:'ok'})
  copyFileSync(file,invalid);const broken=new Database(invalid);opened.push(broken);broken.exec("UPDATE health_events SET channel_id='b'");broken.close()
  await expect(validateBackupRestore(invalid)).rejects.toThrow('outro canal')
  expect(readFileSync(file)).toEqual(before);expect(before.includes(Buffer.from('Jornal São José'))).toBe(false)
})
