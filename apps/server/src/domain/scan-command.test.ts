import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import {resolve} from 'node:path'
import {openDatabase} from '../db/client.js'
import {sessionDigest} from './access.js'
import {rootAuthority} from './root-edit.js'
import {readScanReview,queueScan} from './scan-command.js'
import {scanETag} from '@rplayout/protocol'
vi.mock('../config.js',async original=>({...await original<Record<string,unknown>>(),AUTH_USER:'',AUTH_PASSWORD:'',DEFAULT_ROLE:'ADMIN'}))
let db:ReturnType<typeof openDatabase>
const request={headers:{cookie:'rplayout_session=SESSION'},ip:'127.0.0.1'},path=resolve('Acervo Çãó')
beforeEach(()=>{db=openDatabase(':memory:');db.sqlite.exec("INSERT INTO users VALUES('u','Admin','NO_LOGIN','ADMIN',1,'now')");db.sqlite.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(sessionDigest('SESSION'),'u','2099-01-01','now');db.sqlite.prepare("INSERT INTO media_roots VALUES('r',?,'Acervo','now')").run(path)})
afterEach(()=>db.sqlite.close())
const actor=()=>rootAuthority(db.db,request),review=()=>readScanReview(db.db,actor(),true)
it('conferência não cria lote; alteração cega, extras e caminho arbitrário recusados',()=>{
  const r=review(),body={requestId:r.operationId,measure:false};expect(r.canStart).toBe(true)
  expect(db.sqlite.prepare('SELECT COUNT(*) n FROM ingest_batches').get()).toEqual({n:0})
  expect(()=>queueScan(db.db,body,undefined,actor(),true)).toThrow('original obrigatória')
  expect(()=>queueScan(db.db,{...body,enabled:true},scanETag(r),actor(),true)).toThrow('exige')
  expect(()=>queueScan(db.db,{...body,root:resolve('other')},scanETag(r),actor(),true)).toThrow('cadastrada')
})
it('pedido durável deduplicado preserva ID/raízes/modo e estado atual sem criar outro',()=>{
  const r=review(),body={requestId:r.operationId,measure:false,root:path},first=queueScan(db.db,body,scanETag(r),actor(),true)
  expect(first.state).toBe('PENDING');db.sqlite.exec("UPDATE ingest_batches SET state='RUNNING'")
  const repeated=queueScan(db.db,body,scanETag(r),actor(),true);expect(repeated.batchId).toBe(first.batchId);expect(repeated.state).toBe('RUNNING');expect(repeated.deduplicated).toBe(true)
  expect(()=>queueScan(db.db,{...body,measure:true},scanETag(r),actor(),true)).toThrow('Identificador')
  expect(db.sqlite.prepare('SELECT COUNT(*) n FROM ingest_batches').get()).toEqual({n:1})
  db.sqlite.exec('DELETE FROM ingest_batches');expect(queueScan(db.db,body,scanETag(r),actor(),true).state).toBe('UNKNOWN')
})
it('raízes e batch same-value/ABA invalidam revisão original',()=>{
  const r=review();db.sqlite.exec('UPDATE media_roots SET label=label')
  expect(()=>queueScan(db.db,{requestId:r.operationId,measure:false},scanETag(r),actor(),true)).toThrow('mudaram')
  const current=review();db.sqlite.exec("INSERT INTO ingest_batches(id,roots,measure,state,created_at,updated_at) VALUES('a','[]',0,'COMPLETED','now','now');UPDATE ingest_batches SET state=state;DELETE FROM ingest_batches")
  expect(()=>queueScan(db.db,{requestId:current.operationId,measure:false},scanETag(current),actor(),true)).toThrow('mudaram')
})
it('lote ativo e sonda indisponível recusam novo pedido; falha de audit reverte lote/counter',()=>{
  const r=review();expect(()=>queueScan(db.db,{requestId:r.operationId,measure:true},scanETag(r),actor(),false)).toThrow('configurada')
  db.sqlite.exec("CREATE TRIGGER scan_audit_failure BEFORE INSERT ON operator_decisions WHEN NEW.kind='MEDIA_SCAN_QUEUED' BEGIN SELECT RAISE(ABORT,'AUDIT_FAILED');END")
  expect(()=>queueScan(db.db,{requestId:r.operationId,measure:true},scanETag(r),actor(),true)).toThrow('AUDIT_FAILED')
  expect(review().batchRevision).toBe(r.batchRevision);expect(db.sqlite.prepare('SELECT COUNT(*) n FROM ingest_batches').get()).toEqual({n:0})
  db.sqlite.exec('DROP TRIGGER scan_audit_failure');queueScan(db.db,{requestId:r.operationId,measure:true},scanETag(r),actor(),true)
  const busy=review();expect(busy.canStart).toBe(false);expect(()=>queueScan(db.db,{requestId:busy.operationId,measure:false},scanETag(busy),actor(),true)).toThrow('ativo/pendente')
})
it.each(['revoke','scope','role','station'] as const)('autorização fresca recusa %s inclusive deduplicação',change=>{
  const a=actor(),r=readScanReview(db.db,a,true),body={requestId:r.operationId,measure:false};queueScan(db.db,body,scanETag(r),a,true)
  if(change==='revoke')db.sqlite.exec('DELETE FROM sessions')
  if(change==='scope')db.sqlite.exec("INSERT INTO user_access VALUES('u','[\"restricted\"]',NULL,'now')")
  if(change==='role')db.sqlite.exec("UPDATE users SET role='INVALID'")
  if(change==='station')db.sqlite.exec("INSERT INTO user_access VALUES('u',NULL,'[\"192.0.2.1\"]','now')")
  expect(()=>queueScan(db.db,body,scanETag(r),a,true)).toThrow(/sessão|compartilhado/);expect(db.sqlite.prepare('SELECT COUNT(*) n FROM ingest_batches').get()).toEqual({n:1})
})
