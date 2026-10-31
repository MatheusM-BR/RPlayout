import type { WatchdogDetection } from './live-watchdog.js'

/** Parada de uma entrada ao vivo dentro do item que estava no ar (AIRED). */
export type LiveOutageAction = 'NONE' | 'WAIT_ART' | 'HOLD_LAST_FRAME' | 'CONTINGENCY'
/** Como a parada foi encerrada: sinal voltou, item terminou com ela aberta, ou o acompanhamento parou. */
export type LiveOutageClosedBy = 'SIGNAL_RETURNED' | 'ITEM_ENDED'
export interface LiveOutage {
  id: string
  asRunId: string | null
  itemId: string | null
  sourceName: string
  /** Hora de parede do servidor (ISO, com milissegundos). */
  startedAt: string
  endedAt: string | null
  durationMs: number | null
  reasons: WatchdogDetection[]
  action: LiveOutageAction
  closedBy: LiveOutageClosedBy | null
}

export const OUTAGE_REASON_LABELS: Record<WatchdogDetection, string> = {
  SIGNAL_LOSS: 'sem sinal', FREEZE: 'congelado', BLACK: 'preto ou fade', AUDIO_STALL: 'áudio parado', AUDIO_MISSING: 'sem áudio',
  SILENCE: 'silêncio', LOW_BITRATE: 'bitrate baixo', LOW_FPS: 'quadros por segundo baixos',
}
export const OUTAGE_ACTION_LABELS: Record<LiveOutageAction, string> = {
  NONE: 'só alerta', WAIT_ART: 'grafismo de espera', HOLD_LAST_FRAME: 'último quadro congelado', CONTINGENCY: 'contingência',
}
export const outageReasonText = (outage: Pick<LiveOutage, 'reasons'>) => outage.reasons.map(reason => OUTAGE_REASON_LABELS[reason] ?? reason).join(' + ') || 'motivo não registrado'

/** "15 s", "2 min 05 s", "1 h 02 min 03 s". */
export function outageDurationText(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return 'em andamento'
  const total = Math.round(ms / 1000), h = Math.floor(total / 3600), m = Math.floor(total % 3600 / 60), s = total % 60
  return h ? `${h} h ${String(m).padStart(2, '0')} min ${String(s).padStart(2, '0')} s` : m ? `${m} min ${String(s).padStart(2, '0')} s` : `${s} s`
}

/** Total parado no item (paradas sobrepostas não contam em dobro). Aberta conta até `now`. */
export function outageTotalMs(outages: readonly Pick<LiveOutage, 'startedAt' | 'endedAt'>[], now = Date.now()): number {
  const spans = outages.map(outage => [Date.parse(outage.startedAt), outage.endedAt ? Date.parse(outage.endedAt) : now] as const)
    .filter(([start, end]) => Number.isFinite(start) && Number.isFinite(end) && end >= start).sort((a, b) => a[0] - b[0])
  let total = 0, cursorStart = -Infinity, cursorEnd = -Infinity
  for (const [start, end] of spans) {
    if (start > cursorEnd) { if (cursorEnd > cursorStart) total += cursorEnd - cursorStart; cursorStart = start; cursorEnd = end }
    else cursorEnd = Math.max(cursorEnd, end)
  }
  if (cursorEnd > cursorStart) total += cursorEnd - cursorStart
  return total
}

/** Uma linha legível: "13:10:00 → 13:10:15 (15 s) · sem sinal · grafismo de espera". */
export function outageLine(outage: LiveOutage, time: (iso: string) => string): string {
  const end = outage.endedAt ? time(outage.endedAt) : 'em andamento'
  const closed = outage.closedBy === 'ITEM_ENDED' ? ' · fechada no fim do item' : ''
  return `${time(outage.startedAt)} → ${end} (${outageDurationText(outage.durationMs)}) · ${outageReasonText(outage)} · ${OUTAGE_ACTION_LABELS[outage.action]}${closed}`
}
