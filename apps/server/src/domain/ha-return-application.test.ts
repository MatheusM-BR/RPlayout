// NOT_RUN: durable intention/quota/schema only; no files/workers/native checks.
import {it,expect} from 'vitest'
import Database from 'better-sqlite3'
import {randomUUID} from 'node:crypto'
import {HaReturnApplications,haReturnApplicationRequest,HA_RETURN_APPLICATION_RESERVE} from './ha-return-application.js'
const request=()=>({applicationId:randomUUID(),channelId:'ch',candidate:{candidateId:randomUUID(),planId:randomUUID(),channelId:'ch'},bindingPlanId:randomUUID()})
it('pedido somente IDs com canal consistente — NOT_RUN',()=>{
  const body=request();expect(haReturnApplicationRequest.safeParse(body).success).toBe(true)
  for(const extra of [{file:'active.db'},{nativePrepared:true},{plan:{inputs:[]}}])expect(haReturnApplicationRequest.safeParse({...body,...extra}).success).toBe(false)
  expect(haReturnApplicationRequest.safeParse({...body,channelId:'other'}).success).toBe(false)
})
it('UUID consulta; uma aplicação por candidato/plano; falha preserva quota — NOT_RUN',()=>{
  const db=new Database(':memory:'),body=request()
  try{
    const journal=new HaReturnApplications(db,'application-contract','boot-a'),initial=journal.accept(body)
    expect(initial.phase).toBe('ACCEPTED');expect(initial.operationalReady).toBe(false);expect(journal.accept(body)).toEqual(initial)
    expect(()=>journal.accept({...body,bindingPlanId:randomUUID()})).toThrow('outra intenção')
    expect(()=>journal.accept({...body,applicationId:randomUUID()})).toThrow()
    journal.fail(body);expect(journal.query(body.applicationId,'ch').phase).toBe('FAILED');expect(journal.reservedBytes()).toBe(HA_RETURN_APPLICATION_RESERVE)
    const successor=new HaReturnApplications(db,'application-contract','boot-b');expect(successor.query(body.applicationId,'ch').ownedHere).toBe(false);expect(()=>successor.fail(body)).toThrow('estrangeira')
    expect(()=>journal.query(body.applicationId,'other')).toThrow('canal')
  }finally{db.close()}
})
