import { describe, expect, it } from 'vitest'
import { FLOW, RATE, formatClock, type Anchor, type PlanItem } from '@rplayout/protocol'
import { resolve } from './resolve.js'

const rate = RATE['50']

/** Segundos em frames, a 50fps. */
const s = (n: number): number => Math.round(n * 50)
/** Hora do dia em frames desde a meia-noite. */
const at = (h: number, m: number, sec = 0): number => s(h * 3600 + m * 60 + sec)

const clock = (frames: number): string => formatClock(frames, rate)

let order = 0
function item(overrides: Partial<PlanItem> & { id: string; duration: number }): PlanItem {
  return {
    order: order++,
    minDuration: overrides.duration,
    anchor: FLOW,
    onOverrun: 'PUSH',
    elastic: null,
    isFiller: false,
    locked: false,
    ...overrides,
  }
}

function plan(items: PlanItem[], plannedStart: number, extra: Partial<Parameters<typeof resolve>[0]> = {}) {
  order = 0
  return resolve({ rate, items, now: null, onAir: null, plannedStart, ...extra })
}

const byId = (result: ReturnType<typeof resolve>, id: string) => {
  const found = result.items.find((i) => i.id === id)
  if (!found) throw new Error(`item ${id} não encontrado`)
  return found
}

const soft = (target: number, tolerance: number): Anchor => ({
  kind: 'SOFT',
  at: target,
  tolerance,
  priority: 3,
})

describe('encadeamento simples', () => {
  it('propaga horários a partir do início planejado', () => {
    order = 0
    const result = plan(
      [
        item({ id: 'a', duration: s(60) }),
        item({ id: 'b', duration: s(90) }),
        item({ id: 'c', duration: s(30) }),
      ],
      at(19, 0),
    )

    expect(clock(byId(result, 'a').start)).toBe('19:00:00')
    expect(clock(byId(result, 'b').start)).toBe('19:01:00')
    expect(clock(byId(result, 'c').start)).toBe('19:02:30')
    expect(clock(result.endsAt)).toBe('19:03:00')
    expect(result.conflicts).toHaveLength(0)
  })

  it('com o início já vencido e nada no ar, projeta a partir de agora', () => {
    order = 0
    const result = resolve({
      rate,
      items: [item({ id: 'a', duration: s(60) }), item({ id: 'b', duration: s(60) })],
      now: at(12, 0),
      onAir: null,
      plannedStart: at(4, 30),
    })

    expect(clock(byId(result, 'a').start)).toBe('12:00:00')
    expect(clock(byId(result, 'b').start)).toBe('12:01:00')
  })

  it('planejamento offline respeita o início planejado', () => {
    order = 0
    const result = plan([item({ id: 'a', duration: s(60) })], at(4, 30))
    expect(clock(byId(result, 'a').start)).toBe('04:30:00')
  })

  it('grade vazia devolve o início planejado', () => {
    const result = plan([], at(6, 0))
    expect(result.items).toHaveLength(0)
    expect(result.endsAt).toBe(at(6, 0))
  })
})

describe('folga antes de uma âncora', () => {
  it('estica o elástico para cobrir', () => {
    order = 0
    const result = plan(
      [
        item({ id: 'vt', duration: s(60) }),
        item({
          id: 'filler',
          duration: s(20),
          isFiller: true,
          elastic: { min: s(10), max: s(120) },
        }),
        item({ id: 'jornal', duration: s(600), anchor: { kind: 'FIXED', at: at(19, 3) } }),
      ],
      at(19, 0),
    )

    expect(byId(result, 'filler').duration).toBe(s(120))
    expect(byId(result, 'filler').adjustments[0]?.kind).toBe('STRETCHED')
    expect(clock(byId(result, 'jornal').start)).toBe('19:03:00')
    expect(result.conflicts).toHaveLength(0)
  })

  it('sem elástico, reporta o buraco e sugere filler', () => {
    order = 0
    const result = plan(
      [
        item({ id: 'vt', duration: s(60) }),
        item({ id: 'jornal', duration: s(600), anchor: { kind: 'FIXED', at: at(19, 3) } }),
      ],
      at(19, 0),
    )

    expect(result.conflicts).toHaveLength(1)
    expect(result.conflicts[0]?.kind).toBe('GAP')
    expect(result.conflicts[0]?.frames).toBe(s(120))
    expect(result.suggestions[0]?.action).toBe('ADD_FILLER')
    // A âncora fixa entra na hora dela mesmo com dead air antes.
    expect(clock(byId(result, 'jornal').start)).toBe('19:03:00')
  })
})

