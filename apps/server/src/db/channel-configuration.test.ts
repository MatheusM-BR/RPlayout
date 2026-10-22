import {afterEach,describe,expect,it} from 'vitest'
import {mkdtempSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import type Database from 'better-sqlite3'
import {openDatabase} from './client.js'
import {configurationRevision,validateChannelConfiguration} from './channel-configuration.js'
import {getChannel,listChannels} from './repo.js'
import {validateBackupRestore} from '../domain/backup.js'

const opened:Database.Database[]=[],directories:string[]=[]
afterEach(()=>{
  for(const db of opened.splice(0))if(db.open)db.close()
  for(const directory of directories.splice(0))rmSync(directory,{recursive:true,force:true})
})
function fixture(file=':memory:',seed=true){
  const value=openDatabase(file);opened.push(value.sqlite)
  if(seed)value.sqlite.exec("INSERT INTO channels(id,name,width,height,rate_num,rate_den,target_lufs,ceiling_dbtp,limiter_lookahead_ms,created_at) VALUES('ch','QC',320,180,25,1,-23,-1,5,'now'),('other','Outro',320,180,25,1,-23,-1,5,'now')")
  return {...value,revision:(id='ch')=>configurationRevision(value.db,id)}
}
function path(){const directory=mkdtempSync(join(tmpdir(),'RPlayout-channel-revisions-'));directories.push(directory);return join(directory,'test.db')}

describe('base persistida da revisão de configuração (a guarda HTTP é etapa separada)',()=>{
  it('DTO carrega configuração e revisão do mesmo snapshot',async()=>{
    const f=fixture()
    expect(await getChannel(f.db,'ch')).toMatchObject({name:'QC',configurationRevision:1})
    f.sqlite.exec("UPDATE channels SET name='Atualizado' WHERE id='ch'")
    expect((await listChannels(f.db)).find(channel=>channel.id==='ch')).toMatchObject({name:'Atualizado',configurationRevision:2})
    expect(f.revision('other')).toBe(1)
  })
  it('detecta ABA e preserva tombstone ao excluir e reinserir canal',()=>{
    const f=fixture()
    f.sqlite.exec("UPDATE channels SET name='Temporário' WHERE id='ch'; UPDATE channels SET name='QC' WHERE id='ch'")
    expect(f.revision()).toBe(3)
    f.sqlite.exec("DELETE FROM channels WHERE id='ch'; INSERT INTO channels(id,name,width,height,rate_num,rate_den,target_lufs,ceiling_dbtp,limiter_lookahead_ms,created_at) VALUES('ch','QC',320,180,25,1,-23,-1,5,'now')")
    expect(f.revision()).toBe(5)
    expect(()=>f.revision('missing')).toThrow('nenhuma versão será presumida')
  })
  it('saídas invalidam seus donos; mover uma saída invalida canal anterior e novo',()=>{
    const f=fixture()
    f.sqlite.exec("INSERT INTO output_profiles(id,channel_id,name,kind,target,created_at) VALUES('out','ch','Monitor','FILE','qa.mp4','now')")
    expect(f.revision()).toBe(2);expect(f.revision('other')).toBe(1)
    f.sqlite.exec("UPDATE output_profiles SET channel_id='other' WHERE id='out'")
    expect(f.revision()).toBe(3);expect(f.revision('other')).toBe(2)
    f.sqlite.exec("DELETE FROM output_profiles WHERE id='out'")
    expect(f.revision()).toBe(3);expect(f.revision('other')).toBe(3)
  })
  it('rollback e limite numérico conservam dados e contadores juntos',()=>{
    const f=fixture()
    expect(()=>f.sqlite.transaction(()=>{f.sqlite.exec("UPDATE channels SET name='Não commitado' WHERE id='ch'");throw new Error('falha')})()).toThrow('falha')
    expect(f.revision()).toBe(1)
    f.sqlite.prepare("UPDATE channel_configuration_versions SET version=? WHERE channel_id='ch'").run(Number.MAX_SAFE_INTEGER)
    expect(()=>f.sqlite.exec("UPDATE channels SET name='Overflow' WHERE id='ch'")).toThrow()
    expect(f.sqlite.prepare("SELECT name FROM channels WHERE id='ch'").get()).toEqual({name:'QC'})
    expect(f.revision()).toBe(Number.MAX_SAFE_INTEGER)
  })
  it('outro escritor e reinício enxergam a mesma revisão; backup valida contrato',async()=>{
    const file=path(),a=fixture(file),b=fixture(file,false)
    b.sqlite.exec("UPDATE channels SET name='Segundo escritor' WHERE id='ch'")
    expect(a.revision()).toBe(2)
    a.sqlite.close();b.sqlite.close()
    const reopened=fixture(file,false)
    expect(reopened.revision()).toBe(2)
    expect(await validateBackupRestore(file)).toMatchObject({integrity:'ok'})
  })
  it('startup/backup recusam trigger removido ou counter inexistente',async()=>{
    const file=path(),f=fixture(file)
    f.sqlite.exec("DELETE FROM channel_configuration_versions WHERE channel_id='ch'")
    expect(()=>validateChannelConfiguration(f.sqlite)).toThrow('incompletas')
    f.sqlite.exec("INSERT INTO channel_configuration_versions VALUES('ch',1); DROP TRIGGER channel_configuration_update")
    expect(()=>validateChannelConfiguration(f.sqlite)).toThrow('channel_configuration_update')
    f.sqlite.close()
    await expect(validateBackupRestore(file)).rejects.toThrow('channel_configuration_update')
    expect(()=>fixture(file,false)).toThrow('channel_configuration_update')
  })
})
