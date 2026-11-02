/** Trechos que se repetem em sequência (grade em loop expandida): a mesma
 * sequência de `period` itens repetida `repeats` vezes a partir de `start`.
 * Mostrar 1.567 linhas de um loop de 4 esconde o que importa na grade. */
export interface RepeatRun { start: number; period: number; repeats: number }

export function findRepeatRuns(keys: readonly string[], maxPeriod = 12, minRepeats = 3): RepeatRun[] {
  const runs: RepeatRun[] = []
  let i = 0
  while (i < keys.length) {
    let best: RepeatRun | null = null
    for (let period = 1; period <= maxPeriod && i + period * minRepeats <= keys.length; period++) {
      let repeats = 1
      while (i + (repeats + 1) * period <= keys.length) {
        let same = true
        for (let k = 0; k < period; k++) if (keys[i + k] !== keys[i + repeats * period + k]) { same = false; break }
        if (!same) break
        repeats++
      }
      if (repeats >= minRepeats && (!best || repeats * period > best.repeats * best.period)) best = { start: i, period, repeats }
    }
    if (best) { runs.push(best); i += best.period * best.repeats } else i++
  }
  return runs
}

/** Índices visíveis quando as repetições estão recolhidas: o primeiro ciclo de
 * cada trecho fica, o resto vira uma linha de resumo depois dele. */
export function collapsedRows(total: number, runs: readonly RepeatRun[]): Array<{ index: number } | { summary: RepeatRun; hidden: number; lastIndex: number }> {
  const rows: Array<{ index: number } | { summary: RepeatRun; hidden: number; lastIndex: number }> = []
  let i = 0, r = 0
  while (i < total) {
    const run = runs[r]
    if (run && run.start === i) {
      for (let k = 0; k < run.period; k++) rows.push({ index: i + k })
      const end = run.start + run.period * run.repeats
      rows.push({ summary: run, hidden: end - (i + run.period), lastIndex: end - 1 })
      i = end; r++
    } else { rows.push({ index: i }); i++ }
  }
  return rows
}
