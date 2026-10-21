import {afterEach,it,expect} from 'vitest'
import Database from 'better-sqlite3'
import {randomUUID} from 'node:crypto'
import {UpgradeBackups} from './upgrade-backups.js'
import {migrateUpgradeBackupRequests} from '../db/upgrade-backup-requests.js'
const databases:Database.Database[]=[]
afterEach(()=>{for(const db of databases.splice(0))db.close()})
function fixture(){const db=new Database(':memory:');databases.push(db);db.exec('CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT NOT NULL,applied_at TEXT NOT NULL)');migrateUpgradeBackupRequests(db);return {db,service:new UpgradeBackups(db,'unused-fixture-directory')}}
// NOT_RUN: fixtures prepared for the consolidated validation round.
it('authorization failure does not create an intent or a backup',()=>{
  const {db,service}=fixture()
  expect(()=>service.create({requestId:randomUUID()},()=>{throw new Error('denied')})).toThrow('denied')
  expect(db.prepare('SELECT count(*) n FROM backup_upgrade_requests').get()).toEqual({n:0})
})
it('same UUID queries the durable refusal instead of starting another backup',async()=>{
  const {db,service}=fixture(),request={requestId:randomUUID()};let checks=0
  service.create(request,()=>{if(++checks>2)throw new Error('expired before asynchronous builder')})
  await service.settled()
  expect(service.query(request).phase).toBe('REFUSED')
  expect(service.create(request,()=>{}).phase).toBe('REFUSED')
  expect(db.prepare('SELECT count(*) n FROM backup_upgrade_requests').get()).toEqual({n:1})
  expect((db.prepare('SELECT report FROM backup_upgrade_requests').get() as {report:string}).report).not.toContain('Resultado não aprovado')
})
it('closing prevents new work and an active/unknown creator cannot be reconciled',async()=>{
  const {service}=fixture(),request={requestId:randomUUID()};let checks=0
  service.create(request,()=>{if(++checks>2)throw new Error('abort before backup')})
  expect(()=>service.reconcile({...request,confirm:true},()=>{})).toThrow('vivo')
  await service.settled();service.close()
  expect(()=>service.create({requestId:randomUUID()},()=>{})).toThrow('encerrando')
})
it('pedido em CHECKING herdado de criador local morto é reconciliado na partida; remoto fica preservado',async()=>{
  const {hostname}=await import('node:os')
  // The copy is taken while the request still runs: the row keeps CHECKING
  // with another process as creator (its result can never be stored here).
  const copied=async(creator:object)=>{
    const {db,service}=fixture(),request={requestId:randomUUID()}
    service.create(request,()=>{})
    db.prepare('UPDATE backup_upgrade_requests SET creator=? WHERE request_id=?').run(JSON.stringify(creator),request.requestId)
    await service.settled()
    const phase=()=>(db.prepare('SELECT phase FROM backup_upgrade_requests WHERE request_id=?').get(request.requestId) as {phase:string}).phase
    expect(phase()).toBe('CHECKING')
    const restarted=new UpgradeBackups(db,'unused-fixture-directory')
    return {phase:phase(),restarted}
  }
  const dead=await copied({host:hostname(),pid:0x7ffffff0,boot:randomUUID()})
  expect(dead.phase).toBe('REFUSED')
  const remote=await copied({host:'outro-servidor',pid:4242,boot:randomUUID()})
  expect(remote.phase).toBe('CHECKING')
  expect(()=>remote.restarted.create({requestId:randomUUID()},()=>{})).toThrow('em andamento')
})
