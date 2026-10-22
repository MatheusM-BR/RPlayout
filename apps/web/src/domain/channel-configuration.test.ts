import {afterEach,describe,expect,it,vi} from 'vitest'
import {configurationHeaders,channelConfigurationPatch,captureConfigurationRevision} from './channel-configuration.js'
import {api} from '../api.js'
import type {Channel} from '@rplayout/protocol'
const original:Channel={id:'QC/Ç:Ã',name:'Original',width:1920,height:1080,rate:{num:25,den:1},scan:'PROGRESSIVE',fieldOrder:'TFF',targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,programSdiDeviceId:null,slateTemplateId:null,createdAt:'now',audioChannels:8,configurationRevision:42}
afterEach(()=>vi.restoreAllMocks())
describe('rascunho de configuração conserva o baseline de abertura',()=>{
  it('atualizar a lista preserva revisão original; só primeira abertura ou reabertura explícita capturam revisão nova',()=>{
    expect(captureConfigurationRevision(original.id,undefined,42)).toBe(42)
    expect(captureConfigurationRevision(original.id,42,99)).toBe(42)
    expect(captureConfigurationRevision(original.id,42,99,true)).toBe(99)
    expect(()=>captureConfigurationRevision(original.id,42,0)).toThrow()
  })
  it('presets usam exatamente a revisão de abertura e identidade Unicode, sem buscar autorização nova',async()=>{
    const fetcher=vi.spyOn(globalThis,'fetch').mockImplementation(async()=>new Response(JSON.stringify({ok:true,configurationRevision:43}),{status:200,headers:{'Content-Type':'application/json'}}))
    await api.addTransmissionPreset(original.id,{name:'Destino',kind:'SRT',target:'srt://localhost:9000'},42)
    await api.applyTransmissionPreset(original.id,'preset/Ç',42)
    await api.removeTransmissionPreset(original.id,'preset/Ç',42)
    expect(fetcher).toHaveBeenCalledTimes(3)
    for(const [path,init] of fetcher.mock.calls){expect(new Headers(init?.headers).get('If-Match')).toBe(configurationHeaders(original.id,42)['If-Match']);expect(String(path)).toContain('QC%2F%C3%87%3A%C3%83')}
    expect(String(fetcher.mock.calls[1]![0])).toContain('preset%2F%C3%87/apply')
  })
  it('não envia campos intactos nem valor indefinido; áudio carrega seu total anterior',()=>{
    expect(channelConfigurationPatch(original,{name:'Editado',width:1920,rateNum:25,rateDen:1,audioChannels:16})).toEqual({name:'Editado',audioChannels:16,expectedAudioChannels:8})
    expect(channelConfigurationPatch(original,{name:original.name,width:undefined})).toEqual({})
  })
  it('identidade Unicode tem ETag próprio, sem presumir revisão ausente',()=>{
    expect(configurationHeaders(original.id,42)).toEqual({'If-Match':'"channel:QC%2F%C3%87%3A%C3%83:42"'})
    expect(()=>configurationHeaders(original.id,undefined)).toThrow('seus campos não foram enviados')
    for(const bad of [0,-1,1.5,Infinity,NaN,Number.MAX_SAFE_INTEGER+1])expect(()=>configurationHeaders(original.id,bad)).toThrow()
  })
  it('API usa revisão capturada e corpo mínimo, sem consulta para substituir revisão antiga',async()=>{
    const fetcher=vi.spyOn(globalThis,'fetch').mockImplementation(async()=>new Response(JSON.stringify({ok:true,configurationRevision:43}),{status:200,headers:{'Content-Type':'application/json'}}))
    await api.patchChannel(original.id,channelConfigurationPatch(original,{name:'Editado'}),original.configurationRevision)
    await api.cadencePreview(original.id,{num:50,den:1},{name:'Editado'},42)
    await api.cadenceConvert(original.id,{num:50,den:1},'a'.repeat(64),{name:'Editado'},42)
    expect(fetcher).toHaveBeenCalledTimes(3)
    for(const [path,init] of fetcher.mock.calls){expect(new Headers(init?.headers).get('If-Match')).toBe(configurationHeaders(original.id,42)['If-Match']);expect(String(path)).toContain('QC%2F%C3%87%3A%C3%83')}
    expect(JSON.parse(String(fetcher.mock.calls[0]![1]!.body))).toEqual({name:'Editado'})
    for(const [,init] of fetcher.mock.calls.slice(1))expect(JSON.parse(String(init!.body)).format).toEqual({name:'Editado'})
  })
  it('API recusa revisão ausente antes de trafegar e não busca novo baseline automaticamente',()=>{
    const fetcher=vi.spyOn(globalThis,'fetch')
    expect(()=>api.patchChannel(original.id,{width:1280},undefined)).toThrow()
    expect(()=>api.cadencePreview(original.id,{num:50,den:1},{},undefined)).toThrow()
    expect(()=>api.cadenceConvert(original.id,{num:50,den:1},'a'.repeat(64),{},undefined)).toThrow()
    expect(()=>api.addTransmissionPreset(original.id,{name:'Destino',kind:'SRT',target:'srt://localhost:9000'},undefined)).toThrow()
    expect(()=>api.applyTransmissionPreset(original.id,'preset',undefined)).toThrow()
    expect(()=>api.removeTransmissionPreset(original.id,'preset',undefined)).toThrow()
    expect(()=>api.addOutput(original.id,{name:'SRT',kind:'SRT',target:'srt://localhost:9000'},undefined)).toThrow()
    expect(()=>api.patchOutput('out',{name:'SRT'},original.id,undefined)).toThrow()
    expect(()=>api.removeOutput('out',original.id,undefined)).toThrow()
    expect(()=>api.reconcileConfiguration(original.id,'run',undefined)).toThrow()
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('saídas e reconciliação enviam prova original sem consulta/retry para trocar baseline',async()=>{
    const fetcher=vi.spyOn(globalThis,'fetch').mockImplementation(async()=>new Response(JSON.stringify({ok:true,configurationRevision:43}),{status:200,headers:{'Content-Type':'application/json'}}))
    await api.addOutput(original.id,{name:'SRT',kind:'SRT',target:'srt://localhost:9000'},42)
    await api.patchOutput('out/Ç',{bitrateKbps:7000},original.id,42)
    await api.removeOutput('out/Ç',original.id,42)
    await api.reconcileConfiguration(original.id,'run',42)
    expect(fetcher).toHaveBeenCalledTimes(4)
    for(const [,init] of fetcher.mock.calls)expect(new Headers(init?.headers).get('If-Match')).toBe(configurationHeaders(original.id,42)['If-Match'])
    expect(String(fetcher.mock.calls[1]![0])).toBe('/api/outputs/out%2F%C3%87')
    expect(String(fetcher.mock.calls[2]![0])).toBe('/api/outputs/out%2F%C3%87')
    expect(JSON.parse(String(fetcher.mock.calls[3]![1]!.body))).toEqual({runId:'run',confirm:true})
  })
})
