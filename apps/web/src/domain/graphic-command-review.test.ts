import {it,expect} from 'vitest'
import type {ReviewedGraphicCommand,GraphicCommandReceipt} from '../api.js'
import {graphicReviewMatches,graphicReviewKey,graphicCommandFeedback} from './graphic-command-review.js'
const command:ReviewedGraphicCommand={id:'cmd',state:'UNCERTAIN',reviewToken:'proof',createdAt:'now',actor:'qa',replayed:false,physicalOutputValidated:false}
it('consentimento de pendência exige alvo/revisão atuais e permissão de conferência',()=>{
  expect(graphicReviewMatches(command,[command],true)).toBe(true)
  for(const list of [null,[],[{...command,id:'other'}],[{...command,reviewToken:'new'}],[{...command,state:'REVIEWED' as const}]])expect(graphicReviewMatches(command,list,true)).toBe(false)
  expect(graphicReviewMatches(command,[command],false)).toBe(false)
  expect(graphicReviewMatches({...command,reviewToken:''},[{...command,reviewToken:''}],true)).toBe(false)
})
it.each(['CONFIRMED','SIMULATED','REJECTED','REVIEWED'] as const)('estado %s não autoriza encerramento de pendência antiga',state=>{
  const value={...command,state};expect(graphicReviewMatches(value,[value],true)).toBe(false)
})
it('canal, comando, estado, prova e observação pertencem ao consentimento',()=>{
  const key=graphicReviewKey('ch',command,'Conferido')
  for(const value of [{...command,id:'other'},{...command,state:'SENDING' as const},{...command,reviewToken:'new'}])expect(graphicReviewKey('ch',value,'Conferido')).not.toBe(key)
  expect(graphicReviewKey('other',command,'Conferido')).not.toBe(key);expect(graphicReviewKey('ch',command,'Outra observação')).not.toBe(key)
})
it.each(['ACCEPTED','SENDING','UNCERTAIN','REJECTED','REVIEWED'] as const)('estado %s não é apresentado como simulação nem confirmação física',state=>{
  const text=graphicCommandFeedback({...command,state},'Arte')
  expect(text).not.toContain('ação simulada');expect(text).not.toContain('engine confirmou o comando')
})
it('somente recibo explícito separa confirmação do engine de simulação',()=>{
  expect(graphicCommandFeedback({...command,state:'CONFIRMED'},'Arte')).toContain('confira a imagem no PGM')
  expect(graphicCommandFeedback({...command,state:'SIMULATED'},'Arte')).toContain('não confirma saída física')
  for(const value of [null,{...command,id:''},{...command,physicalOutputValidated:true},{...command,state:'OTHER'}])expect(()=>graphicCommandFeedback(value as GraphicCommandReceipt,'Arte')).toThrow()
})
