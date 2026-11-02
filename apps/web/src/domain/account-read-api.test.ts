import {afterEach,it,expect,vi} from 'vitest'
import {api} from '../api.js'
afterEach(()=>vi.unstubAllGlobals())
it('account catalog and channel list share read-only cancellation without attaching it to writes',async()=>{
  const calls:Array<[string,RequestInit]>=[]
  vi.stubGlobal('fetch',async(path:string,init:RequestInit={})=>{calls.push([path,init]);return new Response('{}',{headers:{'content-type':'application/json'}})})
  const controller=new AbortController()
  await Promise.all([api.users(controller.signal),api.state(controller.signal)])
  expect(calls.map(([path])=>path)).toEqual(['/api/users/review','/api/state'])
  for(const [,init]of calls){expect(init.signal).toBe(controller.signal);expect(init.method??'GET').toBe('GET')}
  controller.abort()
  await api.retryMediaJob('unrelated',false)
  expect(calls[2]![1].signal).toBeUndefined()
})
it('session inspection is cancellable, encodes Unicode ID and never ends sessions',async()=>{
  const calls:Array<[string,RequestInit]>=[]
  vi.stubGlobal('fetch',async(path:string,init:RequestInit={})=>{calls.push([path,init]);return new Response('{}',{headers:{'content-type':'application/json'}})})
  const controller=new AbortController()
  await api.userSessions('operador/Çã',controller.signal)
  expect(calls).toHaveLength(1)
  expect(calls[0]![0]).toBe('/api/users/operador%2F%C3%87%C3%A3/sessions')
  expect(calls[0]![1].signal).toBe(controller.signal)
  expect(calls[0]![1].method??'GET').toBe('GET')
  expect(calls[0]![1].body).toBeUndefined()
})
