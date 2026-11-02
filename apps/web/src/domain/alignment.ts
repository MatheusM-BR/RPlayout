/** Alinhamento de horário até um item em foco: quanto sobra ou falta e quais
 * ajustes chegam mais perto. Tudo em ms; a tela converte de/para quadros. */

export const ALIGN_TOLERANCE_MS = 1000

export interface FocusInput {
  focusItemId: string
  /** Itens na ordem da grade no ar, com início/fim resolvidos (ms de parede). */
  rows: ReadonlyArray<{ id: string; title: string; startMs: number; endMs: number; dropped?: boolean; anchor: { kind: string; at?: number }
    /** Quanto o agendador já mexeu neste item para bater horários (ms):
     * previsto − executado; item pulado conta a duração inteira. */
    autoAdjustMs?: number }>
  /** Horário fixo do item (âncora) em ms de parede, ou alvo digitado pelo operador. */
  anchorMs: number | null
  operatorTargetMs: number | null
  nowMs: number
}
export interface FocusStatus {
  title: string; startMs: number; leftMs: number
  /** Quando a grade chegaria ao foco sem compensação automática. */
  arrivalMs: number | null
  /** Chegada no plano já compensado (o que o motor fará se ninguém alinhar). */
  scheduledArrivalMs: number | null
  /** Positivo: o agendador corta/pula esse tempo sozinho (corte seco) antes do foco. */
  autoCutMs: number
  targetMs: number | null
  /** alvo − chegada: positivo sobra tempo (preencher), negativo falta (cortar). */
  diffMs: number | null
  mode: 'FILL' | 'CUT' | 'OK' | null
  fixed: boolean
}

export function focusStatus(input: FocusInput): FocusStatus | null {
  const rows = input.rows.filter(row => !row.dropped)
  const index = rows.findIndex(row => row.id === input.focusItemId)
  if (index < 0) return null
  const row = rows[index]!
  const fixed = row.anchor.kind === 'FIXED' || row.anchor.kind === 'HARD_TIME'
  const scheduledArrivalMs = index > 0 ? rows[index - 1]!.endMs : null
  // O que ainda vai rodar antes do foco (pulados incluídos): ajustes do agendador.
  const autoCutMs = input.rows.filter(entry => entry.id !== row.id && input.rows.indexOf(entry) < input.rows.findIndex(other => other.id === row.id) && (entry.dropped || entry.endMs > input.nowMs)).reduce((sum, entry) => sum + (entry.autoAdjustMs ?? 0), 0)
  const arrivalMs = scheduledArrivalMs === null ? null : scheduledArrivalMs + autoCutMs
  const targetMs = fixed ? input.anchorMs : input.operatorTargetMs
  const diffMs = targetMs !== null && arrivalMs !== null ? targetMs - arrivalMs : null
  const mode = diffMs === null ? null : Math.abs(diffMs) <= ALIGN_TOLERANCE_MS ? 'OK' : diffMs > 0 ? 'FILL' : 'CUT'
  return { title: row.title, startMs: row.startMs, leftMs: row.startMs - input.nowMs, arrivalMs, scheduledArrivalMs, autoCutMs, targetMs, diffMs, mode, fixed }
}

export interface Candidate { key: string; title: string; durationMs: number }
export interface Proposal { keys: string[]; totalMs: number; restMs: number }

const UNIT = 100 // ms: precisão do cálculo

/** Combinações de VTs que cabem na sobra sem passar dela: a mais cheia
 * primeiro, com menos itens no empate. Cada VT entra no máximo uma vez. */
