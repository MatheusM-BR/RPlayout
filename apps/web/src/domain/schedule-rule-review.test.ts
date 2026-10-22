import {afterEach,describe,expect,it,vi} from 'vitest'
import type {ScheduleRuleReview} from '@rplayout/protocol'
import {scheduleRuleHeaders,scheduleRulesReady} from './schedule-rule-review.js'
import {api} from '../api.js'
afterEach(()=>vi.restoreAllMocks())
const review:ScheduleRuleReview={channelId:'channel:ç',revision:41,rules:[],editorialOnly:true,automaticTake:false}
it('pauta só pode ser proposta com conferência pronta e sem rascunho/consentimento pendente',()=>{
  const state={blocked:false,busy:false,dirty:false,intent:false}
  expect(scheduleRulesReady(review,review,state)).toBe(true)
  for(const key of ['blocked','busy','dirty','intent'])expect(scheduleRulesReady(review,review,{...state,[key]:true})).toBe(false)
  expect(scheduleRulesReady(null,review,state)).toBe(false);expect(scheduleRulesReady(review,null,state)).toBe(false)
  expect(scheduleRulesReady(review,{...review,revision:42},state)).toBe(false);expect(scheduleRulesReady(review,{...review,channelId:'other'},state)).toBe(false)
})
describe('API de faixas conserva a revisão da abertura',()=>{
  it('CRUD envia somente a conferência original, sem GET de renovação',async()=>{
    const fetcher=vi.spyOn(globalThis,'fetch').mockImplementation(async()=>new Response(JSON.stringify({...review,revision:42,applied:true}),{status:200}))
    await api.addRule(review.channelId,{name:'Draft',weekdays:'0',startMinute:60,endMinute:120,categories:[],avoidHours:0},review)
    await api.updateRule('band ç',review.channelId,{name:'Draft'},review)
    await api.removeRule('band ç',review.channelId,review)
    expect(fetcher).toHaveBeenCalledTimes(3)
    expect(fetcher.mock.calls.map(([url])=>url)).toEqual(['/api/channels/channel%3A%C3%A7/rules','/api/rules/band%20%C3%A7','/api/rules/band%20%C3%A7'])
    expect(fetcher.mock.calls.map(([,init])=>init?.method)).toEqual(['POST','PATCH','DELETE'])
    for(const [,init]of fetcher.mock.calls)expect(new Headers(init?.headers).get('If-Match')).toBe('"rules:channel%3A%C3%A7:41"')
  })
  it('lista nova não renova o rascunho existente',()=>{
    const newList={...review,revision:42};expect(scheduleRuleHeaders(review,review.channelId)).not.toEqual(scheduleRuleHeaders(newList,review.channelId))
    expect(scheduleRuleHeaders(review,review.channelId)['If-Match']).toContain(':41"')
  })
  it.each([null,{...review,channelId:'foreign'},{...review,revision:0},{...review,revision:NaN},{...review,revision:Number.MAX_SAFE_INTEGER+1}])('sem revisão válida %j não faz chamada',original=>{
    const fetcher=vi.spyOn(globalThis,'fetch')
    expect(()=>api.removeRule('band',review.channelId,original)).toThrow();expect(fetcher).not.toHaveBeenCalled()
  })
})
