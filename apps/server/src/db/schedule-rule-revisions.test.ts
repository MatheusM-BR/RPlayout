import {afterEach,beforeEach,describe,expect,it} from 'vitest'
import Database from 'better-sqlite3'
import {mkdtempSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {openDatabase} from './client.js'
import {migrateScheduleRuleRevisions,validateScheduleRuleRevisions} from './schedule-rule-revisions.js'
import {validateBackupRestore} from '../domain/backup.js'
import {editScheduleRule} from '../domain/schedule-rule-edit.js'
import {scheduleRuleETag} from '@rplayout/protocol'
let file:string,value:ReturnType<typeof openDatabase>
const opened:Database.Database[]=[]
beforeEach(()=>{
  file=join(mkdtempSync(join(tmpdir(),'playout-rule-revisions-')),'db.sqlite');value=openDatabase(file);opened.push(value.sqlite)
  for(const id of ['a','b'])value.sqlite.prepare('INSERT INTO channels(id,name,width,height,rate_num,rate_den,target_lufs,ceiling_dbtp,limiter_lookahead_ms,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,id,320,180,25,1,-23,-1,5,'now')
})
afterEach(()=>{for(const connection of opened.splice(0))if(connection.open)connection.close()})
const version=(id:string)=>(value.sqlite.prepare('SELECT version FROM schedule_rule_versions WHERE channel_id=?').get(id) as {version:number}).version
function seed(){value.sqlite.prepare('INSERT INTO schedule_rules VALUES(?,?,?,?,?,?,?,?,?)').run('band','a','Band','0123456',60,120,'[]',0,'original')}
describe('migração 27 protege todos os escritores de faixas',()=>{
  it('mudança de dono, mesmo valor e exclusão/recriação preservam tombstone',()=>{
    seed();const a=version('a'),b=version('b')
    value.sqlite.prepare("UPDATE schedule_rules SET channel_id='b'").run();expect(version('a')).toBeGreaterThan(a);expect(version('b')).toBeGreaterThan(b)
    const moved=version('b');value.sqlite.prepare('UPDATE schedule_rules SET name=name').run();expect(version('b')).toBeGreaterThan(moved)
    value.sqlite.prepare('DELETE FROM schedule_rules').run();const deleted=version('b');value.sqlite.prepare("DELETE FROM channels WHERE id='b'").run();expect(version('b')).toBeGreaterThan(deleted)
    const tombstone=version('b');value.sqlite.prepare('INSERT INTO channels(id,name,width,height,rate_num,rate_den,target_lufs,ceiling_dbtp,limiter_lookahead_ms,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run('b','b',320,180,25,1,-23,-1,5,'now');expect(version('b')).toBeGreaterThan(tombstone)
  })
  it('lock IMMEDIATE é obtido antes da validação, bloqueando segundo escritor durante conferência',()=>{
    const writer=new Database(file,{timeout:0});opened.push(writer);let checked=false
    editScheduleRule(value.db,'CREATE','a',{name:'Band',weekdays:'0',startMinute:60,endMinute:120,categories:[],avoidHours:0},scheduleRuleETag('a',version('a')),{authorize:()=>{
      expect(value.sqlite.inTransaction).toBe(true);expect(()=>writer.prepare("UPDATE channels SET name='Changed' WHERE id='a'").run()).toThrow(/locked/);checked=true
    },audit:()=>{}})
    expect(checked).toBe(true);expect(value.sqlite.prepare("SELECT name FROM channels WHERE id='a'").get()).toEqual({name:'a'})
  })
  it('segundo escritor, restart e backup preservam revisão monotônica',async()=>{
    const writer=new Database(file);opened.push(writer);const old=version('a');writer.prepare('INSERT INTO schedule_rules VALUES(?,?,?,?,?,?,?,?,?)').run('band','a','Band','0',60,120,'[]',0,'original')
    expect(version('a')).toBeGreaterThan(old);const current=version('a');value.sqlite.close();value=openDatabase(file);opened.push(value.sqlite);expect(version('a')).toBe(current)
    const backup=join(mkdtempSync(join(tmpdir(),'playout-rule-backup-')),'backup.db');await value.sqlite.backup(backup);expect(await validateBackupRestore(backup)).toMatchObject({integrity:'ok',foreignKeys:'ok'})
  })
  it('upgrade 26 preserva conteúdo/IDs, inicializa uma vez e não normaliza legado',()=>{
    seed();const rows=value.sqlite.prepare('SELECT * FROM schedule_rules').all()
    for(const row of value.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'schedule_rule_revision_%'").all() as {name:string}[])value.sqlite.exec(`DROP TRIGGER ${row.name}`)
    value.sqlite.exec('DROP TABLE schedule_rule_versions; DELETE FROM schema_migrations WHERE version=27')
    migrateScheduleRuleRevisions(value.sqlite);expect(value.sqlite.prepare('SELECT * FROM schedule_rules').all()).toEqual(rows)
    const before=version('a');migrateScheduleRuleRevisions(value.sqlite);expect(version('a')).toBe(before)
  })
  it.each(['table','counter','trigger'])('startup/backup recusam proteção marcada adulterada: %s',async damaged=>{
    if(damaged==='table')value.sqlite.exec('DROP TABLE schedule_rule_versions')
    if(damaged==='counter')value.sqlite.prepare("DELETE FROM schedule_rule_versions WHERE channel_id='a'").run()
    if(damaged==='trigger')value.sqlite.exec('DROP TRIGGER schedule_rule_revision_schedule_rules_update')
    expect(()=>validateScheduleRuleRevisions(value.sqlite)).toThrow()
    const backup=join(mkdtempSync(join(tmpdir(),'playout-rule-damaged-')),'backup.db');await value.sqlite.backup(backup)
    await expect(validateBackupRestore(backup)).rejects.toThrow();value.sqlite.close();expect(()=>openDatabase(file)).toThrow()
  })
})
