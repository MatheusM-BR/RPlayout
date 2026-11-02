import {afterEach,it,expect,vi} from 'vitest'
import {api,graphicCommandKey} from '../api.js'
afterEach(()=>vi.unstubAllGlobals())
it('SHOW/HIDE/camada preservam chave explícita e consulta não envia comando',async()=>{
  const fetch=vi.fn(async()=>new Response('{}',{status:200,headers:{'content-type':'application/json'}}));vi.stubGlobal('fetch',fetch)
  await api.showGraphic('a','tpl',{},'original-key');await api.showGraphic('a','tpl',{},'original-key')
  await api.hideGraphic('a','hide-key');await api.triggerGraphicLayer('a','LOWER_THIRD',{action:'SHOW',payload:{}},'layer-key')
  await api.graphicCommands('a')
  const requests=fetch.mock.calls as unknown as Array<[string,RequestInit]>
  expect(new Headers(requests[0]![1].headers).get('idempotency-key')).toBe('original-key')
  expect(new Headers(requests[1]![1].headers).get('idempotency-key')).toBe('original-key')
  expect(new Headers(requests[2]![1].headers).get('idempotency-key')).toBe('hide-key')
  expect(new Headers(requests[3]![1].headers).get('idempotency-key')).toBe('layer-key')
  expect(requests[4]![0]).toContain('/graphic-commands');expect(requests[4]![1].method??'GET').toBe('GET')
})
it('chave usa getRandomValues sem depender de randomUUID em HTTP remoto',()=>{
  vi.stubGlobal('crypto',{getRandomValues:(bytes:Uint8Array)=>bytes.fill(10)})
  expect(graphicCommandKey()).toBe('0a'.repeat(16))
  vi.stubGlobal('crypto',undefined);expect(()=>graphicCommandKey()).toThrow('chave segura')
})
