import {afterEach,describe,expect,it,vi} from 'vitest'
import type {GraphicsReview} from '@rplayout/protocol'
import {graphicsHeaders} from './graphics-review.js'
import {api} from '../api.js'
afterEach(()=>vi.restoreAllMocks())
const review:GraphicsReview={channelId:'ch:ç',revision:41,sharedRevision:72,templates:[],slateTemplateId:null,channelArchived:false,automaticTake:false,physicalOutputValidated:false}
const draft={name:'Arte',svg:'<g/>',fields:[],fadeMs:300,holdSeconds:null}
describe('API de artes não renova prova de uma ação antiga',()=>{
  it('CRUD/slate envia somente a conferência original e não faz GET implícito',async()=>{
    const fetcher=vi.spyOn(globalThis,'fetch').mockImplementation(async()=>new Response(JSON.stringify({...review,revision:42,applied:true}),{status:200}))
    await api.addGraphicTemplate(review.channelId,draft,review);await api.updateGraphicTemplate('art ç',review.channelId,{name:'Draft'},review);await api.removeGraphicTemplate('art ç',review.channelId,review);await api.setSlate(review.channelId!,'art ç',review)
    expect(fetcher).toHaveBeenCalledTimes(4);expect(fetcher.mock.calls.map(([,init])=>init?.method)).toEqual(['POST','PATCH','DELETE','PATCH']);expect(fetcher.mock.calls.map(([url])=>url)).toEqual(['/api/graphics','/api/graphics/art%20%C3%A7','/api/graphics/art%20%C3%A7','/api/channels/ch%3A%C3%A7/slate'])
    for(const [,init]of fetcher.mock.calls)expect(new Headers(init?.headers).get('If-Match')).toBe('"graphics:C%3Ach%3A%C3%A7:41:72"')
  })
  it('consulta de canal Unicode é explícita e global não vira canal G',async()=>{
    const fetcher=vi.spyOn(globalThis,'fetch').mockImplementation(async()=>new Response(JSON.stringify(review),{status:200}))
    await api.graphicsReview('ch:ç');await api.graphicsReview(null);expect(fetcher.mock.calls.map(([url])=>url)).toEqual(['/api/graphics/review?channelId=ch%3A%C3%A7','/api/graphics/review'])
    expect(graphicsHeaders({...review,channelId:null},null)['If-Match']).not.toBe(graphicsHeaders({...review,channelId:'G'},'G')['If-Match'])
  })
  it('atualizar lista não muda a conferência original do rascunho',()=>{
    expect(graphicsHeaders(review,review.channelId)['If-Match']).toContain(':41:72"');expect(graphicsHeaders({...review,sharedRevision:73},review.channelId)).not.toEqual(graphicsHeaders(review,review.channelId))
  })
  it.each([null,{...review,channelId:'foreign'},{...review,revision:0},{...review,sharedRevision:NaN},{...review,revision:Number.MAX_SAFE_INTEGER+1}])('sem prova válida %j não envia escolha/CRUD',original=>{
    const fetcher=vi.spyOn(globalThis,'fetch');expect(()=>api.setSlate(review.channelId!,null,original)).toThrow();expect(fetcher).not.toHaveBeenCalled()
  })
})
