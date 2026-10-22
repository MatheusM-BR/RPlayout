import {describe,it,expect} from 'vitest'
import {interruptionResultMessage,interruptionFailureMessage} from './interruption-feedback.js'
const run=(phase:string,nativeProgramConfirmed=false,message:string|null=null)=>({phase,nativeProgramConfirmed,message})
describe('return feedback follows durable phase, not absence of native proof',()=>{
 it('confirmed native and simulation remain distinct',()=>{
  expect(interruptionResultMessage('RESUME',run('CONFIRMED',true))).toContain('confirmado pelo engine')
  expect(interruptionResultMessage('RESUME',run('CONFIRMED'))).toContain('somente simulado')
 })
 it.each(['UNCERTAIN','UNKNOWN'])('never announces %s as simulated or successful',phase=>{
  const message=interruptionResultMessage('RESUME',run(phase,false,'ACK ausente'))
  expect(message).toContain('inconclusivo');expect(message).toContain('ACK ausente')
  expect(message).not.toContain('simulado');expect(message).not.toContain('confirmado pelo engine')
 })
 it('pre-take failure is not an uncertain switch',()=>{
  expect(interruptionResultMessage('RESUME',run('FAILED'))).toContain('antes do TAKE')
 })
 it.each(['PREPARING','SWITCHING'])('does not invite replay of %s',phase=>{
  expect(interruptionResultMessage('RESUME',run(phase))).toContain('sem repetir TAKE')
 })
 it('closed uncertainty and discard do not claim a native return',()=>{
  expect(interruptionResultMessage('RESUME',run('CLOSED_UNCERTAIN'))).toContain('sem confirmar sucesso')
  expect(interruptionResultMessage('DISCARD',run('CONFIRMED'))).toContain('descartado')
 })
 it('lost response asks for observation, never automatic retry',()=>{
  expect(interruptionFailureMessage(new Error('Failed to fetch'),true)).toContain('Consulte o registro')
  expect(interruptionFailureMessage(new Error('ID ausente'),false)).toBe('ID ausente')
 })
})
