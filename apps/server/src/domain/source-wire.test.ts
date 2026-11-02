import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { SecretVault, SECRET_PREFIX } from './secret-vault.js'
import { SourceWire, sourceAddress } from './source-wire.js'

const raw = 'srt://user:PRIVATE_PASSWORD@host:9000?mode=caller&passphrase=PRIVATE_PASSPHRASE&streamid=PRIVATE_STREAM_ID&latency=120'
describe('fronteira pública de entradas com credenciais', () => {
  it('HTTP/WS compartilham referência, sem alterar estado privado ou URLs do monitor', () => {
    const wire = new SourceWire(new SecretVault(randomBytes(32)))
    const original = { sources: [{ id: 'source', channelId: 'ch', kind: 'SRT', targetUrl: raw, srtConfig: { passphrase: 'PRIVATE_PASSPHRASE', streamId: 'PRIVATE_STREAM_ID' } }], view: { items: [{ sourceRef: raw, liveEndpoint: raw, liveConfig: { sourceEndpoint: raw } }] }, live: { transport: { preview: { kind: 'SOURCE', source: raw } }, liveSources: [{ source: raw, error: 'Falhou ' + raw }] }, monitors: { pgm: 'http://host:8889/channel/pgm' } }
    const json = JSON.stringify(original), publicState = wire.publicValue(original)
    expect(JSON.stringify(publicState)).not.toMatch(/PRIVATE_/)
    expect(publicState.monitors.pgm).toBe(original.monitors.pgm)
    expect(publicState.live.transport.preview.source).toBe(publicState.view.items[0]?.sourceRef)
    const record = publicState.sources[0] as typeof original.sources[0] & { controlRef: string; credentialProtected: boolean }
    expect(record.credentialProtected).toBe(true)
    expect(record.controlRef).toBe(publicState.live.transport.preview.source)
    expect(wire.resolve(record.controlRef)).toBe(raw)
    expect(JSON.stringify(original)).toBe(json)
    expect(wire.publicValue(publicState)).toEqual(publicState)
  })
  it('referência atravessa reinício com o mesmo cofre e recusa outra chave/protocolo/ciphertext', () => {
    const key = randomBytes(32), vault = new SecretVault(key)
    const reference = new SourceWire(vault).reference(raw)
    expect(new SourceWire(new SecretVault(key)).resolve(reference)).toBe(raw)
    const legacyReference = 'srt:protected:v1:' + reference.split(':')[3]!.split('.')[1]
    expect(new SourceWire(new SecretVault(key)).resolve(legacyReference)).toBe(raw)
    const afterRestart = new SourceWire(new SecretVault(key)).reference(raw)
    expect(afterRestart).not.toBe(reference)
    expect(afterRestart.split(':')[3]!.split('.')[0]).toBe(reference.split(':')[3]!.split('.')[0])
    expect(() => new SourceWire(vault).resolve(reference.replace(reference.split(':')[3]!.split('.')[0]!, 'A'.repeat(43)))).toThrow()
    expect(() => new SourceWire(new SecretVault(randomBytes(32))).resolve(reference)).toThrow('outra instalação')
    expect(() => new SourceWire(vault).resolve(reference.replace('srt:', 'rtmp:'))).toThrow()
    const parts = reference.split(':'); parts[3] = (parts[3]!.startsWith('A') ? 'B' : 'A') + parts[3]!.slice(1)
    expect(() => new SourceWire(vault).resolve(parts.join(':'))).toThrow()
    const dbValue = vault.encrypt(raw, 'live_sources.target_url')
    expect(() => new SourceWire(vault).resolve('srt:protected:v1:' + Buffer.from(dbValue.slice(SECRET_PREFIX.length), 'base64').toString('base64url'))).toThrow()
  })
  it('não confunde links iguais com credenciais distintas; cache limitado não impede resolução', () => {
    const wire = new SourceWire(new SecretVault(randomBytes(32)), 1)
    const a = wire.reference(raw), b = wire.reference(raw.replace('PRIVATE_PASSPHRASE', 'OTHER_PASSPHRASE'))
    expect(a).not.toBe(b); expect(wire.resolve(a)).toBe(raw); expect(wire.resolve(b)).toContain('OTHER_PASSPHRASE')
    expect(wire.reference('ndi:CAMERA ÇÃO (ESTÚDIO)')).toBe('ndi:CAMERA ÇÃO (ESTÚDIO)')
    expect(wire.reference('sdi:0')).toBe('sdi:0')
    expect(sourceAddress('ndi:CAMERA ÇÃO (ESTÚDIO)')).toBe('ndi:CAMERA ÇÃO (ESTÚDIO)')
    expect(sourceAddress('srt://HOST:9000?name=São%20Paulo&mode=caller')).toBe('srt://HOST:9000?name=São%20Paulo&mode=caller')
    expect(wire.reference('srt://HOST:9000?name=São%20Paulo&mode=caller')).toBe('srt://HOST:9000?name=São%20Paulo&mode=caller')
    expect(wire.publicValue({ channelId: 'ch', kind: 'NDI', targetUrl: 'ndi:CAMERA ÇÃO (ESTÚDIO)' }).targetUrl).toBe('ndi:CAMERA ÇÃO (ESTÚDIO)')
  })
  it('redige RTMP de um segmento e grafia stream_key/passwd sem expor caminho ou query', () => {
    for (const value of ['rtmp://host/PRIVATE_KEY', 'rtmps://host/app/PRIVATE_KEY', 'srt://host:9000?stream_key=PRIVATE_KEY&passwd=PRIVATE_PASSWORD']) {
      const wire = new SourceWire(new SecretVault(randomBytes(32))), reference = wire.reference(value)
      expect(sourceAddress(value)).not.toContain('PRIVATE_'); expect(reference).not.toContain('PRIVATE_'); expect(wire.resolve(reference)).toBe(value)
    }
  })
  it('entrada resolve somente campos de controle e rejeita máscara executável antes do decoder', () => {
    const wire = new SourceWire(new SecretVault(randomBytes(32))), reference = wire.reference(raw)
    expect(wire.incoming({ sourceRef: reference, liveConfig: { sourceEndpoint: reference }, title: reference })).toEqual({ sourceRef: raw, liveConfig: { sourceEndpoint: raw }, title: reference })
    expect(wire.incoming({ targetUrl: reference }, true).targetUrl).toBe(raw)
    expect(wire.incoming({ targetUrl: reference }, false).targetUrl).toBe(reference)
    expect(() => wire.incoming({ sourceRef: sourceAddress(raw) })).toThrow('mascarado')
    expect(() => wire.incoming({ sourceRef: 'srt:protected:v1:not_an_envelope' })).toThrow()
  })
  it('token legado de equipamento não atravessa HTTP/WS e não altera o registro privado', () => {
    const wire = new SourceWire(new SecretVault(randomBytes(32)))
    const event = { deviceConfig: { deviceId: 'router', token: 'PRIVATE_DEVICE_TOKEN', action: 'PING', params: {} }, token: 'unrelated-session-field' }
    expect(wire.publicValue(event)).toEqual({ ...event, deviceConfig: { ...event.deviceConfig, token: 'REDACTED' } })
    expect(event.deviceConfig.token).toBe('PRIVATE_DEVICE_TOKEN')
  })
})
