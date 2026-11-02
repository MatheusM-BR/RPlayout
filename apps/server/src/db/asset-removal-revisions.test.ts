import {mkdtempSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {afterEach,describe,expect,it} from 'vitest'
import type Database from 'better-sqlite3'
import {openDatabase} from './client.js'
import {assetRemovalRevision,validateAssetRemovalRevisions} from './asset-removal-revisions.js'
import {validateBackupRestore} from '../domain/backup.js'
const opened:Database.Database[]=[]
const path=()=>join(mkdtempSync(join(tmpdir(),'RPlayout-removal-versions-')),'qa.db')
function fixture(file=':memory:'){
  const value=openDatabase(file);opened.push(value.sqlite)
  return {...value,revision:(scope='A:a')=>assetRemovalRevision(value.sqlite,scope)}
}
afterEach(()=>{for(const db of opened.splice(0))if(db.open)db.close()})
const insert="INSERT INTO media_assets(id,content_hash,path,title,kind,duration_frames,created_at) VALUES('a','H','a.mp4','A','VIDEO',250,'now')"
describe('migração 31 rastreia vínculos, tombstones e integridade durável',()=>{
  it('igual/ABA/delete-reinsert não recupera versão original',()=>{
    const f=fixture();f.sqlite.exec(insert);const original=f.revision()
    f.sqlite.exec("UPDATE media_assets SET title=title WHERE id='a'; DELETE FROM media_assets WHERE id='a'");f.sqlite.exec(insert)
    expect(f.revision()).toBe(original+3);validateAssetRemovalRevisions(f.sqlite)
  })
  it('vínculo e fallback antigo/novo incrementam cada ativo uma vez',()=>{
    const f=fixture();f.sqlite.exec(insert);f.sqlite.exec("INSERT INTO channels(id,name,width,height,rate_num,rate_den,target_lufs,ceiling_dbtp,limiter_lookahead_ms,created_at) VALUES('c','C',320,180,25,1,-23,-1,5,'now'); INSERT INTO rundowns(id,channel_id,name,date,planned_start,created_at,updated_at) VALUES('rd','c','RD','2026-10-06',0,'now','now')")
    const original=f.revision();f.sqlite.exec("INSERT INTO rundown_items(id,rundown_id,sort_order,type,title,media_id,live_fallback_media_id,min_duration,anchor,on_overrun,locked,auto_next,loop) VALUES('i','rd',0,'VT','I','a','a',0,'{\"kind\":\"FLOW\"}','PUSH',0,0,0)")
    expect(f.revision()).toBe(original+1)
    f.sqlite.exec("INSERT INTO media_assets(id,content_hash,path,title,kind,duration_frames,created_at) VALUES('b','H','b.mp4','B','VIDEO',250,'now')")
    const priorB=f.revision('A:b')
    f.sqlite.exec("UPDATE rundown_items SET media_id='b',live_fallback_media_id='b' WHERE id='i'")
    expect(f.revision()).toBe(original+2);expect(f.revision('A:b')).toBe(priorB+1)
    f.sqlite.exec("DELETE FROM rundown_items WHERE id='i'");expect(f.revision('A:b')).toBe(priorB+2)
  })
  it('mudança de candidato broken é durável; item saudável não bumpa PRUNE',()=>{
    const f=fixture(),before=f.revision('PRUNE');f.sqlite.exec(insert);expect(f.revision('PRUNE')).toBe(before)
    f.sqlite.exec("UPDATE media_assets SET probe_error='E' WHERE id='a'; UPDATE media_assets SET probe_error=NULL WHERE id='a'");expect(f.revision('PRUNE')).toBe(before+2)
  })
  it('migração de 30 preserva linhas e baseline é criado apenas uma vez',()=>{
    const file=path(),f=fixture(file);f.sqlite.exec(insert)
    const rows=f.sqlite.prepare('SELECT * FROM media_assets').all(),triggers=f.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'asset_removal_%'").all() as {name:string}[]
    for(const trigger of triggers)f.sqlite.exec(`DROP TRIGGER ${trigger.name}`)
    f.sqlite.exec('DROP TABLE asset_removal_versions; DELETE FROM schema_migrations WHERE version=31');f.sqlite.close()
    const migrated=fixture(file),revision=migrated.revision();expect(migrated.sqlite.prepare('SELECT * FROM media_assets').all()).toEqual(rows);migrated.sqlite.close()
    expect(fixture(file).revision()).toBe(revision)
  })
  it('duas conexões/restart/backup observam counters; snapshot conservado',async()=>{
    const file=path(),a=fixture(file);a.sqlite.exec(insert);const b=fixture(file),original=a.revision()
    b.sqlite.exec("UPDATE media_assets SET title=title WHERE id='a'");expect(a.revision()).toBe(original+1);a.sqlite.close();b.sqlite.close()
    expect(fixture(file).revision()).toBe(original+1);expect(await validateBackupRestore(file)).toMatchObject({integrity:'ok',foreignKeys:'ok'})
  })
  it.each(['missing-trigger','changed-trigger','missing-scope'])('abre/backup falham fechados com %s',async change=>{
    const file=path(),f=fixture(file)
    if(change==='missing-trigger')f.sqlite.exec('DROP TRIGGER asset_removal_items_update')
    if(change==='changed-trigger')f.sqlite.exec('DROP TRIGGER asset_removal_items_update; CREATE TRIGGER asset_removal_items_update BEFORE UPDATE ON rundown_items BEGIN SELECT 1; END')
    if(change==='missing-scope')f.sqlite.exec("DELETE FROM asset_removal_versions WHERE scope='REFERENCES'")
    expect(()=>validateAssetRemovalRevisions(f.sqlite)).toThrow();f.sqlite.close();expect(()=>openDatabase(file)).toThrow();await expect(validateBackupRestore(file)).rejects.toThrow()
  })
})
