import { describe, expect, it } from 'vitest'
import { NO_MEDIA_SERVER, publishedStreamUrls } from './stream-endpoints.js'

const base = (running: boolean) => ({ server: { running, exposed: false, host: '192.0.2.2', ports: {} }, channels: [{ channelId: 'c', format: null, program: 'c', clean: 'c', preview: 'c', urls: { rtsp: 'rtsp://192.0.2.2:8554/c', srt: 'srt://192.0.2.2:8890?streamid=read:c' }, publishers: [] }], guests: [], destinations: [], relays: [], paths: [] }) as any
describe('B9: pontos de acesso só com servidor de mídia no ar', () => {
  it('sem MediaMTX não lista endereços e diz por quê', () => {
    expect(publishedStreamUrls(base(false), 'c')).toEqual({ urls: null, reason: NO_MEDIA_SERVER })
  })
  it('com MediaMTX lista os endereços do canal', () => {
    expect(publishedStreamUrls(base(true), 'c').urls).toMatchObject({ rtsp: 'rtsp://192.0.2.2:8554/c' })
    expect(publishedStreamUrls(base(true), 'outro').urls).toBeNull()
  })
  it('antes da leitura não afirma nada', () => {
    expect(publishedStreamUrls(null, 'c')).toEqual({ urls: null, reason: null })
  })
})
