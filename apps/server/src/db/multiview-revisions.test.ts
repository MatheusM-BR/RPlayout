import {afterEach,beforeEach,describe,expect,it} from 'vitest'
import Database from 'better-sqlite3'
import {mkdtempSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {openDatabase} from './client.js'
import {migrateMultiviewRevisions,validateMultiviewRevisions} from './multiview-revisions.js'
import {validateBackupRestore} from '../domain/backup.js'
const opened:Database.Database[]=[]
let file:string,db:ReturnType<typeof openDatabase>
beforeEach(()=>{
  file=join(mkdtempSync(join(tmpdir(),'playout-multiview-revisions-')),'db.sqlite');db=openDatabase(file);opened.push(db.sqlite)
  for(const id of ['a','b','default'])db.sqlite.prepare('INSERT INTO channels(id,name,width,height,rate_num,rate_den,target_lufs,ceiling_dbtp,limiter_lookahead_ms,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,id,320,180,25,1,-23,-1,5,'now')
})
afterEach(()=>{for(const connection of opened.splice(0))if(connection.open)connection.close()})
const version=(scope:string,connection=db.sqlite)=>(connection.prepare('SELECT version FROM multiview_versions WHERE scope=?').get(scope) as {version:number}).version
describe('migração 26 persiste escopos separados e invalida todos os escritores',()=>{
  it('move global/canal e mantém tombstone após exclusão/recriação',()=>{
    db.sqlite.prepare('INSERT INTO multiview_configs VALUES(?,?,?,?,?)').run('legacy','a','GRID_2X2',null,'now')
    const a=version('C:a'),g=version('G')
    db.sqlite.prepare('UPDATE multiview_configs SET channel_id=NULL WHERE id=?').run('legacy')
    expect(version('C:a')).toBeGreaterThan(a);expect(version('G')).toBeGreaterThan(g)
    const moved=version('G');db.sqlite.prepare('UPDATE multiview_configs SET channel_id=? WHERE id=?').run('b','legacy')
    expect(version('G')).toBeGreaterThan(moved);expect(version('C:b')).toBeGreaterThan(1)
    const before=version('C:a');db.sqlite.prepare('DELETE FROM channels WHERE id=?').run('a')
    expect(version('C:a')).toBeGreaterThan(before)
    db.sqlite.prepare('INSERT INTO channels(id,name,width,height,rate_num,rate_den,target_lufs,ceiling_dbtp,limiter_lookahead_ms,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run('a','a',320,180,25,1,-23,-1,5,'now')
    expect(version('C:a')).toBeGreaterThan(before+1)
    expect(version('C:default')).not.toBe(version('G'))
  })
  it('fonte muda a revisão do canal/global, não a de outro canal',()=>{
    const a=version('C:a'),b=version('C:b'),g=version('G')
    db.sqlite.prepare('INSERT INTO live_sources(id,channel_id,name,kind,target_url,created_at) VALUES(?,?,?,?,?,?)').run('source','a','source','NDI','ndi:fixture','now')
    expect(version('C:a')).toBeGreaterThan(a);expect(version('G')).toBeGreaterThan(g);expect(version('C:b')).toBe(b)
    const oldA=version('C:a');db.sqlite.prepare('UPDATE live_sources SET channel_id=? WHERE id=?').run('b','source')
    expect(version('C:a')).toBeGreaterThan(oldA);expect(version('C:b')).toBeGreaterThan(b)
  })
  it('outro escritor, restart e backup conservam a revisão sem depender de cache',async()=>{
    const writer=new Database(file);opened.push(writer)
    const old=version('C:a');writer.prepare('INSERT INTO multiview_configs VALUES(?,?,?,?,?)').run('written-elsewhere','a','COMPACT_LIST',null,'now')
    expect(version('C:a')).toBeGreaterThan(old);expect(version('C:a',writer)).toBe(version('C:a'))
    const before=version('C:a');db.sqlite.close();db=openDatabase(file);opened.push(db.sqlite)
    expect(version('C:a')).toBe(before)
    const backup=join(mkdtempSync(join(tmpdir(),'playout-multiview-backup-')),'backup.db');await db.sqlite.backup(backup)
    expect((await validateBackupRestore(backup)).integrity).toBe('ok')
  })
  it('upgrade 25 preserva IDs/conteúdo legado e não repete baseline',()=>{
    db.sqlite.prepare('INSERT INTO multiview_configs VALUES(?,?,?,?,?)').run('mv-default','default','COMPACT_LIST',null,'original')
    const rows=db.sqlite.prepare('SELECT * FROM multiview_configs').all()
    for(const row of db.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'multiview_revision_%'").all() as {name:string}[])db.sqlite.exec(`DROP TRIGGER ${row.name}`)
    db.sqlite.exec('DROP TABLE multiview_versions; DELETE FROM schema_migrations WHERE version=26')
    migrateMultiviewRevisions(db.sqlite);expect(db.sqlite.prepare('SELECT * FROM multiview_configs').all()).toEqual(rows)
    const before=db.sqlite.prepare('SELECT * FROM multiview_versions ORDER BY scope').all();migrateMultiviewRevisions(db.sqlite)
    expect(db.sqlite.prepare('SELECT * FROM multiview_versions ORDER BY scope').all()).toEqual(before)
  })
  it.each(['table','counter','trigger'])('startup/backup recusam proteção marcada mas adulterada: %s',async damaged=>{
    if(damaged==='table')db.sqlite.exec('DROP TABLE multiview_versions')
    if(damaged==='counter')db.sqlite.prepare("DELETE FROM multiview_versions WHERE scope='G'").run()
    if(damaged==='trigger')db.sqlite.exec('DROP TRIGGER multiview_revision_multiview_configs_update')
    expect(()=>validateMultiviewRevisions(db.sqlite)).toThrow()
    const backup=join(mkdtempSync(join(tmpdir(),'playout-damaged-mv-')),'backup.db');await db.sqlite.backup(backup)
    await expect(validateBackupRestore(backup)).rejects.toThrow()
    db.sqlite.close();expect(()=>openDatabase(file)).toThrow()
  })
})
