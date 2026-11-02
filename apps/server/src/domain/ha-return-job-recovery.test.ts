// NOT_RUN: recovery contracts only. No process is killed, no file is deleted.
import {it,expect} from 'vitest'
import {randomUUID} from 'node:crypto'
import {hostname} from 'node:os'
import Database from 'better-sqlite3'
import {assertReturnJobStopped,haReturnJobRecoveryRequest,HaReturnJobRecoveries,HA_RETURN_JOB_RECOVERY_RESERVE} from './ha-return-job-recovery.js'
const owner=JSON.stringify({host:hostname(),pid:process.pid,boot:randomUUID()})
const previous=JSON.stringify({host:hostname(),pid:123456,boot:randomUUID()})
const request=()=>({recoveryId:randomUUID(),kind:'MEDIA_REVIEW' as const,targetId:randomUUID(),channelId:'ch',expectedPhase:'CHECKING' as const,expectedUpdatedAt:'2026-10-11T12:00:00.000Z',reason:'Encerrar tentativa sem conclusão comprovada'})
it('postgain closure only accepts its pending phases, not a confirmed receipt — NOT_RUN',()=>{
  const body={...request(),kind:'POSTGAIN_REVIEW'}
  expect(haReturnJobRecoveryRequest.safeParse({...body,expectedPhase:'ACCEPTED'}).success).toBe(true)
  expect(haReturnJobRecoveryRequest.safeParse({...body,expectedPhase:'MEASURING'}).success).toBe(true)
  for(const expectedPhase of ['CHECKING','APPLYING','REVIEWED','FAILED','COMMITTING'])expect(haReturnJobRecoveryRequest.safeParse({...body,expectedPhase}).success).toBe(false)
})
it('only idle current owner or same-host ESRCH proves stopped — NOT_RUN',()=>{
  expect(()=>assertReturnJobStopped(owner,owner,true)).not.toThrow()
  expect(()=>assertReturnJobStopped(owner,owner,false)).toThrow('corrente')
  expect(()=>assertReturnJobStopped(previous,owner,true,()=>{throw Object.assign(new Error(),{code:'ESRCH'})})).not.toThrow()
  expect(()=>assertReturnJobStopped(previous,owner,true,()=>{})).toThrow('ainda existe')
  expect(()=>assertReturnJobStopped(previous,owner,true,()=>{throw Object.assign(new Error(),{code:'EPERM'})})).toThrow('comprovar')
  expect(()=>assertReturnJobStopped(JSON.stringify({host:'remote-host',pid:1,boot:randomUUID()}),owner,true,()=>{throw Object.assign(new Error(),{code:'ESRCH'})})).toThrow('remoto')
})
it('explicit request refuses wrong stage, paths and missing reason — NOT_RUN',()=>{
  const body=request();expect(haReturnJobRecoveryRequest.safeParse(body).success).toBe(true)
  for(const extra of [{expectedPhase:'REVIEWED'},{expectedPhase:'APPLYING'},{reason:''},{path:'private.db'},{force:true}])expect(haReturnJobRecoveryRequest.safeParse({...body,...extra}).success).toBe(false)
})
it('candidate/binding stages use their own phase, never another job phase — NOT_RUN',()=>{
  const body=request()
  expect(haReturnJobRecoveryRequest.safeParse({...body,kind:'CANDIDATE',expectedPhase:'MATERIALIZING'}).success).toBe(true)
  expect(haReturnJobRecoveryRequest.safeParse({...body,kind:'BINDING_APPLICATION',expectedPhase:'APPLYING'}).success).toBe(true)
  expect(haReturnJobRecoveryRequest.safeParse({...body,kind:'CANDIDATE',expectedPhase:'APPLYING'}).success).toBe(false)
  expect(haReturnJobRecoveryRequest.safeParse({...body,kind:'BINDING_APPLICATION',expectedPhase:'MATERIALIZING'}).success).toBe(false)
})
it('technical review/rekey accept only their specific phase, never confirmations — NOT_RUN',()=>{
  const body=request()
  expect(haReturnJobRecoveryRequest.safeParse({...body,kind:'DATABASE_REVIEW',expectedPhase:'REVIEWING'}).success).toBe(true)
  expect(haReturnJobRecoveryRequest.safeParse({...body,kind:'REKEY',expectedPhase:'REKEYING'}).success).toBe(true)
  for(const extra of [{kind:'DATABASE_REVIEW',expectedPhase:'REKEYING'},{kind:'REKEY',expectedPhase:'REVIEWING'},{kind:'DATABASE_REVIEW',expectedPhase:'REVIEWED'},{kind:'REKEY',expectedPhase:'REKEYED_STAGED'}])expect(haReturnJobRecoveryRequest.safeParse({...body,...extra}).success).toBe(false)
})
it('history can only close before operational commit — NOT_RUN',()=>{
  for(const kind of ['HISTORY_IMPORT','HISTORY_VARIANT']){
    expect(haReturnJobRecoveryRequest.safeParse({...request(),kind,expectedPhase:'EXTRACTING'}).success).toBe(true)
    expect(haReturnJobRecoveryRequest.safeParse({...request(),kind,expectedPhase:'COMMITTING'}).success).toBe(false)
    expect(haReturnJobRecoveryRequest.safeParse({...request(),kind,expectedPhase:'CONFIRMED'}).success).toBe(false)
  }
})
it('journal and closure share transaction, immutable historical result, no replay — NOT_RUN',()=>{
  const db=new Database(':memory:')
  try{
    db.exec('CREATE TABLE fixture_job(state TEXT); INSERT INTO fixture_job VALUES(\'CHECKING\')')
    const journal=new HaReturnJobRecoveries(db,'recovery-fixture',owner),body=request()
    expect(()=>journal.close(body,'operator',()=>{db.exec("UPDATE fixture_job SET state='FAILED'");throw new Error('changed')},()=>{})).toThrow('changed')
    expect((db.prepare('SELECT state FROM fixture_job').get() as {state:string}).state).toBe('CHECKING')
    let calls=0;const saved=journal.close(body,'operator',()=>{calls++;db.exec("UPDATE fixture_job SET state='FAILED'")},()=>{})
    expect(saved.publicationAuthorized).toBe(false);expect(saved.partialFilesPreserved).toBe(true);expect(saved.operationReplayed).toBe(false)
    expect(journal.close(body,'operator',()=>{calls++},()=>{})).toEqual(saved);expect(calls).toBe(1)
    expect(journal.reservedBytes()).toBe(HA_RETURN_JOB_RECOVERY_RESERVE)
    expect(()=>journal.query(body.recoveryId,'other')).toThrow('canal')
    expect(()=>journal.close({...body,reason:'Outra intenção'},'operator',()=>{},()=>{})).toThrow('outra intenção')
    expect(()=>db.exec('DELETE FROM ha_return_job_recoveries')).toThrow('immutable')
    expect((db.prepare('SELECT payload FROM ha_return_job_recoveries').get() as {payload:string}).payload).not.toContain(body.reason)
  }finally{db.close()}
})
