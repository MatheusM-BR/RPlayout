import {afterEach,beforeEach,it,expect,vi} from 'vitest'
import {resolve} from 'node:path'
import {openDatabase} from '../db/client.js'
import {IngestOwnership} from './ingest-ownership.js'
import {executionHostIdentity} from './execution-host.js'
import {operatorDecisions} from '../db/schema.js'
let db:ReturnType<typeof openDatabase>
const roots=[resolve('media')]
beforeEach(()=>{db=openDatabase(':memory:')})
afterEach(()=>{vi.restoreAllMocks();db.sqlite.close()})
const row=()=>db.sqlite.prepare('SELECT id,state,owner_host,owner_pid,owner_boot FROM ingest_batches').get() as {id:string;state:string;owner_host:string|null;owner_pid:number;owner_boot:string|null}
const seed=(host:string|null,pid:number|null,boot:string|null)=>db.sqlite.prepare("INSERT INTO ingest_batches(id,roots,measure,state,created_at,updated_at,owner_host,owner_pid,owner_boot) VALUES('old',?,0,'RUNNING','now','now',?,?,?)").run(JSON.stringify(roots),host,pid,boot)
it('claim vivo não é tomado por outro worker; fechamento tardio não altera dono sucessor',()=>{
  const a=new IngestOwnership(db.sqlite),b=new IngestOwnership(db.sqlite),id=a.claim(roots,false)!
  expect(b.claim(roots,false)).toBe(null);expect(b.pending()).toBe(null)
  db.sqlite.exec("UPDATE ingest_batches SET owner_boot='successor'")
  a.finish(id,false,null);expect(row().state).toBe('RUNNING');expect(row().owner_boot).toBe('successor')
})
it.each(['unknown','remote','alive','uncertain'] as const)('owner %s mantém o scanner bloqueado',mode=>{
  seed(mode==='unknown'?null:mode==='remote'?'remote':executionHostIdentity(),mode==='unknown'?null:process.pid,mode==='unknown'?null:'boot')
  if(mode==='uncertain')vi.spyOn(process,'kill').mockImplementation(()=>{throw Object.assign(new Error('denied'),{code:'EPERM'})})
  const worker=new IngestOwnership(db.sqlite),before=row();expect(worker.pending()).toBe(null);expect(worker.claim(roots,false)).toBe(null);expect(row()).toEqual(before)
})
it('apenas morte local comprovada retoma mesmo ID; caminhos e modo são congelados',()=>{
  seed(executionHostIdentity(),2147483647,'dead');vi.spyOn(process,'kill').mockImplementation(()=>{throw Object.assign(new Error('dead'),{code:'ESRCH'})})
  const worker=new IngestOwnership(db.sqlite),pending=worker.pending()!
  expect(pending.id).toBe('old');expect(row().state).toBe('PENDING')
  expect(worker.claim([resolve('elsewhere')],false,'old')).toBe(null);expect(worker.claim(roots,true,'old')).toBe(null)
  expect(worker.claim(roots,false,'old')).toBe('old');worker.finish('old',true,null);expect(row().state).toBe('PENDING');expect(row().owner_boot).toBe(null)
})
it('fila PENDING tem precedência; estado terminal e repetição de finish não retomam lote',()=>{
  seed(executionHostIdentity(),process.pid,'boot');db.sqlite.exec("UPDATE ingest_batches SET state='PENDING',owner_host=NULL,owner_pid=NULL,owner_boot=NULL")
  const worker=new IngestOwnership(db.sqlite);expect(worker.claim(roots,false)).toBe(null);expect(worker.claim(roots,false,'old')).toBe('old')
  worker.finish('old',false,null);expect(row().state).toBe('COMPLETED');expect(worker.claim(roots,false,'old')).toBe(null)
  worker.finish('old',true,'late');expect(row().state).toBe('COMPLETED')
})
it('PENDING com responsável contraditório ou modo inválido não pode ser reclamado',()=>{
  seed(executionHostIdentity(),process.pid,'boot');db.sqlite.exec("UPDATE ingest_batches SET state='PENDING'")
  const worker=new IngestOwnership(db.sqlite);expect(worker.pending()).toBe(null);expect(worker.claim(roots,false,'old')).toBe(null)
  db.sqlite.exec('UPDATE ingest_batches SET owner_host=NULL,owner_pid=NULL,owner_boot=NULL,measure=2')
  expect(worker.pending()).toBe(null);expect(worker.claim(roots,false,'old')).toBe(null)
})
it('recuperação automática registra prova/intent protegidos uma vez na mesma transação',()=>{
  seed(executionHostIdentity(),2147483647,'dead');vi.spyOn(process,'kill').mockImplementation(()=>{throw Object.assign(new Error('dead'),{code:'ESRCH'})})
  const a=new IngestOwnership(db.sqlite),b=new IngestOwnership(db.sqlite)
  expect(a.pending()?.id).toBe('old');expect(b.pending()?.id).toBe('old')
  const audits=db.db.select().from(operatorDecisions).all();expect(audits).toHaveLength(1)
  expect(audits[0]!.kind).toBe('MEDIA_SCAN_AUTO_RECOVERED');expect(audits[0]!.actorUsername).toBe(null)
  expect(audits[0]!.payload).toMatchObject({batchId:'old',roots,measure:false,proof:'LOCAL_PROCESS_ABSENT',recoveryActor:'SCANNER_WORKER',automaticTake:false,processKilled:false})
  expect(audits[0]!.payload.previousOwnerFingerprint).toMatch(/^[a-f0-9]{64}$/)
  for(const field of ['owner_pid','owner_host','owner_boot'])expect(field in audits[0]!.payload).toBe(false)
  const raw=db.sqlite.prepare('SELECT payload FROM operator_decisions').get() as {payload:string};expect(raw.payload).not.toContain(roots[0]);expect(raw.payload).not.toContain('LOCAL_PROCESS_ABSENT')
  expect(vi.mocked(process.kill).mock.calls.every(args=>args[1]===0)).toBe(true)
})
it.each(['pending','claim'] as const)('falha de auditoria reverte posse/revisão e impede %s',method=>{
  seed(executionHostIdentity(),2147483647,'dead');vi.spyOn(process,'kill').mockImplementation(()=>{throw Object.assign(new Error('dead'),{code:'ESRCH'})})
  const before=db.sqlite.prepare('SELECT * FROM ingest_batches').get(),revision=db.sqlite.prepare('SELECT * FROM scan_revision').get(),worker=new IngestOwnership(db.sqlite)
  db.sqlite.exec("CREATE TRIGGER auto_recovery_audit_failure BEFORE INSERT ON operator_decisions WHEN NEW.kind='MEDIA_SCAN_AUTO_RECOVERED' BEGIN SELECT RAISE(ABORT,'AUDIT_FAILED');END")
  expect(()=>method==='pending'?worker.pending():worker.claim(roots,false,'old')).toThrow('AUDIT_FAILED')
  expect(db.sqlite.prepare('SELECT * FROM ingest_batches').get()).toEqual(before);expect(db.sqlite.prepare('SELECT * FROM scan_revision').get()).toEqual(revision)
  expect(db.db.select().from(operatorDecisions).all()).toHaveLength(0)
  db.sqlite.exec('DROP TRIGGER auto_recovery_audit_failure');expect(worker.pending()?.id).toBe('old');expect(db.db.select().from(operatorDecisions).all()).toHaveLength(1)
})
it.each(['roots','measure'] as const)('RUNNING local morto com intenção %s inválida não é liberado nem auditado',field=>{
  seed(executionHostIdentity(),2147483647,'dead');vi.spyOn(process,'kill').mockImplementation(()=>{throw Object.assign(new Error('dead'),{code:'ESRCH'})})
  db.sqlite.exec(field==='roots'?"UPDATE ingest_batches SET roots='not-json'":'UPDATE ingest_batches SET measure=2')
  const before=row(),worker=new IngestOwnership(db.sqlite);expect(worker.pending()).toBe(null);expect(worker.claim(roots,false)).toBe(null);expect(row()).toEqual(before)
  expect(db.db.select().from(operatorDecisions).all()).toHaveLength(0);expect(process.kill).not.toHaveBeenCalled()
})
