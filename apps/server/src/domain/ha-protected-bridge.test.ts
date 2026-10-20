// NOT_RUN: envelopes/contracts. No transform/network/physical qualification.
import {it,expect} from 'vitest'
import {haProtectedBridgeProof} from './ha-protected-bridge.js'
import {haExportSeal} from './ha-execution-export.js'
const id='12345678-1234-4234-8234-123456789abc'
const proof={version:1,entries:5,inventoryMac:'a'.repeat(43),pairingFingerprint:'b'.repeat(64),encoding:'EXPORT_SCOPED_PAIRING_ENVELOPES'}
it('prova não aceita chave privada ou aprovação operacional — NOT_RUN',()=>{
  expect(haProtectedBridgeProof.safeParse(proof).success).toBe(true)
  expect(haProtectedBridgeProof.safeParse({...proof,installationKey:'secret'}).success).toBe(false)
  expect(haProtectedBridgeProof.safeParse({...proof,publicationAuthorized:true}).success).toBe(false)
})
it('selo distingue bytes originais e transportáveis sem liberar PGM — NOT_RUN',()=>{
  const seal={version:1,exportId:id,channelId:'ch',promotionId:id,stopRequestId:id,sourcePreparationId:id,sourceSnapshotHash:'a'.repeat(64),sourceDatabaseHash:'b'.repeat(64),protectedBridge:proof,databaseHash:'c'.repeat(64),databaseBytes:4096,sealedAt:'2026-10-11T00:00:00.000Z',contents:'CLOSED_OPERATIONAL_DATABASE',reverseSyncConfirmed:false,primaryApproved:false,publicationAuthorized:false}
  expect(haExportSeal.safeParse(seal).success).toBe(true)
  expect(haExportSeal.safeParse({...seal,publicationAuthorized:true}).success).toBe(false)
})
