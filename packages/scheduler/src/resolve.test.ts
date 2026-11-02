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

  it('HORA FIXA com vários itens estourando entra na hora: descarta os de depois e corta o que atravessa (A2)', () => {
    order = 0
    // 04:00 + 7:10 + 3 min + 12 s + 2 min: a grade passa de 04:10 em 2:22.
    const result = plan(
      [
        item({ id: 'programa', duration: s(430) }),
        item({ id: 'movimento', duration: s(180) }),
        item({ id: 'preto', duration: s(12) }),
        item({ id: 'barras', duration: s(120) }),
        item({ id: 'comercial', duration: s(25), anchor: { kind: 'FIXED', at: at(4, 10) } }),
        item({ id: 'depois', duration: s(30) }),
      ],
      at(4, 0),
    )

    const comercial = byId(result, 'comercial')
    expect(clock(comercial.start)).toBe('04:10:00')
    expect(comercial.deviation).toBe(0)
    expect(comercial.anchorHit).toBe(true)
    // 'movimento' (04:07:10) atravessa 04:10: cortado para 2:50; os de depois saem.
    expect(byId(result, 'movimento').duration).toBe(s(170))
    expect(byId(result, 'preto').state).toBe('DROPPED')
    expect(byId(result, 'barras').state).toBe('DROPPED')
    // Nada fica na grade com 0 s.
    expect(result.items.filter((row) => row.state !== 'DROPPED' && row.duration === 0)).toEqual([])
    expect(clock(byId(result, 'depois').start)).toBe('04:10:25')
  })

  it('HORA FIXA descarta, sem deixar 0 s, os itens que inteiros cairiam depois da hora (A2/A7)', () => {
    order = 0
    const result = plan(
      [
        item({ id: 'longo', duration: s(660) }),
        item({ id: 'preto', duration: s(12) }),
        item({ id: 'curto', duration: s(20) }),
        item({ id: 'comercial', duration: s(25), anchor: { kind: 'FIXED', at: at(4, 10) } }),
      ],
      at(4, 0),
    )

    expect(clock(byId(result, 'comercial').start)).toBe('04:10:00')
    expect(byId(result, 'preto').state).toBe('DROPPED')
    expect(byId(result, 'curto').state).toBe('DROPPED')
    expect(byId(result, 'preto').adjustments[0]?.kind).toBe('DROPPED')
    expect(byId(result, 'longo').duration).toBe(s(600))
    expect(result.compensationReport?.actions.filter((a) => a.actionType === 'DROP_ITEM').map((a) => a.itemId).sort()).toEqual(['curto', 'preto'])
  })

  it('HORA FIXA com o item no ar estourando: corta o PGM na hora, sem passar do já exibido', () => {
    order = 0
    const result = resolve({
      rate,
      items: [
        item({ id: 'no-ar', duration: s(900) }),
        item({ id: 'seguinte', duration: s(60) }),
        item({ id: 'comercial', duration: s(25), anchor: { kind: 'FIXED', at: at(4, 10) } }),
      ],
      now: at(4, 5),
      onAir: { itemId: 'no-ar', startedAt: at(4, 0), elapsed: s(300) },
      plannedStart: at(4, 0),
    })
    expect(clock(byId(result, 'comercial').start)).toBe('04:10:00')
    expect(byId(result, 'no-ar').duration).toBe(s(600))
    expect(byId(result, 'seguinte').state).toBe('DROPPED')
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

describe('Fase A: Automação 24/7 e Compensação Determinística (SPEC BDD)', () => {
  const rate30 = { num: 30, den: 1 }

  it('Cenário 1: Evento atrasa 45s (1350 quadros) antes de HARD_TIME das 19:00:00:00', () => {
    // 19:00:00 a 30fps = 19 * 3600 * 30 = 2.052.000 frames
    const hardTimeAt = 19 * 3600 * 30
    // Cursor previsto para chegar às 19:00:45 (atraso de 1350 quadros)
    const plannedStart = hardTimeAt - (900 + 150 + 600 + 450) + 1350

    order = 0
    const items: PlanItem[] = [
      {
        id: 'item-2',
        order: 1,
        title: 'VT Promocional',
        duration: 900,
        minDuration: 300,
        anchor: FLOW,
        onOverrun: 'PUSH',
        elastic: null,
        isFiller: false,
        locked: false,
        timingFlags: { trimmable: true, optional: false, protected: false },
      },
      {
        id: 'item-3',
        order: 2,
        title: 'Vinheta Patrocínio',
        duration: 150,
        minDuration: 150,
        anchor: FLOW,
        onOverrun: 'PUSH',
        elastic: null,
        isFiller: false,
        locked: false,
        timingFlags: { trimmable: false, optional: false, protected: true },
      },
      {
        id: 'item-4',
        order: 3,
        title: 'Chamada Cultural',
        duration: 600,
        minDuration: 600,
        anchor: FLOW,
        onOverrun: 'PUSH',
        elastic: null,
        isFiller: false,
        locked: false,
        timingFlags: { trimmable: false, optional: true, protected: false },
      },
      {
        id: 'item-5',
        order: 4,
        title: 'Filler de Alinhamento',
        duration: 450,
        minDuration: 150,
        anchor: FLOW,
        onOverrun: 'PUSH',
        elastic: { min: 150, max: 900 },
        isFiller: true,
        eventType: 'FILLER',
        locked: false,
      },
      {
        id: 'item-6',
        order: 5,
        title: 'Voz do Brasil / Rede Nacional',
        duration: 1800,
        minDuration: 1800,
        anchor: { kind: 'HARD_TIME', at: hardTimeAt },
        onOverrun: 'PUSH',
        elastic: null,
        isFiller: false,
        eventType: 'HARD_TIME',
        locked: true,
      },
    ]

    const result = resolve({
      rate: rate30,
      items,
      now: null,
      onAir: null,
      plannedStart,
    })

    const item2 = result.items.find((i) => i.id === 'item-2')!
    const item3 = result.items.find((i) => i.id === 'item-3')!
    const item4 = result.items.find((i) => i.id === 'item-4')!
    const item5 = result.items.find((i) => i.id === 'item-5')!
    const item6 = result.items.find((i) => i.id === 'item-6')!

    // Passo 1: Filler encolhido de 450 para 150 (-300)
    expect(item5.duration).toBe(150)
    // Passo 2: Opcional descartado (-600)
    expect(item4.state).toBe('DROPPED')
    // Passo 3: Trimmable cortado em 450 quadros (de 900 para 450)
    expect(item2.duration).toBe(450)
    // Passo 4: Protected intacto (150 quadros)
    expect(item3.duration).toBe(150)
    expect(item3.state).toBe('PENDING')
    // Resultado: HARD_TIME entra exatamente no frame planejado (19:00:00:00)
    expect(item6.start).toBe(hardTimeAt)

    // Auditoria de compensação
    expect(result.compensationReport).toBeDefined()
    const report = result.compensationReport!
    expect(report.initialDriftFrames).toBe(1350)
    expect(report.compensatedDriftFrames).toBe(1350)
    expect(report.actions).toHaveLength(3)

    const fillerAction = report.actions.find((a) => a.itemId === 'item-5')!
    expect(fillerAction.actionType).toBe('SHRINK_FILLER')
    expect(fillerAction.deltaFrames).toBe(300)

    const dropAction = report.actions.find((a) => a.itemId === 'item-4')!
    expect(dropAction.actionType).toBe('DROP_ITEM')
    expect(dropAction.deltaFrames).toBe(600)

    const trimAction = report.actions.find((a) => a.itemId === 'item-2')!
    expect(trimAction.actionType).toBe('TRIM_TAIL')
    expect(trimAction.deltaFrames).toBe(450)
  })

  it('Passo 5: Aplica Emergency Truncation no frame zero se o atraso exceder a margem recuperável antes do HARD_TIME', () => {
    const hardTimeAt = 19 * 3600 * 30
    // Atraso de 2000 quadros (muito além dos 300+600+600=1500 que os itens podem ceder)
    const plannedStart = hardTimeAt - (900 + 150 + 600 + 450) + 2000

    order = 0
    const items: PlanItem[] = [
      {
        id: 'item-2',
        order: 1,
        title: 'VT Promocional',
        duration: 900,
        minDuration: 300,
        anchor: FLOW,
        onOverrun: 'PUSH',
        elastic: null,
        isFiller: false,
        locked: false,
        timingFlags: { trimmable: true, optional: false, protected: false },
      },
      {
        id: 'item-3',
        order: 2,
        title: 'Vinheta Patrocínio',
        duration: 150,
        minDuration: 150,
        anchor: FLOW,
        onOverrun: 'PUSH',
        elastic: null,
        isFiller: false,
        locked: false,
        timingFlags: { trimmable: false, optional: false, protected: true },
      },
      {
        id: 'item-4',
        order: 3,
        title: 'Chamada Cultural',
        duration: 600,
        minDuration: 600,
        anchor: FLOW,
        onOverrun: 'PUSH',
        elastic: null,
        isFiller: false,
        locked: false,
        timingFlags: { trimmable: false, optional: true, protected: false },
      },
      {
        id: 'item-5',
        order: 4,
        title: 'Filler de Alinhamento',
        duration: 450,
        minDuration: 150,
        anchor: FLOW,
        onOverrun: 'PUSH',
        elastic: { min: 150, max: 900 },
        isFiller: true,
        eventType: 'FILLER',
        locked: false,
      },
      {
        id: 'item-6',
        order: 5,
        title: 'Voz do Brasil / Rede Nacional',
        duration: 1800,
        minDuration: 1800,
        anchor: { kind: 'HARD_TIME', at: hardTimeAt },
        onOverrun: 'PUSH',
        elastic: null,
        isFiller: false,
        eventType: 'HARD_TIME',
        locked: true,
      },
    ]

    const result = resolve({
      rate: rate30,
      items,
      now: null,
      onAir: null,
      plannedStart,
    })

    const item6 = result.items.find((i) => i.id === 'item-6')!
    expect(item6.start).toBe(hardTimeAt)
    expect(result.compensationReport?.status).toBe('HARD_TIME_VIOLATION_PREVENTED')
    expect(result.compensationReport?.actions.some((a) => a.actionType === 'EMERGENCY_CUT')).toBe(true)
  })

  it('Suporte a evento LIVE com dynamic overrun e alerta de maxDuration', () => {
    order = 0
    const liveItem: PlanItem = {
      id: 'live-1',
      order: 1,
      title: 'Transmissão Ao Vivo Estúdio',
      duration: 18000,
      minDuration: 0,
      anchor: FLOW,
      onOverrun: 'PUSH',
      elastic: null,
      isFiller: false,
      eventType: 'LIVE',
      locked: false,
      liveConfig: {
        sourceType: 'SRT',
        sourceEndpoint: 'srt://127.0.0.1:9000',
        estimatedDuration: 18000, // 10 min
        maxDuration: 27000, // 15 min
        autoFollowOnEnd: true,
      },
    }

    const nextItem: PlanItem = {
      id: 'vt-next',
      order: 2,
      title: 'VT Sequencial',
      duration: 3000,
      minDuration: 1000,
      anchor: FLOW,
      onOverrun: 'PUSH',
      elastic: null,
      isFiller: false,
      locked: false,
    }

    // LIVE estendeu para 28.000 quadros (excedeu maxDuration de 27.000)
    const result = resolve({
      rate: rate30,
      items: [liveItem, nextItem],
      now: 10000,
      onAir: { itemId: 'live-1', startedAt: 0, elapsed: 28000 },
      plannedStart: 0,
    })

    const resolvedLive = result.items.find((i) => i.id === 'live-1')!
    const resolvedNext = result.items.find((i) => i.id === 'vt-next')!

    // Duração do item no ar expandida dinamicamente para o playhead real
    expect(resolvedLive.duration).toBe(28000)
    expect(resolvedNext.start).toBe(28000)
    // Alerta de estouro de maxDuration emitido
    expect(result.conflicts.some((c) => c.kind === 'OVERRUN' && c.itemId === 'live-1')).toBe(true)
  })
})

