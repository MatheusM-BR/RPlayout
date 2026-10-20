// NOT_RUN: fixtures para a validação consolidada, sem execução neste lote.
import {describe,it,expect} from 'vitest'
import {haMonitorIntent,resolvedMonitorRequests,monitorReviewAncestors,type HaMonitorLedgerReport} from './ha-monitor-review.js'
const ids=['12345678-1234-4234-8234-123456789abc','22345678-1234-4234-8234-123456789abc','32345678-1234-4234-8234-123456789abc']
const make=(index:number,phase:HaMonitorLedgerReport['phase'],parent?:number):HaMonitorLedgerReport=>({version:1,request:{requestId:ids[index]!,channelId:'ch',promotionId:'42345678-1234-4234-8234-123456789abc',bus:'mon',on:true,...(parent!==undefined?{supersedesRequestId:ids[parent]!,reviewToken:'conferencia'}:{})},phase,actor:'admin',updatedAt:'2026-10-11T00:00:00.000Z',confirmationIsHistorical:true,physicalOutputValidated:false})
describe('revisão de monitor admitido — NOT_RUN',()=>{
  it('somente novo ACK resolve cadeia, preservando incerteza antiga',()=>{
    const reports=[make(0,'UNCERTAIN'),make(1,'UNCERTAIN',0),make(2,'CONFIRMED',1)]
    const resolved=resolvedMonitorRequests(reports);expect(resolved.get(ids[0]!)).toBe(ids[2]);expect(resolved.get(ids[1]!)).toBe(ids[2]);expect(resolved.size).toBe(2)
    expect(reports[0]!.phase).toBe('UNCERTAIN');expect(monitorReviewAncestors(reports,ids[1]!)).toEqual(new Set([ids[1],ids[0]]))
  })
  it('recusa/novo envio pendente não confirmam revisão',()=>{
    expect(resolvedMonitorRequests([make(0,'UNCERTAIN'),make(1,'REFUSED',0)]).size).toBe(0)
    expect(resolvedMonitorRequests([make(0,'UNCERTAIN'),make(1,'SENDING',0)]).size).toBe(0)
  })
  it('recusa cadeia cíclica, órfã ou de outro bus',()=>{
    expect(()=>resolvedMonitorRequests([make(0,'UNCERTAIN',1),make(1,'UNCERTAIN',0)])).toThrow()
    expect(()=>resolvedMonitorRequests([make(1,'CONFIRMED',0)])).toThrow()
    const correction=make(1,'CONFIRMED',0);correction.request.bus='pvw'
    expect(()=>resolvedMonitorRequests([make(0,'UNCERTAIN'),correction])).toThrow()
  })
  it('exige token e UUID distinto para revisão',()=>{
    expect(haMonitorIntent.safeParse({...make(0,'UNCERTAIN').request,supersedesRequestId:ids[1]}).success).toBe(false)
    expect(haMonitorIntent.safeParse({...make(0,'UNCERTAIN').request,supersedesRequestId:ids[0],reviewToken:'x'}).success).toBe(false)
  })
})
