import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {describe,expect,it} from 'vitest'
import type {Channel,MediaAsset,RundownItem} from '@rplayout/protocol'
import type {ItemView} from '../types.js'
import {AudioDialog} from '../components/AudioDialog.js'
const routing={mode:'STEREO_1_2' as const},hash='a'.repeat(64)
const audio={mode:'AUTO' as const,gainDb:0,analysisId:'job',routing,measured:{scope:'TRIM' as const,integratedLufs:-28,lra:2,truePeakDbtp:-6,measuredAt:'2026-10-09T00:00:00Z',input:{contentHash:hash,audioTrack:0,routing,trim:{inNs:1e9,outNs:3e9}}}}
const channel={id:'ch',rate:{num:25,den:1},audioChannels:2,targetLufs:-23,ceilingDbtp:-1} as Channel
const asset:MediaAsset={id:'asset',contentHash:hash,path:'fixture.mp4',title:'Fixture',kind:'VIDEO',durationFrames:250,durationNs:10e9,probe:null,probeError:null,categoryId:null,defaultTrim:null,defaultAudio:null,loudnessFile:null,suggestedTrim:null,qcStatus:'PENDING',qcNotes:null,qcCheckedAt:null,createdAt:'2026-10-09T00:00:00Z',audioMetadata:{hasAudio:true,channels:2,tracks:[{index:0,channels:2,rate:48000}]}}
const view=(out=75):ItemView=>({item:{id:'item',title:'Trecho',audioTrack:0} as RundownItem,asset,trim:{in:25,out},trimSource:'ITEM',audio,audioSource:'ITEM',gainDb:5,siblingCount:1})
const markup=(out=75)=>renderToStaticMarkup(createElement(AudioDialog,{view:view(out),channel,onCancel:()=>{},onApply:async()=>{}}))
describe('markup de medição do corte, não homologação visual',()=>{
  it('oferece escolha FILE/TRIM e distingue leitura de trecho válida',()=>{
    const html=markup();expect(html).toContain('Escopo da medição');expect(html).toContain('Trecho selecionado');expect(html).toContain('MIX ESCOLHIDO · TRECHO SELECIONADO');expect(html).toContain('Alterar o trecho exige nova medição')
  })
  it('outro corte não exibe leitura TRIM anterior como válida',()=>{
    const html=markup(100);expect(html).not.toContain('MIX ESCOLHIDO · TRECHO SELECIONADO');expect(html).toContain('A trilha/mix escolhido ainda não tem medição válida')
  })
})
