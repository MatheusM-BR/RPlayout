import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import {resolve} from 'node:path'
import {openDatabase} from '../db/client.js'
import {sessionDigest} from './access.js'
import {rootAuthority} from './root-edit.js'
import {readScanReview} from './scan-command.js'
import {recoverScan} from './scan-recovery.js'
import {scanETag} from '@rplayout/protocol'
import {executionHostIdentity} from './execution-host.js'
vi.mock('../config.js',async original=>({...await original<Record<string,unknown>>(),AUTH_USER:'',AUTH_PASSWORD:'',DEFAULT_ROLE:'ADMIN'}))
let db:ReturnType<typeof openDatabase>
const request={headers:{cookie:'rplayout_session=SESSION'},ip:'127.0.0.1'},path=resolve('Acervo Çãó')
beforeEach(()=>{db=openDatabase(':memory:');db.sqlite.exec("INSERT INTO users VALUES('u','Admin','NO_LOGIN','ADMIN',1,'now')");db.sqlite.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(sessionDigest('SESSION'),'u','2099-01-01','now');db.sqlite.prepare("INSERT INTO media_roots VALUES('r',?,'Acervo','now')").run(path);db.sqlite.prepare("INSERT INTO ingest_batches(id,roots,measure,state,created_at,updated_at,owner_host,owner_pid,owner_boot) VALUES('a',?,0,'RUNNING','now','now',?,2147483647,'original')").run(JSON.stringify([path]),executionHostIdentity());vi.spyOn(process,'kill').mockImplementation(()=>{throw Object.assign(new Error('dead'),{code:'ESRCH'})})})
afterEach(()=>{vi.restoreAllMocks();db.sqlite.close()})
const actor=()=>rootAuthority(db.db,request),review=()=>readScanReview(db.db,actor(),true)
it('diagnóstico é read-only; prova original e audit liberam só morte local comprovada, mesmo ID',()=>{
  const before=db.sqlite.prepare('SELECT * FROM ingest_batches').get(),r=review();expect(db.sqlite.prepare('SELECT * FROM ingest_batches').get()).toEqual(before)
  expect(r.activeBatches[0]!.canRecover).toBe(true);const body={requestId:r.operationId,batchId:'a'}
  expect(()=>recoverScan(db.db,body,undefined,actor(),true)).toThrow('original obrigatória')
  const result=recoverScan(db.db,body,scanETag(r),actor(),true);expect(result.batchId).toBe('a');expect(result.state).toBe('PENDING')
  expect(db.sqlite.prepare('SELECT state,owner_boot FROM ingest_batches').get()).toEqual({state:'PENDING',owner_boot:null})
  expect(recoverScan(db.db,body,scanETag(r),actor(),true).deduplicated).toBe(true);expect(db.sqlite.prepare('SELECT COUNT(*) n FROM operator_decisions').get()).toEqual({n:1})
  expect(vi.mocked(process.kill).mock.calls.every(args=>args[1]===0)).toBe(true)
})
it('falha de audit reverte owner/estado/counter; mudança same-value invalida original',()=>{
  const r=review(),before=db.sqlite.prepare('SELECT * FROM ingest_batches').get(),body={requestId:r.operationId,batchId:'a'}
  db.sqlite.exec("CREATE TRIGGER recovery_audit_failure BEFORE INSERT ON operator_decisions BEGIN SELECT RAISE(ABORT,'AUDIT_FAILED');END")
  expect(()=>recoverScan(db.db,body,scanETag(r),actor(),true)).toThrow('AUDIT_FAILED');expect(db.sqlite.prepare('SELECT * FROM ingest_batches').get()).toEqual(before);expect(review().batchRevision).toBe(r.batchRevision)
  db.sqlite.exec('DROP TRIGGER recovery_audit_failure');db.sqlite.exec('UPDATE ingest_batches SET state=state')
  expect(()=>recoverScan(db.db,body,scanETag(r),actor(),true)).toThrow('mudaram')
})
it.each(['alive','remote','unknown','uncertain'] as const)('recusa owner %s sem mudança, mesmo que corpo alegue encerramento',mode=>{
  if(mode==='alive')vi.mocked(process.kill).mockReturnValue(true)
  if(mode==='remote')db.sqlite.exec("UPDATE ingest_batches SET owner_host='remote'")
  if(mode==='unknown')db.sqlite.exec('UPDATE ingest_batches SET owner_boot=NULL')
  if(mode==='uncertain')vi.mocked(process.kill).mockImplementation(()=>{throw Object.assign(new Error('denied'),{code:'EPERM'})})
  const r=review(),before=db.sqlite.prepare('SELECT * FROM ingest_batches').get(),body={requestId:r.operationId,batchId:'a'}
  expect(()=>recoverScan(db.db,{...body,confirmedPreviousStopped:true},scanETag(r),actor(),true)).toThrow('sem dono')
  expect(()=>recoverScan(db.db,body,scanETag(r),actor(),true)).toThrow('não comprovado');expect(db.sqlite.prepare('SELECT * FROM ingest_batches').get()).toEqual(before)
})
it.each(['revoke','scope','role','station'] as const)('autorização fresca recusa %s',change=>{
  const a=actor(),r=review()
  if(change==='revoke')db.sqlite.exec('DELETE FROM sessions')
  if(change==='scope')db.sqlite.exec("INSERT INTO user_access VALUES('u','[\"restricted\"]',NULL,'now')")
  if(change==='role')db.sqlite.exec("UPDATE users SET role='OPERATOR'")
  if(change==='station')db.sqlite.exec("INSERT INTO user_access VALUES('u',NULL,'[\"192.0.2.1\"]','now')")
  expect(()=>recoverScan(db.db,{requestId:r.operationId,batchId:'a'},scanETag(r),a,true)).toThrow(/sessão|compartilhado|papel/);expect(db.sqlite.prepare('SELECT state FROM ingest_batches').get()).toEqual({state:'RUNNING'})
})
