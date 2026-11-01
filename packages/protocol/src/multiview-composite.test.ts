import {describe,expect,it} from 'vitest'
import {MULTIVIEW_LAYOUTS,MULTIVIEW_QUALITY_TIER,autoMultiviewCells,clampTier,multiviewLayoutUnits,multiviewTierPaths} from './multiview-composite.js'

describe('multiview composto: geometria e preenchimento',()=>{
  it('cada layout cobre a grade de 12 exatamente uma vez',()=>{
    for(const layout of MULTIVIEW_LAYOUTS){
      const grid=Array.from({length:12},()=>Array(12).fill(0) as number[])
      for(const [x,y,w,h] of layout.units)for(let row=y;row<y+h;row++)for(let col=x;col<x+w;col++)grid[row]![col]!++
      expect(grid.flat().every(count=>count===1),layout.id).toBe(true)
    }
  })
  it('mesma tabela do engine (apps/engine/src/multiview.rs, Layout::units)',()=>{
    expect(MULTIVIEW_LAYOUTS.map(layout=>[layout.id,layout.units.length])).toEqual([['MV_PGM_PVW',10],['MV_2X2',4],['MV_3X3',9],['MV_4X4',16],['MV_1_PLUS_5',6]])
    expect(multiviewLayoutUnits('MV_1_PLUS_5')).toEqual([[0,0,8,8],[8,0,4,4],[8,4,4,4],[0,8,4,4],[4,8,4,4],[8,8,4,4]])
    expect(multiviewLayoutUnits('MV_PGM_PVW').slice(0,3)).toEqual([[0,0,6,6],[6,0,6,6],[0,6,3,3]])
    expect(multiviewLayoutUnits('MV_3X3')[4]).toEqual([4,4,4,4])
  })
  it('preenche como um master: PGM, PVW, entradas, depois NEXT/QC/contingência',()=>{
    expect(autoMultiviewCells('MV_2X2',['a','b','c'])).toEqual([{kind:'pgm'},{kind:'pvw'},{kind:'source',id:'a'},{kind:'source',id:'b'}])
    expect(autoMultiviewCells('MV_1_PLUS_5',['a'])).toEqual([{kind:'pgm'},{kind:'pvw'},{kind:'source',id:'a'},{kind:'next'},{kind:'qc'},{kind:'contingency'}])
    expect(autoMultiviewCells('MV_PGM_PVW',[]).slice(-6)).toEqual([{kind:'contingency'},...Array(5).fill({kind:'empty'})])
  })
  it('o nível do multiview é o teto dos níveis de monitor (mesmos caminhos por nível)',()=>{
    expect(MULTIVIEW_QUALITY_TIER).toEqual({REFERENCIA:'ref',PADRAO:'std',LEVE:'lite'})
    expect(clampTier('ref','std')).toBe('std')
    expect(clampTier('lite','std')).toBe('lite')
    expect(clampTier('std','lite')).toBe('lite')
    expect(clampTier('ref','ref')).toBe('ref')
    expect(multiviewTierPaths('c1/mv','REFERENCIA')).toEqual({ref:'c1/mv-ref',std:'c1/mv-std',lite:'c1/mv'})
    expect(multiviewTierPaths('c1/mv','PADRAO')).toEqual({std:'c1/mv-std',lite:'c1/mv'})
    expect(multiviewTierPaths('c1/mv','LEVE')).toEqual({lite:'c1/mv'})
  })
})
