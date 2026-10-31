import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {it,expect,vi} from 'vitest'
import {ReviewedOperationConfirm} from '../components/broadcast/ReviewedOperationConfirm.js'

it('reviewed operation starts unchecked, disabled and sends nothing on render',()=>{
  const onConfirm=vi.fn(async()=>{})
  const html=renderToStaticMarkup(createElement(ReviewedOperationConfirm,{reviewKey:'channel:review1',confirmation:'Autorizo somente esta revisão.',label:'Confirmar inserção',disabled:false,onConfirm}))
  expect(html).toContain('type="checkbox"');expect(html).not.toContain('checked=""')
  expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Confirmar inserção/)
  expect(html).toContain('Autorizo somente esta revisão.');expect(onConfirm).not.toHaveBeenCalled()
})
it('unreviewed operation has no consent checkbox and cannot be confirmed',()=>{
  const html=renderToStaticMarkup(createElement(ReviewedOperationConfirm,{reviewKey:null,confirmation:'Não conferido.',label:'Confirmar inserção',disabled:false,onConfirm:async()=>{}}))
  expect(html).not.toContain('type="checkbox"');expect(html).toMatch(/<button[^>]*disabled=""/)
})
it('pending or unavailable operation disables consent and confirmation',()=>{
  const html=renderToStaticMarkup(createElement(ReviewedOperationConfirm,{reviewKey:'review',confirmation:'Autorizo.',label:'Confirmar',disabled:true,onConfirm:async()=>{}}))
  expect(html.match(/disabled=""/g)).toHaveLength(2)
})
