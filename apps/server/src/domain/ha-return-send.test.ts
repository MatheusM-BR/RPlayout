// NOT_RUN: protocol contracts. No network/native/hardware validation.
import {it,expect} from 'vitest'
import {haReturnSendRequest,haReturnResumeRequest} from './ha-return-send.js'
import {haReturnProgress} from './ha-return-store.js'
import {returnWireCost} from './ha-return-pacer.js'
const id='12345678-1234-4234-8234-123456789abc'
it('envio recebe somente IDs internos, não destino/caminho do operador — NOT_RUN',()=>{
  const request={requestId:id,channelId:'ch',promotionId:id,exportId:id}
  expect(haReturnSendRequest.safeParse(request).success).toBe(true)
  for(const extra of [{path:'foreign'},{peerUrl:'http://foreign'},{retry:true}])expect(haReturnSendRequest.safeParse({...request,...extra}).success).toBe(false)
})
it('recibo não confirma cópia parcial nem autorização de publicação — NOT_RUN',()=>{
  const receipt={version:1,transferId:id,exportId:id,promotionId:id,channelId:'ch',stopRequestId:id,manifestHash:'a'.repeat(64),databaseHash:'b'.repeat(64),databaseBytes:4096,offset:4096,phase:'RECEIVED_QUARANTINE',checkedAt:'2026-10-11T00:00:00.000Z',primaryApproved:false,publicationAuthorized:false,authorityTransferred:false,physicalOutputValidated:false}
  expect(haReturnProgress.safeParse(receipt).success).toBe(true)
  expect(haReturnProgress.safeParse({...receipt,offset:4095}).success).toBe(false)
  expect(haReturnProgress.safeParse({...receipt,publicationAuthorized:true}).success).toBe(false)
})
it('retomada exige UUID próprio, token e offset, sem retry implícito — NOT_RUN',()=>{
  const request={resumeId:id,requestId:id,channelId:'ch',reviewToken:'conferencia',expectedOffset:4096}
  expect(haReturnResumeRequest.safeParse(request).success).toBe(true)
  expect(haReturnResumeRequest.safeParse({...request,expectedOffset:-1}).success).toBe(false)
  expect(haReturnResumeRequest.safeParse({...request,restartFromZero:true}).success).toBe(false)
})
it('custo de rede inclui expansão base64/cifra e cabeçalhos — NOT_RUN',()=>{
  const raw=Buffer.alloc(256*1024),operation={version:1,transferId:id,operation:'WRITE',offset:0,data:raw.toString('base64')}
  expect(returnWireCost(operation)).toBeGreaterThan(raw.length)
  expect(returnWireCost(operation)).toBeGreaterThan(Buffer.byteLength(JSON.stringify(operation)))
})
