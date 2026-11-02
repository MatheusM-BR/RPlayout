import {afterEach,it,expect,vi} from 'vitest'
import {api} from '../api.js'
afterEach(()=>vi.unstubAllGlobals())
it('catálogo e telemetria recebem sinais GET independentes; nomes de canal codificados',async()=>{
  const calls:Array<[string,RequestInit]>=[]
  vi.stubGlobal('fetch',async(url:string,init:RequestInit={})=>{calls.push([url,init]);return new Response(url.includes('/sources/live')?'[]':'{}')})
  const sources=new AbortController(),telemetry=new AbortController()
  await api.liveSources('QC Çãó / 2',sources.signal);await api.srtTelemetry(telemetry.signal)
  expect(calls.map(([url])=>url)).toEqual(['/api/sources/live?channelId=QC%20%C3%87%C3%A3%C3%B3%20%2F%202','/api/srt/telemetry'])
  expect(calls[0]![1].signal).toBe(sources.signal);expect(calls[1]![1].signal).toBe(telemetry.signal)
  for(const [,init]of calls){expect(init.method??'GET').toBe('GET');expect(init.body).toBeUndefined()}
  telemetry.abort();expect(sources.signal.aborted).toBe(false)
})
