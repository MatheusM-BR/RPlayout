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