describe('estouro antes de uma âncora fixa', () => {
  it('descarta o filler primeiro', () => {
    order = 0
    const result = plan(
      [
        item({ id: 'vt', duration: s(120) }),
        item({ id: 'filler', duration: s(30), isFiller: true, onOverrun: 'DROP_FILLER' }),
        item({ id: 'jornal', duration: s(600), anchor: { kind: 'FIXED', at: at(19, 2) } }),
      ],
      at(19, 0),
    )

    expect(byId(result, 'filler').state).toBe('DROPPED')
    expect(clock(byId(result, 'jornal').start)).toBe('19:02:00')
    expect(result.conflicts).toHaveLength(0)
  })

  it('descarta o filler e depois corta o VT, nessa ordem', () => {
    order = 0
    const result = plan(
      [
        item({ id: 'vt', duration: s(120), minDuration: s(90), onOverrun: 'TRIM_PREV' }),
        item({ id: 'filler', duration: s(30), isFiller: true, onOverrun: 'DROP_FILLER' }),
        item({ id: 'jornal', duration: s(600), anchor: { kind: 'FIXED', at: at(19, 1, 40) } }),
      ],
      at(19, 0),
    )

    expect(byId(result, 'filler').state).toBe('DROPPED')
    expect(byId(result, 'vt').duration).toBe(s(100))
    expect(byId(result, 'vt').adjustments.some((a) => a.kind === 'TRIMMED')).toBe(true)
    expect(clock(byId(result, 'jornal').start)).toBe('19:01:40')
    expect(result.conflicts).toHaveLength(0)
  })

  it('nunca corta abaixo da duração mínima por conta própria', () => {
    order = 0
    const result = plan(
      [
        item({ id: 'vt', duration: s(120), minDuration: s(110), onOverrun: 'TRIM_PREV' }),
        item({ id: 'jornal', duration: s(600), anchor: { kind: 'FIXED', at: at(19, 1) } }),
      ],
      at(19, 0),
    )

    const vt = byId(result, 'vt')
    const voluntary = vt.adjustments.find((a) => !a.reason.includes('forçado'))
    expect(voluntary?.frames).toBe(s(10))

    // O que não coube vira corte forçado, e isso é sempre um erro reportado.
    expect(result.conflicts[0]?.kind).toBe('OVERRUN')
    expect(result.conflicts[0]?.severity).toBe('ERROR')
    expect(clock(byId(result, 'jornal').start)).toBe('19:01:00')
  })

  it('não toca em item travado', () => {
    order = 0
    const result = plan(
      [
        item({
          id: 'vt',
          duration: s(300),
          minDuration: s(60),
          onOverrun: 'TRIM_PREV',
          locked: true,
        }),
        item({ id: 'chamada', duration: s(30), anchor: soft(at(19, 1), s(30)) }),
      ],
      at(19, 0),
    )

    expect(byId(result, 'vt').duration).toBe(s(300))
    expect(byId(result, 'vt').adjustments).toHaveLength(0)
    expect(result.conflicts[0]?.kind).toBe('ANCHOR_MISSED')
  })

  it('duas âncoras fixas que não cabem uma na outra são sinalizadas', () => {
    order = 0
    const result = plan(
      [
        item({ id: 'abertura', duration: s(60), anchor: { kind: 'FIXED', at: at(20, 0) } }),
        item({ id: 'bloco', duration: s(600), onOverrun: 'PUSH' }),
        item({ id: 'rede', duration: s(300), anchor: { kind: 'FIXED', at: at(20, 5) } }),
      ],
      at(19, 55),
    )

    expect(result.conflicts.some((c) => c.kind === 'ANCHOR_IMPOSSIBLE')).toBe(true)
    expect(clock(byId(result, 'rede').start)).toBe('20:05:00')
  })
})

