import {afterEach,describe,expect,it} from 'vitest'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import Database from 'better-sqlite3'
import {openDatabase} from './client.js'
import {validateAudioBus} from './audio-bus.js'
const owned:string[]=[]
afterEach(()=>{for(const dir of owned.splice(0))rmSync(dir,{recursive:true,force:true})})
describe('migração do barramento de áudio',()=>{
  it('upgrade conserva canais estéreo, persiste 16 e é idempotente',()=>{
    const dir=mkdtempSync(join(tmpdir(),'rplayout-audio-bus-'));owned.push(dir);const file=join(dir,'test.db')
    const original=openDatabase(file)
    original.sqlite.exec("INSERT INTO channels(id,name,width,height,rate_num,rate_den,target_lufs,ceiling_dbtp,limiter_lookahead_ms,created_at) VALUES('ch','QA',320,180,25,1,-23,-1,5,'now'); ALTER TABLE channels DROP COLUMN audio_channels; DELETE FROM schema_migrations WHERE version=20")
    original.sqlite.close()
    const upgraded=openDatabase(file)
    expect(upgraded.sqlite.prepare('SELECT audio_channels FROM channels').get()).toEqual({audio_channels:2})
    expect(()=>upgraded.sqlite.exec('UPDATE channels SET audio_channels=4')).toThrow()
    upgraded.sqlite.exec('UPDATE channels SET audio_channels=16');upgraded.sqlite.close()
    const reopened=openDatabase(file)
    expect(reopened.sqlite.prepare('SELECT audio_channels FROM channels').get()).toEqual({audio_channels:16})
    expect(reopened.sqlite.prepare('SELECT count(*) n FROM schema_migrations WHERE version=20').get()).toEqual({n:1});reopened.sqlite.close()
  })
  it('recusa contrato SQL removido em backup/startup',()=>{
    const value=openDatabase(':memory:')
    value.sqlite.exec('ALTER TABLE channels DROP COLUMN audio_channels')
    expect(()=>validateAudioBus(value.sqlite)).toThrow('Contrato')
    value.sqlite.close()
    const legacy=new Database(':memory:');legacy.exec('CREATE TABLE schema_migrations(version INTEGER)')
    expect(()=>validateAudioBus(legacy)).not.toThrow();legacy.close()
    const historical=new Database(':memory:')
    expect(()=>validateAudioBus(historical)).not.toThrow();historical.close()
  })
})
