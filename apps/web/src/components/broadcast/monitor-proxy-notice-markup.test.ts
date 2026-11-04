import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { BroadcastMonitor } from './BroadcastMonitor.js'

const asset = { id: 'a1', title: 'Soak VT 1', kind: 'VIDEO', path: '/m/soak.mp4', contentHash: 'h', durationFrames: 120 } as any
describe('B8: aviso de proxy do monitor não cobre o tempo', () => {
  it('o aviso fica no topo do quadro, não na base onde estão tempo e formato', () => {
    const html = renderToStaticMarkup(createElement(BroadcastMonitor, { bus: 'pgm', title: 'PGM', webrtcPath: null, port: 8889, asset, rate: { num: 30000, den: 1001 } }))
    const notice = /<div data-testid="monitor-proxy-notice" class="([^"]+)"/.exec(html)
    expect(notice?.[1]).toContain('top-1')
    expect(notice?.[1]).not.toContain('bottom-')
    expect(html).toContain('Proxy de consulta — não confirma PGM/PVW')
    expect(html).not.toContain('absolute bottom-1 left-1 right-1 z-30')
  })
})
