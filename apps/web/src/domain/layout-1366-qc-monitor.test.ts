import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const qc = read('../views/QualityControlView.tsx')
const eng = read('../views/EngineeringDistributionView.tsx')
const css = read('../styles.css')

describe('layout 1366x768: QC e Monitor sem estouro nem sobreposição', () => {
  it('chips de filtro do QC quebram de linha e mantêm a altura de clique', () => {
    expect(css).toMatch(/\.hit-chip\s*\{[^}]*min-height:\s*24px[^}]*white-space:\s*nowrap/)
    const a = qc.indexOf('Botões de Filtro de Status')
    const b = qc.indexOf('Listagem com Scroll de Clipes')
    const filtros = qc.slice(a, b)
    expect(filtros).toMatch(/flex flex-wrap items-center justify-between gap-1/)
    expect(filtros.match(/flex flex-wrap items-center gap-1 font-label-caps/g)).toHaveLength(2)
    expect(filtros.match(/px-2 py-0\.5 hit-chip whitespace-nowrap/g)).toHaveLength(3)
    expect(filtros).not.toMatch(/<div className="flex items-center gap-1 font-label-caps/)
  })
  it('cartões de métrica do Monitor: sem colisão entre título, valor e legenda', () => {
    const a = eng.indexOf('Card 1: GPU NVENC')
    const b = eng.indexOf('Ações Rápidas de Engenharia')
    const cards = eng.slice(a, b)
    expect(cards.match(/min-w-0 bg-surface-panel p-2\.5/g)).toHaveLength(4)
    // Valor grande e selo não encolhem; a legenda é truncada e traz o texto completo no tooltip.
    expect(cards.match(/shrink-0 whitespace-nowrap font-timecode-display/g)).toHaveLength(4)
    for (const caption of ['gpuCaption', 'cpuCaption', 'ramCaption', 'engineCaption']) {
      expect(cards).toContain(`title={${caption}} className="min-w-0 truncate text-right`)
    }
    for (const label of ['UTILIZAÇÃO DA GPU', 'HOST CPU', 'MEMÓRIA RAM', 'ENGINE & PROCESSO']) {
      expect(cards).toContain(`title="${label}"`)
    }
  })
})
