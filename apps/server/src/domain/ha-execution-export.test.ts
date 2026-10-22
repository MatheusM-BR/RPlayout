// NOT_RUN: contracts only, not physical HA qualification.
import {it,expect} from 'vitest'
import {haExportRequest,haExportSeal} from './ha-execution-export.js'
const id='12345678-1234-4234-8234-123456789abc'
const request={requestId:id,channelId:'ch',promotionId:id,stopRequestId:id}
const seal={version:1,exportId:id,channelId:'ch',promotionId:id,stopRequestId:id,sourcePreparationId:id,sourceSnapshotHash:'a'.repeat(64),databaseHash:'b'.repeat(64),databaseBytes:4096,sealedAt:'2026-10-11T00:00:00.000Z',contents:'CLOSED_OPERATIONAL_DATABASE',reverseSyncConfirmed:false,primaryApproved:false,publicationAuthorized:false}
it('não aceita caminho/PID do navegador — NOT_RUN',()=>{
  expect(haExportRequest.safeParse(request).success).toBe(true)
  expect(haExportRequest.safeParse({...request,file:'C:\\foreign.db'}).success).toBe(false)
  expect(haExportRequest.safeParse({...request,pid:123}).success).toBe(false)
})
it('selo diferencia SHA executado da origem e não autoriza publicação — NOT_RUN',()=>{
  expect(haExportSeal.safeParse(seal).success).toBe(true)
  for(const field of ['reverseSyncConfirmed','primaryApproved','publicationAuthorized'])expect(haExportSeal.safeParse({...seal,[field]:true}).success).toBe(false)
  expect(haExportSeal.safeParse({...seal,databaseBytes:0}).success).toBe(false)
})