describe('âncoras flexíveis', () => {
  it('entra no cursor quando está dentro da tolerância', () => {
    order = 0
    const result = plan(
      [
        item({ id: 'vt', duration: s(60) }),
        item({ id: 'chamada', duration: s(30), anchor: soft(at(19, 1, 30), s(60)) }),
      ],
      at(19, 0),
    )

    const chamada = byId(result, 'chamada')
    expect(clock(chamada.start)).toBe('19:01:00')
    expect(chamada.anchorHit).toBe(true)
    expect(chamada.deviation).toBe(-s(30))
    expect(result.conflicts).toHaveLength(0)
  })

  it('reporta quando não cabe nem na tolerância', () => {
    order = 0
    const result = plan(
      [
        item({ id: 'vt', duration: s(300) }),
        item({ id: 'chamada', duration: s(30), anchor: soft(at(19, 1), s(30)) }),
      ],
      at(19, 0),
    )

    const chamada = byId(result, 'chamada')
    expect(chamada.anchorHit).toBe(false)
    expect(clock(chamada.start)).toBe('19:05:00')
    expect(result.conflicts[0]?.kind).toBe('ANCHOR_MISSED')
    expect(result.suggestions[0]?.action).toBe('RELAX_ANCHOR')
  })

  it('escolhe o melhor ponto dentro de uma janela', () => {
    order = 0
    const result = plan(
      [
        item({ id: 'vt', duration: s(45) }),
        item({
          id: 'institucional',
          duration: s(30),
          anchor: { kind: 'WINDOW', from: at(19, 1), to: at(19, 10), priority: 2 },
        }),
      ],
      at(19, 0),
    )

    // Cursor cai antes da janela: entra no primeiro instante permitido.
    expect(clock(byId(result, 'institucional').start)).toBe('19:01:00')
    expect(byId(result, 'institucional').anchorHit).toBe(true)
  })
})

