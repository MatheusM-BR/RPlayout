// NOT_RUN: contracts only, no materialization/worker/native validation executed.
import {it,expect} from 'vitest'
import {randomUUID} from 'node:crypto'
import {haReturnCandidateJob} from './ha-return-candidate.js'
it('job interno não aceita chave ou prontidão operacional — NOT_RUN',()=>{
  const request={planId:randomUUID(),reviewId:randomUUID(),rekeyId:randomUUID(),transferId:randomUUID(),channelId:'ch',editionInventoryMac:'a'.repeat(43),checkpointMac:null,revisionIds:['rev'],executionRevisionId:'rev',cursorPolicy:'STOPPED',reason:'Explicit review'}
  const job={candidateId:randomUUID(),request,sourceDatabaseHash:'b'.repeat(64),vaultFingerprint:'c'.repeat(64),recordedAt:'2026-10-11T00:00:00.000Z'}
  expect(haReturnCandidateJob.safeParse(job).success).toBe(true)
  expect(haReturnCandidateJob.safeParse({...job,installationKey:'secret'}).success).toBe(false)
  expect(haReturnCandidateJob.safeParse({...job,nativePrepared:true}).success).toBe(false)
})
