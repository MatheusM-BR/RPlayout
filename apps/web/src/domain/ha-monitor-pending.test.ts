// NOT_RUN: fixtures preparados para a validação consolidada do lote.
import {describe,it,expect} from 'vitest'
import {monitorKey,readPendingHaMonitors} from './ha-monitor-pending.js'
const request={requestId:'12345678-1234-4234-8234-123456789abc',promotionId:'22345678-1234-4234-8234-123456789abc',channelId:'canal',bus:'mon' as const,on:true}
describe('diário do monitor HA — NOT_RUN',()=>{
  it('preserva a intenção incerta e UUID para consulta sem reenvio',()=>{
    const entry={request,phase:'UNKNOWN'};expect(readPendingHaMonitors(JSON.stringify({[monitorKey(request)]:entry}))).toEqual({[monitorKey(request)]:entry})
  })
  it('recusa chave de outro canal ou intenção inválida',()=>{
    expect(()=>readPendingHaMonitors(JSON.stringify({outro:{request,phase:'UNKNOWN'}}))).toThrow()
    expect(()=>readPendingHaMonitors(JSON.stringify({[monitorKey(request)]:{request:{...request,on:'true'},phase:'UNKNOWN'}}))).toThrow()
  })
  it('não apaga um diário corrompido silenciosamente',()=>{expect(()=>readPendingHaMonitors('{')).toThrow();expect(readPendingHaMonitors(null)).toEqual({})})
  it('preserva revisão explícita após reload sem converter o antigo em confirmado',()=>{
    const correction={...request,requestId:'32345678-1234-4234-8234-123456789abc',supersedesRequestId:request.requestId,reviewToken:'conferencia'}
    const entry={request:correction,phase:'UNKNOWN'}
    expect(readPendingHaMonitors(JSON.stringify({[monitorKey(request)]:entry}))[monitorKey(request)]).toEqual(entry)
  })
})