describe('com item no ar', () => {
  it('recupera o atraso descartando filler e cortando o VT', () => {
    // O cenário do plano: a live anterior estourou 32s e o bloco tem de fechar
    // às 20:00:00 em ponto.
    order = 0
    const items = [
      item({ id: 'vt07', duration: s(168), minDuration: s(140), onOverrun: 'TRIM_PREV' }),
      item({ id: 'vinheta', duration: s(12), anchor: soft(at(19, 59, 28), s(90)) }),
      item({ id: 'filler', duration: s(20), isFiller: true, onOverrun: 'DROP_FILLER' }),
      item({ id: 'estudio', duration: s(840), anchor: { kind: 'FIXED', at: at(20, 0) } }),
    ]

    const result = resolve({
      rate,
      items,
      now: at(19, 57, 42),
      onAir: { itemId: 'vt07', startedAt: at(19, 57, 12), elapsed: s(30) },
      plannedStart: at(19, 56, 40),
    })

    expect(byId(result, 'vt07').state).toBe('ON_AIR')
    expect(byId(result, 'filler').state).toBe('DROPPED')
    expect(byId(result, 'vt07').duration).toBe(s(156))
    expect(clock(byId(result, 'vinheta').start)).toBe('19:59:48')
    expect(clock(byId(result, 'estudio').start)).toBe('20:00:00')
    expect(result.conflicts).toHaveLength(0)
  })

  it('nunca corta o item no ar abaixo do que já foi ao ar', () => {
    order = 0
    const items = [
      item({ id: 'vt', duration: s(300), minDuration: s(10), onOverrun: 'TRIM_PREV' }),
      item({ id: 'rede', duration: s(600), anchor: { kind: 'FIXED', at: at(20, 0) } }),
    ]

    const result = resolve({
      rate,
      items,
      now: at(19, 58),
      onAir: { itemId: 'vt', startedAt: at(19, 56), elapsed: s(120) },
      plannedStart: at(19, 56),
    })

    const vt = byId(result, 'vt')
    const voluntary = vt.adjustments.filter((a) => !a.reason.includes('forçado'))
    const cut = voluntary.reduce((total, a) => total + a.frames, 0)
    expect(s(300) - cut).toBeGreaterThanOrEqual(s(120))
  })

  it('marca como cumpridos os itens anteriores ao que está no ar', () => {
    order = 0
    const items = [
      item({ id: 'passado', duration: s(60) }),
      item({ id: 'agora', duration: s(120) }),
      item({ id: 'depois', duration: s(60) }),
    ]

    const result = resolve({
      rate,
      items,
      now: at(19, 1),
      onAir: { itemId: 'agora', startedAt: at(19, 0, 30), elapsed: s(30) },
      plannedStart: at(18, 59, 30),
    })

    expect(byId(result, 'passado').state).toBe('DONE')
    expect(clock(byId(result, 'passado').end)).toBe('19:00:30')
    expect(byId(result, 'agora').state).toBe('ON_AIR')
    expect(byId(result, 'depois').state).toBe('PENDING')
    expect(clock(byId(result, 'depois').start)).toBe('19:02:30')
  })

  it('âncora vencida é reportada e o item entra no fluxo, sem rebobinar a grade', () => {
    order = 0
    const items = [
      item({ id: 'vt', duration: s(60) }),
      item({ id: 'perdido', duration: s(60), anchor: { kind: 'FIXED', at: at(18, 0) } }),
      item({ id: 'depois', duration: s(30) }),
    ]

    const result = resolve({
      rate,
      items,
      now: at(19, 0),
      onAir: null,
      plannedStart: at(19, 0),
    })

    expect(result.conflicts.some((c) => c.kind === 'ANCHOR_PAST')).toBe(true)
    expect(result.suggestions.some((sg) => sg.action === 'MOVE_ANCHOR')).toBe(true)

    // O item não volta para as 18:00: entra logo depois do anterior.
    expect(clock(byId(result, 'perdido').start)).toBe('19:01:00')
    expect(clock(byId(result, 'depois').start)).toBe('19:02:00')
  })

  it('nenhum item entra antes do anterior sair, em nenhum cenário', () => {
    order = 0
    // Mistura tudo: âncora vencida, âncora fixa apertada e item no ar.
    const items = [
      item({ id: 'ar', duration: s(300), minDuration: s(60), onOverrun: 'TRIM_PREV' }),
      item({ id: 'vencida', duration: s(60), anchor: { kind: 'FIXED', at: at(4, 0) } }),
      item({ id: 'apertada', duration: s(120), anchor: { kind: 'FIXED', at: at(12, 1) } }),
      item({ id: 'solta', duration: s(45) }),
      item({ id: 'flexivel', duration: s(30), anchor: soft(at(3, 0), s(30)) }),
    ]

    const result = resolve({
      rate,
      items,
      now: at(12, 2),
      onAir: { itemId: 'ar', startedAt: at(12, 0), elapsed: s(120) },
      plannedStart: at(12, 0),
    })

    for (const current of result.items) {
      expect(current.end).toBeGreaterThanOrEqual(current.start)
    }
    const live = result.items.filter((current) => current.state !== 'DROPPED')
    for (let index = 1; index < live.length; index++) {
      const previous = live[index - 1]!
      const next = live[index]!
      expect(next.start).toBeGreaterThanOrEqual(previous.end)
    }
  })
})

describe('determinismo', () => {
  it('a mesma entrada devolve exatamente a mesma saída', () => {
    const build = (): PlanItem[] => {
      order = 0
      return [
        item({ id: 'a', duration: s(120), minDuration: s(90), onOverrun: 'TRIM_PREV' }),
        item({ id: 'b', duration: s(30), isFiller: true, onOverrun: 'DROP_FILLER' }),
        item({ id: 'c', duration: s(45), elastic: { min: s(15), max: s(90) } }),
        item({ id: 'd', duration: s(600), anchor: { kind: 'FIXED', at: at(19, 2) } }),
      ]
    }

    const first = plan(build(), at(19, 0))
    const second = plan(build(), at(19, 0))
    expect(JSON.stringify(second)).toBe(JSON.stringify(first))
  })

  it('não muda o array de entrada', () => {
    order = 0
    const items = [
      item({ id: 'a', duration: s(120), minDuration: s(60), onOverrun: 'TRIM_PREV' }),
      item({ id: 'b', duration: s(600), anchor: { kind: 'FIXED', at: at(19, 1) } }),
    ]
    const snapshot = JSON.stringify(items)
    plan(items, at(19, 0))
    expect(JSON.stringify(items)).toBe(snapshot)
  })
})
