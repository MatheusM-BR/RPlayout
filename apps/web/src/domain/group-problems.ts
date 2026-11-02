/** Problemas iguais com objetos diferentes ("Vinheta: o arquivo não está mais
 * na pasta", "Promo: o arquivo não está…") viram um grupo só, na ordem da 1ª
 * ocorrência. Antes 12 arquivos ausentes eram 12 cartões. */
export interface ProblemLike { id: string | number; origem: string; texto: string; quando: string }
export interface ProblemGroup<T extends ProblemLike> { key: string; origem: string; motivo: string; itens: T[]; sujeitos: string[] }

export function groupProblems<T extends ProblemLike>(problems: readonly T[]): Array<ProblemGroup<T>> {
  const groups = new Map<string, ProblemGroup<T>>()
  for (const problem of problems) {
    const split = problem.texto.indexOf(': ')
    const subject = split > 0 ? problem.texto.slice(0, split) : ''
    const reason = split > 0 ? problem.texto.slice(split + 2) : problem.texto
    const key = `${problem.origem}\u0000${reason}`
    const group = groups.get(key) ?? { key, origem: problem.origem, motivo: reason, itens: [], sujeitos: [] }
    group.itens.push(problem)
    if (subject && !group.sujeitos.includes(subject)) group.sujeitos.push(subject)
    groups.set(key, group)
  }
  return [...groups.values()]
}
