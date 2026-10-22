import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {createApp,runtimeFor,type App} from '../app.js'
import {channels} from '../db/schema.js'

vi.mock('../config.js', async original => ({ ...await original<Record<string,unknown>>(), ENGINE_BINARY:'', MEDIAMTX_BINARY:'', DEVICES_BINARY:'' }))
let app:App
beforeEach(async()=>{
  vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date(2026,9,20,19,0,0))
  app=await createApp(':memory:')
  app.db.insert(channels).values({id:'ch',name:'Monitor QA',rateNum:25,rateDen:1,width:320,height:180,targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,createdAt:new Date().toISOString()}).run()
})
afterEach(()=>{app.close();vi.useRealTimers()})

it('monitor ligado reafirma a ordem a cada 5 s enquanto a janela avisa; uma ordem perdida não deixa o monitor preto para sempre',async()=>{
  const runtime=(await runtimeFor(app,'ch'))!
  const monitores=(runtime as unknown as {monitores:Set<string>}).monitores
  monitores.add('pvw')
  const set=vi.spyOn(runtime.transport,'setMonitor').mockImplementation(()=>{})
  runtime.watching('pvw')
  expect(set).toHaveBeenCalledTimes(1)
  // Heartbeats inside the window do not flood the engine.
  vi.setSystemTime(Date.now()+4_000);runtime.watching('pvw')
  expect(set).toHaveBeenCalledTimes(1)
  // Next heartbeat after 5 s re-sends the same idempotent order.
  vi.setSystemTime(Date.now()+1_000);runtime.watching('pvw')
  expect(set).toHaveBeenCalledTimes(2)
  expect(set).toHaveBeenLastCalledWith('pvw',true)
  // A bus this channel does not have is never ordered.
  runtime.watching('mon')
  expect(set.mock.calls.every(([bus])=>bus==='pvw')).toBe(true)
})
