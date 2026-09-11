import { describe, expect, it } from 'vitest'

import { decidirVigilia, type Vigilia } from './engine.js'

/** Roda uma sequência de tiques e diz em qual deles o motor seria morto. */
function correr(tiques: { vao: number; andou: boolean }[]): {
  matouNoTique: number | null
  semQuadroMs: number
} {
  let estado: Pick<Vigilia, 'semQuadroMs' | 'booted'> = { semQuadroMs: 0, booted: false }
  for (const [indice, tique] of tiques.entries()) {
    const decisao = decidirVigilia({ ...tique, ...estado })
    estado = { semQuadroMs: decisao.semQuadroMs, booted: decisao.booted }
    if (decisao.matar) return { matouNoTique: indice, semQuadroMs: decisao.semQuadroMs }
  }
  return { matouNoTique: null, semQuadroMs: estado.semQuadroMs }
}

/** Tiques normais: 50 ms cada, que é a cadência do laço de serviço. */
function sadios(quantos: number, andou = false) {
  return Array.from({ length: quantos }, () => ({ vao: 50, andou }))
}

describe('vigilia do motor', () => {
  it('quadro que anda zera o silêncio e marca que o motor subiu', () => {
    const decisao = decidirVigilia({ vao: 50, andou: true, semQuadroMs: 2_900, booted: false })
    expect(decisao).toEqual({ semQuadroMs: 0, booted: true, matar: false })
  })

  it('deixa o motor recém-subido montar o pipeline sem ser morto', () => {
    // Três segundos são o prazo de um canal em regime. Um processo que acabou
    // de nascer ainda está inicializando codificador e abrindo placa.
    expect(correr(sadios(70)).matouNoTique).toBeNull()
  })

  it('mata o motor que nunca produziu o primeiro quadro', () => {
    // 20 s de silêncio observado desde que subiu: aí não é montagem, é defeito.
    const { matouNoTique } = correr(sadios(500))
    expect(matouNoTique).not.toBeNull()
    expect(((matouNoTique ?? 0) + 1) * 50).toBe(20_000)
  })

  it('mata o motor em regime que congela por três segundos', () => {
    const { matouNoTique } = correr([{ vao: 50, andou: true }, ...sadios(200)])
    expect(matouNoTique).not.toBeNull()
    // O tique em que morre é aquele em que o silêncio observado fecha 3 s.
    expect((matouNoTique ?? 0) * 50).toBe(3_000)
  })

  it('laço de eventos travado não é motor parado', () => {
    // O relatório de quadros chega pelo mesmo laço que roda o watchdog. Quando
    // o laço destrava, o Node roda o temporizador antes da entrada e saída: o
    // watchdog acorda primeiro e vê um vão enorme com o contador parado. Esse
    // vão é cegueira nossa, não silêncio do motor -- e cobrar por ele foi o que
    // fez o servidor matar motores saudáveis.
    const travado = [{ vao: 50, andou: true }, { vao: 9_000, andou: false }, ...sadios(20)]
    expect(correr(travado).matouNoTique).toBeNull()
  })

  it('travamento repetido do laço também não mata', () => {
    const tiques = [{ vao: 50, andou: true }]
    for (let i = 0; i < 10; i += 1) tiques.push({ vao: 5_000, andou: false })
    expect(correr(tiques).matouNoTique).toBeNull()
  })

  it('congelamento de verdade não escapa por causa de um vão grande', () => {
    // Um vão gigante no meio não perdoa o resto: o silêncio observado antes e
    // depois continua somando, e o motor morre como tem de morrer.
    const tiques = [
      { vao: 50, andou: true },
      ...sadios(40),
      { vao: 9_000, andou: false },
      ...sadios(40),
    ]
    expect(correr(tiques).matouNoTique).not.toBeNull()
  })
})
