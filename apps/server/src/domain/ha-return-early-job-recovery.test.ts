// NOT_RUN: early journal closure only, no worker/files/physical recovery.
import {it,expect} from 'vitest'
import Database from 'better-sqlite3'
import {randomUUID} from 'node:crypto'
import {HaReturnCandidateStages,HA_RETURN_CANDIDATE_RESERVE} from './ha-return-candidate-staging.js'
import {HaReturnApplications,HA_RETURN_APPLICATION_RESERVE} from './ha-return-application.js'
it('candidate close requires exact phase/date, stopped callback and keeps quota — NOT_RUN',()=>{
  const db=new Database(':memory:')
  try{
    const journal=new HaReturnCandidateStages(db,'early-recovery','boot-a'),request={candidateId:randomUUID(),planId:randomUUID(),channelId:'ch'},initial=journal.accept(request)
    expect(()=>journal.closeInterrupted(request.candidateId,'ch','MATERIALIZING',initial.updatedAt,()=>{})).toThrow('mudou')
    expect(()=>journal.closeInterrupted(request.candidateId,'ch','ACCEPTED',initial.updatedAt,()=>{throw new Error('still live')})).toThrow('still live')
    expect(journal.query(request.candidateId,'ch').phase).toBe('ACCEPTED')
    let seen='';journal.closeInterrupted(request.candidateId,'ch','ACCEPTED',initial.updatedAt,owner=>{seen=owner})
    expect(seen).toBe('boot-a');expect(journal.query(request.candidateId,'ch').phase).toBe('FAILED');expect(journal.reservedBytes()).toBe(HA_RETURN_CANDIDATE_RESERVE)
    expect(()=>journal.closeInterrupted(request.candidateId,'ch','ACCEPTED',initial.updatedAt,()=>{})).toThrow('mudou')
  }finally{db.close()}
})
it('binding application closure preserves original owner/request and immutable attempt — NOT_RUN',()=>{
  const db=new Database(':memory:')
  try{
    const journal=new HaReturnApplications(db,'early-recovery','boot-a'),candidate={candidateId:randomUUID(),planId:randomUUID(),channelId:'ch'},request={applicationId:randomUUID(),channelId:'ch',candidate,bindingPlanId:randomUUID()},initial=journal.accept(request)
    const successor=new HaReturnApplications(db,'early-recovery','boot-b')
    successor.closeInterrupted(request.applicationId,'ch','ACCEPTED',initial.updatedAt,owner=>{expect(owner).toBe('boot-a')})
    const closed=successor.query(request.applicationId,'ch')
    expect(closed.request).toEqual(request);expect(closed.ownedHere).toBe(false);expect(closed.phase).toBe('FAILED');expect(closed.result).toBeNull();expect(journal.reservedBytes()).toBe(HA_RETURN_APPLICATION_RESERVE)
    expect(()=>journal.accept({...request,applicationId:randomUUID()})).toThrow()
  }finally{db.close()}
})
