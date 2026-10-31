import { describe, expect, it } from 'vitest'
import { EngineCommandRejected } from './engine.js'
import { MediaVersionError } from './file-version.js'
import { transportRefusalStatus } from './transport-refusal.js'
describe('recusa de comando de transporte não vira 500 (A4)', () => {
  it('recusa do engine e mídia alterada são 409', () => {
    expect(transportRefusalStatus(new EngineCommandRejected('este canal não tem barramento de preview'), true)).toBe(409)
    expect(transportRefusalStatus(new MediaVersionError('A mídia mudou.'), true)).toBe(409)
  })
  it('pré-condição com mensagem é 422 com engine pronto e 503 com engine fora', () => {
    expect(transportRefusalStatus(new Error('O arquivo do preview não está disponível. Atualize o acervo.'), true)).toBe(422)
    expect(transportRefusalStatus(new Error('O engine foi encerrado por SIGKILL.'), false)).toBe(503)
  })
  it('bug de programação e erro com status próprio seguem o tratamento global', () => {
    expect(transportRefusalStatus(new TypeError('x is undefined'), true)).toBeNull()
    expect(transportRefusalStatus(Object.assign(new Error('conflito'), { status: 409 }), true)).toBeNull()
    expect(transportRefusalStatus('texto', true)).toBeNull()
  })
})
