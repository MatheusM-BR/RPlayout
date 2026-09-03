import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type Db } from '../db/client.js'
import { mediaAssets } from '../db/schema.js'
import { Ingest } from './ingest.js'

let db: Db
let pasta: string
let ingest: Ingest

beforeEach(() => {
  db = openDatabase(':memory:').db
  pasta = mkdtempSync(join(tmpdir(), 'rplayout-ingest-'))
  // Sonda que sempre falha: este teste é sobre o arquivo **entrar** no acervo,
  // não sobre o que a sonda lê dele. Falhando, ele entra com o motivo à vista,
  // que já basta para distinguir "entrou" de "foi pulado".
  ingest = new Ingest(db, '/bin/false', join(pasta, '.thumbs'))
  ingest.measure = false
})

afterEach(() => {
  rmSync(pasta, { recursive: true, force: true })
})

async function esperarFim(limiteMs = 60_000): Promise<void> {
  const fim = Date.now() + limiteMs
  while (Date.now() < fim) {
    if (!ingest.status().running) return
    await new Promise((pronto) => setTimeout(pronto, 250))
  }
  throw new Error('a varredura não terminou')
}

describe('varredura', () => {
  it('acha o arquivo recém-copiado na mesma procura', async () => {
    // Este é o defeito relatado: copiar um arquivo, mandar procurar na mesma
    // hora, e a procura terminar dizendo que não achou nada -- com o arquivo
    // ali na pasta. Ele era pulado por estar "ainda mudando" e ficava para uma
    // próxima varredura que ninguém dispara.
    writeFileSync(join(pasta, 'recem-copiado.mkv'), 'x'.repeat(1024))
    expect(ingest.start(pasta)).toBe(true)
    await esperarFim()

    const linhas = await db.select().from(mediaAssets)
    expect(linhas.map((linha) => linha.path)).toEqual([join(pasta, 'recem-copiado.mkv')])
    // Entrou. Com a sonda falhando ele conta como falho, não como novo -- o
    // que importa aqui é que ele não foi pulado em silêncio.
    expect(ingest.status().skipped).toBe(0)
    expect(ingest.status().failed).toBe(1)
  }, 70_000)

  it('varre mais de uma pasta numa procura só', async () => {
    const outra = mkdtempSync(join(tmpdir(), 'rplayout-ingest2-'))
    try {
      writeFileSync(join(pasta, 'a.mkv'), 'x'.repeat(1024))
      writeFileSync(join(outra, 'b.mkv'), 'x'.repeat(1024))
      expect(ingest.start([pasta, outra])).toBe(true)
      await esperarFim()

      const caminhos = (await db.select().from(mediaAssets)).map((linha) => linha.path).sort()
      expect(caminhos).toEqual([join(pasta, 'a.mkv'), join(outra, 'b.mkv')].sort())
    } finally {
      rmSync(outra, { recursive: true, force: true })
    }
  }, 70_000)

  it('varrer uma pasta não marca o acervo da outra como sumido', async () => {
    // Com uma pasta só isto nunca aparecia. Com duas, varrer a pasta nova
    // marcaria tudo da antiga como "não está mais na pasta" -- o acervo
    // inteiro condenado por uma procura que nem olhou para ele.
    const outra = mkdtempSync(join(tmpdir(), 'rplayout-ingest3-'))
    try {
      writeFileSync(join(pasta, 'a.mkv'), 'x'.repeat(1024))
      writeFileSync(join(outra, 'b.mkv'), 'x'.repeat(1024))
      ingest.start([pasta, outra])
      await esperarFim()

      ingest.start([outra])
      await esperarFim()

      const linhas = await db.select().from(mediaAssets)
      const a = linhas.find((linha) => linha.path.endsWith('a.mkv'))
      expect(a?.probeError).not.toBe('o arquivo não está mais na pasta')
    } finally {
      rmSync(outra, { recursive: true, force: true })
    }
  }, 120_000)

  it('marca como sumido o que saiu de uma pasta que foi varrida', async () => {
    const arquivo = join(pasta, 'some.mkv')
    writeFileSync(arquivo, 'x'.repeat(1024))
    ingest.start(pasta)
    await esperarFim()

    rmSync(arquivo)
    ingest.start(pasta)
    await esperarFim()

    const [linha] = await db.select().from(mediaAssets)
    expect(linha?.probeError).toBe('o arquivo não está mais na pasta')
  }, 120_000)
})
