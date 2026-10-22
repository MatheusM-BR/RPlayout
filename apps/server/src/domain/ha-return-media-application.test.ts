// NOT_RUN: durable intention/schema/quota/ownership only, no worker/files checks.
import {it,expect} from 'vitest'
import Database from 'better-sqlite3'
import {randomUUID} from 'node:crypto'
import {HaReturnMediaApplications,haReturnMediaApplicationRequest,HA_RETURN_MEDIA_APPLICATION_RESERVE} from './ha-return-media-application.js'
const request=()=>({mediaApplicationId:randomUUID(),mediaReviewId:randomUUID(),channelId:'ch'})
it('adoção AUTO pede somente UUID registrado, nunca valores do cliente — NOT_RUN',()=>{
  expect(haReturnMediaApplicationRequest.safeParse({...request(),autoDecisionId:randomUUID()}).success).toBe(true)
  expect(haReturnMediaApplicationRequest.safeParse({...request(),autoDecisionId:'invalid'}).success).toBe(false)
  expect(haReturnMediaApplicationRequest.safeParse({...request(),autoDecisionId:randomUUID(),audio:{mode:'AUTO',measured:{integratedLufs:-23}}}).success).toBe(false)
})
it('pedido somente IDs, UUID consulta e uma tentativa por revisão — NOT_RUN',()=>{
  const db=new Database(':memory:'),body=request()
  try{
    const journal=new HaReturnMediaApplications(db,'media-application-contract','boot-a'),initial=journal.accept(body)
    expect(initial.phase).toBe('ACCEPTED');expect(initial.operationalReady).toBe(false);expect(journal.accept(body)).toEqual(initial)
    expect(()=>journal.accept({...body,mediaReviewId:randomUUID()})).toThrow('outra intenção');expect(()=>journal.accept({...body,mediaApplicationId:randomUUID()})).toThrow()
    for(const extra of [{file:'active.db'},{nativePrepared:true},{encodedEvidence:'secret'}])expect(haReturnMediaApplicationRequest.safeParse({...body,...extra}).success).toBe(false)
    journal.fail(body);expect(journal.query(body.mediaApplicationId,'ch').phase).toBe('FAILED');expect(journal.reservedBytes()).toBe(HA_RETURN_MEDIA_APPLICATION_RESERVE)
    const next=new HaReturnMediaApplications(db,'media-application-contract','boot-b');expect(next.query(body.mediaApplicationId,'ch').ownedHere).toBe(false);expect(()=>next.fail(body)).toThrow('estrangeira');expect(()=>next.query(body.mediaApplicationId,'other')).toThrow('canal')
  }finally{db.close()}
})
