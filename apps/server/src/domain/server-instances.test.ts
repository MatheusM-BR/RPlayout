import {afterEach,expect,it,vi} from 'vitest'
import {openDatabase} from '../db/client.js'
import {ServerInstanceRegistration,serverInstanceStorageStatus} from './server-instances.js'
import {readServerInstances,serverInstanceSignature,validateServerInstances,migrateServerInstances} from '../db/server-instances.js'
import {randomUUID} from 'node:crypto'
import {executionHostIdentity} from './execution-host.js'
import {backupDatabase} from './backup.js'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
const databases:ReturnType<typeof openDatabase>[]=[],directories:string[]=[]
afterEach(async()=>{for(const db of databases.splice(0))db.sqlite.close();for(const path of directories.splice(0))await rm(path,{recursive:true,force:true});vi.restoreAllMocks()})
function setup(){const db=openDatabase(':memory:');databases.push(db);return db}
it('partida e declaração de fechamento são assinadas/idempotentes; não provam morte do processo',()=>{
  const db=setup(),first=new ServerInstanceRegistration(db.sqlite),second=new ServerInstanceRegistration(db.sqlite)
  expect(first.id).not.toBe(second.id);expect(readServerInstances(db.sqlite)).toHaveLength(2)
  expect(serverInstanceStorageStatus(db.sqlite)).toMatchObject({open:2,protected:2,storageReleaseBlocked:true,nativeResourcesStopped:false})
  first.storageClosed();first.storageClosed()
  expect(serverInstanceStorageStatus(db.sqlite)).toMatchObject({open:1,storageClosed:1,protected:2,storageReleaseBlocked:true})
  const before=db.sqlite.prepare('SELECT * FROM server_instances').all();migrateServerInstances(db.sqlite);expect(db.sqlite.prepare('SELECT * FROM server_instances').all()).toEqual(before)
})
it.each(['remote','alive','uncertain','absent'] as const)('somente ESRCH local é ausência; caso %s',mode=>{
  const db=setup(),row={version:1 as const,id:randomUUID(),host:mode==='remote'?'remote':executionHostIdentity(),pid:2147483647,boot:randomUUID(),phase:'OPEN' as const,openedAt:new Date().toISOString(),closedAt:null}
  db.sqlite.prepare('INSERT INTO server_instances VALUES(?,?,?)').run(row.id,JSON.stringify(row),serverInstanceSignature(row))
  const kill=vi.spyOn(process,'kill').mockImplementation(()=>{if(mode==='alive')return true;throw Object.assign(new Error('probe'),{code:mode==='uncertain'?'EPERM':'ESRCH'})})
  const before=db.sqlite.prepare('SELECT * FROM server_instances').all()
  expect(serverInstanceStorageStatus(db.sqlite)).toMatchObject({protected:mode==='absent'?0:1,localAbsent:mode==='absent'?1:0,storageReleaseBlocked:mode!=='absent',nativeResourcesStopped:false})
  expect(db.sqlite.prepare('SELECT * FROM server_instances').all()).toEqual(before);if(mode==='remote')expect(kill).not.toHaveBeenCalled()
})
it('registro adulterado não é reclassificado/ignorado nem fechado por outro dono',()=>{
  const db=setup(),instance=new ServerInstanceRegistration(db.sqlite)
  db.sqlite.prepare("UPDATE server_instances SET signature='forged' WHERE id=?").run(instance.id)
  expect(()=>instance.storageClosed()).toThrow('inválido');expect(()=>serverInstanceStorageStatus(db.sqlite)).toThrow('inválido');expect(()=>validateServerInstances(db.sqlite)).toThrow('inválido')
})
it('backup conserva as assinaturas e recusa tabela/registro de migração ausentes',async()=>{
  const db=setup();new ServerInstanceRegistration(db.sqlite);const path=await mkdtemp(join(tmpdir(),'RPlayout-instance-backup-'));directories.push(path)
  const backup=await backupDatabase(db.sqlite,path);expect(backup.validation.tables.server_instances).toBe(1)
  db.sqlite.exec('DELETE FROM schema_migrations WHERE version=41');expect(()=>validateServerInstances(db.sqlite)).toThrow('migração')
})
