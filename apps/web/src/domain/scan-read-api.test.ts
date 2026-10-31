import {afterEach,it,expect,vi} from 'vitest'
import type {ScanReview} from '@rplayout/protocol'
import {api} from '../api.js'
afterEach(()=>vi.unstubAllGlobals())
it('somente conferência GET é cancelável; scan/recovery retêm UUID/ETag originais sem AbortSignal',async()=>{
  const calls:Array<[string,RequestInit]>=[]
  vi.stubGlobal('fetch',async(path:string,init:RequestInit={})=>{calls.push([path,init]);return new Response('{}')})
  const controller=new AbortController(),review={operationId:'request-original',revision:2,batchRevision:4} as ScanReview
  await api.scanReview(controller.signal);controller.abort()
  await api.scan(true,review,'C:\\São José Çãó');await api.scan(true,review,'C:\\São José Çãó');await api.recoverScan('lote-Ç',review)
  expect(calls[0]![0]).toBe('/api/library/scan/review');expect(calls[0]![1].signal).toBe(controller.signal)
  expect(calls.slice(1).map(([,init])=>init.method)).toEqual(['POST','POST','POST'])
  for(const [,init]of calls.slice(1)){expect(init.signal).toBeUndefined();expect(new Headers(init.headers).get('if-match')).toBe('"scan:2:4"')}
  expect(calls[1]![1].body).toBe(calls[2]![1].body)
  expect(JSON.parse(String(calls[1]![1].body))).toEqual({measure:true,requestId:'request-original',root:'C:\\São José Çãó'})
  expect(JSON.parse(String(calls[3]![1].body))).toEqual({batchId:'lote-Ç',requestId:'request-original'})
})
