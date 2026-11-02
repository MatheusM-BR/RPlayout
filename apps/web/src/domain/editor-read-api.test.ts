import {afterEach,it,expect,vi} from 'vitest'
import type {AssetMetadataReview,AssetRemovalReview,GraphicsReview,ScheduleRuleReview} from '@rplayout/protocol'
import {api} from '../api.js'
afterEach(()=>vi.unstubAllGlobals())
it('GETs editoriais propagam cancelamento e codificam IDs sem confundir escopo global',async()=>{
  const calls:Array<[string,RequestInit]>=[]
  vi.stubGlobal('fetch',async(path:string,init:RequestInit={})=>{calls.push([path,init]);return new Response('{}')})
  const controller=new AbortController(),id='São José/Çãó & Ó'
  await api.assetMetadataReview(id,controller.signal);await api.assetRemovalReview(id,controller.signal);await api.assetRemovalReview(null,controller.signal)
  await api.graphicsReview(id,controller.signal);await api.graphicsReview(null,controller.signal);await api.rules(id,controller.signal);await api.graphicCommands(id,controller.signal)
  expect(calls.map(([url])=>url)).toEqual([`/api/assets/${encodeURIComponent(id)}/metadata-review`,`/api/assets/${encodeURIComponent(id)}/removal-review`,'/api/assets/prune-review',`/api/graphics/review?channelId=${encodeURIComponent(id)}`,'/api/graphics/review',`/api/channels/${encodeURIComponent(id)}/rules`,`/api/channels/${encodeURIComponent(id)}/graphic-commands`])
  for(const [,init]of calls){expect(init.signal).toBe(controller.signal);expect(init.method??'GET').toBe('GET');expect(init.body).toBeUndefined()}
})
it('cancelar consulta não cancela mutações nem renova suas provas originais',async()=>{
  const calls:Array<[string,RequestInit]>=[]
  vi.stubGlobal('fetch',async(path:string,init:RequestInit={})=>{calls.push([path,init]);return new Response('{}')})
  const metadata={assetId:'a',title:'Original',categoryId:null,revision:3,canEdit:true} satisfies AssetMetadataReview
  const removal={assetId:'a',operation:'REMOVE',token:'A'.repeat(43),assets:[{assetId:'a',title:'Original',revision:3,uses:[],blockers:[],publishedReferences:0,historicalReferences:0}],filesPreserved:true,historyPreserved:true,automaticTake:false} satisfies AssetRemovalReview
  const graphics={channelId:'ch',revision:4,sharedRevision:7,templates:[],slateTemplateId:null,channelArchived:false,automaticTake:false,physicalOutputValidated:false} satisfies GraphicsReview
  const rule={channelId:'ch',revision:9,rules:[],editorialOnly:true,automaticTake:false} satisfies ScheduleRuleReview
  const controller=new AbortController();await api.graphicsReview('ch',controller.signal);controller.abort()
  await api.patchAssetMetadata('a',{title:'Novo'},metadata);await api.removeAssets('a',removal,['a'],false)
  await api.updateGraphicTemplate('art','ch',{name:'Novo'},graphics);await api.removeGraphicTemplate('art','ch',graphics);await api.setSlate('ch',null,graphics)
  await api.updateRule('rule','ch',{name:'Novo'},rule);await api.removeRule('rule','ch',rule)
  await api.reviewGraphicCommand('ch',{id:'cmd',state:'UNCERTAIN',reviewToken:'token-original',createdAt:'now',actor:null,replayed:false,physicalOutputValidated:false},'Conferido no QA')
  const writes=calls.slice(1);expect(writes.map(([,init])=>init.method)).toEqual(['PATCH','DELETE','PATCH','DELETE','PATCH','PATCH','DELETE','POST'])
  for(const [,init]of writes)expect(init.signal).toBeUndefined()
  expect(new Headers(writes[0]![1].headers).get('if-match')).toBe('"asset-metadata:a:3"')
  for(const [,init]of writes.slice(2,5))expect(new Headers(init.headers).get('if-match')).toBe('"graphics:C%3Ach:4:7"')
  for(const [,init]of writes.slice(5,7))expect(new Headers(init.headers).get('if-match')).toBe('"rules:ch:9"')
  expect(JSON.parse(String(writes[7]![1].body))).toEqual({reviewToken:'token-original',note:'Conferido no QA',imageAndEngineChecked:true})
})
