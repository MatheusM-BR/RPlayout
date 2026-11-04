import { describe, expect, it } from 'vitest'
import { initialProtocolConfig, inputName, sourceName } from './protocol-config.js'

describe('cadastro consistente de entradas', () => {
  it('acompanha a seleção NDI e OMT sem manter a recomendação SRT anterior', () => {
    expect(inputName('SRT LISTENER :9000', 'ESTÚDIO (Câmera 1)', false)).toBe('ESTÚDIO (Câmera 1)')
    expect(inputName('ESTÚDIO (Câmera 1)', 'EXTERNA (OMT)', false)).toBe('EXTERNA (OMT)')
    expect(inputName('EXTERNA (OMT)', undefined, false)).toBe('')
  })
  it('preserva apelido escolhido pelo operador e nome salvo durante edição', () => {
    expect(inputName('Jornal — Brasília', 'HOST (Feed)', true)).toBe('Jornal — Brasília')
  })
  it('usa o nome exato descoberto, sem acrescentar prefixo de protocolo', () => {
    expect(sourceName('ndi:host/cam', [{ reference: 'ndi:host/cam', label: 'Câmera São João' }])).toBe('Câmera São João')
    expect(sourceName('omt:HOST (PGM)', [])).toBe('HOST (PGM)')
  })
  it('mantém o rótulo descoberto após canonicalização da referência',()=>{
    const sources=[{reference:'NDI://HOST (CAM)',label:'Câmera São José Çãó'},
      {reference:'omt://HOST (CAM)',label:'Estúdio OMT'}]
    expect(sourceName('ndi:HOST (CAM)',sources)).toBe('Câmera São José Çãó')
    expect(sourceName('omt:HOST (CAM)',sources)).toBe('Estúdio OMT')
    expect(sourceName('ndi:host (cam)',sources)).toBe('host (cam)')
  })
  it('restaura fonte e parâmetros ao editar, em vez de sobrescrever pelo primeiro anúncio', () => {
    expect(initialProtocolConfig('ndi:ESTÚDIO (CAM 2)').name).toBe('ESTÚDIO (CAM 2)')
    expect(initialProtocolConfig('omt:SERVIDOR (PGM)').name).toBe('SERVIDOR (PGM)')
    expect(initialProtocolConfig('srt://192.168.1.2:9876?mode=caller&latency=150&passphrase=abcdefghij&streamid=studio')).toMatchObject({
      host: '192.168.1.2', port: 9876, srtMode: 'caller', latency: 150, passphrase: 'abcdefghij', streamId: 'studio',
    })
  })
})
import { availableInputKind } from './protocol-config.js'
describe('B10: entrada nova não abre num protocolo ausente', () => {
  const fam = (available: boolean) => ({ available, reason: available ? null : 'sem plugin', sources: [] })
  it('NDI/SDI/OMT ausentes abrem em SRT; presentes ficam', () => {
    const none = { sdi: fam(false), ndi: fam(false), omt: fam(false) }
    expect(availableInputKind('NDI', none)).toBe('SRT')
    expect(availableInputKind('SDI', none)).toBe('SRT')
    expect(availableInputKind('OMT', none)).toBe('SRT')
    expect(availableInputKind('RTMP', none)).toBe('RTMP')
    expect(availableInputKind('NDI', { ...none, ndi: fam(true) })).toBe('NDI')
  })
  it('antes da descoberta não troca nada', () => {
    expect(availableInputKind('NDI', null)).toBe('NDI')
  })
})
