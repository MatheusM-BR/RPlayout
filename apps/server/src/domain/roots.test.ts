import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type Db } from '../db/client.js'
import { addRoot, contem, dentroDasPastas, labelFor, listRoots, removeRoot } from './roots.js'

let db: Db
let base: string

beforeEach(() => {
  db = openDatabase(':memory:').db
  base = mkdtempSync(join(tmpdir(), 'rplayout-pastas-'))
})

afterEach(() => {
  rmSync(base, { recursive: true, force: true })
})

/** Cria uma pasta de verdade: `addRoot` recusa caminho que não existe. */
function pasta(...partes: string[]): string {
  const caminho = join(base, ...partes)
  mkdirSync(caminho, { recursive: true })
  return caminho
}

describe('estar dentro de uma pasta', () => {
  it('a própria pasta conta', () => {
    expect(contem('/acervo', '/acervo')).toBe(true)
  })

  it('arquivo abaixo conta', () => {
    expect(contem('/acervo', '/acervo/vinhetas/abertura.mkv')).toBe(true)
  })

  it('pasta vizinha de nome parecido não conta', () => {
    // Comparar por prefixo de texto diria que sim, e "/acervo2" viraria parte
    // de "/acervo" -- um arquivo de fora entrando pela guarda de caminho.
    expect(contem('/acervo', '/acervo2/filme.mkv')).toBe(false)
  })

  it('caminho de fora não conta', () => {
    expect(contem('/acervo', '/etc/passwd')).toBe(false)
  })

  it('a guarda pergunta a todas as pastas', () => {
    const pastas = [{ path: '/acervo' }, { path: '/comerciais' }]
    expect(dentroDasPastas(pastas, '/comerciais/spot.mkv')).toBe(true)
    expect(dentroDasPastas(pastas, '/outro/spot.mkv')).toBe(false)
  })
})

describe('nome curto da pasta', () => {
  it('usa o último trecho do caminho', () => {
    expect(labelFor('/mnt/midia/programacao')).toBe('programacao')
  })
})

describe('pastas do acervo', () => {
  it('banco vazio nasce com a pasta da variável de ambiente', async () => {
    // Quem já usava o sistema não pode perder o acervo por causa desta tabela.
    const raiz = pasta('midia')
    const pastas = await listRoots(db, raiz)
    expect(pastas.map((entrada) => entrada.path)).toEqual([resolve(raiz)])
  })

  it('acrescenta uma segunda pasta', async () => {
    await listRoots(db, pasta('midia'))
    const resultado = await addRoot(db, pasta('comerciais'))
    expect(resultado.ok).toBe(true)
    expect(await listRoots(db, '')).toHaveLength(2)
  })

  it('recusa pasta que não existe', async () => {
    const resultado = await addRoot(db, join(base, 'nao-existe'))
    expect(resultado).toMatchObject({ ok: false })
  })

  it('recusa a mesma pasta duas vezes', async () => {
    const raiz = pasta('midia')
    await listRoots(db, raiz)
    expect(await addRoot(db, raiz)).toMatchObject({ ok: false })
  })

  it('recusa pasta dentro de outra que já está', async () => {
    // Seria varrida duas vezes, e o mesmo arquivo apareceria duas vezes no
    // explorador.
    await listRoots(db, pasta('midia'))
    expect(await addRoot(db, pasta('midia', 'vinhetas'))).toMatchObject({ ok: false })
  })

  it('recusa pasta que engloba uma que já está', async () => {
    await listRoots(db, pasta('midia', 'vinhetas'))
    expect(await addRoot(db, join(base, 'midia'))).toMatchObject({ ok: false })
  })

  it('tira uma pasta, mas nunca a última', async () => {
    const raiz = pasta('midia')
    await listRoots(db, raiz)
    const extra = await addRoot(db, pasta('comerciais'))
    expect(extra.ok).toBe(true)
    if (!extra.ok) return

    expect(await removeRoot(db, extra.root.id)).toBe(true)
    const sobrou = await listRoots(db, '')
    expect(sobrou).toHaveLength(1)
    // Sem pasta nenhuma o acervo fica sem lugar para procurar, e a interface
    // sem como voltar atrás a não ser digitando um caminho do nada.
    expect(await removeRoot(db, sobrou[0]!.id)).toBe(false)
  })

  it('pasta que sumiu do disco aparece marcada, não some da lista', async () => {
    const raiz = pasta('rede')
    await listRoots(db, raiz)
    rmSync(raiz, { recursive: true, force: true })
    const pastas = await listRoots(db, '')
    expect(pastas[0]?.present).toBe(false)
  })
})
