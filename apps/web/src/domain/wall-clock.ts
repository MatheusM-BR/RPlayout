import { framesToMs, msToFrames, wholeSeconds, type Rate } from '@rplayout/protocol'

/** Horários da grade são quadros desde a meia-noite local da data da grade
 * (mesma base do servidor, `rundown-clock.ts`). Uma grade em loop continua
 * contando depois de dias; o operador precisa ver relógio de parede, não
 * "184:54:26". */

const pad = (value: number) => String(value).padStart(2, '0')
export const localDateKey = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`

/** Data de referência das grades exibidas, para telas que não recebem a data. */
let currentGradeDate: string | null = null
export function setCurrentGradeDate(date: string | null | undefined): void { currentGradeDate = date ?? null }

export function gradeMidnightMs(date: string | null | undefined, now = new Date()): number {
  const match = date ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(date) : null
  const base = match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : new Date(now)
  base.setHours(0, 0, 0, 0)
  return base.getTime()
}

/** Instante absoluto de um quadro da grade. */
export function gradeInstant(frames: number, rate: Rate, date: string | null | undefined = currentGradeDate): Date {
  return new Date(gradeMidnightMs(date) + framesToMs(frames, rate))
}

/** Instante no segundo inteiro mais próximo (meia-quadro de tolerância), para
 * exibir HH:MM:SS: a 29,97 a âncora 04:10:00 vira 449550 quadros = 04:09:59,985
 * e truncar mostrava 04:09:59. */
function gradeSecond(frames: number, rate: Rate, date: string | null | undefined): Date {
  const seconds = wholeSeconds(frames, rate) * (frames < 0 ? -1 : 1)
  return new Date(gradeMidnightMs(date) + seconds * 1000)
}

/** `HH:MM:SS` do dia; com `DD/MM` na frente quando não é hoje. */
export function wallClock(frames: number, rate: Rate, date: string | null | undefined = currentGradeDate, now = new Date()): string {
  if (!Number.isFinite(frames)) return '--:--:--'
  const at = gradeSecond(frames, rate, date)
  const time = `${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`
  return localDateKey(at) === localDateKey(now) ? time : `${pad(at.getDate())}/${pad(at.getMonth() + 1)} ${time}`
}

/** Só `HH:MM:SS` do dia (régua, relógio do playhead). */
export function wallTime(frames: number, rate: Rate, date: string | null | undefined = currentGradeDate): string {
  if (!Number.isFinite(frames)) return '--:--:--'
  const at = gradeSecond(frames, rate, date)
  return `${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`
}

/** Hora do dia em segundos, só para `HH:MM:SS` válido (00–23:00–59:00–59). */
export function parseHms(text: string): number | null {
  const match = /^\s*([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?\s*$/.exec(text)
  return match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3] ?? 0) : null
}

export function formatHms(seconds: number): string {
  const s = ((Math.floor(seconds) % 86400) + 86400) % 86400
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`
}

/** Hora atual em `HH:MM:SS`; `roundUpMinutes` arredonda para o próximo minuto cheio + N. */
export function nowHms(now = new Date(), roundUpMinutes = 0): string {
  if (roundUpMinutes <= 0) return formatHms(now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds())
  const minutes = now.getHours() * 60 + now.getMinutes() + roundUpMinutes
  return formatHms(minutes * 60)
}

export type DayChoice = 'today' | 'tomorrow'

/** Instante de hoje/amanhã no horário pedido. */
export function wallInstant(seconds: number, day: DayChoice, now = new Date()): Date {
  const target = new Date(now)
  target.setHours(0, 0, 0, 0)
  if (day === 'tomorrow') target.setDate(target.getDate() + 1)
  return new Date(target.getTime() + seconds * 1000)
}

/** Âncora em quadros, na base da grade, para um instante absoluto. */
export function anchorFramesFor(instant: Date, rate: Rate, date: string | null | undefined): number {
  return msToFrames(instant.getTime() - gradeMidnightMs(date, instant), rate)
}

/** Horário de parede (segundos do dia) e dia relativo de uma âncora salva. */
export function anchorWall(frames: number, rate: Rate, date: string | null | undefined, now = new Date()): { seconds: number; day: DayChoice | 'past' | 'later' } {
  const at = gradeSecond(frames, rate, date)
  const seconds = at.getHours() * 3600 + at.getMinutes() * 60 + at.getSeconds()
  const today = localDateKey(now), tomorrow = localDateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1))
  const key = localDateKey(at)
  return { seconds, day: key === today ? 'today' : key === tomorrow ? 'tomorrow' : at < now ? 'past' : 'later' }
}

/** Instante para um horário escolhido: "hoje" é o dia da grade quando ela é
 * futura; senão o dia atual. "amanhã" é o dia seguinte a essa referência. */
export function resolveWallInstant(seconds: number, day: DayChoice, date: string | null | undefined, now = new Date()): Date {
  const today = new Date(now); today.setHours(0, 0, 0, 0)
  const grade = gradeMidnightMs(date, now)
  const ref = new Date(Math.max(today.getTime(), grade))
  if (day === 'tomorrow') ref.setDate(ref.getDate() + 1)
  ref.setHours(Math.floor(seconds / 3600), Math.floor((seconds % 3600) / 60), seconds % 60, 0)
  return ref
}
