// NOT_RUN: read-only diagnostic contracts, not native/network qualification.
import {it,expect} from 'vitest'
import Database from 'better-sqlite3'
import {inspectReturnedDatabase} from './ha-return-db-review.js'
import {haReturnReviewRequest} from './ha-return-store.js'
import type {HaSnapshot} from './ha-replication.js'
const id='12345678-1234-4234-8234-123456789abc'
it('revisão não aceita aprovação/caminho fornecidos pelo operador — NOT_RUN',()=>{
  const request={reviewId:id,transferId:id,channelId:'ch'}
  expect(haReturnReviewRequest.safeParse(request).success).toBe(true)
  expect(haReturnReviewRequest.safeParse({...request,file:'foreign'}).success).toBe(false)
  expect(haReturnReviewRequest.safeParse({...request,primaryApproved:true}).success).toBe(false)
})
it('diagnóstico não ignora ausência de estrutura operacional — NOT_RUN',()=>{
  const db=new Database(':memory:')
  try{const baseline:HaSnapshot={version:1,capturedAt:'2026-10-11T00:00:00.000Z',channels:[],asRun:[],journals:[]};expect(()=>inspectReturnedDatabase(db,'ch',baseline)).toThrow('obrigatória')}
  finally{db.close()}
})
