import type {HaControlRequest,HaControlReport} from '../api.js'
export type PendingHaControl={request:HaControlRequest;phase:HaControlReport['phase']|'UNKNOWN'}
export const haControlStorageKey='rplayout:ha-control-pending:v1'
const uuid=(value:unknown)=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
const id=(value:unknown)=>typeof value==='string'&&value.length>0&&value.length<=128
export function parseHaControlRequest(value:unknown):HaControlRequest{
  const request=value as HaControlRequest
  if(!request||!uuid(request.requestId)||!uuid(request.promotionId)||!id(request.channelId)||!id(request.itemId)||request.revisionId!==null&&!id(request.revisionId)||!['CUE','TAKE'].includes(request.action)||Object.keys(request).some(key=>!['requestId','channelId','promotionId','revisionId','action','itemId'].includes(key)))throw new Error('Intenção de controle inválida.')
  return {requestId:request.requestId,channelId:request.channelId,promotionId:request.promotionId,revisionId:request.revisionId,action:request.action,itemId:request.itemId}
}
export function readPendingHaControls(raw:string|null):Record<string,PendingHaControl>{
  if(!raw)return {}
  if(raw.length>128*1024)throw new Error('Diário local excedeu limite.')
  const parsed:unknown=JSON.parse(raw)
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new Error('Diário de controle inválido.')
  const result:Record<string,PendingHaControl>=Object.create(null)
  for(const [key,value] of Object.entries(parsed)){
    const entry=value as PendingHaControl,request=parseHaControlRequest(entry?.request)
    if(key!==request.channelId||!['UNKNOWN','ACCEPTED','SENDING','CONFIRMED','REFUSED','UNCERTAIN'].includes(entry.phase))throw new Error('Diário de outro canal/fase.')
    result[key]={request,phase:entry.phase}
  }
  return result
}
export function confirmedHaControlResponse(request:HaControlRequest,report:HaControlReport):PendingHaControl{
  if(JSON.stringify(parseHaControlRequest(report.request))!==JSON.stringify(parseHaControlRequest(request))||report.version!==1||report.confirmationIsHistorical!==true||report.physicalOutputValidated!==false||!['ACCEPTED','SENDING','CONFIRMED','REFUSED','UNCERTAIN'].includes(report.phase))throw new Error('Resposta de outro controle.')
  if(report.phase==='CONFIRMED'){
    const proof=report.proof
    if(!proof||proof.itemId!==request.itemId||!uuid(proof.ownerId)||!Number.isSafeInteger(proof.term)||proof.term<=0)throw new Error('Controle sem prova atribuível.')
    if(request.action==='TAKE'){
      if(!('nativeConfirmed' in proof)||proof.nativeConfirmed!==true||!Number.isSafeInteger(proof.decoderId)||proof.decoderId<=0||!Number.isSafeInteger(proof.elapsed)||proof.elapsed<0)throw new Error('ACK de abertura não confirma TAKE.')
    }else if(!('programChanged' in proof)||proof.programChanged!==false||proof.signalConfirmed!==false)throw new Error('CUE não deve declarar mudança de PGM ou confirmação de sinal.')
  }
  return {request,phase:report.phase}
}
