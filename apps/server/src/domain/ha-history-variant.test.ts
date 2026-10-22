// NOT_RUN: policy/idempotence contracts; no real operational transaction/hardware QA.
import {it,expect} from 'vitest'
import {haHistoryVariantRequest} from './ha-history-variant.js'
const id='12345678-1234-4234-8234-123456789abc'
const request={decisionId:id,reviewId:id,transferId:id,channelId:'ch',records:[{id:'run',primaryHash:'a'.repeat(64),receivedHash:'b'.repeat(64),policy:'KEEP_PRIMARY_WITH_VARIANT',reason:'Preservar ambas as evidências.'}]}
it('política não permite overwrite ou confirmação nativa do cliente — NOT_RUN',()=>{
  expect(haHistoryVariantRequest.safeParse(request).success).toBe(true)
  expect(haHistoryVariantRequest.safeParse({...request,overwrite:true}).success).toBe(false)
  expect(haHistoryVariantRequest.safeParse({...request,nativeConfirmed:true}).success).toBe(false)
  expect(haHistoryVariantRequest.safeParse({...request,records:[{...request.records[0],policy:'OVERWRITE_RECEIVED'}]}).success).toBe(false)
})
it('exige justificativa, hashes e IDs únicos — NOT_RUN',()=>{
  expect(haHistoryVariantRequest.safeParse({...request,records:[{...request.records[0],reason:'  '}]}).success).toBe(false)
  expect(haHistoryVariantRequest.safeParse({...request,records:[...request.records,...request.records]}).success).toBe(false)
  expect(haHistoryVariantRequest.safeParse({...request,records:[{...request.records[0],receivedHash:null}]}).success).toBe(true)
})
