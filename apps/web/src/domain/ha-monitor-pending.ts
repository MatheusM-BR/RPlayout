import type {HaMonitorRequest,HaMonitorReport} from '../api.js'

export type PendingHaMonitor={request:HaMonitorRequest;phase:HaMonitorReport['phase']|'UNKNOWN';resolvedBy?:string}
export const haMonitorStorageKey='rplayout:ha-monitor-pending:v1'
export function monitorKey(request:Pick<HaMonitorRequest,'channelId'|'promotionId'|'bus'>){return JSON.stringify([request.channelId,request.promotionId,request.bus])}
export function readPendingHaMonitors(raw:string|null):Record<string,PendingHaMonitor>{
  if(!raw)return {}
  if(raw.length>128*1024)throw new Error('Diário local de monitor excedeu limite; preserve-o para revisão.')
  const value:unknown=JSON.parse(raw)
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Diário local de monitor inválido.')
  const result:Record<string,PendingHaMonitor>={}
  for(const [key,item] of Object.entries(value)){
    const entry=item as PendingHaMonitor,request=entry?.request
    if(!request||typeof request.channelId!=='string'||!request.channelId||request.channelId.length>128||typeof request.promotionId!=='string'||typeof request.requestId!=='string'||![request.promotionId,request.requestId].every(id=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))||!['pvw','mon'].includes(request.bus)||typeof request.on!=='boolean'||!['UNKNOWN','ACCEPTED','SENDING','CONFIRMED','REFUSED','UNCERTAIN'].includes(entry.phase)||monitorKey(request)!==key)throw new Error('Diário local de monitor inválido; nenhum comando foi enviado.')
    const uuid=(value:unknown)=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
    if((request.supersedesRequestId!==undefined||request.reviewToken!==undefined)&&(!uuid(request.supersedesRequestId)||request.supersedesRequestId===request.requestId||typeof request.reviewToken!=='string'||!request.reviewToken||request.reviewToken.length>256))throw new Error('Revisão local de monitor inválida.')
    if(entry.resolvedBy!==undefined&&!uuid(entry.resolvedBy))throw new Error('Resolução local de monitor inválida.')
    result[key]={request:{requestId:request.requestId,channelId:request.channelId,promotionId:request.promotionId,bus:request.bus,on:request.on,...(request.supersedesRequestId?{supersedesRequestId:request.supersedesRequestId,reviewToken:request.reviewToken}:{})},phase:entry.phase,...(entry.resolvedBy?{resolvedBy:entry.resolvedBy}:{})}
  }
  return result
}
export function newHaMonitorId(){
  const bytes=new Uint8Array(16);globalThis.crypto.getRandomValues(bytes);bytes[6]=(bytes[6]!&15)|64;bytes[8]=(bytes[8]!&63)|128
  const hex=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('')
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`
}
