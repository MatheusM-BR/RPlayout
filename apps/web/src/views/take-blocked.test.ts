import {expect,it} from 'vitest'
import {takeBlockedReason} from './MasterControlView.js'

it('TAKE sem PVW ou com grade a publicar explica o motivo em vez de não fazer nada',()=>{
  expect(takeBlockedReason(false,null)).toContain('nada armado no PVW')
  expect(takeBlockedReason(true,{kind:'ITEM',id:'a'})).toContain('publique')
  expect(takeBlockedReason(false,{kind:'ITEM',id:'a'})).toBeNull()
})
