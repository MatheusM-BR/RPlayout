import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {createApp,runtimeFor,type App} from '../app.js'
import {channels,rundowns} from '../db/schema.js'
import {Checkpoints} from './checkpoints.js'

vi.mock('../config.js', async original => ({ ...await original<Record<string,unknown>>(), ENGINE_BINARY:'', MEDIAMTX_BINARY:'', DEVICES_BINARY:'' }))
let app:App
beforeEach(async()=>{
  app=await createApp(':memory:');const stamp=new Date().toISOString()
  app.db.insert(channels).values({id:'ch',name:'Ocioso QA',rateNum:25,rateDen:1,width:320,height:180,targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,createdAt:stamp}).run()
  app.db.insert(rundowns).values({id:'rd',channelId:'ch',name:'Grade',date:'2026-10-20',plannedStart:0,loop:false,createdAt:stamp,updatedAt:stamp}).run()
})
afterEach(()=>{app.close();vi.useRealTimers()})

it('canal sem nada no ar não regrava o mesmo checkpoint a cada segundo; muda ou 30 s depois, grava',async()=>{
  const runtime=(await runtimeFor(app,'ch'))!
  await runtime.load('rd')
  const write=vi.spyOn(Checkpoints.prototype,'write')
  let now=Date.parse('2026-10-20T22:00:00Z');vi.spyOn(Date,'now').mockImplementation(()=>now)
  runtime.checkpoint()
  const first=write.mock.calls.length
  for(let i=0;i<10;i++){now+=1_000;runtime.checkpoint()}
  expect(write.mock.calls.length).toBe(first)
  // Forced writes (STOP, recovery) are never skipped.
  runtime.checkpoint(true)
  expect(write.mock.calls.length).toBe(first+1)
  now+=31_000;runtime.checkpoint()
  expect(write.mock.calls.length).toBe(first+2)
  expect(first).toBe(1)
})
it('telemetria atualiza a grade no máximo uma vez por segundo, juntando as marcações do intervalo',async()=>{
  const runtime=(await runtimeFor(app,'ch'))!
  await runtime.load('rd')
  vi.useFakeTimers()
  const refresh=vi.spyOn(runtime,'refresh')
  await runtime.refreshForTelemetry()
  expect(refresh).toHaveBeenCalledTimes(1)
  const second=runtime.refreshForTelemetry(),third=runtime.refreshForTelemetry()
  expect(third).toBe(second)
  expect(refresh).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(1_000)
  await second
  expect(refresh).toHaveBeenCalledTimes(2)
})

it('no último quadro de um item cortado o checkpoint anterior fica, sem alerta permanente',async()=>{
  const runtime=(await runtimeFor(app,'ch'))!
  await runtime.load('rd')
  const write=vi.spyOn(Checkpoints.prototype,'write')
  const real=runtime.transport.state.bind(runtime.transport)
  vi.spyOn(runtime.transport,'state').mockImplementation(()=>({...real(),onAir:{itemId:'x',startedAt:0,elapsed:2736},playing:true,programTrim:{in:0,out:2736}} as ReturnType<typeof real>))
  runtime.checkpoint()
  expect(write).not.toHaveBeenCalled()
  expect(runtime.recoveryError).toBeNull()
})
