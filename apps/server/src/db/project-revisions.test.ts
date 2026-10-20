import {afterEach,describe,expect,it} from 'vitest'
import {mkdtempSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import type Database from 'better-sqlite3'
import {openDatabase} from './client.js'
import {projectRevision,validateProjectRevisions} from './project-revisions.js'
import {validateBackupRestore} from '../domain/backup.js'
const opened:Database.Database[]=[]
afterEach(()=>{for(const db of opened.splice(0))if(db.open)db.close()})
const channelSql="INSERT INTO channels(id,name,width,height,rate_num,rate_den,target_lufs,ceiling_dbtp,limiter_lookahead_ms,created_at) VALUES('a','A',320,180,25,1,-23,-1,5,'now'),('b','B',320,180,25,1,-23,-1,5,'now')"
function fixture(file=':memory:',seed=true){const value=openDatabase(file);opened.push(value.sqlite);if(seed)value.sqlite.exec(channelSql);return {...value,revision:(id='a')=>projectRevision(value.db,id)}}
const filePath=()=>join(mkdtempSync(join(tmpdir(),'RPlayout-project-revisions-')),'fixture.db')
describe('migração 24 e revisões de projeto entre escritores',()=>{
  it('preserva tombstone e invalida ambos os donos ao mover registros',()=>{
    const f=fixture()
    f.sqlite.exec("INSERT INTO output_profiles(id,channel_id,name,kind,target,created_at) VALUES('out','a','QA','FILE','qa.mp4','now')")
    expect(f.revision()).toBe(2);expect(f.revision('b')).toBe(1)
    f.sqlite.exec("UPDATE output_profiles SET channel_id='b' WHERE id='out'")
    expect(f.revision()).toBe(3);expect(f.revision('b')).toBe(2)
    f.sqlite.exec("DELETE FROM channels WHERE id='a'; INSERT INTO channels(id,name,width,height,rate_num,rate_den,target_lufs,ceiling_dbtp,limiter_lookahead_ms,created_at) VALUES('a','A',320,180,25,1,-23,-1,5,'now')")
    expect(f.revision()).toBe(5)
  })
  it('dependências compartilhadas invalidam conservadoramente todos os canais',()=>{
    const f=fixture()
    f.sqlite.exec("INSERT INTO external_devices(id,name,kind,host,port,created_at) VALUES('dev','QA','GPIO_RELAY','127.0.0.1',1,'now')")
    expect(f.revision()).toBe(2);expect(f.revision('b')).toBe(2)
    f.sqlite.exec("INSERT INTO graphic_templates(id,name,svg,fields,fade_ms,created_at) VALUES('global','QA','<svg/>','[]',0,'now')")
    expect(f.revision()).toBe(3);expect(f.revision('b')).toBe(3)
    f.sqlite.exec("INSERT INTO qc_decisions(id,asset_id,content_hash,channel_id,status,checks,created_at) VALUES('qc','asset','hash','a','APPROVED','{}','now')")
    expect(f.revision()).toBe(4);expect(f.revision('b')).toBe(4)
  })
  it('dois bancos e reinício observam revisão durável; backup verifica triggers',async()=>{
    const file=filePath(),a=fixture(file),b=fixture(file,false)
    b.sqlite.exec("UPDATE channels SET name='Outro escritor' WHERE id='a'")
    expect(a.revision()).toBe(2);a.sqlite.close();b.sqlite.close()
    const restarted=fixture(file,false);expect(restarted.revision()).toBe(2)
    expect(await validateBackupRestore(file)).toMatchObject({integrity:'ok',foreignKeys:'ok'})
  })
  it('banco 23 recebe baseline uma única vez, sem alterar grade/configuração',()=>{
    const file=filePath(),f=fixture(file)
    const triggers=f.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'project_revision_%'").all() as {name:string}[]
    for(const trigger of triggers)f.sqlite.exec(`DROP TRIGGER ${trigger.name}`)
    f.sqlite.exec('DROP TABLE channel_project_versions; DELETE FROM schema_migrations WHERE version=24')
    const before=f.sqlite.prepare('SELECT * FROM channels ORDER BY id').all();f.sqlite.close()
    const upgraded=fixture(file,false),revision=upgraded.revision()
    expect(revision).toBeGreaterThanOrEqual(2**40);expect(upgraded.sqlite.prepare('SELECT * FROM channels ORDER BY id').all()).toEqual(before)
    upgraded.sqlite.close();expect(fixture(file,false).revision()).toBe(revision)
  })
  it.each(['counter','trigger','table'])('startup e backup recusam contrato danificado: %s',async damage=>{
    const file=filePath(),f=fixture(file)
    f.sqlite.exec(damage==='counter'?"DELETE FROM channel_project_versions WHERE channel_id='a'":damage==='trigger'?'DROP TRIGGER project_revision_channels_update':'DROP TABLE channel_project_versions')
    expect(()=>validateProjectRevisions(f.sqlite)).toThrow();f.sqlite.close()
    await expect(validateBackupRestore(file)).rejects.toThrow();expect(()=>openDatabase(file)).toThrow()
  })
})
