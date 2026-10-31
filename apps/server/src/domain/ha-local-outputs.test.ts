import {it,expect} from 'vitest'
import {prepareHaLocalOutputs} from './ha-local-outputs.js'
import type {HaBindings} from './ha-bindings.js'
// NOT_RUN: pure preparation fixtures, not native publishing or physical proof.
const channel={id:'ch',width:1920,height:1080}
const row={id:'out',channelId:'ch',name:'Programa',kind:'RTMP',role:'PROGRAM',target:'rtmp://PRIMARY/live',enabled:true,width:1920,height:1080,rateNum:25,rateDen:1,scan:'PROGRESSIVE',bitrateKbps:8000,createdAt:'2026-10-10T00:00:00Z'}
function plan(outputs:ReturnType<HaBindings['executionBindings']>['outputs']):ReturnType<HaBindings['executionBindings']>{return {planId:'plan',bindingDigest:'digest',inputs:[],outputs}}
it('preserves encoder settings but uses only the local reviewed destination',()=>{
  const result=prepareHaLocalOutputs(channel,[row],plan([{outputId:'out',kind:'RTMP',target:'rtmp://RESERVE/live',reason:null}]))
  expect(JSON.parse(result.program[0]!)).toMatchObject({id:'out',target:'rtmp://RESERVE/live',width:1920,bitrateKbps:8000})
  expect(JSON.stringify(result)).not.toContain('PRIMARY')
  expect(result.publicationAuthorized).toBe(false)
})
it('rejects missing, duplicate and unexpected bindings rather than filling defaults',()=>{
  expect(()=>prepareHaLocalOutputs(channel,[row],plan([]))).toThrow()
  const binding={outputId:'out',kind:'RTMP',target:'rtmp://RESERVE/live',reason:null}
  expect(()=>prepareHaLocalOutputs(channel,[row],plan([binding,binding]))).toThrow()
  expect(()=>prepareHaLocalOutputs(channel,[row],plan([{...binding,outputId:'other'}]))).toThrow()
})
it('requires an explicit disabling reason and never turns disabled outputs into publishers',()=>{
  const result=prepareHaLocalOutputs(channel,[row],plan([{outputId:'out',kind:'RTMP',target:null,reason:'Destino indisponível na reserva'}]))
  expect(result.program).toEqual([])
  expect(result.disabled).toHaveLength(1)
  expect(()=>prepareHaLocalOutputs(channel,[row],plan([{outputId:'out',kind:'RTMP',target:null,reason:null}]))).toThrow()
})
it('uses the effective SRT preview protocol and refuses inherited full-resolution preview',()=>{
  const binding=plan([{outputId:'out',kind:'SRT',target:'srt://127.0.0.1:8890?streamid=publish:reserve',reason:null}])
  expect(()=>prepareHaLocalOutputs(channel,[{...row,role:'PREVIEW'}],binding)).toThrow()
  const result=prepareHaLocalOutputs(channel,[{...row,role:'PREVIEW',width:426,height:240,rateNum:15,bitrateKbps:450}],binding)
  expect(result.program).toEqual([])
  expect(JSON.parse(result.preview!)).toMatchObject({kind:'srt',width:426,bitrateKbps:450})
})
it('requires an explicit discovered connector for master SDI',()=>{
  const result=prepareHaLocalOutputs({...channel,programSdiDeviceId:'sdi:9'},[],plan([{outputId:'@masterSDI',kind:'SDI',target:'sdi:2',reason:null}]))
  expect(result.program).toEqual(['sdi:2'])
  expect(()=>prepareHaLocalOutputs({...channel,programSdiDeviceId:'sdi:9'},[],plan([]))).toThrow()
})
