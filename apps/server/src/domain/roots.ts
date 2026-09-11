import { randomUUID } from 'node:crypto'
import { basename, resolve, sep } from 'node:path'
import { existsSync, statSync } from 'node:fs'
import { eq } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { mediaRoots } from '../db/schema.js'

export interface MediaRoot {
  readonly id: string
  readonly path: string
  readonly label: string
  /** A pasta existe agora? Uma unidade de rede desconectada some sem avisar. */
  readonly present: boolean
}

/** Nome curto de uma pasta, para quando o operador não escolher um. */
export function labelFor(path: string): string {
  const limpo = resolve(path)
  return basename(limpo) || limpo
}

/**
 * As pastas do acervo, sempre com pelo menos uma.
 *
 * A primeira vez que o servidor sobe num banco antigo, a pasta que estava na
 * variável de ambiente vira a primeira linha: quem já usava o sistema não
 * perde o acervo por causa desta mudança, e quem está começando também não
 * fica com o acervo vazio e sem lugar para procurar.
 */
export async function listRoots(db: Db, fallback: string): Promise<MediaRoot[]> {
  const rows = await db.select().from(mediaRoots)
  if (rows.length === 0 && fallback !== '') {
    const semente = {
      id: randomUUID(),
      path: resolve(fallback),
      label: labelFor(fallback),
      createdAt: new Date().toISOString(),
    }
    await db.insert(mediaRoots).values(semente)
    return [{ ...semente, present: existe(semente.path) }]
  }
  return rows
    .map((row) => ({ id: row.id, path: row.path, label: row.label, present: existe(row.path) }))
    .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'))
}

/** Acrescenta uma pasta. Devolve o motivo quando não dá. */
export async function addRoot(
  db: Db,
  path: string,
  label?: string,
): Promise<{ ok: true; root: MediaRoot } | { ok: false; error: string }> {
  const limpo = resolve(path.trim())
  if (path.trim() === '') return { ok: false, error: 'Diga o caminho da pasta.' }
  if (!existsSync(limpo)) return { ok: false, error: `Não achei a pasta ${limpo}.` }
  if (!statSync(limpo).isDirectory()) return { ok: false, error: `${limpo} não é uma pasta.` }

  const atuais = await db.select().from(mediaRoots)
  if (atuais.some((row) => row.path === limpo)) {
    return { ok: false, error: 'Essa pasta já está no acervo.' }
  }
  // Pasta dentro de outra seria varrida duas vezes, e o mesmo arquivo entraria
  // duas vezes no explorador. O contrário -- uma pasta que engloba as que já
  // estão -- tem o mesmo defeito, e por isso os dois lados são recusados.
  const dentro = atuais.find((row) => contem(row.path, limpo) || contem(limpo, row.path))
  if (dentro) {
    return { ok: false, error: `Essa pasta se sobrepõe a ${dentro.path}, que já está no acervo.` }
  }

  const nova = {
    id: randomUUID(),
    path: limpo,
    label: (label ?? '').trim() || labelFor(limpo),
    createdAt: new Date().toISOString(),
  }
  await db.insert(mediaRoots).values(nova)
  return { ok: true, root: { ...nova, present: true } }
}

/**
 * Tira uma pasta da lista.
 *
 * O acervo dela não é apagado: uma grade que aponta para um arquivo dessa
 * pasta continuaria apontando, e apagar a linha faria a grade perder a
 * referência sem explicação. Some da procura, continua tocando.
 */
export async function removeRoot(db: Db, id: string): Promise<boolean> {
  const rows = await db.select().from(mediaRoots)
  if (!rows.some((row) => row.id === id)) return false
  // Ficar sem nenhuma pasta deixaria o acervo sem lugar para procurar, e a
  // interface sem como voltar atrás a não ser digitando um caminho do nada.
  if (rows.length === 1) return false
  await db.delete(mediaRoots).where(eq(mediaRoots.id, id))
  return true
}

/** `alvo` está dentro de `raiz`? Compara caminhos já resolvidos. */
export function contem(raiz: string, alvo: string): boolean {
  const a = resolve(raiz)
  const b = resolve(alvo)
  return b === a || b.startsWith(a + sep)
}

/** O caminho está dentro de alguma das pastas do acervo? */
export function dentroDasPastas(roots: readonly { path: string }[], alvo: string): boolean {
  return roots.some((root) => contem(root.path, alvo))
}

function existe(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}