export function fillProposals(gapMs: number, candidates: readonly Candidate[], maxItems = 5, limit = 3): Proposal[] {
  if (!(gapMs > 0)) return []
  const capacity = Math.floor(gapMs / UNIT)
  const usable = candidates.filter(entry => entry.durationMs > 0 && Math.ceil(entry.durationMs / UNIT) <= capacity).slice(0, 300)
  const proposals: Proposal[] = []
  const banned = new Set<string>()
  for (let attempt = 0; attempt < limit * 3 && proposals.length < limit; attempt++) {
    const pool = usable.filter(entry => !banned.has(entry.key))
    const best = knapsack(capacity, pool, maxItems)
    if (!best) break
    const keys = best.map(entry => entry.key)
    const signature = [...keys].sort().join('|')
    if (!proposals.some(proposal => [...proposal.keys].sort().join('|') === signature)) {
      const totalMs = best.reduce((sum, entry) => sum + entry.durationMs, 0)
      proposals.push({ keys, totalMs, restMs: gapMs - totalMs })
    }
    // Próxima alternativa: sem o maior item desta.
    const largest = [...best].sort((a, b) => b.durationMs - a.durationMs)[0]
    if (!largest) break
    banned.add(largest.key)
  }
  return proposals
}

/** Maior soma ≤ capacidade usando até maxItems itens (0/1). */
function knapsack(capacity: number, pool: readonly Candidate[], maxItems: number): Candidate[] | null {
  // count[s] = menor número de itens para somar exatamente s; from[s] = (item, s anterior)
  const count = new Int16Array(capacity + 1).fill(-1)
  const fromItem = new Int32Array(capacity + 1).fill(-1)
  const fromSum = new Int32Array(capacity + 1).fill(-1)
  count[0] = 0
  // Cópia por item mantém 0/1 (cada item uma vez).
  for (let i = 0; i < pool.length; i++) {
    const weight = Math.ceil(pool[i]!.durationMs / UNIT)
    for (let sum = capacity; sum >= weight; sum--) {
      const prev = count[sum - weight]!
      if (prev < 0 || prev >= maxItems) continue
      if (count[sum]! < 0 || prev + 1 < count[sum]!) { count[sum] = prev + 1; fromItem[sum] = i; fromSum[sum] = sum - weight }
    }
  }
  for (let sum = capacity; sum > 0; sum--) {
    if (count[sum]! <= 0) continue
    const chosen: Candidate[] = []
    let cursor = sum
    while (cursor > 0) { chosen.push(pool[fromItem[cursor]!]!); cursor = fromSum[cursor]! }
    return chosen.reverse()
  }
  return null
}

export interface CutOption { key: string; title: string; savesMs: number }
/** Menor conjunto de cortes/retiradas que recupera o atraso, com a menor
 * sobra possível; se nada alcança, o que mais recupera. */
export function cutProposal(lateMs: number, options: readonly CutOption[]): { keys: string[]; savedMs: number; reaches: boolean } | null {
  const pool = options.filter(option => option.savesMs > 0).slice(0, 40)
  if (!(lateMs > 0) || !pool.length) return null
  const total = pool.reduce((sum, option) => sum + Math.ceil(option.savesMs / UNIT), 0)
  const reach = new Int16Array(total + 1).fill(-1), fromItem = new Int32Array(total + 1).fill(-1), fromSum = new Int32Array(total + 1).fill(-1)
  reach[0] = 0
  for (let i = 0; i < pool.length; i++) {
    const weight = Math.ceil(pool[i]!.savesMs / UNIT)
    for (let sum = total; sum >= weight; sum--) {
      const prev = reach[sum - weight]!
      if (prev < 0) continue
      if (reach[sum]! < 0 || prev + 1 < reach[sum]!) { reach[sum] = prev + 1; fromItem[sum] = i; fromSum[sum] = sum - weight }
    }
  }
  const need = Math.ceil(lateMs / UNIT)
  let pick = -1
  for (let sum = need; sum <= total; sum++) if (reach[sum]! > 0) { pick = sum; break }
  const reaches = pick >= 0
  if (!reaches) for (let sum = total; sum > 0; sum--) if (reach[sum]! > 0) { pick = sum; break }
  if (pick < 0) return null
  const keys: string[] = []
  let cursor = pick, savedMs = 0
  while (cursor > 0) { const option = pool[fromItem[cursor]!]!; keys.push(option.key); savedMs += option.savesMs; cursor = fromSum[cursor]! }
  return { keys: keys.reverse(), savedMs, reaches }
}
