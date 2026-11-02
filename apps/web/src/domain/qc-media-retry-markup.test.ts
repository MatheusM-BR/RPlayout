import {it,expect} from 'vitest'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {QcMediaRetryControl} from '../components/broadcast/QcMediaRetryControl.js'
it('unknown owner requires unchecked page confirmation before retry',()=>{
  const html=renderToStaticMarkup(createElement(QcMediaRetryControl,{pending:false,requiresConfirmation:true,onRetry:()=>{}}))
  expect(html).toContain('type="checkbox"')
  expect(html).not.toContain('checked=""')
  expect(html).toContain('disabled=""')
  expect(html).toContain('não encerra processos')
})
it('ordinary failed proxy does not require owner declaration',()=>{
  const html=renderToStaticMarkup(createElement(QcMediaRetryControl,{pending:false,requiresConfirmation:false,onRetry:()=>{}}))
  expect(html).not.toContain('checkbox')
  expect(html).not.toContain('disabled=""')
})
it('pending retry cannot be clicked or re-confirmed',()=>{
  const html=renderToStaticMarkup(createElement(QcMediaRetryControl,{pending:true,requiresConfirmation:true,onRetry:()=>{}}))
  expect(html.match(/disabled=""/g)).toHaveLength(2)
  expect(html).toContain('Aguardando confirmação da fila')
})
