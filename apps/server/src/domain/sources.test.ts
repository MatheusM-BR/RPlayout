import { describe, expect, it } from 'vitest'
import { temAac } from './sources.js'

describe('decodificador de AAC', () => {
  it('não saber é diferente de não faltar', () => {
    // A descoberta ainda não rodou. Afirmar aqui faria o alerta acusar a
    // instalação de um defeito que ninguém verificou.
    expect(temAac(null)).toBeNull()
  })

  it('nada faltando quer dizer que há decodificador', () => {
    expect(temAac([])).toBe(true)
  })

  it('reconhece a falta mesmo com o nome composto das alternativas', () => {
    // A descoberta reporta "avdec_aac ou faad" quando nenhum dos dois existe.
    const faltando = [
      { element: 'avdec_aac ou faad', plugin: 'gst-libav', breaks: 'tocar AAC' },
    ]
    expect(temAac(faltando)).toBe(false)
  })

  it('falta de outra coisa não vira falta de AAC', () => {
    const faltando = [{ element: 'ndisrc', plugin: 'NDI', breaks: 'entrada NDI' }]
    expect(temAac(faltando)).toBe(true)
  })
})
