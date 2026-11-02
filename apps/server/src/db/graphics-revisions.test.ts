import {afterEach,beforeEach,describe,expect,it} from 'vitest'
import Database from 'better-sqlite3'
import {mkdtempSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {openDatabase} from './client.js'
import {graphicsRevision,migrateGraphicsRevisions,validateGraphicsRevisions} from './graphics-revisions.js'
import {validateBackupRestore} from '../domain/backup.js'
import {editGraphicTemplate,readGraphicsReview} from '../domain/graphics-edit.js'
import {graphicsETag} from '@rplayout/protocol'
let file:string,value:ReturnType<typeof openDatabase>
const connections:Database.Database[]=[]
beforeEach(()=>{file=join(mkdtempSync(join(tmpdir(),'playout-graphics-revisions-')),'db.sqlite');value=openDatabase(file);connections.push(value.sqlite);for(const id of ['a','b'])value.sqlite.prepare('INSERT INTO channels(id,name,width,height,rate_num,rate_den,target_lufs,ceiling_dbtp,limiter_lookahead_ms,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,id,320,180,25,1,-23,-1,5,'now')})
afterEach(()=>{for(const connection of connections.splice(0))if(connection.open)connection.close()})
const version=(id:string|null)=>graphicsRevision(value.db,id)
function seed(){value.sqlite.prepare('INSERT INTO graphic_templates(id,channel_id,name,svg,fields,fade_ms,hold_seconds,created_at) VALUES(?,?,?,?,?,?,?,?)').run('template','a','Arte','<g/>','[]',300,null,'original')}
describe('migração 28 protege artes/slate de todos os escritores',()=>{
  it('owner antigo/novo e tombstones não colidem com global',()=>{
    seed();const a=version('a'),b=version('b'),global=version(null)
    value.sqlite.exec("UPDATE graphic_templates SET channel_id='b'");expect(version('a')).toBeGreaterThan(a);expect(version('b')).toBeGreaterThan(b);expect(version(null)).toBe(global)
    value.sqlite.exec('UPDATE graphic_templates SET channel_id=NULL');expect(version(null)).toBeGreaterThan(global)
    value.sqlite.exec("DELETE FROM graphic_templates; DELETE FROM channels WHERE id='a'");const tombstone=version('a')
    value.sqlite.prepare('INSERT INTO channels(id,name,width,height,rate_num,rate_den,target_lufs,ceiling_dbtp,limiter_lookahead_ms,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run('a','a',320,180,25,1,-23,-1,5,'now');expect(version('a')).toBeGreaterThan(tombstone)
  })
  it('lock é IMMEDIATE antes de ler/conferir, impedindo segundo escritor',()=>{
    const writer=new Database(file,{timeout:0});connections.push(writer);let checked=false
    const review=readGraphicsReview(value.db,'a',()=>{})
    editGraphicTemplate(value.db,'CREATE',undefined,{channelId:'a',name:'Arte',svg:'<g/>'},graphicsETag(review),{authorize:()=>{expect(value.sqlite.inTransaction).toBe(true);expect(()=>writer.prepare("UPDATE channels SET name=name WHERE id='a'").run()).toThrow(/locked/);checked=true},audit:()=>{}})
    expect(checked).toBe(true)
  })
  it('segundo escritor/restart/backup mantêm revisão sem cache',async()=>{
    seed();const writer=new Database(file);connections.push(writer);const original=version('a');writer.exec('UPDATE graphic_templates SET name=name');expect(version('a')).toBeGreaterThan(original)
    const current=version('a');value.sqlite.close();value=openDatabase(file);connections.push(value.sqlite);expect(version('a')).toBe(current)
    const backup=join(mkdtempSync(join(tmpdir(),'playout-graphics-backup-')),'backup.db');await value.sqlite.backup(backup);expect(await validateBackupRestore(backup)).toMatchObject({integrity:'ok',foreignKeys:'ok'})
  })
  it('upgrade 27 preserva conteúdo/IDs e roda apenas uma vez',()=>{
    seed();const original=value.sqlite.prepare('SELECT * FROM graphic_templates').all()
    for(const row of value.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'graphics_revision_%'").all()as {name:string}[])value.sqlite.exec(`DROP TRIGGER ${row.name}`)
    value.sqlite.exec('DROP TABLE graphics_versions; DELETE FROM schema_migrations WHERE version=28');migrateGraphicsRevisions(value.sqlite)
    expect(value.sqlite.prepare('SELECT * FROM graphic_templates').all()).toEqual(original);const baseline=version('a');expect(baseline).toBeGreaterThanOrEqual(2**40);migrateGraphicsRevisions(value.sqlite);expect(version('a')).toBe(baseline)
  })
  it.each(['table','counter','trigger'])('startup/backup recusam dano marcado: %s',async damage=>{
    value.sqlite.exec(damage==='table'?'DROP TABLE graphics_versions':damage==='counter'?"DELETE FROM graphics_versions WHERE scope='C:a'":'DROP TRIGGER graphics_revision_graphic_templates_update')
    expect(()=>validateGraphicsRevisions(value.sqlite)).toThrow();const backup=join(mkdtempSync(join(tmpdir(),'playout-graphics-damaged-')),'backup.db');await value.sqlite.backup(backup);await expect(validateBackupRestore(backup)).rejects.toThrow();value.sqlite.close();expect(()=>openDatabase(file)).toThrow()
  })
})
