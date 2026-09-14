import { describe, expect, it } from 'vitest'
import { baseName, dateInName, parseM3u, samePath } from './playlist.js'

describe('parseM3u', () => {
  it('lê a forma simples: um caminho por linha', () => {
    const lista = parseM3u('C:\\VT\\abertura.mp4\nC:\\VT\\materia.mp4\n')
    expect(lista.map((e) => e.ref)).toEqual(['C:\\VT\\abertura.mp4', 'C:\\VT\\materia.mp4'])
    expect(lista[0]?.title).toBeNull()
  })

  it('lê a forma estendida, com duração e título', () => {
    const lista = parseM3u(
      ['#EXTM3U', '#EXTINF:325,Leilão Nelore JMP 2025', 'D:\\Programas\\leilao.mp4'].join('\n'),
    )
    expect(lista).toHaveLength(1)
    expect(lista[0]).toEqual({
      ref: 'D:\\Programas\\leilao.mp4',
      title: 'Leilão Nelore JMP 2025',
      seconds: 325,
    })
  })

  /**
   * `-1` é como o formato escreve "não sei" -- é o caso de toda entrada ao
   * vivo. Aceitar isso como duração poria um número negativo na grade.
   */
  it('trata duração -1 como desconhecida', () => {
    const lista = parseM3u('#EXTINF:-1,Estúdio ao vivo\nsdi://1\n')
    expect(lista[0]?.seconds).toBeNull()
    expect(lista[0]?.title).toBe('Estúdio ao vivo')
  })

  /** O `#EXTINF` vale para a linha seguinte e só para ela. */
  it('não vaza o título de uma entrada para a próxima', () => {
    const lista = parseM3u('#EXTINF:10,Com título\na.mp4\nb.mp4\n')
    expect(lista[0]?.title).toBe('Com título')
    expect(lista[1]?.title).toBeNull()
  })

  it('ignora diretivas que não entende, em vez de inventar significado', () => {
    const lista = parseM3u(
      ['#EXTM3U', '#EXTVLCOPT:no-audio', '#EXTGRP:Comerciais', 'x.mp4'].join('\n'),
    )
    expect(lista.map((e) => e.ref)).toEqual(['x.mp4'])
  })

  it('aguenta fim de linha do Windows, linha vazia e marca de ordem de byte', () => {
    const lista = parseM3u('\ufeff#EXTM3U\r\n\r\nA.mp4\r\n\r\nB.mp4\r\n')
    expect(lista.map((e) => e.ref)).toEqual(['A.mp4', 'B.mp4'])
  })

  it('lista vazia não é erro', () => {
    expect(parseM3u('#EXTM3U\n')).toEqual([])
  })
})

describe('dateInName', () => {
  /** O caso do operador: "Playlist Programação 08-02-2026.m3u". */
  it('lê dia-mês-ano, que é como se escreve data aqui', () => {
    expect(dateInName('Playlist Programação 08-02-2026.m3u')).toBe('2026-02-08')
  })

  it('ISO não tem ambiguidade e vem primeiro', () => {
    expect(dateInName('grade 2026-02-08.m3u')).toBe('2026-02-08')
  })

  it('primeiro número acima de doze só pode ser dia', () => {
    expect(dateInName('25-12-2026.m3u')).toBe('2026-12-25')
  })

  /** Programa configurado em inglês escreve mês-dia; o segundo número entrega. */
  it('segundo número acima de doze quer dizer mês-dia', () => {
    expect(dateInName('02-25-2026.m3u')).toBe('2026-02-25')
  })

  it('aceita ponto e sublinhado como separador', () => {
    expect(dateInName('grade 08.02.2026.m3u')).toBe('2026-02-08')
    expect(dateInName('grade 08_02_2026.m3u')).toBe('2026-02-08')
  })

  it('recusa data que não existe em vez de rolar para o mês seguinte', () => {
    expect(dateInName('31-02-2026.m3u')).toBeNull()
  })

  it('nome sem data devolve nulo', () => {
    expect(dateInName('AGROSHOP 24H.m3u')).toBeNull()
  })
})

describe('caminhos', () => {
  it('tira a pasta, venha de Windows ou de Unix', () => {
    expect(baseName('C:\\Users\\Workstation\\Desktop\\1 PROGRAMAÇÃO\\a.mp4')).toBe('a.mp4')
    expect(baseName('/home/vt/a.mp4')).toBe('a.mp4')
    expect(baseName('a.mp4')).toBe('a.mp4')
  })

  /** A mesma lista tem que servir quando o acervo muda de letra de unidade. */
  it('compara caminho ignorando barra e maiúscula', () => {
    expect(samePath('C:\\VT\\A.MP4', 'c:/vt/a.mp4')).toBe(true)
    expect(samePath('C:/VT/a.mp4', 'C:/VT/b.mp4')).toBe(false)
  })
})
