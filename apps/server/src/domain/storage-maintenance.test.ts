import {afterEach,expect,it,vi} from 'vitest'
import Database from 'better-sqlite3'
import {mkdtemp,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {randomUUID} from 'node:crypto'
import {openDatabase} from '../db/client.js'
import {readStorageAdmission,storageAdmissionSignature} from '../db/storage-admission.js'
import {readServerInstances,serverInstanceSignature} from '../db/server-instances.js'
import {ServerInstanceRegistration} from './server-instances.js'
import {StorageMaintenance} from './storage-maintenance.js'
import {backupDatabase} from './backup.js'
const connections:Database.Database[]=[],dirs:string[]=[]
afterEach(async()=>{vi.restoreAllMocks();for(const db of connections.splice(0))if(db.open)db.close();for(const dir of dirs.splice(0))await rm(dir,{recursive:true,force:true})})
function setup(){const {sqlite}=openDatabase(':memory:');connections.push(sqlite);return sqlite}
it('reserva bloqueia registro e só seu detentor reabre; não promove quarentena',()=>{
  const db=setup();db.exec('CREATE TABLE ha_recovery_origin(id INTEGER)')
  const lease=new StorageMaintenance(db);lease.acquire();lease.assertHeld()
  const reserved=readStorageAdmission(db)
  expect(reserved).toMatchObject({phase:'MAINTENANCE',revision:1})
  expect(()=>new ServerInstanceRegistration(db)).toThrow('manutenção')
  expect(()=>new StorageMaintenance(db).acquire()).toThrow('livre')
  expect(()=>new StorageMaintenance(db).release()).toThrow('perdida')
  lease.release();expect(readStorageAdmission(db)).toMatchObject({phase:'OPEN',revision:2,owner:null})
  expect(db.prepare("SELECT name FROM sqlite_master WHERE name='ha_recovery_origin'").get()).toBeTruthy()
  expect(()=>lease.assertHeld()).toThrow('perdida');new ServerInstanceRegistration(db)
})
it('instância viva bloqueia reserva mesmo declarando armazenamento fechado',()=>{
  const db=setup(),instance=new ServerInstanceRegistration(db);instance.storageClosed()
  const before=readStorageAdmission(db)
  expect(()=>new StorageMaintenance(db).acquire()).toThrow('viva')
  expect(readStorageAdmission(db)).toEqual(before)
})
it.each(['ESRCH','EPERM','REMOTE'] as const)('dono anterior %s conserva incerteza ou autoriza somente reserva de armazenamento',mode=>{
  const db=setup();new ServerInstanceRegistration(db)
  const original=readServerInstances(db)[0]!,row={...original,pid:2147483647,...(mode==='REMOTE'?{host:'remote'}:{})}
  db.prepare('UPDATE server_instances SET payload=?,signature=?').run(JSON.stringify(row),serverInstanceSignature(row))
  const kill=vi.spyOn(process,'kill').mockImplementation(()=>{throw Object.assign(new Error('probe'),{code:mode})})
  const lease=new StorageMaintenance(db)
  if(mode==='ESRCH'){lease.acquire();expect(readStorageAdmission(db)?.phase).toBe('MAINTENANCE')}
  else expect(()=>lease.acquire()).toThrow('incerta')
  if(mode==='REMOTE')expect(kill).not.toHaveBeenCalled()
})
it('assinatura inválida não admite partida, reserva ou backup',async()=>{
  const db=setup();db.exec("UPDATE storage_admission SET signature='forged'")
  expect(()=>new ServerInstanceRegistration(db)).toThrow('Assinatura')
  expect(()=>new StorageMaintenance(db).acquire()).toThrow('Assinatura')
  const path=await mkdtemp(join(tmpdir(),'RPlayout-admission-test-'));dirs.push(path)
  await expect(backupDatabase(db,path)).rejects.toThrow('Assinatura')
})
it('mudança assinada da geração impede detentor antigo de liberar reserva',()=>{
  const db=setup(),lease=new StorageMaintenance(db);lease.acquire()
  const row=readStorageAdmission(db)!,changed={...row,revision:row.revision+1,owner:{...row.owner!,boot:randomUUID()}}
  db.prepare('UPDATE storage_admission SET payload=?,signature=?').run(JSON.stringify(changed),storageAdmissionSignature(changed))
  expect(()=>lease.release()).toThrow('perdida');expect(readStorageAdmission(db)).toEqual(changed)
})
it('fechamento não aceita outra encarnação assinada com mesmo id/pid/host',()=>{
  const db=setup(),instance=new ServerInstanceRegistration(db),row={...readServerInstances(db)[0]!,boot:randomUUID()}
  db.prepare('UPDATE server_instances SET payload=?,signature=?').run(JSON.stringify(row),serverInstanceSignature(row))
  expect(()=>instance.storageClosed()).toThrow('mudou');expect(readServerInstances(db)[0]!.phase).toBe('OPEN')
})
it('reserva persiste após reconexão; migração e callback de partida não executam',async()=>{
  const path=await mkdtemp(join(tmpdir(),'RPlayout-maintenance-db-'));dirs.push(path)
  const file=join(path,'service.db'),db=openDatabase(file).sqlite;connections.push(db)
  const lease=new StorageMaintenance(db);lease.acquire();db.close()
  const callback=vi.fn();expect(()=>openDatabase(file,{onOpened:callback})).toThrow('manutenção');expect(callback).not.toHaveBeenCalled()
  const check=new Database(file,{readonly:true});connections.push(check)
  expect(readStorageAdmission(check)).toMatchObject({phase:'MAINTENANCE',revision:1})
  expect(()=>new StorageMaintenance(check).acquire()).toThrow('livre')
})
it('migrações e registro ficam na mesma transação de admissão; erro de partida reverte ambos',async()=>{
  const path=await mkdtemp(join(tmpdir(),'RPlayout-admission-rollback-'));dirs.push(path)
  const file=join(path,'service.db')
  expect(()=>openDatabase(file,{onOpened:db=>{new ServerInstanceRegistration(db);throw new Error('injected-startup')}})).toThrow('injected-startup')
  const check=new Database(file);connections.push(check)
  expect(check.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()).toEqual([])
})
