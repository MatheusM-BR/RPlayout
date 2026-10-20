// NOT_RUN: contracts; no transformation/worker/native/network qualification.
import {it,expect} from 'vitest'
import {haReturnRekeyRequest,haRekeyResult} from './ha-return-rekey.js'
const id='12345678-1234-4234-8234-123456789abc'
it('reproteção recebe somente IDs, nunca chave/caminho do navegador — NOT_RUN',()=>{
  const request={rekeyId:id,transferId:id,channelId:'ch'}
  expect(haReturnRekeyRequest.safeParse(request).success).toBe(true)
  expect(haReturnRekeyRequest.safeParse({...request,pairingKey:'secret'}).success).toBe(false)
  expect(haReturnRekeyRequest.safeParse({...request,file:'foreign'}).success).toBe(false)
})
it('resultado distingue SHA recebido/reprotegido e não aprova PGM — NOT_RUN',()=>{
  const result={sourceDatabaseHash:'a'.repeat(64),databaseHash:'b'.repeat(64),databaseBytes:4096,entries:3,vaultFingerprint:'c'.repeat(64),installationKeyCopied:false,operationalApproved:false,publicationAuthorized:false}
  expect(haRekeyResult.safeParse(result).success).toBe(true)
  for(const field of ['installationKeyCopied','operationalApproved','publicationAuthorized'])expect(haRekeyResult.safeParse({...result,[field]:true}).success).toBe(false)
})
