/** Mensagem do servidor/engine sem frase repetida (B11: "PGM anterior
 * preservado; PGM anterior preservado"). Mantém a ordem da primeira vez. */
export function dedupeNotice(text: string | null | undefined): string {
  const out: string[] = [], seen = new Set<string>()
  for (const sentence of (text ?? '').split(/(?<=[.;])\s+/)) {
    const clean = sentence.trim()
    const key = clean.replace(/[.;\s]+$/, '').toLocaleLowerCase('pt-BR')
    if (!key || seen.has(key)) continue
    seen.add(key); out.push(clean)
  }
  return out.join(' ').replace(/;$/, '.')
}
