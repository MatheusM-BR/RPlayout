import {afterEach,it,expect,vi} from 'vitest'
import {api} from '../api.js'
import {BoundedLatestRead} from './bounded-latest-read.js'

afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers()})
it('consultas operacionais compartilham cancelamento, IDs Unicode e a revisão original',async()=>{
  const calls:Array<[string,RequestInit]>=[]
  vi.stubGlobal('fetch',async(path:string,init:RequestInit={})=>{calls.push([path,init]);return new Response('{}')})
  const controller=new AbortController(),id='Grade/Çã'
  await api.rundown(id,controller.signal);await api.operationalRevisions(id,controller.signal)
  await api.simulateOperationalPlaylist(id,controller.signal);await api.reviewOperationalRollback(id,'revisão/Ó',37,controller.signal)
  expect(calls).toHaveLength(4)
  for(const [path,init]of calls){expect(path).toContain('/api/rundowns/Grade%2F%C3%87%C3%A3');expect(init.signal).toBe(controller.signal);expect(init.method??'GET').toBe('GET');expect(init.body).toBeUndefined()}
  expect(calls[3]![0]).toContain('revisionId=revis%C3%A3o%2F%C3%93')
  expect(new Headers(calls[3]![1].headers).get('If-Match')).toBe('w/"37"')
})
it('prazo do grupo encerra simulação e histórico pendentes, sem escrever revisão',async()=>{
  vi.useFakeTimers()
  const calls:Array<[string,RequestInit]>=[]
  vi.stubGlobal('fetch',(path:string,init:RequestInit={})=>{calls.push([path,init]);return new Promise<Response>((_,reject)=>init.signal!.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}))})
  const reads=new BoundedLatestRead(),reading=reads.start()!
  const outcome=Promise.allSettled([api.simulateOperationalPlaylist('rd',reading.signal),api.operationalRevisions('rd',reading.signal)])
  await vi.advanceTimersByTimeAsync(10000)
  expect((await outcome).map(result=>result.status)).toEqual(['rejected','rejected'])
  expect(reading.timedOut()).toBe(true);reading.finish()
  expect(calls).toHaveLength(2);for(const [,init]of calls)expect(init.method??'GET').toBe('GET')
})
it('cancelamento de consulta não é anexado a publicação nem confirmação de rollback',async()=>{
  const calls:Array<[string,RequestInit]>=[]
  vi.stubGlobal('fetch',async(path:string,init:RequestInit={})=>{calls.push([path,init]);return new Response('{}')})
  const controller=new AbortController();controller.abort()
  await api.publishOperationalPlaylist('rd',37,'A'.repeat(43));await api.rollbackOperationalPlaylist('rd','rev1',37,'B'.repeat(43))
  for(const [,init]of calls){expect(init.method).toBe('POST');expect(init.signal).toBeUndefined();expect(new Headers(init.headers).get('If-Match')).toBe('w/"37"')}
})
