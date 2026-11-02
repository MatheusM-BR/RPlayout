import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const master = read('../views/MasterControlView.tsx')

describe('UI/UX operacional (r88-33)', () => {
  it('aviso de cadência convertida fica numa faixa de altura fixa, fora do fluxo da grade', () => {
    expect(master).not.toMatch(/role="alert" className="px-margin py-3/)
    const slot = master.indexOf('data-testid="cadence-notice-slot"')
    expect(slot).toBeGreaterThan(0)
    expect(master.slice(slot - 20, slot + 200)).toMatch(/\bh-9\b/)
    expect(master).toContain('A cadência foi convertida')
  })
  it('tokens de texto mínimo existem e respeitam os pisos', () => {
    const css = read('../styles.css')
    expect(css).toMatch(/--fs-data:\s*(1[2-9]|[2-9]\d)px/)
    expect(css).toMatch(/--fs-label:\s*(1[1-9]|[2-9]\d)px/)
    expect(css).toContain('.t-status')
  })
  it('horários, durações e status da grade do Master e da Playlist usam os tokens', () => {
    const playlist = read('../views/PlaylistScheduleView.tsx')
    expect(master).toMatch(/py-1\.5 px-3 t-time/)
    expect(master).toMatch(/font-label-caps t-status">\s*CUED/)
    expect(playlist).toContain('col-span-2 font-label-mono t-time')
    expect(playlist).toMatch(/font-label-mono t-status block/)
  })
  it('alvos de clique: biblioteca >=36px, botões por linha e QC >=32px', () => {
    const css = read('../styles.css')
    expect(css).toMatch(/\.hit-row\s*\{\s*min-height:\s*36px/)
    expect(css).toMatch(/\.hit-btn\s*\{\s*min-height:\s*32px/)
    expect(master).not.toMatch(/px-2 h-7 rounded border cursor-grab/)
    expect(master).toContain('px-2 hit-row rounded border cursor-grab')
    const qc = read('../views/QualityControlView.tsx')
    expect(qc).toMatch(/px-4 hit-btn rounded bg-status-ok[\s\S]{0,300}ml-3 mr-3/)
    expect(qc).toMatch(/px-4 hit-btn rounded bg-on-air-crimson/)
  })
  it('termos Aprovar/Rejeitar/Ignorar e glossário na legenda de atalhos', () => {
    const dialog = read('../components/ShortcutsDialog.tsx')
    for (const term of ['TAKE', 'CUE', 'PGM', 'PVW', 'ALINHAR', 'FOCO']) expect(dialog).toContain(`['${term}',`)
    expect(dialog).toContain('TAKE sempre')
    expect(dialog).toContain('Desarma o ABORT')
    const qc = read('../views/QualityControlView.tsx')
    expect(qc).not.toMatch(/Ignorar\s*\n\s*<\/button>/)
    expect(read('../components/QualityControlPanel.tsx')).not.toContain('ACEITAR')
  })
  it('AiredView, QC e Monitor mostram Carregando… antes da primeira resposta', () => {
    expect(read('../views/AiredView.tsx')).toMatch(/entries === null \? \(loadError \? '—' : 'Carregando…'\)/)
    expect(read('../views/AiredView.tsx')).toMatch(/entries === null\s*\? <div role="status"/)
    expect(read('../views/QualityControlView.tsx')).toContain('Carregando acervo…')
    expect(read('../views/QualityControlView.tsx')).not.toMatch(/libraryLoaded \? okCount : 'N\/D'/)
    const eng = read('../views/EngineeringDistributionView.tsx')
    expect(eng).toContain("hostMetrics ? percent(hostMetrics.cpu.percent) : 'Carregando…'")
    expect(eng).toContain('Carregando saídas…')
  })
})
