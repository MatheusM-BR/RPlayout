import { describe, expect, it } from 'vitest'
import { gradeClock, gradeCsv, gradeM3u } from './grade-export.js'
import type { RundownView } from './plan.js'

const rate = { num: 30000, den: 1001 }
const at = (seconds: number) => Math.round(seconds * 30000 / 1001)
const view = {
  channel: { rate, name: 'Agro QA' },
  rundown: { name: 'Grade', date: '2026-10-31' },
  items: [
    { item: { id: 'a', title: 'Comercial ProRes 25s', type: 'VT', sourceRef: null, anchor: { kind: 'FIXED', at: at(4 * 3600 + 600) } }, asset: { path: 'C:/acervo/comercial.mov' } },
    { item: { id: 'b', title: 'Leilao Ao Vivo', type: 'LIVE', sourceRef: 'srt://0.0.0.0:9000?passphrase=SEGREDO', anchor: { kind: 'FLOW' } }, asset: null },
  ],
  schedule: { items: [
    { id: 'a', start: at(4 * 3600 + 600), duration: at(25), state: 'PENDING', adjustments: [] },
    { id: 'b', start: at(4 * 3600 + 625), duration: at(40), state: 'PENDING', adjustments: [] },
  ] },
} as unknown as RundownView

describe('exportação da grade (M9)', () => {
  it('CSV traz horário e duração legíveis (HH:MM:SS) e os quadros em colunas próprias', () => {
    const csv = gradeCsv(view)
    const [header, first] = csv.replace(/^\ufeff/, '').split('\r\n')
    expect(header).toContain('entrada prevista;duração;âncora;hora da âncora')
    expect(first).toContain('"04:10:00";"00:25";"HORA FIXA";"04:10:00"')
    expect(first).toContain(`"${at(4 * 3600 + 600)}";"${at(25)}"`)
    expect(csv).not.toContain('SEGREDO')
  })
  it('M3U estendido lista arquivos com segundos; ao vivo vira comentário', () => {
    const m3u = gradeM3u(view)
    expect(m3u.startsWith('#EXTM3U')).toBe(true)
    expect(m3u).toContain('#EXTINF:24.992,Comercial ProRes 25s\r\nC:/acervo/comercial.mov')
    expect(m3u).toContain('# AO VIVO / SEM ARQUIVO: Leilao Ao Vivo (00:40)')
    expect(m3u).not.toContain('SEGREDO')
  })
  it('grade em loop depois da meia-noite mostra o dia', () => {
    expect(gradeClock(at(86_400 + 3600), rate)).toBe('D+1 01:00:00')
  })
})
