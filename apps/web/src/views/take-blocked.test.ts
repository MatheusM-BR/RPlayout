import {expect,it} from 'vitest'
import {takeBlockedReason} from './MasterControlView.js'

it('TAKE sem PVW ou com grade a publicar explica o motivo em vez de não fazer nada',()=>{
  expect(takeBlockedReason(false,null)).toContain('nada armado no PVW')
  expect(takeBlockedReason(true,{kind:'ITEM',id:'a'})).toContain('publique')
  expect(takeBlockedReason(false,{kind:'ITEM',id:'a'})).toBeNull()
})
it('ao vivo aberto só no PVW explica que precisa entrar na grade',()=>{
  const preview={kind:'SOURCE',source:'ndi:VMIX'}
  expect(takeBlockedReason(false,preview,['ndi:OUTRA'])).toContain('não está na grade')
  expect(takeBlockedReason(false,preview,['ndi:VMIX'])).toBeNull()
})
it('TAKE de ao vivo fora da grade vira inserção + TAKE; na grade, TAKE normal',async()=>{
  const {liveOutsideGrade}=await import('./MasterControlView.js')
  expect(liveOutsideGrade({kind:'SOURCE',source:'ndi:VMIX',title:'vMix'},['ndi:OUTRA'])).toEqual({source:'ndi:VMIX',title:'vMix'})
  expect(liveOutsideGrade({kind:'SOURCE',source:'ndi:VMIX'},['ndi:VMIX'])).toBeNull()
  expect(liveOutsideGrade({kind:'ITEM',id:'a'},[])).toBeNull()
  expect(liveOutsideGrade(null,[])).toBeNull()
})
it('sem barramento de PVW o TAKE DIRETO leva o item selecionado, com motivo claro quando não dá (A1)',async()=>{
  const {directTakePlan}=await import('./MasterControlView.js')
  expect(directTakePlan(false,{id:'vt',title:'Comercial'},null)).toEqual({itemId:'vt',title:'Comercial'})
  expect(directTakePlan(false,null,null)).toMatchObject({reason:expect.stringContaining('TAKE DIRETO')})
  expect(directTakePlan(true,{id:'vt',title:'Comercial'},null)).toMatchObject({reason:expect.stringContaining('publique')})
  expect(directTakePlan(false,{id:'vt',title:'Comercial'},'vt')).toMatchObject({reason:expect.stringContaining('já está no ar')})
})
it('linha de ao vivo: recusado não é EXIBIDO e queda no PGM aparece (M3/M4)',async()=>{
  const {liveLineSignal}=await import('./MasterControlView.js')
  expect(liveLineSignal('live',[{itemId:'live',state:'FAILED'}])).toBe('FAILED')
  expect(liveLineSignal('live',[{itemId:'outro',state:'LOST',busItemIds:{pgm:'live'}}])).toBe('LOST')
  expect(liveLineSignal('live',[{itemId:'live',state:'ON_PGM'}])).toBeNull()
  expect(liveLineSignal('vt',[{itemId:'live',state:'FAILED'}])).toBeNull()
})
