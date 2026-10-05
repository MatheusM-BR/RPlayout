import {describe,expect,it} from 'vitest'
import {qcLivePreviewReady} from './qc-live-preview.js'
import type {Live} from '../types.js'
describe('QC mostra apenas a seleção pronta no PVW, não a imagem da seleção anterior',()=>{
  const source='ndi:ESTÚDIO'
  const signal=(state:string,pvw?:string)=>[{source,itemId:'source',state,busStates:pvw?{pvw}:undefined,changedAt:'now',message:null}] as Live['transport']['liveSources']
  it('não depende de passagem pelo Master: SOURCE+PVW_READY é suficiente',()=>{
    expect(qcLivePreviewReady(source,{kind:'SOURCE',source},signal('ON_PGM','PVW_READY'))).toBe(true)
  })
  it.each([undefined,null,{kind:'SOURCE',source:'omt:OUTRA'},{kind:'ITEM',id:'other'},{kind:'ASSET',id:'other'}] as const)('CUE ausente/diferente não herda a imagem anterior (%s)',preview=>{
    expect(qcLivePreviewReady(source,preview,signal('PVW_READY','PVW_READY'))).toBe(false)
  })
  it.each(['CUEING','TAKE_PENDING','ON_PGM','LOST','FAILED',undefined])('PGM ou descoberta não provam PVW pronto (%s)',state=>{
    expect(qcLivePreviewReady(source,{kind:'SOURCE',source},signal('ON_PGM',state))).toBe(false)
  })
})
