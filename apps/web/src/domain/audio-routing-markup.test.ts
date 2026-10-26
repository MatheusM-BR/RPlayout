import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {describe,expect,it} from 'vitest'
import {AudioDialog} from '../components/AudioDialog.js'
import type {ItemView} from '../types.js'
import type {AudioLevel,Channel} from '@rplayout/protocol'
const channel:Channel={id:'ch',name:'Áudio',rate:{num:25,den:1},width:1920,height:1080,scan:'PROGRESSIVE',fieldOrder:'TFF',targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,programSdiDeviceId:null,slateTemplateId:null,createdAt:'now'}
function markup(audio:AudioLevel,asset:ItemView['asset']=null){
  const view:ItemView={editorialRevision:1,item:{id:'live',rundownId:'r',order:0,type:asset?'VT':'LIVE',title:'Entrada',mediaId:asset?.id??null,sourceRef:asset?null:'ndi:Estúdio',trim:null,audio,durationOverride:2500,minDuration:0,anchor:{kind:'FLOW'},onOverrun:'PUSH',elastic:null,blockId:null,fit:'PILLARBOX',audioTrack:0,locked:false,autoNext:true,loop:false,notes:null},asset,trim:{in:0,out:2500},trimSource:'ITEM',audio,audioSource:'ITEM',gainDb:0,siblingCount:1}
  return renderToStaticMarkup(createElement(AudioDialog,{view,channel,onCancel:()=>{},onApply:async()=>{}}))
}
describe('seleção de áudio é preservada ao abrir edição',()=>{
  it('padrão legado não vira par 1-2 implicitamente',()=>{
    const html=markup({mode:'OFF',gainDb:0,measured:null})
    expect(html).toMatch(/aria-pressed="true"[^>]*>Mix padrão da entrada/)
    expect(html).toContain('Não muda o par da saída SDI')
  })
  it('par escolhido e matriz invertida são renderizados, sem projetar loudness do arquivo',()=>{
    expect(markup({mode:'MANUAL',gainDb:0,measured:null,routing:{mode:'STEREO_3_4'}})).toMatch(/aria-pressed="true"[^>]*>Stereo Secundário \(3-4\)/)
    const html=markup({mode:'MANUAL',gainDb:0,measured:null,routing:{mode:'MATRIX',matrix:[[0,0,-1,0],[0,0,0,1]]}})
    expect(html).toContain('aria-label="Mix L entrada 3"');expect(html).toContain('value="-1"')
    expect(html).toContain('Aplicar Áudio e Canais')
  })
  it('oferece medir mix de arquivo e só habilita AUTO com medição correspondente',()=>{
    const asset:NonNullable<ItemView['asset']>={id:'asset',contentHash:'a'.repeat(64),title:'VT',path:'C:/ação.mkv',kind:'VIDEO',durationFrames:250,durationNs:null,probe:null,probeError:null,categoryId:null,defaultTrim:null,defaultAudio:null,loudnessFile:null,suggestedTrim:null,qcStatus:'PENDING',qcNotes:null,qcCheckedAt:null,createdAt:'now'}
    const routing={mode:'STEREO_3_4' as const},audio:AudioLevel={mode:'AUTO',gainDb:0,measured:null,routing}
    const missing=markup(audio,asset);expect(missing).toContain('Medir mix escolhido');expect(missing).toContain('Meça a trilha/mix escolhido');expect(missing).toMatch(/disabled=""[^>]*>EBU R128 AUTO/)
    const valid=markup({...audio,analysisId:'trusted',measured:{integratedLufs:-18,lra:3,truePeakDbtp:-7,scope:'FILE',measuredAt:'2026-10-01T00:00:00.000Z',input:{contentHash:asset.contentHash,audioTrack:0,routing}}},asset)
    expect(valid).toContain('MIX ESCOLHIDO');expect(valid).not.toMatch(/disabled=""[^>]*>EBU R128 AUTO/)
    expect(markup(audio)).not.toContain('Medir mix escolhido')
  })
})
