// NOT_RUN: selected append contracts; no real HA/native validation.
import {it,expect} from 'vitest'
import {haHistoryImportRequest,haHistoryAppendEligible,asRunRowHash} from './ha-history-import.js'
const id='12345678-1234-4234-8234-123456789abc'
it('importação é por IDs/hashes, sem overwrite ou caminho externo — NOT_RUN',()=>{
  const request={importId:id,reviewId:id,transferId:id,channelId:'ch',records:[{id:'run',receivedHash:'a'.repeat(64)}]}
  expect(haHistoryImportRequest.safeParse(request).success).toBe(true)
  expect(haHistoryImportRequest.safeParse({...request,overwrite:true}).success).toBe(false)
  expect(haHistoryImportRequest.safeParse({...request,records:[...request.records,...request.records]}).success).toBe(false)
})
it('não importa registro aberto/simulado/duração estimada — NOT_RUN',()=>{
  const row={execution_kind:'NATIVE',duration_evidence:'ENGINE_POSITION',started_at:'2026-10-11T00:00:00Z',ended_at:'2026-10-11T00:00:01Z',aired_frames:25,start_position_frames:0,end_position_frames:25,rate_num:25,rate_den:1}
  expect(haHistoryAppendEligible(row)).toBe(true)
  for(const change of [{ended_at:null},{execution_kind:'SIMULATED'},{duration_evidence:'CLOCK_ESTIMATE'},{start_position_frames:-1}])expect(haHistoryAppendEligible({...row,...change})).toBe(false)
})
it('SHA cobre todos os campos e não depende da ordem das colunas — NOT_RUN',()=>{
  expect(asRunRowHash({id:'a',title:'b'},['id','title'])).toBe(asRunRowHash({id:'a',title:'b'},['title','id']))
  expect(asRunRowHash({id:'a',title:'b'},['id','title'])).not.toBe(asRunRowHash({id:'a',title:'c'},['id','title']))
})
