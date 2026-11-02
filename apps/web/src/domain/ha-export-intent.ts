import type {HaExportRequest,HaExportReport} from '../api.js'
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function exportIntent(value:unknown):HaExportRequest{
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Intenção ausente.')
  const v=value as Record<string,unknown>
  if(Object.keys(v).sort().join(',')!=='channelId,promotionId,requestId,stopRequestId'||typeof v.channelId!=='string'||!v.channelId||v.channelId.length>128||![v.requestId,v.promotionId,v.stopRequestId].every(id=>typeof id==='string'&&uuid.test(id)))throw new Error('Intenção inválida.')
  return v as unknown as HaExportRequest
}
export function exportReport(request:HaExportRequest,value:HaExportReport){
  const actual=exportIntent(value.request)
  if(Object.entries(request).some(([key,v])=>actual[key as keyof HaExportRequest]!==v)||value.version!==1||!['ACCEPTED','COPYING','SEALED','FAILED'].includes(value.phase)||value.partialEvidenceRetained!==true||value.reverseSyncConfirmed!==false||value.primaryApproved!==false||value.publicationAuthorized!==false||!Number.isFinite(Date.parse(value.updatedAt)))throw new Error('Resposta de outra intenção ou sem contrato.')
  if(value.phase==='SEALED'&&(!/^[a-f0-9]{64}$/i.test(value.databaseHash??'')||!/^[a-f0-9]{64}$/i.test(value.manifestHash??'')||typeof value.databaseBytes!=='number'||!Number.isSafeInteger(value.databaseBytes)||value.databaseBytes<=0||value.databaseBytes>16*1024**3))throw new Error('Selo incompleto.')
  return value
}
