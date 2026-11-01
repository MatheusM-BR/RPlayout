import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Whep } from './Whep.js'
import { MonitorEngineeringPanel } from './broadcast/MonitorEngineeringPanel.js'

const tiers = { ref: 'c/mon-ref', std: 'c/mon-std', lite: 'c/mon' }

describe('seletor de nível no monitor (markup)', () => {
  it('com níveis, mostra AUTO/REF/PAD/LEV e começa no automático', () => {
    const html = renderToStaticMarkup(createElement(Whep, { path: 'c/mon', port: 8889, tiers, role: 'pgm', hideControls: true }))
    expect(html).toContain('aria-label="Nível de qualidade deste monitor"')
    for (const label of ['AUTO', 'REF', 'PAD', 'LEV']) expect(html).toContain(label)
    expect(html).toMatch(/aria-pressed="true"[^>]*>AUTO/)
  })
  it('sem níveis (QC, HA, multiview) não há seletor: nada muda para quem não os conhece', () => {
    const html = renderToStaticMarkup(createElement(Whep, { path: 'c/qc', port: 8889, hideControls: true }))
    expect(html).not.toContain('Nível de qualidade')
  })
  it('tela técnica sem dados ainda diz que não há monitor aberto', () => {
    const html = renderToStaticMarkup(createElement(MonitorEngineeringPanel, { channelId: 'c' }))
    expect(html).toContain('Monitores do navegador')
    expect(html).toContain('Nenhum monitor aberto nesta página.')
    expect(html).toContain('MEDIR ATRASO')
  })
})

describe('selo do scope ao vivo do PGM', () => {
  it('o rótulo diz o nível em uso (REF/PAD/LEV), ao lado do INDICATIVO', async () => {
    const { liveScopeLabel } = await import('./broadcast/BroadcastMonitor.js')
    const { ScopeDeck } = await import('./scopes/ScopeDeck.js')
    expect(liveScopeLabel('ref')).toBe('PGM · REF · WHEP decodificado pelo navegador')
    expect(liveScopeLabel('std')).toContain('· PAD ·')
    expect(liveScopeLabel('lite')).toContain('· LEV ·')
    expect(liveScopeLabel(null)).toBe('PGM · WHEP decodificado pelo navegador')
    const html = renderToStaticMarkup(createElement(ScopeDeck, { storageKey: 'teste', compact: true, live: { element: null, label: liveScopeLabel('lite'), valid: true } }))
    expect(html).toContain('INDICATIVO')
    expect(html).toContain('PGM · LEV · WHEP')
  })
  it('onTierChange é opcional: o Whep sem ele (e com ele) desenha o mesmo seletor', () => {
    const plain = renderToStaticMarkup(createElement(Whep, { path: 'c/mon', port: 8889, tiers, role: 'pgm', hideControls: true }))
    const withCallback = renderToStaticMarkup(createElement(Whep, { path: 'c/mon', port: 8889, tiers, role: 'pgm', hideControls: true, onTierChange: () => {} }))
    expect(withCallback).toBe(plain)
  })
})
