// NOT_RUN: contratos da interface, sem operação real CUE/TAKE.
import {it,expect} from 'vitest'
import {readPendingHaControls,confirmedHaControlResponse} from './ha-control-pending.js'
import type {HaControlRequest,HaControlReport} from '../api.js'
const request:HaControlRequest={requestId:'12345678-1234-4234-8234-123456789abc',promotionId:'22345678-1234-4234-8234-123456789abc',channelId:'ch',revisionId:'edition',action:'TAKE',itemId:'live'}
const report:HaControlReport={version:1,request,phase:'CONFIRMED',actor:'admin',updatedAt:'2026-10-11T00:00:00.000Z',confirmationIsHistorical:true,physicalOutputValidated:false}
it('preserva pedido desconhecido após reload, sem converter em TAKE confirmado — NOT_RUN',()=>{
  expect(readPendingHaControls(JSON.stringify({ch:{request,phase:'UNKNOWN'}}))).toEqual({ch:{request,phase:'UNKNOWN'}})
})
it('recusa ACK de abertura como confirmação de TAKE — NOT_RUN',()=>{
  expect(()=>confirmedHaControlResponse(request,report)).toThrow()
  expect(()=>confirmedHaControlResponse(request,{...report,proof:{itemId:'live',ownerId:'32345678-1234-4234-8234-123456789abc',term:2,programChanged:false,signalConfirmed:false}})).toThrow()
})
it('aceita somente prova nativa atribuível ao pedido — NOT_RUN',()=>{
  expect(confirmedHaControlResponse(request,{...report,proof:{itemId:'live',ownerId:'32345678-1234-4234-8234-123456789abc',term:2,decoderId:4,elapsed:1,nativeConfirmed:true}}).phase).toBe('CONFIRMED')
  expect(()=>confirmedHaControlResponse(request,{...report,request:{...request,itemId:'other'}})).toThrow()
})
it('diário inválido não desaparece silenciosamente — NOT_RUN',()=>{
  expect(()=>readPendingHaControls('{')).toThrow();expect(()=>readPendingHaControls(JSON.stringify({other:{request,phase:'UNKNOWN'}}))).toThrow()
})
