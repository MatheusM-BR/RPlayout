/**
 * Listas de reprodução em M3U.
 *
 * É o formato que a programação chega de fora: o operador monta a grade do dia
 * num programa de playlist e salva um `.m3u` na pasta, um por dia. Ler esse
 * arquivo é mais barato -- e muito menos sujeito a erro -- do que remontar a
 * mesma sequência à mão na grade.
 *
 * O formato não tem norma escrita; o que existe é o que os programas fazem.
 * Este interpretador aceita as três formas que aparecem na prática: a simples
 * (um caminho por linha), a estendida (`#EXTM3U` com `#EXTINF`), e a mistura
 * das duas, que é o que sai da maioria dos programas de automação.
 */

/** Uma entrada da lista, ainda sem ligação com o acervo. */
export interface PlaylistEntry {
  /** O caminho exatamente como está escrito no arquivo. */
  readonly ref: string
  /** Título declarado no `#EXTINF`, quando há. */
  readonly title: string | null
  /**
   * Duração declarada em segundos, quando há.
   *
   * Nulo quando a lista não diz ou diz `-1`, que é como o formato escreve
   * "não sei" -- e é o caso de toda entrada ao vivo.
   */
  readonly seconds: number | null
}

/**
 * Lê uma lista M3U.
 *
 * Linha que começa com `#` é diretiva. Só `#EXTINF` interessa: ela vem antes
 * do caminho e traz duração e título. As outras (`#EXTM3U`, `#EXTVLCOPT`,
 * `#EXTGRP`) são ignoradas de propósito -- inventar significado para diretiva
 * que não se entende é como um dia se toca a coisa errada no ar.
 */
export function parseM3u(text: string): PlaylistEntry[] {
  const entries: PlaylistEntry[] = []
  // Alguns programas gravam com marca de ordem de byte. Ela não é conteúdo.
  const limpo = text.replace(/^\uFEFF/, '')

  let title: string | null = null
  let seconds: number | null = null

  for (const bruta of limpo.split(/\r?\n/)) {
    const linha = bruta.trim()
    if (linha === '') continue

    if (linha.startsWith('#')) {
      const info = /^#EXTINF:\s*(-?\d+(?:\.\d+)?)\s*(?:,(.*))?$/i.exec(linha)
      if (info) {
        const declarada = Number(info[1])
        // `-1` é como o formato escreve "não sei": é o caso de todo ao vivo.
        seconds = Number.isFinite(declarada) && declarada > 0 ? declarada : null
        const nome = (info[2] ?? '').trim()
        title = nome === '' ? null : nome
      }
      continue
    }

    entries.push({ ref: linha, title, seconds })
    // O `#EXTINF` vale para a linha seguinte e só para ela.
    title = null
    seconds = null
  }

  return entries
}

/**
 * A data escrita no nome do arquivo, em ISO, ou nulo.
 *
 * É o que permite a lista do dia se apresentar sozinha: o operador salva
 * "Playlist Programação 08-02-2026.m3u" e o sistema sabe a que dia ela
 * pertence sem ninguém dizer.
 *
 * Dia antes de mês, que é como se escreve data aqui. Quando o primeiro número
 * passa de doze a ordem é inequívoca e vale o que ele diz; quando não passa, a
 * convenção brasileira decide -- e é por isso que o formato ISO, quando
 * aparece, é reconhecido primeiro: ele não tem ambiguidade nenhuma.
 */
export function dateInName(name: string): string | null {
  // ISO primeiro: 2026-02-08. Não há o que interpretar.
  const iso = /(\d{4})[-_.](\d{1,2})[-_.](\d{1,2})/.exec(name)
  if (iso) return montar(Number(iso[1]), Number(iso[2]), Number(iso[3]))

  const local = /(\d{1,2})[-_./](\d{1,2})[-_./](\d{4})/.exec(name)
  if (!local) return null

  const primeiro = Number(local[1])
  const segundo = Number(local[2])
  const ano = Number(local[3])

  // Segundo número acima de doze só pode ser dia, e aí a ordem é mês-dia --
  // é o que sai de programa configurado em inglês. Fora esse caso vale a
  // convenção daqui: dia antes de mês.
  return segundo > 12 && primeiro <= 12
    ? montar(ano, primeiro, segundo)
    : montar(ano, segundo, primeiro)
}

function montar(ano: number, mes: number, dia: number): string | null {
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null
  const data = new Date(Date.UTC(ano, mes - 1, dia))
  // Rejeita 31 de fevereiro e afins: a data rolaria para março em silêncio.
  if (data.getUTCMonth() !== mes - 1 || data.getUTCDate() !== dia) return null
  return `${ano.toString().padStart(4, '0')}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
}

/**
 * Só o nome do arquivo, sem pasta, venha o caminho de Windows ou de Unix.
 *
 * Lista escrita no Windows traz `\` e às vezes caminho absoluto de outra
 * máquina; casar por nome de arquivo é o que faz a mesma lista servir quando o
 * acervo mudou de letra de unidade.
 */
export function baseName(ref: string): string {
  const partes = ref.replace(/\\/g, '/').split('/')
  return partes[partes.length - 1] ?? ref
}

/** Compara caminhos ignorando barra, maiúscula e barra final. */
export function samePath(a: string, b: string): boolean {
  const normal = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  return normal(a) === normal(b)
}
