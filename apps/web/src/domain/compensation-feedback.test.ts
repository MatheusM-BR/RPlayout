import {describe,it,expect} from 'vitest'
import {compensationReceiptMessage,compensationFailureMessage} from './compensation-feedback.js'
describe('compensation commit and observation are distinct',()=>{
 it('does not hide a committed revision behind refresh failure',()=>{
  const message=compensationReceiptMessage({revision:12,deduplicated:false,refreshError:'Engine não sincronizado'})
  expect(message).toContain('gravada na revisão 12')
  expect(message).toContain('exige atenção')
  expect(message).toContain('Engine não sincronizado')
  expect(message).not.toContain('PGM/CUE preservados')
 })
 it('describes replay as already applied, not a second compensation',()=>{
  expect(compensationReceiptMessage({revision:12,deduplicated:true,refreshError:null})).toContain('já aplicada na revisão 12')
 })
 it('lost reply is not represented as rejection or rollback',()=>{
  expect(compensationFailureMessage(new Error('Failed to fetch'),true)).toContain('mesma solicitação')
  expect(compensationFailureMessage(new Error('Failed to fetch'),true)).toContain('não confirmado')
  expect(compensationFailureMessage(new Error('Campo vazio'),false)).toBe('Campo vazio')
 })
})
