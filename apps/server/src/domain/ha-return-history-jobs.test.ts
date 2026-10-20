// NOT_RUN: durable intent/transition contracts, not an as-run commit proof.
import {it,expect} from 'vitest'
import {randomUUID} from 'node:crypto'
import Database from 'better-sqlite3'
import {HaReturnHistoryJobs,HA_RETURN_HISTORY_JOB_RESERVE} from './ha-return-history-jobs.js'
const body=()=>({kind:'IMPORT' as const,request:{importId:randomUUID(),reviewId:randomUUID(),transferId:randomUUID(),channelId:'ch',records:[{id:'row',receivedHash:'a'.repeat(64)}]}})
it('intent survives owner change, exact UUID is not reaccepted as a fresh job — NOT_RUN',()=>{
  const db=new Database(':memory:')
  try{
    const journal=new HaReturnHistoryJobs(db,'durable-history','boot-a'),request=body(),initial=journal.accept(request,'operator')
    expect(initial.phase).toBe('ACCEPTED');expect(journal.accept(request,'operator')).toEqual(initial)
    const next=new HaReturnHistoryJobs(db,'durable-history','boot-b')
    expect(next.existing(request)?.ownedHere).toBe(false)
    expect(()=>next.transition(request,'EXTRACTING')).toThrow('owner')
    expect(()=>journal.accept({...request,request:{...request.request,records:[{id:'different',receivedHash:'b'.repeat(64)}]}},'operator')).toThrow('outra intenção')
    expect(()=>journal.query(request.request.importId,'other')).toThrow('canal')
    expect(journal.reservedBytes()).toBe(HA_RETURN_HISTORY_JOB_RESERVE)
    expect((db.prepare('SELECT payload FROM ha_return_history_jobs').get() as {payload:string}).payload).not.toContain('receivedHash')
  }finally{db.close()}
})
it('precommit failure can close, committing failure remains uncertain and never replays — NOT_RUN',()=>{
  const db=new Database(':memory:')
  try{
    const journal=new HaReturnHistoryJobs(db,'durable-history','boot-a'),first=body(),second=body()
    journal.accept(first,'operator');journal.transition(first,'EXTRACTING');journal.failBeforeCommit(first)
    expect(journal.query(first.request.importId,'ch')?.phase).toBe('FAILED');expect(()=>journal.transition(first,'EXTRACTING')).toThrow('ordem')
    journal.accept(second,'operator');expect(()=>journal.transition(second,'COMMITTING')).toThrow('ordem')
    journal.transition(second,'EXTRACTING');journal.transition(second,'COMMITTING');journal.failBeforeCommit(second)
    expect(journal.query(second.request.importId,'ch')?.phase).toBe('COMMITTING');expect(journal.accept(second,'operator')?.phase).toBe('COMMITTING')
    journal.transition(second,'CONFIRMED');journal.failBeforeCommit(second);expect(journal.query(second.request.importId,'ch')?.phase).toBe('CONFIRMED')
    // Only Store may call this after matching the actual operational receipt.
  }finally{db.close()}
})
it('explicit recovery never closes committing or receipt-confirmed history — NOT_RUN',()=>{
  const db=new Database(':memory:')
  try{
    const journal=new HaReturnHistoryJobs(db,'history-recovery','boot-a'),request=body()
    const initial=journal.accept(request,'operator')
    expect(()=>journal.closeInterrupted(request.request.importId,'ch','IMPORT','ACCEPTED',initial.updatedAt,()=>{},()=>{throw new Error('receipt exists')})).toThrow('receipt exists')
    expect(journal.query(request.request.importId,'ch')?.phase).toBe('ACCEPTED')
    journal.transition(request,'EXTRACTING');journal.transition(request,'COMMITTING')
    const committing=journal.query(request.request.importId,'ch')!
    expect(()=>journal.closeInterrupted(request.request.importId,'ch','IMPORT','COMMITTING',committing.updatedAt,()=>{},()=>{})).toThrow('commit')
    const another=body(),accepted=journal.accept(another,'operator')
    let checks=0;journal.closeInterrupted(another.request.importId,'ch','IMPORT','ACCEPTED',accepted.updatedAt,owner=>expect(owner).toBe('boot-a'),()=>{checks++})
    expect(checks).toBe(2);expect(journal.query(another.request.importId,'ch')?.phase).toBe('FAILED')
  }finally{db.close()}
})
