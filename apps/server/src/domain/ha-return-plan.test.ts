// NOT_RUN: contrato de planejamento. Não transfere autoridade nem roda engine.
import {it,expect} from 'vitest'
import {planHaReturn} from './ha-return-plan.js'
type Context=Parameters<typeof planHaReturn>[0]
const promotionId='12345678-1234-4234-8234-123456789abc'
function fixture():Context{return {promotion:{request:{requestId:promotionId,preparation:{channelId:'ch'},fromNodeId:'primary',targetNodeId:'standby',expectedRevision:1}} as Context['promotion'],stop:{version:1,request:{requestId:'22345678-1234-4234-8234-123456789abc',channelId:'ch',promotionId,reviewToken:'conferencia',confirmStop:true},phase:'CONFIRMED',actor:'admin',updatedAt:'2026-10-11T00:00:00.000Z',ownedResourcesStopped:true,storageReleased:true,originalControlOutcomesUnchanged:true,authorityReturnedToPrimary:false,automaticRestart:false,physicalOutputValidated:false},assignment:{channelId:'ch',selectedNodeId:'standby',lastTransferId:promotionId,revision:2,lastTerm:3,engineLeaseActive:false,waitingForLeaseExpiry:false} as Context['assignment'],currentNodeId:'standby',primaryNodeId:'primary',localOwnerUnchanged:true,unresolvedControls:0}}
it('parada e lease expirado não substituem sincronização reversa — NOT_RUN',()=>{
  const result=planHaReturn(fixture());expect(result.transferReady).toBe(false);expect(result.blockers).toEqual(['EXECUTION_EXPORT_NOT_SEALED','REVERSE_SYNC_NOT_CONFIRMED','PRIMARY_RECONCILIATION_NOT_CONFIRMED']);expect(result.automaticRestart).toBe(false)
})
it('sinaliza lease ativo, instância perdida e controle não resolvido — NOT_RUN',()=>{
  const value=fixture();value.assignment.engineLeaseActive=true;value.localOwnerUnchanged=false;value.unresolvedControls=1
  expect(planHaReturn(value).blockers).toEqual(expect.arrayContaining(['LEASE_STILL_ACTIVE','LOCAL_OWNER_CHANGED','CONTROL_OUTCOMES_UNRESOLVED']))
})
it('recusa parada ou admissão de outro canal — NOT_RUN',()=>{
  const value=fixture();value.assignment.channelId='other';expect(()=>planHaReturn(value)).toThrow('outro canal')
})
it('selo correlacionado remove somente bloqueio de exportação — NOT_RUN',()=>{
  const value=fixture()
  value.exportSeal={version:1,exportId:promotionId,channelId:'ch',promotionId,stopRequestId:'22345678-1234-4234-8234-123456789abc',sourcePreparationId:promotionId,sourceSnapshotHash:'a'.repeat(64),databaseHash:'b'.repeat(64),databaseBytes:4096,sealedAt:'2026-10-11T00:00:00.000Z',contents:'CLOSED_OPERATIONAL_DATABASE',reverseSyncConfirmed:false,primaryApproved:false,publicationAuthorized:false}
  const result=planHaReturn(value)
  expect(result.exportSealed).toBe(true)
  expect(result.blockers).toEqual(['REVERSE_SYNC_NOT_CONFIRMED','PRIMARY_RECONCILIATION_NOT_CONFIRMED'])
  expect(result.transferReady).toBe(false)
  value.stop=null;expect(()=>planHaReturn(value)).toThrow('Selo')
})
