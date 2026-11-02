import {afterEach,describe,expect,it} from 'vitest'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import type Database from 'better-sqlite3'
import {openDatabase} from './client.js'
import {configurationRevision} from './channel-configuration.js'
import {validatePresetConfiguration} from './preset-configuration.js'
import {validateBackupRestore} from '../domain/backup.js'
import {transmissionPresets} from './schema.js'
const handles:Database.Database[]=[],directories:string[]=[]
afterEach(()=>{for(const handle of handles.splice(0))if(handle.open)handle.close();for(const path of directories.splice(0))rmSync(path,{recursive:true,force:true})})
function fixture(path=':memory:',seed=true){
  const value=openDatabase(path);handles.push(value.sqlite)
  if(seed)value.sqlite.exec("INSERT INTO channels(id,name,width,height,rate_num,rate_den,target_lufs,ceiling_dbtp,limiter_lookahead_ms,created_at) VALUES('ch','QA',320,180,25,1,-23,-1,5,'now'),('other','Outro',320,180,25,1,-23,-1,5,'now')")
  return {...value,revision:(id='ch')=>configurationRevision(value.db,id)}
}
function file(){const path=mkdtempSync(join(tmpdir(),'RPlayout-preset-revisions-'));directories.push(path);return join(path,'qa.db')}
const insert=(f:ReturnType<typeof fixture>)=>f.db.insert(transmissionPresets).values({id:'preset',channelId:'ch',name:'Destino',kind:'RTMP',target:'rtmp://localhost/live/qa',createdAt:'now'}).run()
describe('presets invalidam a configuração publicada à tela',()=>{
  it('ABA, mudança de dono e remoção incrementam todos os canais afetados',()=>{
    const f=fixture();insert(f);expect(f.revision()).toBe(2)
    f.sqlite.exec("UPDATE transmission_presets SET name='Outro' WHERE id='preset'; UPDATE transmission_presets SET name='Destino' WHERE id='preset'")
    expect(f.revision()).toBe(4);expect(f.revision('other')).toBe(1)
    f.sqlite.exec("UPDATE transmission_presets SET channel_id='other' WHERE id='preset'")
    expect(f.revision()).toBe(5);expect(f.revision('other')).toBe(2)
    f.sqlite.exec("DELETE FROM transmission_presets WHERE id='preset'");expect(f.revision('other')).toBe(3)
  })
  it('rollback de preset e overflow conservam o contador e o registro',()=>{
    const f=fixture()
    expect(()=>f.sqlite.transaction(()=>{insert(f);throw new Error('rollback')})()).toThrow('rollback')
    expect(f.revision()).toBe(1);expect(f.sqlite.prepare('SELECT count(*) n FROM transmission_presets').get()).toEqual({n:0})
    f.sqlite.prepare("UPDATE channel_configuration_versions SET version=? WHERE channel_id='ch'").run(Number.MAX_SAFE_INTEGER)
    expect(()=>insert(f)).toThrow();expect(f.sqlite.prepare('SELECT count(*) n FROM transmission_presets').get()).toEqual({n:0})
  })
  it('migração a partir de 21 invalida snapshot anterior uma vez e preserva dados',()=>{
    const path=file(),f=fixture(path);insert(f);const old=f.revision()
    f.sqlite.exec('DROP TRIGGER channel_configuration_preset_insert; DROP TRIGGER channel_configuration_preset_update; DROP TRIGGER channel_configuration_preset_delete; DELETE FROM schema_migrations WHERE version=22');f.sqlite.close()
    const next=fixture(path,false);expect(next.revision()).toBe(old+1);expect(next.sqlite.prepare('SELECT name FROM transmission_presets').get()).toEqual({name:'Destino'});next.sqlite.close()
    expect(fixture(path,false).revision()).toBe(old+1)
  })
  it('outro escritor/reinício e restauração de backup conservam o contrato',async()=>{
    const path=file(),a=fixture(path),b=fixture(path,false);insert(b)
    expect(a.revision()).toBe(2);a.sqlite.close();b.sqlite.close()
    const reopened=fixture(path,false);expect(reopened.revision()).toBe(2)
    expect(await validateBackupRestore(path)).toMatchObject({integrity:'ok'})
  })
  it('startup e backup recusam proteção de preset adulterada',async()=>{
    const path=file(),f=fixture(path)
    f.sqlite.exec('DROP TRIGGER channel_configuration_preset_update')
    expect(()=>validatePresetConfiguration(f.sqlite)).toThrow('channel_configuration_preset_update');f.sqlite.close()
    await expect(validateBackupRestore(path)).rejects.toThrow('channel_configuration_preset_update')
    expect(()=>fixture(path,false)).toThrow('channel_configuration_preset_update')
  })
})
