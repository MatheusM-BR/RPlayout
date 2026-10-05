import {afterEach,describe,expect,it} from 'vitest'
import {mkdtempSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import type Database from 'better-sqlite3'
import {openDatabase} from './client.js'
import {validateBackupRestore} from '../domain/backup.js'

const opened:Database.Database[]=[],directories:string[]=[]
afterEach(()=>{for(const db of opened.splice(0))if(db.open)db.close();for(const directory of directories.splice(0))rmSync(directory,{recursive:true,force:true})})
function fixture(file=':memory:') {
  const value=openDatabase(file);opened.push(value.sqlite)
  value.sqlite.exec(`INSERT INTO media_assets(id,content_hash,path,title,kind,duration_frames,default_trim,created_at)
    VALUES('asset','hash','C:/Ação.mxf','VT','VIDEO',100,'{"in":25,"out":100}','now')`)
  return value.sqlite
}
function file(){const directory=mkdtempSync(join(tmpdir(),'RPlayout-trim-cadence-'));directories.push(directory);return join(directory,'bank.db')}

describe('migração 19: unidades do corte padrão sem presumir cadência legada',()=>{
  it('backup 18 antes do upgrade e 19 depois restauram sem reinterpretar o legado',async()=>{
    const path=file(),old=fixture(path)
    old.exec('DROP TRIGGER media_trim_cadence_insert; DROP TRIGGER media_trim_cadence_update; ALTER TABLE media_assets DROP COLUMN default_trim_rate_num; ALTER TABLE media_assets DROP COLUMN default_trim_rate_den; DELETE FROM schema_migrations WHERE version=19')
    old.close()
    expect(await validateBackupRestore(path)).toMatchObject({integrity:'ok'})
    const upgraded=openDatabase(path);opened.push(upgraded.sqlite)
    const data=upgraded.sqlite.prepare('SELECT default_trim,default_trim_rate_num,default_trim_rate_den FROM media_assets').get()
    expect(data).toEqual({default_trim:'{"in":25,"out":100}',default_trim_rate_num:null,default_trim_rate_den:null})
    upgraded.sqlite.close()
    const again=openDatabase(path);opened.push(again.sqlite)
    expect(again.sqlite.prepare('SELECT default_trim,default_trim_rate_num,default_trim_rate_den FROM media_assets').get()).toEqual(data)
    expect(again.sqlite.prepare('SELECT count(*) n FROM schema_migrations WHERE version=19').get()).toEqual({n:1})
    expect(await validateBackupRestore(path)).toMatchObject({integrity:'ok'})
  })
  it.each([[25,null],[null,1],[0,1],[250,1],[25.5,1]])('escrita SQL de cadência inválida é recusada: %j/%j',(num,den)=>{
    const db=fixture()
    expect(()=>db.prepare('UPDATE media_assets SET default_trim_rate_num=?,default_trim_rate_den=?').run(num,den)).toThrow('Cadência')
    expect(db.prepare('SELECT default_trim_rate_num,default_trim_rate_den FROM media_assets').get()).toEqual({default_trim_rate_num:null,default_trim_rate_den:null})
  })
  it('taxa racional válida persiste e pode ser removida junto do padrão',()=>{
    const db=fixture()
    db.exec('UPDATE media_assets SET default_trim_rate_num=30000,default_trim_rate_den=1001')
    expect(()=>db.exec('UPDATE media_assets SET default_trim=NULL')).toThrow('Cadência')
    db.exec('UPDATE media_assets SET default_trim=NULL,default_trim_rate_num=NULL,default_trim_rate_den=NULL')
  })
  it.each(['column','trigger'] as const)('migração marcada mas %s ausente não é tratada como legado',async kind=>{
    const path=file(),db=fixture(path)
    db.exec('DROP TRIGGER media_trim_cadence_update')
    if(kind==='column'){db.exec('DROP TRIGGER media_trim_cadence_insert; ALTER TABLE media_assets DROP COLUMN default_trim_rate_den')}
    db.close()
    expect(()=>openDatabase(path)).toThrow(/Banco incompleto|Proteção/)
    await expect(validateBackupRestore(path)).rejects.toThrow(/Banco incompleto|Proteção/)
  })
})
