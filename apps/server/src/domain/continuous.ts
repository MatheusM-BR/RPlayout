import type { RundownView } from './plan.js'
import { rundownFrames } from './rundown-clock.js'
import { liveDurationLimit } from './live-timing.js'

export interface HorizonRule {
  weekdays: string
  startMinute: number
  endMinute: number
}

/** Decide se o preenchimento contínuo deve agir neste instante. */
export function shouldFillHorizon(now: number, end: number, lead = 5): boolean {
  return end - now <= lead
}

/** Escolhe a faixa da pauta vigente para o minuto local, se existir. */
export function activeHorizonRule(rules: readonly HorizonRule[], nowMinute: number, weekday: number): HorizonRule | null {
  return rules.find((rule) => rule.weekdays.includes(String(weekday)) && nowMinute >= rule.startMinute && nowMinute < rule.endMinute) ?? null
}

/** This is the loaded execution's projection, not editorial coverage, media
 * prefetch, automatic handover, or evidence of 48h uninterrupted output. */
export function executionHorizon(view: RundownView | null,
  onAir: { itemId: string } | null, revisionId: string | null, now = new Date()) {
  const source = !view ? 'NONE' as const : revisionId ? 'PUBLISHED' as const : 'LEGACY' as const
  const clock = view ? rundownFrames(view.rundown.date, view.channel.rate, now) : null
  const timings = new Map(view?.schedule.items.map(timing => [timing.id, timing]) ?? [])
  const index = view && onAir ? view.items.findIndex(entry => entry.item.id === onAir.itemId) : -1
  const pending = view?.items.slice(Math.max(0, index)).filter(entry =>
    timings.get(entry.item.id)?.state !== 'DROPPED') ?? []
  let mode: 'FINITE' | 'LOOP' | 'OPEN_LIVE' | 'MANUAL_HOLD' | 'WAITING_START' | 'NO_EXECUTION' | 'INVALID_DATE' = 'FINITE'
  let reason: string | null = null
  if (!view || !pending.length) { mode = 'NO_EXECUTION'; reason = 'Não há playlist executável carregada.' }
  else if (clock === null) { mode = 'INVALID_DATE'; reason = 'Data da grade inválida; confira e publique uma revisão válida.' }
  else if (onAir && index < 0) { mode = 'NO_EXECUTION'; reason = 'O item em PGM não pertence à playlist carregada; confira a execução antes de anunciar cobertura.' }
  else if (!onAir && (timings.get(pending[0]!.item.id)?.start ?? clock) > clock) {
    mode = 'WAITING_START'; reason = 'Playlist futura aguardando início; o intervalo até ela não conta como cobertura.'
  }
  else if (pending.some(entry => entry.item.autoNext === false)) { mode = 'MANUAL_HOLD'; reason = 'Há item que aguarda TAKE manual; duração de cobertura não é garantida.' }
  else if (pending.some(entry => (entry.item.type === 'LIVE' || entry.item.eventType === 'LIVE') &&
    liveDurationLimit(entry.item, timings.get(entry.item.id)?.duration ?? 0) === null)) {
    mode = 'OPEN_LIVE'; reason = 'Há ao vivo sem encerramento automático definido; confira a duração com o operador.'
  } else if (view.rundown.loop || pending.some(entry => entry.item.loop)) {
    mode = 'LOOP'; reason = 'Loop ativo não comprova cobertura editorial de 48 horas.'
  }
  const end = view?.schedule.endsAt ?? null
  const remainingFrames = mode === 'FINITE' && clock !== null && end !== null && Number.isFinite(end) ? Math.max(0, end - clock) : null
  const minutes = remainingFrames === null || !view ? null : remainingFrames * view.channel.rate.den / view.channel.rate.num / 60
  // Estimates of live duration and gaps must not become a green assurance.
  const uncertain = pending.some(entry => entry.item.type === 'LIVE' || entry.item.eventType === 'LIVE') ||
    (view?.schedule.conflicts ?? []).some(conflict => conflict.severity === 'ERROR' || conflict.kind === 'GAP')
  return { source, mode, reason, rundownId: view?.rundown.id ?? null, rundownDate: view?.rundown.date ?? null,
    revisionId, nowFrames: clock, endsAtFrames: end, remainingFrames,
    minutesRemaining: minutes === null ? null : Math.floor(minutes),
    coverageMinutes: minutes === null ? null : Math.floor(minutes),
    coverageHours: minutes === null ? null : Math.floor(minutes / 60 * 10) / 10,
    targetHours: 48, coverageReady: source === 'PUBLISHED' && !uncertain && minutes !== null && minutes >= 48 * 60,
    automaticHandover: false as const }
}

export function horizonWarning(status: ReturnType<typeof executionHorizon>, playing: boolean, leadFrames: number) {
  if (!playing || status.mode !== 'FINITE' || status.remainingFrames === null || status.remainingFrames > leadFrames) return null
  return { rundownId: status.rundownId!, channelRevision: status.revisionId,
    date: status.rundownDate!, endBucket: Math.floor(status.endsAtFrames! / Math.max(1, leadFrames)),
    message: 'A playlist em execução termina em menos de cinco minutos. Confira a próxima revisão publicada e o estado da passagem automática.' }
}
