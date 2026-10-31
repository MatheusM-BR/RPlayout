import {afterEach,describe,expect,it} from 'vitest'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import type Database from 'better-sqlite3'
import {openDatabase} from './client.js'
import {qcRevision,validateQcRevisions} from './qc-revisions.js'
import {validateBackupRestore} from '../domain/backup.js'
const handles:Database.Database[]=[],directories:string[]=[]
afterEach(()=>{for(const db of handles.splice(0))if(db.open)db.close();for(const path of directories.splice(0))rmSync(path,{recursive:true,force:true})})
function fixture(path=':memory:',seed=true){
  const f=openDatabase(path);handles.push(f.sqlite)
  if(seed)f.sqlite.exec("INSERT INTO media_assets(id,content_hash,path,title,kind,duration_frames,created_at) VALUES('a','hash','test.mp4','VT','VIDEO',250,'now'),('b','other','other.mp4','Outro','VIDEO',250,'now')")
  return {...f,revision:(id='a')=>qcRevision(f.db,id)}
}
function path(){const directory=mkdtempSync(join(tmpdir(),'RPlayout-qc-revisions-'));directories.push(directory);return join(directory,'qa.db')}
function decision(f:ReturnType<typeof fixture>){f.sqlite.exec(`INSERT INTO qc_decisions(id,asset_id,content_hash,channel_id,status,checks,created_at) VALUES('qc','a','hash','ch','BLOCKED','{"playable":false,"errors":[],"warnings":[]}','now')`)}
describe('revisão QC durável por arquivo',()=>{
  it('metadados ABA, remoção/reinserção e decisões de qualquer canal invalidam a leitura',()=>{
    const f=fixture();expect(f.revision()).toBe(1)
    f.sqlite.exec("UPDATE media_assets SET content_hash='new' WHERE id='a';UPDATE media_assets SET content_hash='hash' WHERE id='a'");expect(f.revision()).toBe(3)
    decision(f);expect(f.revision()).toBe(4)
    f.sqlite.exec("UPDATE qc_decisions SET asset_id='b',channel_id='@all' WHERE id='qc'");expect(f.revision()).toBe(5);expect(f.revision('b')).toBe(2)
    f.sqlite.exec("DELETE FROM qc_decisions;DELETE FROM media_assets WHERE id='a';INSERT INTO media_assets(id,content_hash,path,title,kind,duration_frames,created_at) VALUES('a','hash','test.mp4','VT','VIDEO',250,'now')")
    expect(f.revision()).toBe(7);expect(f.revision('b')).toBe(3)
  })
  it('rollback e overflow revertem a decisão e todos os contadores',()=>{
    const f=fixture()
    expect(()=>f.sqlite.transaction(()=>{decision(f);throw new Error('rollback')})()).toThrow('rollback');expect(f.revision()).toBe(1)
    f.sqlite.prepare("UPDATE qc_review_versions SET version=? WHERE asset_id='a'").run(Number.MAX_SAFE_INTEGER)
    expect(()=>decision(f)).toThrow();expect(f.sqlite.prepare('SELECT count(*) n FROM qc_decisions').get()).toEqual({n:0})
  })
  it('outro escritor/reinício e backup preservam a revisão',async()=>{
    const file=path(),a=fixture(file),b=fixture(file,false);decision(b)
    expect(a.revision()).toBe(2);a.sqlite.close();b.sqlite.close();expect(fixture(file,false).revision()).toBe(2)
    expect(await validateBackupRestore(file)).toMatchObject({integrity:'ok',foreignKeys:'ok'})
  })
  it('migração a partir de 22 é única e preserva o conteúdo sem inventar histórico',()=>{
    const file=path(),f=fixture(file);decision(f)
    for(const table of ['media_assets','qc_decisions'])for(const action of ['insert','update','delete'])f.sqlite.exec(`DROP TRIGGER qc_review_${table}_${action}`)
    f.sqlite.exec('DROP TABLE qc_review_versions;DELETE FROM schema_migrations WHERE version=23');f.sqlite.close()
    const next=fixture(file,false),revision=next.revision();expect(revision).toBeGreaterThan(2**40)
    expect(next.sqlite.prepare('SELECT status FROM qc_decisions').get()).toEqual({status:'BLOCKED'});next.sqlite.close()
    expect(fixture(file,false).revision()).toBe(revision)
  })
  it.each(['trigger','missing counter'])('startup e restauração recusam proteção incompleta: %s',async kind=>{
    const file=path(),f=fixture(file)
    f.sqlite.exec(kind==='trigger'?'DROP TRIGGER qc_review_qc_decisions_update':"DELETE FROM qc_review_versions WHERE asset_id='a'")
    expect(()=>validateQcRevisions(f.sqlite)).toThrow();f.sqlite.close()
    await expect(validateBackupRestore(file)).rejects.toThrow();expect(()=>fixture(file,false)).toThrow()
  })
})
