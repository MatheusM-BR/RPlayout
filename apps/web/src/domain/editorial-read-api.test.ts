import {afterEach,it,expect,vi} from 'vitest'
import {api} from '../api.js'

afterEach(()=>vi.unstubAllGlobals())
it('sessão e acervo propagam cancelamento GET e codificam canal Unicode',async()=>{
  const calls:Array<[string,RequestInit]>=[]
  vi.stubGlobal('fetch',async(path:string,init:RequestInit={})=>{calls.push([path,init]);return new Response('{}')})
  const controller=new AbortController(),channel='Canal/Çãó & Ó'
  await api.session(controller.signal);await api.library(channel,controller.signal);await api.library(undefined,controller.signal)
  expect(calls.map(([path])=>path)).toEqual(['/api/session',`/api/library?channelId=${encodeURIComponent(channel)}`,'/api/library'])
  for(const [,init]of calls){expect(init.signal).toBe(controller.signal);expect(init.method??'GET').toBe('GET');expect(init.body).toBeUndefined()}
})
it('catálogo, fila e conferências de integrações compartilham signal só em GET; comandos preservam prova/UUID',async()=>{
  const calls:Array<[string,RequestInit]>=[]
  vi.stubGlobal('fetch',async(path:string,init:RequestInit={})=>{calls.push([path,init]);return new Response('{}')})
  const controller=new AbortController(),channel='Canal/Çãó',id='Gateway/Ó',delivery='Entrega/Ç'
  await api.integrations(channel,controller.signal);await api.integrationDeliveries(channel,controller.signal)
  await api.integrationCatalogReview(channel,controller.signal);await api.integrationCatalogReview(null,controller.signal)
  await api.integrationReview(id,controller.signal);await api.integrationDeliveryReview(delivery,controller.signal)
  expect(calls.map(([path])=>path)).toEqual([
    `/api/integrations?channelId=${encodeURIComponent(channel)}`,`/api/integration-deliveries?channelId=${encodeURIComponent(channel)}`,
    `/api/integrations/review?channelId=${encodeURIComponent(channel)}`,'/api/integrations/review',
    `/api/integrations/${encodeURIComponent(id)}/review`,`/api/integration-deliveries/${encodeURIComponent(delivery)}/review`
  ])
  for(const [,init]of calls){expect(init.signal).toBe(controller.signal);expect(init.method??'GET').toBe('GET');expect(init.body).toBeUndefined()}
  const review={id,channelId:channel,name:'Gateway',url:'http://localhost',events:['engine.error'],enabled:false,revision:4,canEdit:true}
  await api.patchIntegration(id,{name:'Novo'},review);await api.testIntegration(id,review,'stable-uuid')
  await api.retryIntegrationDelivery(delivery,{id:delivery,integrationId:id,channelId:channel,state:'FAILED',attempts:1,revision:3,configurationRevision:4,canRetry:true,requiresOwnerConfirmation:false,diagnostic:{ownership:'INACTIVE',message:'Falhou'}},false)
  expect(calls.slice(6).map(([,init])=>init.method)).toEqual(['PATCH','POST','POST'])
  for(const [,init]of calls.slice(6))expect(init.signal).toBeUndefined()
  expect(new Headers(calls[7]![1].headers).get('if-match')).toBe(`"integration:${encodeURIComponent(id)}:4"`)
  expect(JSON.parse(String(calls[7]![1].body))).toEqual({requestId:'stable-uuid'})
})
it('catálogos e conferência de categoria usam signal somente em GET, com ID Unicode codificado',async()=>{
  const calls:Array<[string,RequestInit]>=[]
  vi.stubGlobal('fetch',async(path:string,init:RequestInit={})=>{calls.push([path,init]);return new Response('{}')})
  const controller=new AbortController()
  await api.categories(controller.signal);await api.categoryReview('AÇÃO/Çãó',controller.signal)
  expect(calls.map(([path])=>path)).toEqual(['/api/categories','/api/categories/A%C3%87%C3%83O%2F%C3%87%C3%A3%C3%B3/review'])
  for(const [,init]of calls){expect(init.signal).toBe(controller.signal);expect(init.method??'GET').toBe('GET');expect(init.body).toBeUndefined()}
  await api.setCategoryColor('AÇÃO/Çãó','#5b8fd6',{id:'AÇÃO/Çãó',color:'#4a9d7a',stored:true,canEdit:true,revision:4,items:0})
  expect(calls[2]![1].method).toBe('PUT');expect(calls[2]![1].signal).toBeUndefined()
})
it('pastas, navegação, conferência e polling são canceláveis sem trocar caracteres ou iniciar scan',async()=>{
  const calls:Array<[string,RequestInit]>=[]
  vi.stubGlobal('fetch',async(path:string,init:RequestInit={})=>{calls.push([path,init]);return new Response('{}')})
  const controller=new AbortController(),path='C:\\Acervo São José Çãó'
  await api.rootCatalogReview(controller.signal);await api.browseMediaRoot(path,controller.signal);await api.rootAddReview(path,controller.signal);await api.scanStatus(controller.signal)
  expect(calls.map(([url])=>url)).toEqual(['/api/library/roots/review',`/api/library/roots/browse?path=${encodeURIComponent(path)}`,`/api/library/roots/add-review?path=${encodeURIComponent(path)}`,'/api/library/scan'])
  for(const [,init]of calls){expect(init.signal).toBe(controller.signal);expect(init.method??'GET').toBe('GET');expect(init.body).toBeUndefined()}
  await api.browseMediaRoot(undefined,controller.signal);expect(calls[4]![0]).toBe('/api/library/roots/browse')
})
