// NOT_RUN: job/admission contracts only; no files/workers/native checks.
import {it,expect} from 'vitest'
import Database from 'better-sqlite3'
import {randomUUID} from 'node:crypto'
import {haReturnMediaCandidateJob} from './ha-return-media-candidate.js'
import {assertNoUnboundReturnCandidate} from '../db/return-candidate-admission.js'
function job(){const applicationId=randomUUID(),channelId='ch';return {mediaApplicationId:randomUUID(),applicationId,candidate:{candidateId:randomUUID(),planId:randomUUID(),channelId},sourceDatabaseHash:'a'.repeat(64),sourceDatabaseBytes:1024,vaultFingerprint:'b'.repeat(64),recordedAt:new Date().toISOString(),rate:{num:25,den:1},audioChannels:2,mediaReview:{mediaReviewId:randomUUID(),applicationId,channelId},reviewResult:{applicationDatabaseHash:'a'.repeat(64),evidenceMac:'c'.repeat(43),runtimeHash:'d'.repeat(64),checkedAt:new Date().toISOString(),requiredHashes:0,verifiedHashes:0,bytesAndDecodeComplete:true,checkedMounts:0,blockedMounts:0,livePending:0,mixPending:0,issues:[],issuesTruncated:false,publicationAuthorized:false,operationalReady:false},encodedEvidence:'{}'}}
it('job interno correlaciona aplicação/canal/hash e não aceita autorização — NOT_RUN',()=>{
  const value=job();expect(haReturnMediaCandidateJob.safeParse(value).success).toBe(true)
  for(const extra of [{file:'active.db'},{publicationAuthorized:true},{nativePrepared:true}])expect(haReturnMediaCandidateJob.safeParse({...value,...extra}).success).toBe(false)
  expect(haReturnMediaCandidateJob.safeParse({...value,applicationId:randomUUID()}).success).toBe(false)
  expect(haReturnMediaCandidateJob.safeParse({...value,candidate:{...value.candidate,channelId:'other'}}).success).toBe(false)
  expect(haReturnMediaCandidateJob.safeParse({...value,sourceDatabaseHash:'e'.repeat(64)}).success).toBe(false)
})
it('novo marcador, mesmo vazio e sem anteriores, impede bootstrap — NOT_RUN',()=>{
  const db=new Database(':memory:')
  try{db.exec('CREATE TABLE ha_return_media_origin(id INTEGER PRIMARY KEY,payload TEXT)');expect(()=>assertNoUnboundReturnCandidate(db)).toThrow('partida operacional bloqueada')}finally{db.close()}
})
