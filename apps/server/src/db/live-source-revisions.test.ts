import {afterEach,describe,expect,it} from 'vitest'
import {mkdtempSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {openDatabase} from './client.js'
import {liveSourceRevision,validateLiveSourceRevisions} from './live-source-revisions.js'
import {validateBackupRestore} from '../domain/backup.js'
const opened:ReturnType<typeof openDatabase>[]=[]
afterEach(()=>{for(const f of opened.splice(0))if(f.sqlite.open)f.sqlite.close()})
function fixture(file=':memory:',seed=true){
  const f=openDatabase(file);opened.push(f)
  if(seed)f.sqlite.exec("INSERT INTO channels(id,name,width,height,rate_num,rate_den,target_lufs,ceiling_dbtp,limiter_lookahead_ms,created_at) VALUES('a','A',320,180,25,1,-23,-1,5,'now'),('b','B',320,180,25,1,-23,-1,5,'now')")
  return {...f,revision:(id='a')=>liveSourceRevision(f.db,id)}
}
const path=()=>join(mkdtempSync(join(tmpdir(),'RPlayout-source-revisions-')),'qa.db')
describe('migração 25: revisões de entradas são duráveis e falham fechadas',()=>{
  it('movimento de fonte invalida os dois donos e delete/recreate conserva tombstone',()=>{
    const f=fixture();f.sqlite.exec("INSERT INTO live_sources(id,channel_id,name,kind,target_url,created_at) VALUES('src','a','QA','NDI','ndi:QA','now')")
    expect(f.revision()).toBe(2);expect(f.revision('b')).toBe(1)
    f.sqlite.exec("UPDATE live_sources SET channel_id='b' WHERE id='src'")
    expect(f.revision()).toBe(3);expect(f.revision('b')).toBe(2)
    f.sqlite.exec("DELETE FROM channels WHERE id='a'; INSERT INTO channels(id,name,width,height,rate_num,rate_den,target_lufs,ceiling_dbtp,limiter_lookahead_ms,created_at) VALUES('a','A',320,180,25,1,-23,-1,5,'now')")
    expect(f.revision()).toBe(5)
  })
  it('dois escritores/reinício e backup observam a mesma revisão',async()=>{
    const file=path(),a=fixture(file),b=fixture(file,false)
    b.sqlite.exec("UPDATE channels SET name='Novo' WHERE id='a'")
    expect(a.revision()).toBe(2);a.sqlite.close();b.sqlite.close()
    expect(fixture(file,false).revision()).toBe(2)
    expect(await validateBackupRestore(file)).toMatchObject({integrity:'ok',foreignKeys:'ok'})
  })
  it('upgrade do banco 24 aplica baseline uma vez sem alterar cadastros',()=>{
    const file=path(),f=fixture(file)
    for(const row of f.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'live_source_revision_%'").all() as {name:string}[])f.sqlite.exec(`DROP TRIGGER ${row.name}`)
    f.sqlite.exec('DROP TABLE live_source_versions; DELETE FROM schema_migrations WHERE version=25');f.sqlite.close()
    const next=fixture(file,false),revision=next.revision();expect(revision).toBeGreaterThanOrEqual(2**40)
    next.sqlite.close();expect(fixture(file,false).revision()).toBe(revision)
  })
  it.each(['table','counter','trigger'])('startup e backup recusam dano: %s',async damage=>{
    const file=path(),f=fixture(file)
    f.sqlite.exec(damage==='table'?'DROP TABLE live_source_versions':damage==='counter'?"DELETE FROM live_source_versions WHERE channel_id='a'":'DROP TRIGGER live_source_revision_live_sources_update')
    expect(()=>validateLiveSourceRevisions(f.sqlite)).toThrow();f.sqlite.close()
    await expect(validateBackupRestore(file)).rejects.toThrow();expect(()=>openDatabase(file)).toThrow()
  })
})
