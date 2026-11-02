import { describe, expect, it } from 'vitest'
import {
  buildSrtUri,
  parseSrtUri,
  classifySrtLinkState,
  maskPassphrase,
  sanitizeSrtConfig,
  type SrtConfig,
} from './sources.js'

describe('SRT Protocol Utilities', () => {
  it('buildSrtUri monta URI padronizada para caller com criptografia AES', () => {
    const config: SrtConfig = {
      mode: 'caller',
      host: '198.51.100.10',
      port: 9000,
      latencyMs: 1200,
      passphrase: 'BroadcastSecretKey2026!',
      pbkeylen: 32,
      streamId: 'live/feed1',
      pollTimeoutMs: 300,
    }

    const uri = buildSrtUri(config)
    expect(uri).toContain('srt://198.51.100.10:9000?')
    expect(uri).toContain('mode=caller')
    expect(uri).toContain('latency=1200')
    expect(uri).toContain('passphrase=BroadcastSecretKey2026%21')
    expect(uri).toContain('pbkeylen=32')
    expect(uri).toContain('streamid=live%2Ffeed1')
    expect(uri).toContain('poll_timeout=300')
  })

  it('buildSrtUri usa 0.0.0.0 quando host for omitido no modo listener', () => {
    const config: SrtConfig = {
      mode: 'listener',
      host: '',
      port: 9500,
      latencyMs: 500,
    }

    const uri = buildSrtUri(config)
    expect(uri).toContain('srt://0.0.0.0:9500?')
    expect(uri).toContain('mode=listener')
    expect(uri).toContain('latency=500')
  })

  it('parseSrtUri extrai corretamente configurações completas', () => {
    const uri = 'srt://10.0.1.50:9200?mode=listener&latency=1000&passphrase=SecretPass123&pbkeylen=24&streamid=news&poll_timeout=150'
    const parsed = parseSrtUri(uri)
    expect(parsed).not.toBeNull()
    expect(parsed?.mode).toBe('listener')
    expect(parsed?.host).toBe('10.0.1.50')
    expect(parsed?.port).toBe(9200)
    expect(parsed?.latencyMs).toBe(1000)
    expect(parsed?.passphrase).toBe('SecretPass123')
    expect(parsed?.pbkeylen).toBe(24)
    expect(parsed?.streamId).toBe('news')
    expect(parsed?.pollTimeoutMs).toBe(150)
  })

  it('parseSrtUri retorna null para URIs inválidas', () => {
    expect(parseSrtUri('rtmp://live.com/app/stream')).toBeNull()
    expect(parseSrtUri('invalid_uri')).toBeNull()
  })

  it('maskPassphrase oculta segredo com símbolos uniformes', () => {
    const secret = 'VeryLongSecretKey'
    const masked = maskPassphrase(secret)
    expect(masked).toBe('•'.repeat(secret.length))
    expect(masked).not.toContain(secret)
    expect(maskPassphrase(undefined)).toBeUndefined()
  })

  it('sanitizeSrtConfig não altera config original e mascara passphrase', () => {
    const config: SrtConfig = {
      mode: 'caller',
      host: '1.2.3.4',
      port: 9000,
      latencyMs: 800,
      passphrase: 'supersecretpass',
    }

    const sanitized = sanitizeSrtConfig(config)
    expect(sanitized.passphrase).not.toBe('supersecretpass')
    expect(sanitized.passphrase).toBe('•'.repeat(15))
    expect(config.passphrase).toBe('supersecretpass')
  })

  it('classifySrtLinkState avalia critérios de saúde broadcast', () => {
    // OPTIMAL
    expect(
      classifySrtLinkState({ packetLossPercent: 0.2, rttMs: 80, packetsDropped: 0 }, 800)
    ).toBe('OPTIMAL')

    // DEGRADED por perda moderada
    expect(
      classifySrtLinkState({ packetLossPercent: 2.5, rttMs: 100, packetsDropped: 0 }, 800)
    ).toBe('DEGRADED')

    // DEGRADED por RTT elevado (> 1.5x latency = 1200ms)
    expect(
      classifySrtLinkState({ packetLossPercent: 0.1, rttMs: 1300, packetsDropped: 0 }, 800)
    ).toBe('DEGRADED')

    // CRITICAL por perda de pacotes severa (> 8%)
    expect(
      classifySrtLinkState({ packetLossPercent: 9.0, rttMs: 100, packetsDropped: 0 }, 800)
    ).toBe('CRITICAL')

    // CRITICAL por descarte massivo de pacotes
    expect(
      classifySrtLinkState({ packetLossPercent: 0.5, rttMs: 100, packetsDropped: 60 }, 800)
    ).toBe('CRITICAL')

    // DISCONNECTED quando flag connected for false
    expect(
      classifySrtLinkState({ packetLossPercent: 0, rttMs: 0, connected: false }, 800)
    ).toBe('DISCONNECTED')
  })
})
