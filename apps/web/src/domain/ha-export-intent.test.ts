// NOT_RUN: browser contract; no browser/native validation performed.
import {it,expect} from 'vitest'
import {exportIntent,exportReport} from './ha-export-intent.js'
import type {HaExportReport} from '../api.js'
const id='12345678-1234-4234-8234-123456789abc'
const request={requestId:id,channelId:'ch',promotionId:id,stopRequestId:id}
it('preserva intenção estrita sem caminhos externos — NOT_RUN',()=>{
  expect(exportIntent(request)).toEqual(request)
  expect(()=>exportIntent({...request,path:'foreign'})).toThrow()
})
it('resposta selada exige hashes, tamanho e mesma intenção — NOT_RUN',()=>{
  const report:HaExportReport={version:1,request,phase:'SEALED',updatedAt:'2026-10-11T00:00:00.000Z',partialEvidenceRetained:true,databaseHash:'a'.repeat(64),databaseBytes:4096,manifestHash:'b'.repeat(64),reverseSyncConfirmed:false,primaryApproved:false,publicationAuthorized:false}
  expect(exportReport(request,report)).toEqual(report)
  expect(()=>exportReport(request,{...report,databaseHash:null})).toThrow()
  expect(()=>exportReport(request,{...report,databaseBytes:0})).toThrow()
  expect(()=>exportReport(request,{...report,request:{...request,channelId:'other'}})).toThrow()
})
