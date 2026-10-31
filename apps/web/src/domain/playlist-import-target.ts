import { wholeSeconds, type Rate } from '@rplayout/protocol'
import { localDateKey } from './wall-clock.js'

/** Grade que vai receber a lista importada: a data e a hora em que ela começa.
 * O diálogo mostrava a data do próprio calendário (hoje, ou a última usada) e
 * um início 00:00 editável que não ia ao servidor -- com "Amanhã" aberto na
 * PLAYLIST, a tela dizia "DATA 31/10/2026" e a lista entrava na grade de 01/11. */
export interface PlaylistImportTarget { date: string; start: string }

const pad = (value: number) => String(value).padStart(2, '0')

export function playlistImportTarget(date: string | null | undefined, plannedStart: number, rate: Rate, now = new Date()): PlaylistImportTarget {
  const total = Number.isFinite(plannedStart) && plannedStart > 0 ? wholeSeconds(plannedStart, rate) % 86400 : 0
  const start = `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`
  return { date: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : localDateKey(now), start }
}

/** Segundos desde a meia-noite de "HH:MM" ou "HH:MM:SS"; inválido vale 0. */
export function startSeconds(text: string): number {
  const match = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/.exec(text)
  return match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3] ?? 0) : 0
}
