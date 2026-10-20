// NOT_RUN: contratos de encerramento; não há processos físicos neste fixture.
import {it,expect} from 'vitest'
import {haStopRequest,haStopReport} from './ha-stop.js'
const request={requestId:'12345678-1234-4234-8234-123456789abc',channelId:'ch',promotionId:'22345678-1234-4234-8234-123456789abc',reviewToken:'conferencia',confirmStop:true}
const base={version:1,request,phase:'CONFIRMED',actor:'admin',updatedAt:'2026-10-11T00:00:00.000Z',ownedResourcesStopped:true,storageReleased:true,originalControlOutcomesUnchanged:true,authorityReturnedToPrimary:false,automaticRestart:false,physicalOutputValidated:false}
it('exige intenção e confirmação explícitas, sem PID fornecido — NOT_RUN',()=>{
  expect(haStopRequest.safeParse(request).success).toBe(true)
  expect(haStopRequest.safeParse({...request,confirmStop:false}).success).toBe(false)
  expect(haStopRequest.safeParse({...request,pid:999}).success).toBe(false)
})
it('timeout/parada parcial não confirmam liberação — NOT_RUN',()=>{
  expect(haStopReport.safeParse(base).success).toBe(true)
  expect(haStopReport.safeParse({...base,ownedResourcesStopped:false}).success).toBe(false)
  expect(haStopReport.safeParse({...base,storageReleased:false}).success).toBe(false)
  expect(haStopReport.safeParse({...base,phase:'UNCERTAIN',ownedResourcesStopped:false,storageReleased:false}).success).toBe(true)
})
it('parada não equivale a retorno ao principal ou reinício — NOT_RUN',()=>{
  expect(haStopReport.safeParse({...base,authorityReturnedToPrimary:true}).success).toBe(false)
  expect(haStopReport.safeParse({...base,automaticRestart:true}).success).toBe(false)
})
