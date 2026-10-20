// NOT_RUN: protocol contracts, not transport/crash/hardware qualification.
import {it,expect} from 'vitest'
import {haReturnOperation,HA_RETURN_CHUNK_BYTES} from './ha-return-store.js'
const id='12345678-1234-4234-8234-123456789abc'
const seal={version:1,exportId:id,channelId:'ch',promotionId:id,stopRequestId:id,sourcePreparationId:id,sourceSnapshotHash:'a'.repeat(64),databaseHash:'b'.repeat(64),databaseBytes:4096,sealedAt:'2026-10-11T00:00:00.000Z',contents:'CLOSED_OPERATIONAL_DATABASE',reverseSyncConfirmed:false,primaryApproved:false,publicationAuthorized:false}
it('BEGIN requer selo estrito, sem caminho escolhido pelo par — NOT_RUN',()=>{
  const op={version:1,transferId:id,operation:'BEGIN',seal,manifestHash:'c'.repeat(64)}
  expect(haReturnOperation.safeParse(op).success).toBe(true)
  expect(haReturnOperation.safeParse({...op,path:'C:\\foreign.db'}).success).toBe(false)
  expect(haReturnOperation.safeParse({...op,seal:{...seal,primaryApproved:true}}).success).toBe(false)
})
it('WRITE tem limite de bloco e não aceita saltos negativos — NOT_RUN',()=>{
  const op={version:1,transferId:id,operation:'WRITE',offset:0,data:Buffer.alloc(HA_RETURN_CHUNK_BYTES).toString('base64')}
  expect(haReturnOperation.safeParse(op).success).toBe(true)
  expect(haReturnOperation.safeParse({...op,offset:-1}).success).toBe(false)
  expect(haReturnOperation.safeParse({...op,data:op.data+'AAAA'}).success).toBe(false)
})
it('consulta e verificação não aceitam aprovação do cliente — NOT_RUN',()=>{
  for(const operation of ['STATUS','VERIFY']){
    expect(haReturnOperation.safeParse({version:1,transferId:id,operation}).success).toBe(true)
    expect(haReturnOperation.safeParse({version:1,transferId:id,operation,publicationAuthorized:true}).success).toBe(false)
  }
})
