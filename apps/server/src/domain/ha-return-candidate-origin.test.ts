// NOT_RUN: private-reader contracts; no worker/native/physical qualification.
import {it,expect} from 'vitest'
import Database from 'better-sqlite3'
import {randomUUID} from 'node:crypto'
import {haReturnCandidateOriginRequest,readReturnCandidateOrigin} from './ha-return-candidate-origin.js'
import {HaReturnCandidateStages} from './ha-return-candidate-staging.js'
it('leitura interna aceita IDs, não caminho ou autorização — NOT_RUN',()=>{
  const request={candidateId:randomUUID(),planId:randomUUID(),channelId:'ch'}
  expect(haReturnCandidateOriginRequest.safeParse(request).success).toBe(true)
  for(const extra of [{file:'active.db'},{publicationAuthorized:true},{vaultFingerprint:'x'}])expect(haReturnCandidateOriginRequest.safeParse({...request,...extra}).success).toBe(false)
})
it('proveniência ausente não vira origem operacional — NOT_RUN',()=>{
  const db=new Database(':memory:')
  try{expect(()=>readReturnCandidateOrigin(db,{candidateId:randomUUID(),planId:randomUUID(),channelId:'ch'})).toThrow()}finally{db.close()}
})
it('leitura privada recusa intenção ainda não materializada e mantém quota — NOT_RUN',async()=>{
  const db=new Database(':memory:'),request={candidateId:randomUUID(),planId:randomUUID(),channelId:'ch'}
  try{const stages=new HaReturnCandidateStages(db,'origin-contract','boot-a');stages.accept(request);const before=stages.reservedBytes();await expect(stages.privateOrigin('unused',request,()=>{},new AbortController().signal)).rejects.toThrow();expect(stages.reservedBytes()).toBe(before);expect(stages.query(request.candidateId,'ch').phase).toBe('ACCEPTED')}finally{db.close()}
})
