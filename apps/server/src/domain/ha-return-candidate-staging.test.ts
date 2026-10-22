// NOT_RUN: durable intent/contracts only; no worker/files/native qualification.
import {it,expect} from 'vitest'
import Database from 'better-sqlite3'
import {randomUUID} from 'node:crypto'
import {HaReturnCandidateStages,haReturnCandidateRequest,HA_RETURN_CANDIDATE_RESERVE} from './ha-return-candidate-staging.js'
it('pedido recebe somente IDs, nunca arquivo/chave ou autorização — NOT_RUN',()=>{
  const request={candidateId:randomUUID(),planId:randomUUID(),channelId:'ch'}
  expect(haReturnCandidateRequest.safeParse(request).success).toBe(true)
  for(const extra of [{file:'active.db'},{key:'secret'},{nativePrepared:true}])expect(haReturnCandidateRequest.safeParse({...request,...extra}).success).toBe(false)
})
it('intenção/reserva persistem, UUID consulta e falha não libera quota — NOT_RUN',()=>{
  const db=new Database(':memory:'),request={candidateId:randomUUID(),planId:randomUUID(),channelId:'ch'}
  try{
    const stages=new HaReturnCandidateStages(db,'context','boot-a'),initial=stages.accept(request)
    expect(initial.phase).toBe('ACCEPTED');expect(stages.reservedBytes()).toBe(HA_RETURN_CANDIDATE_RESERVE)
    expect(stages.accept(request)).toEqual(initial)
    expect(()=>stages.accept({...request,candidateId:randomUUID()})).toThrow()
    stages.fail(request);expect(stages.query(request.candidateId,'ch').phase).toBe('FAILED')
    expect(stages.reservedBytes()).toBe(HA_RETURN_CANDIDATE_RESERVE)
    const successor=new HaReturnCandidateStages(db,'context','boot-b')
    expect(successor.query(request.candidateId,'ch').ownedHere).toBe(false)
    expect(()=>successor.fail(request)).toThrow()
  }finally{db.close()}
})
