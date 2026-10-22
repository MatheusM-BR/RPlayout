import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type Db } from '../db/client.js'
import { addRoot, browseServerFolders, contem, dentroDasPastas, labelFor, listRoots, initializeRoots, recordingTarget, removeRoot } from './roots.js'

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

describe('destino remoto de gravação', () => {
  it('preserva Unicode e apenas resolve o caminho, sem criar arquivo', () => {
    const folder = pasta('Ação — Prévia')
    const path = join(folder, 'Ópera — edição.mkv')
    expect(recordingTarget(folder, 'Ópera — edição.mkv')).toEqual({ ok: true, path })
    expect(existsSync(path)).toBe(false)
  })
  it.each(['../fora.mkv', '..\\fora.mkv', 'C:fora.mkv', 'CON.mkv', 'LPT1.mkv', 'teste.mp4', 'nome?.mkv', 'nome.mkv ', ' nome.mkv', 'a\u0000.mkv'])('recusa nome inválido %j', filename => {
    expect(recordingTarget(base, filename)).toMatchObject({ ok: false, status: 400 })
  })
  it('recusa arquivo existente sem modificar seu conteúdo', () => {
    writeFileSync(join(base, 'original.mkv'), 'original')
    expect(recordingTarget(base, 'original.mkv')).toMatchObject({ ok: false, status: 409 })
  })
  it('recusa pasta inexistente e arquivo usado como pasta', () => {
    expect(recordingTarget(join(base, 'sumiu'), 'novo.mkv')).toMatchObject({ ok: false, status: 400 })
    writeFileSync(join(base, 'arquivo'), '')
    expect(recordingTarget(join(base, 'arquivo'), 'novo.mkv')).toMatchObject({ ok: false, status: 400 })
  })
})

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
  it('navega as subpastas pelo servidor sem abrir interface nativa', async () => {
    const raiz = pasta('servidor')
    pasta('servidor', 'Comerciais')
    pasta('servidor', 'Programação')
    const browser = await browseServerFolders(raiz)
    expect(browser.path).toBe(resolve(raiz))
    expect(browser.directories.map((folder) => folder.name)).toEqual(['Comerciais', 'Programação'])
  })

  it('banco vazio nasce com a pasta da variável de ambiente', async () => {
    // Quem já usava o sistema não pode perder o acervo por causa desta tabela.
    const raiz = pasta('midia')
    const pastas = await initializeRoots(db, raiz)
    expect(pastas.map((entrada) => entrada.path)).toEqual([resolve(raiz)])
  })

  it('acrescenta uma segunda pasta', async () => {
    await initializeRoots(db, pasta('midia'))
    const resultado = await addRoot(db, pasta('comerciais'))
    expect(resultado.ok).toBe(true)
    expect(await listRoots(db, '')).toHaveLength(2)
  })

  it('preserva letras acentuadas no caminho que será validado pelo servidor', async () => {
    const raiz = pasta('Programação', 'Ação & Ópera')
    const resultado = await addRoot(db, raiz)
    expect(resultado).toMatchObject({ ok: true })
    if (resultado.ok) expect(resultado.root.path).toBe(resolve(raiz))
  })

  it('recusa pasta que não existe', async () => {
    const resultado = await addRoot(db, join(base, 'nao-existe'))
    expect(resultado).toMatchObject({ ok: false })
  })

  it('recusa a mesma pasta duas vezes', async () => {
    const raiz = pasta('midia')
    await initializeRoots(db, raiz)
    expect(await addRoot(db, raiz)).toMatchObject({ ok: false })
  })

  it('recusa pasta dentro de outra que já está', async () => {
    // Seria varrida duas vezes, e o mesmo arquivo apareceria duas vezes no
    // explorador.
    await initializeRoots(db, pasta('midia'))
    expect(await addRoot(db, pasta('midia', 'vinhetas'))).toMatchObject({ ok: false })
  })

  it('recusa pasta que engloba uma que já está', async () => {
    await initializeRoots(db, pasta('midia', 'vinhetas'))
    expect(await addRoot(db, join(base, 'midia'))).toMatchObject({ ok: false })
  })

  it('tira uma pasta, mas nunca a última', async () => {
    const raiz = pasta('midia')
    await initializeRoots(db, raiz)
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
    await initializeRoots(db, raiz)
    rmSync(raiz, { recursive: true, force: true })
    const pastas = await listRoots(db, '')
    expect(pastas[0]?.present).toBe(false)
  })
})
