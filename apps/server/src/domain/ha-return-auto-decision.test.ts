// NOT_RUN: request/journal contracts only. No native analysis, grade or PGM used.
import {it,expect} from 'vitest'
import {randomUUID} from 'node:crypto'
import Database from 'better-sqlite3'
import {HaReturnAutoDecisions,haReturnAutoDecisionRequest} from './ha-return-auto-decision.js'
const request=()=>({decisionId:randomUUID(),mediaReviewId:randomUUID(),channelId:'ch',evidenceMac:'a'.repeat(43),mountKeys:['b'.repeat(64)],reason:'Adotar medição local deste corte'})
it('no paths/loudness are accepted in operator request; explicit unique keys/reason required — NOT_RUN',()=>{
  const body=request()
  expect(haReturnAutoDecisionRequest.safeParse(body).success).toBe(true)
  expect(haReturnAutoDecisionRequest.safeParse({...body,path:'foreign'}).success).toBe(false)
  expect(haReturnAutoDecisionRequest.safeParse({...body,mountKeys:[...body.mountKeys,...body.mountKeys]}).success).toBe(false)
  expect(haReturnAutoDecisionRequest.safeParse({...body,mountKeys:[]}).success).toBe(false)
  expect(haReturnAutoDecisionRequest.safeParse({...body,reason:''}).success).toBe(false)
})
it('encrypted decision is immutable, same UUID queries and another boot gets no authority — NOT_RUN',()=>{
  const db=new Database(':memory:'),body=request()
  try{
    const journal=new HaReturnAutoDecisions(db,'auto-contract','boot-a')
    // Fixture proposal only: eligibility itself belongs to the pure builder.
    const proposal={request:body,reviewDatabaseHash:'c'.repeat(64),overrides:[{}]} as Parameters<HaReturnAutoDecisions['save']>[0]
    const saved=journal.save(proposal,'operador',()=>{})
    expect(saved.phase).toBe('AUTO_DECISION_RECORDED');expect(saved.publicationAuthorized).toBe(false);expect(saved.qcApproved).toBe(false)
    expect(journal.save(proposal,'operador',()=>{})).toEqual(saved)
    expect(()=>journal.save({...proposal,request:{...body,reason:'Outra intenção'}},'operador',()=>{})).toThrow('outra intenção')
    expect(()=>journal.save({...proposal,request:{...body,decisionId:randomUUID()}},'operador',()=>{})).toThrow()
    expect(()=>db.exec('DELETE FROM ha_return_auto_decisions')).toThrow('history')
    expect(()=>db.exec("UPDATE ha_return_auto_decisions SET channel_id='other'")).toThrow('immutable')
    expect(new HaReturnAutoDecisions(db,'auto-contract','boot-b').query(body.decisionId,'ch').ownedHere).toBe(false)
    expect(()=>journal.query(body.decisionId,'other')).toThrow('canal')
    expect((db.prepare('SELECT payload FROM ha_return_auto_decisions').get() as {payload:string}).payload).not.toContain(body.reason)
  }finally{db.close()}
})
