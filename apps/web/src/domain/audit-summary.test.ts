import {it,expect} from 'vitest'
import {auditActionLabel,auditDetails} from './audit-summary.js'
it('explains a retry request without claiming native completion or approval',()=>{
  const text=auditDetails('MEDIA_JOB_RETRY_REQUESTED',{jobId:'j',versionId:'v',kind:'PROXY',previousAttempts:3,ownerConfirmationRequired:true,confirmedPreviousStopped:true})
  expect(auditActionLabel('MEDIA_JOB_RETRY_REQUESTED')).toContain('solicitada')
  expect(text).toContain('tentativas anteriores 3')
  expect(text).toContain('confirmado pelo operador')
  expect(text).toContain('não comprova conclusão')
})
it('incomplete legacy evidence never invents operator confirmation',()=>{
  expect(auditDetails('MEDIA_JOB_RETRY_REQUESTED',{ownerConfirmationRequired:true,confirmedPreviousStopped:'true'})).toContain('confirmação não registrada')
  expect(auditDetails('MEDIA_JOB_RETRY_REQUESTED',{})).toContain('política de confirmação não informada')
})
it('keeps unknown action and original details',()=>{
  expect(auditActionLabel('OTHER')).toBe('OTHER')
  expect(auditDetails('OTHER',{value:1})).toBe('{"value":1}')
})
