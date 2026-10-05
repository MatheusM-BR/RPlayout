import { describe, expect, it, vi } from 'vitest'

/**
 * A mensagem que o operador vê quando o binário nativo não serve.
 *
 * O erro de origem despeja treze caminhos e uma pilha de vinte linhas, sem
 * explicar a incompatibilidade entre o módulo e o runtime. Este teste existe
 * porque a tradução é fácil de perder num refactor, e sem ela o defeito volta
 * a ser meia hora de investigação na madrugada.
 */
describe('abrir o banco', () => {
  it('traduz binário nativo ausente em recado com conserto', async () => {
    vi.resetModules()
    vi.doMock('better-sqlite3', () => ({
      default: class {
        constructor() {
          throw new Error('Could not locate the bindings file. Tried:\n → a\n → b')
        }
      },
    }))
    const { openDatabase } = await import('./client.js')
    expect(() => openDatabase(':memory:')).toThrowError(/Node e o SQLite testados juntos/)
    expect(() => openDatabase(':memory:')).toThrowError(/não é necessário instalar tsx, tsc ou módulos manualmente/)
    vi.doUnmock('better-sqlite3')
    vi.resetModules()
  })

  it('erro que não é do binário passa inteiro', async () => {
    vi.resetModules()
    vi.doMock('better-sqlite3', () => ({
      default: class {
        constructor() {
          throw new Error('disco cheio')
        }
      },
    }))
    const { openDatabase } = await import('./client.js')
    expect(() => openDatabase(':memory:')).toThrowError('disco cheio')
    vi.doUnmock('better-sqlite3')
    vi.resetModules()
  })
})
