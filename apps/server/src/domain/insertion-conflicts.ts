/** Conflitos que a inserção operacional CAUSA, TOCA ou PIORA. A conferência
 * listava todos os conflitos da grade (B11: "A âncora de 04:10:00 já passou" ao
 * inserir um VT sem relação com ela). Fica o que envolve o item inserido, o que
 * não existia antes e o que já existia mas a inserção agravou (mesmo tipo e
 * item, com atraso maior em frames ou severidade maior; sem tamanho, mensagem
 * diferente). Conflito igual ou menor que antes não aparece. */
export interface ConflictLike { readonly kind: string; readonly itemId: string; readonly message: string; readonly frames?: number; readonly severity?: string }
const severityRank = (severity: string | undefined) => severity === 'ERROR' ? 2 : severity === 'WARN' ? 1 : 0
function worsened(previous: readonly ConflictLike[], conflict: ConflictLike): boolean {
  if (previous.some(old => old.message === conflict.message && old.frames === conflict.frames && severityRank(old.severity) >= severityRank(conflict.severity))) return false
  if (typeof conflict.frames === 'number' && previous.every(old => typeof old.frames === 'number'))
    return previous.every(old => conflict.frames! > old.frames! || severityRank(conflict.severity) > severityRank(old.severity))
  return previous.every(old => old.message !== conflict.message)
}
export function insertionConflicts<T extends ConflictLike>(before: readonly ConflictLike[], after: readonly T[], insertedItemId: string): T[] {
  const known = new Map<string, ConflictLike[]>()
  for (const conflict of before) { const key = `${conflict.kind}\u0000${conflict.itemId}`; known.set(key, [...(known.get(key) ?? []), conflict]) }
  const seen = new Set<string>()
  return after.filter(conflict => {
    const key = `${conflict.kind}\u0000${conflict.itemId}\u0000${conflict.message}`
    if (seen.has(key)) return false
    seen.add(key)
    if (conflict.itemId === insertedItemId) return true
    const previous = known.get(`${conflict.kind}\u0000${conflict.itemId}`)
    return !previous || worsened(previous, conflict)
  })
}

/** Junta prefixo e detalhe sem repetir a mesma frase (B11: "PGM anterior
 * preservado; PGM anterior preservado"). Compara frases sem pontuação final. */
export function joinNotice(...parts: Array<string | null | undefined>): string {
  const out: string[] = [], seen = new Set<string>()
  for (const part of parts) for (const sentence of (part ?? '').split(/(?<=[.;])\s+/)) {
    const clean = sentence.trim()
    const key = clean.replace(/[.;\s]+$/, '').toLocaleLowerCase('pt-BR')
    if (!key || seen.has(key)) continue
    seen.add(key); out.push(clean)
  }
  return out.join(' ').replace(/;$/, '.')
}
