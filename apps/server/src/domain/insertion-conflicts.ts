/** Conflitos que a inserção operacional CAUSA ou TOCA. A conferência listava
 * todos os conflitos da grade (B11: "A âncora de 04:10:00 já passou" ao
 * inserir um VT sem relação com ela). Fica o que envolve o item inserido ou
 * que não existia antes da inserção. */
export interface ConflictLike { readonly kind: string; readonly itemId: string; readonly message: string }
export function insertionConflicts<T extends ConflictLike>(before: readonly ConflictLike[], after: readonly T[], insertedItemId: string): T[] {
  const known = new Set(before.map(conflict => `${conflict.kind}\u0000${conflict.itemId}`))
  const seen = new Set<string>()
  return after.filter(conflict => {
    const key = `${conflict.kind}\u0000${conflict.itemId}\u0000${conflict.message}`
    if (seen.has(key)) return false
    seen.add(key)
    return conflict.itemId === insertedItemId || !known.has(`${conflict.kind}\u0000${conflict.itemId}`)
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
