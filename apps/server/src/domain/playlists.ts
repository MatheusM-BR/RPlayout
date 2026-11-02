import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, extname, join, resolve } from 'node:path'
import { baseName, dateInName, parseM3u, samePath, type MediaAsset } from '@rplayout/protocol'

/** Uma lista de reprodução encontrada na pasta do acervo. */
export interface PlaylistFile {
  /** Caminho absoluto do arquivo. */
  readonly path: string
  /** Nome sem a extensão, que é como o operador chama a lista. */
  readonly name: string
  /** Dia a que a lista pertence, lido do nome. Nulo quando o nome não diz. */
  readonly date: string | null
  readonly entries: number
  /** Quantas entradas acharam arquivo no acervo. */
  readonly matched: number
  readonly modifiedAt: string
}

/** Uma entrada da lista já confrontada com o acervo. */
export interface ResolvedEntry {
  readonly ref: string
  readonly title: string | null
  readonly seconds: number | null
  /** Id do arquivo no acervo, ou nulo quando não achou. */
  readonly mediaId: string | null
  /** Como foi encontrado: pelo caminho inteiro ou só pelo nome do arquivo. */
  readonly matchedBy: 'path' | 'name' | null
}

const EXT = new Set(['.m3u', '.m3u8'])

/**
 * Lê o arquivo respeitando a codificação que ele tiver.
 *
 * Programa de automação do Windows grava em ANSI com a mesma naturalidade com
 * que grava em UTF-8, e "PROGRAMAÇÃO" lido com a tabela errada vira
 * "PROGRAMAÃÃO". O caractere de substituição é a prova de que a leitura em
 * UTF-8 falhou -- ele não aparece em texto que foi mesmo escrito em UTF-8.
 */
async function readText(path: string): Promise<string> {
  const bytes = await readFile(path)
  const utf8 = bytes.toString('utf8')
  return utf8.includes('�') ? bytes.toString('latin1') : utf8
}

/** Procura listas de reprodução na árvore do acervo. */
export async function findPlaylists(root: string): Promise<string[]> {
  const found: string[] = []
  const pending = [resolve(root)]

  while (pending.length > 0) {
    const dir = pending.pop()
    if (dir === undefined) break

    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) pending.push(full)
      else if (entry.isFile() && EXT.has(extname(entry.name).toLowerCase())) found.push(full)
    }
  }

  return found.sort()
}

/**
 * Confronta as entradas da lista com o acervo.
 *
 * Duas formas de casar, nesta ordem. O caminho inteiro é o certo quando a
 * lista foi escrita na mesma máquina. O nome do arquivo é o que salva quando
 * não foi: lista feita numa estação de edição traz caminho de rede ou outra
 * letra de unidade, e recusar por isso obrigaria a reescrever a lista inteira
 * para trocar um `D:` por um `E:`.
 */
export function resolveEntries(
  text: string,
  assets: readonly MediaAsset[],
): ResolvedEntry[] {
  const porNome = new Map<string, MediaAsset>()
  for (const asset of assets) {
    const nome = baseName(asset.path).toLowerCase()
    // O primeiro ganha: com dois arquivos de mesmo nome em pastas diferentes,
    // escolher em silêncio o segundo seria pior do que escolher o primeiro.
    if (!porNome.has(nome)) porNome.set(nome, asset)
  }

  return parseM3u(text).map((entrada) => {
    const porCaminho = assets.find((asset) => samePath(asset.path, entrada.ref))
    if (porCaminho) {
      return { ...entrada, mediaId: porCaminho.id, matchedBy: 'path' as const }
    }
    const achado = porNome.get(baseName(entrada.ref).toLowerCase())
    return {
      ...entrada,
      mediaId: achado?.id ?? null,
      matchedBy: achado ? ('name' as const) : null,
    }
  })
}

/** Descreve uma lista: quantas entradas tem e quantas o acervo conhece. */
export async function describe(
  path: string,
  assets: readonly MediaAsset[],
): Promise<PlaylistFile | null> {
  let info
  try {
    info = await stat(path)
  } catch {
    return null
  }

  const entradas = resolveEntries(await readText(path), assets)
  const nome = basename(path, extname(path))
  return {
    path,
    name: nome,
    date: dateInName(nome),
    entries: entradas.length,
    matched: entradas.filter((entrada) => entrada.mediaId !== null).length,
    modifiedAt: info.mtime.toISOString(),
  }
}

/** As entradas de uma lista, já confrontadas com o acervo. */
export async function entriesOf(
  path: string,
  assets: readonly MediaAsset[],
): Promise<ResolvedEntry[]> {
  return resolveEntries(await readText(path), assets)
}

/**
 * A lista do dia, entre as encontradas.
 *
 * O modelo é o do operador: uma lista por dia, com a data no nome. A do dia é
 * a que tem a data de hoje; não havendo, não há lista do dia -- adivinhar
 * "a mais recente" poria a programação de ontem no ar hoje, que é exatamente
 * o erro que a data no nome existe para evitar.
 */
export function playlistOfDay(listas: readonly PlaylistFile[], iso: string): PlaylistFile | null {
  return listas.find((lista) => lista.date === iso) ?? null
}
