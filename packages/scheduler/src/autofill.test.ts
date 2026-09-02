import { describe, expect, it } from 'vitest'
import { autoFill, preferences, score, type Candidate } from './autofill.js'

const candidate = (over: Partial<Candidate> & { id: string }): Candidate => ({
  durationFrames: 250,
  categoryId: 'vt',
  lastAiredMs: null,
  preference: 0,
  ...over,
})

const base = {
  categories: [],
  avoidWithinMs: 3_600_000,
  nowMs: 1_000_000_000,
  slackFrames: 50,
}

describe('montagem automática', () => {
  it('preenche a janela e para dentro da folga', () => {
    const result = autoFill({
      ...base,
      window: 1000,
      candidates: [
        candidate({ id: 'a', durationFrames: 400 }),
        candidate({ id: 'b', durationFrames: 300 }),
        candidate({ id: 'c', durationFrames: 300 }),
      ],
    })
    expect(result.reason).toBe('FILLED')
    expect(result.leftover).toBeLessThanOrEqual(50)
    expect(result.items).toHaveLength(3)
  })

  it('não repete o mesmo arquivo na mesma montagem', () => {
    const result = autoFill({
      ...base,
      window: 1000,
      candidates: [candidate({ id: 'a', durationFrames: 300 })],
    })
    expect(result.items.map((item) => item.id)).toEqual(['a'])
    expect(result.reason).toBe('OUT_OF_MATERIAL')
  })

  it('recusa o que foi ao ar há pouco', () => {
    const recent = candidate({
      id: 'quente',
      durationFrames: 500,
      lastAiredMs: base.nowMs - 60_000,
    })
    expect(score(recent, 1000, base.nowMs, base.avoidWithinMs)).toBe(Number.NEGATIVE_INFINITY)
  })

  it('deixa entrar de novo quando o intervalo passou', () => {
    const old = candidate({
      id: 'frio',
      durationFrames: 500,
      lastAiredMs: base.nowMs - 7_200_000,
    })
    expect(score(old, 1000, base.nowMs, base.avoidWithinMs)).toBeGreaterThan(0)
  })

  it('respeita a categoria pedida', () => {
    const result = autoFill({
      ...base,
      window: 600,
      categories: ['comercial'],
      candidates: [
        candidate({ id: 'vt', durationFrames: 500, categoryId: 'vt' }),
        candidate({ id: 'com', durationFrames: 500, categoryId: 'comercial' }),
      ],
    })
    expect(result.items.map((item) => item.id)).toEqual(['com'])
  })

  it('prefere o que encaixa melhor na sobra', () => {
    // Com 600 de sobra, o de 550 deixa menos buraco que o de 300.
    const apertado = candidate({ id: 'apertado', durationFrames: 550 })
    const folgado = candidate({ id: 'folgado', durationFrames: 300 })
    expect(score(apertado, 600, base.nowMs, base.avoidWithinMs)).toBeGreaterThan(
      score(folgado, 600, base.nowMs, base.avoidWithinMs),
    )
  })

  it('a preferência do operador desempata', () => {
    const result = autoFill({
      ...base,
      window: 320,
      candidates: [
        candidate({ id: 'comum', durationFrames: 300 }),
        candidate({ id: 'querido', durationFrames: 300, preference: 1.5 }),
      ],
    })
    expect(result.items[0]?.id).toBe('querido')
  })

  it('o peso aprendido é limitado nos dois sentidos', () => {
    const weights = preferences([
      { mediaId: 'amado', inserted: 50, dropped: 0 },
      { mediaId: 'odiado', inserted: 0, dropped: 50 },
    ])
    // Nem dogma a favor nem banimento: 50 inserções não dominam a grade.
    expect(weights.get('amado')).toBe(1.5)
    expect(weights.get('odiado')).toBe(-1.5)
  })

  it('diz quando o acervo acabou antes da janela', () => {
    const result = autoFill({
      ...base,
      window: 5000,
      candidates: [candidate({ id: 'unico', durationFrames: 250 })],
    })
    expect(result.reason).toBe('OUT_OF_MATERIAL')
    expect(result.leftover).toBe(4750)
  })
})
