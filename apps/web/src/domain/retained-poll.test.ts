import {afterEach,expect,it,vi} from 'vitest'
import {RetainedPoll,type RetainedPollState} from './retained-poll.js'

afterEach(()=>vi.useRealTimers())
it('lista desconhecida não vira vazia; vazia só depois de GET válido',async()=>{
  const states:RetainedPollState<string[]>[]=[],reader=new RetainedPoll<string[]>(state=>states.push(state),'falhou')
  await reader.refresh(async()=>{throw new Error('offline')})
  expect(states.at(-1)).toEqual({value:null,pending:false,error:'falhou'})
  await reader.refresh(async()=>[])
  expect(states.at(-1)).toEqual({value:[],pending:false,error:null});reader.close()
})
it('falha preserva identidade da lista e seleção; recuperar publica novo catálogo',async()=>{
  const states:RetainedPollState<string[]>[]=[],reader=new RetainedPoll<string[]>(state=>states.push(state),'falhou'),original=['ndi:ÇÃÓ']
  await reader.refresh(async()=>original);await reader.refresh(async()=>{throw new Error('503')})
  expect(states.at(-1)?.value).toBe(original);expect(states.at(-1)?.error).toBe('falhou')
  await reader.refresh(async()=>['omt:çãó'])
  expect(states.at(-1)).toEqual({value:['omt:çãó'],pending:false,error:null});reader.close()
})
it('ticks e recarga durante consulta compartilham um GET sem sobreposição',async()=>{
  let finish!:(value:string[])=>void
  const loader=vi.fn(()=>new Promise<string[]>(resolve=>{finish=resolve})),publish=vi.fn(),reader=new RetainedPoll<string[]>(publish,'prazo')
  const first=reader.refresh(loader),second=reader.refresh(loader)
  expect(second).toBe(first);expect(loader).toHaveBeenCalledOnce()
  finish(['A']);await first;expect(publish).toHaveBeenCalledTimes(2);reader.close()
})
it('prazo libera UI mesmo se transporte ignorar abort; retorno tardio não substitui lista nova',async()=>{
  vi.useFakeTimers();let late!:(value:string[])=>void
  const states:RetainedPollState<string[]>[]=[],reader=new RetainedPoll<string[]>(state=>states.push(state),'prazo')
  await reader.refresh(async()=>['original'])
  const pending=reader.refresh(()=>new Promise<string[]>(resolve=>{late=resolve}))
  await vi.advanceTimersByTimeAsync(10000);await pending
  expect(states.at(-1)).toEqual({value:['original'],pending:false,error:'prazo'})
  await reader.refresh(async()=>['nova']);late(['antiga']);await Promise.resolve()
  expect(states.at(-1)?.value).toEqual(['nova']);expect(vi.getTimerCount()).toBe(0);reader.close()
})
it('fechar contexto cancela só GET e não publica dados antigos no novo canal',async()=>{
  let finish!:(value:string[])=>void,signal!:AbortSignal
  const oldPublish=vi.fn(),old=new RetainedPoll<string[]>(oldPublish,'prazo')
  const pending=old.refresh(sig=>{signal=sig;return new Promise<string[]>(resolve=>{finish=resolve})})
  const writes=new AbortController();old.close();await pending
  expect(signal.aborted).toBe(true);expect(writes.signal.aborted).toBe(false)
  const freshPublish=vi.fn(),fresh=new RetainedPoll<string[]>(freshPublish,'prazo')
  await fresh.refresh(async()=>['canal B']);finish(['canal A']);await Promise.resolve()
  expect(oldPublish).toHaveBeenCalledTimes(1);expect(freshPublish.mock.lastCall?.[0].value).toEqual(['canal B']);fresh.close()
})
it('telemetria com falha/pendente não apaga nem bloqueia leitura independente do catálogo',async()=>{
  const catalogPublish=vi.fn(),telemetryPublish=vi.fn(),catalog=new RetainedPoll<string[]>(catalogPublish,'catálogo'),telemetry=new RetainedPoll<object>(telemetryPublish,'telemetria')
  await Promise.all([catalog.refresh(async()=>['NDI']),telemetry.refresh(async()=>{throw new Error('telemetria 503')})])
  expect(catalogPublish.mock.lastCall?.[0]).toEqual({value:['NDI'],pending:false,error:null})
  expect(telemetryPublish.mock.lastCall?.[0]).toEqual({value:null,pending:false,error:'telemetria'})
  catalog.close();telemetry.close()
})
