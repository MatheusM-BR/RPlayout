import { describe, expect, it } from 'vitest'
import { canonicalLiveSourceRef, sameLiveSource } from './liveSource.js'
describe('referência de controle da entrada', () => {
  it('usa referência protegida em vez da máscara de exibição', () => {
    expect(canonicalLiveSourceRef({ kind: 'SRT', targetUrl: 'srt://host:9000?passphrase=REDACTED', controlRef: 'srt:protected:v1:opaque' })).toBe('srt:protected:v1:opaque')
  })
  it('preserva nome Unicode de NDI/OMT e protocolo de URL sem segredo', () => {
    expect(canonicalLiveSourceRef({ kind: 'NDI', targetUrl: 'CÂMERA ÇÃO (ESTÚDIO)' })).toBe('ndi:CÂMERA ÇÃO (ESTÚDIO)')
    expect(canonicalLiveSourceRef({ kind: 'OMT', targetUrl: 'omt:ESTÚDIO' })).toBe('omt:ESTÚDIO')
    expect(canonicalLiveSourceRef({ kind: 'SRT', targetUrl: 'srt://host:9000?mode=caller' })).toBe('srt://host:9000?mode=caller')
  })
  it('reconhece o mesmo sinal após reinício, sem confundir segredo distinto ou protocolo', () => {
    const id = 'A'.repeat(43), first = `srt:protected:v1:${id}.nonce_1`, restarted = `srt:protected:v1:${id}.nonce_2`
    expect(sameLiveSource(first, restarted)).toBe(true)
    expect(sameLiveSource(first, restarted.replace('srt:', 'rtmp:'))).toBe(false)
    expect(sameLiveSource(first, restarted.replace(id, 'B'.repeat(43)))).toBe(false)
    expect(sameLiveSource('ndi:CÂMERA ÇÃO', 'ndi:CÂMERA ÇÃO')).toBe(true)
    expect(sameLiveSource('srt:protected:v1:legacy_1', 'srt:protected:v1:legacy_2')).toBe(false)
  })
})
