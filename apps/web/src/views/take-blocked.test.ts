import {expect,it} from 'vitest'
import {qcSharedPreviewWarning,takeBlockedReason} from './MasterControlView.js'

it('TAKE sem PVW ou com grade a publicar explica o motivo em vez de não fazer nada',()=>{
  expect(takeBlockedReason(false,null)).toContain('nada armado no PVW')
  expect(takeBlockedReason(true,{kind:'ITEM',id:'a'})).toContain('publique')
  expect(takeBlockedReason(false,{kind:'ITEM',id:'a'})).toBeNull()
})

it('Master avisa que o PVW está com o QC antes do CUE',()=>{
  expect(qcSharedPreviewWarning(1)).toContain('1 tela')
  expect(qcSharedPreviewWarning(2)).toContain('2 telas')
  expect(qcSharedPreviewWarning(1)).toContain('encerra essa inspeção')
})
