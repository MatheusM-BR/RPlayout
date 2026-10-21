import {describe,expect,it} from 'vitest'
import {qcLivePreviewReady,qcLiveTuningFeedback} from './qc-live-preview.js'
import type {Live} from '../types.js'

describe('Aviso de sintonia do QC acompanha apenas a seleção pendente',()=>{
  it('some ao receber vídeo pronto, sem esperar um clique no botão de qualidade',()=>{
    expect(qcLiveTuningFeedback('one','one','Estúdio ÇÃÓ',false)).toBe('Abrindo Estúdio ÇÃÓ no decodificador do QC…')
    expect(qcLiveTuningFeedback('one','one','Estúdio ÇÃÓ',true)).toBeNull()
  })
  it('não reaparece por perda posterior após consumir a solicitação pronta',()=>{
    expect(qcLiveTuningFeedback(null,'one','Estúdio ÇÃÓ',false)).toBeNull()
  })
  it('não transporta aviso para outro canal, fonte ou seleção de arquivo',()=>{
    expect(qcLiveTuningFeedback('one','two','Outra',false)).toBeNull()
    expect(qcLiveTuningFeedback('one','one',undefined,false)).toBeNull()
  })
})
describe('QC mostra apenas a seleção pronta no PVW, não a imagem da seleção anterior',()=>{
  const source='ndi:ESTÚDIO'
  const now=Date.parse('2026-10-06T18:00:00Z')
  const signal=(state:string,pvw?:string)=>[{source,itemId:'source',state,busStates:pvw?{pvw}:undefined,changedAt:'now',message:null,measurements:{pvw:{sampledAt:new Date(now).toISOString(),videoPresent:true,audioPresent:true,videoAgeMs:0,audioAgeMs:0}}}] as Live['transport']['liveSources']
  it('não depende de passagem pelo Master: SOURCE+PVW_READY com quadro recente é suficiente',()=>{
    expect(qcLivePreviewReady(source,{kind:'SOURCE',source},signal('ON_PGM','PVW_READY'),'NATIVE',now)).toBe(true)
  })
  it.each([undefined,null,{kind:'SOURCE',source:'omt:OUTRA'},{kind:'ITEM',id:'other'},{kind:'ASSET',id:'other'}] as const)('CUE ausente/diferente não herda a imagem anterior (%s)',preview=>{
    expect(qcLivePreviewReady(source,preview,signal('PVW_READY','PVW_READY'))).toBe(false)
  })
  it.each(['CUEING','TAKE_PENDING','ON_PGM','LOST','FAILED',undefined])('PGM ou descoberta não provam PVW pronto (%s)',state=>{
    expect(qcLivePreviewReady(source,{kind:'SOURCE',source},signal('ON_PGM',state))).toBe(false)
  })
  it('ready antigo, sem medição, simulado ou modo desconhecido não libera imagem nem inspeção HQ',()=>{
    const rows=signal('ON_PGM','PVW_READY'),preview={kind:'SOURCE' as const,source}
    expect(qcLivePreviewReady(source,preview,rows,'NATIVE',now+3000)).toBe(false)
    expect(qcLivePreviewReady(source,preview,rows,'SIMULATED',now)).toBe(false)
    expect(qcLivePreviewReady(source,preview,rows,undefined,now)).toBe(false)
    delete rows[0]!.measurements
    expect(qcLivePreviewReady(source,preview,rows,'NATIVE',now)).toBe(false)
  })
  it('soma idade do quadro com entrega e permite vídeo sem áudio, sem confundir com aprovação',()=>{
    const rows=signal('ON_PGM','PVW_READY'),preview={kind:'SOURCE' as const,source}
    rows[0]!.measurements!.pvw!.videoAgeMs=1500
    expect(qcLivePreviewReady(source,preview,rows,'NATIVE',now+600)).toBe(false)
    rows[0]!.measurements!.pvw!.videoAgeMs=0
    rows[0]!.measurements!.pvw!.audioPresent=false
    expect(qcLivePreviewReady(source,preview,rows,'NATIVE',now+600)).toBe(true)
  })
})
