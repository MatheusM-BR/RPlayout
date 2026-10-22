/**
 * Tempo no RPlayout é sempre contado em frames inteiros. Milissegundo é unidade
 * de apresentação; frame é a unidade de verdade. Isso é o que impede o drift
 * acumulado ao longo de horas no ar.
 */

/** Frame rate como razão exata — 59.94 é 60000/1001, não 59.94. */
export interface Rate {
  readonly num: number
  readonly den: number
}

export const RATE = {
  '23.976': { num: 24000, den: 1001 },
  '24': { num: 24, den: 1 },
  '25': { num: 25, den: 1 },
  '29.97': { num: 30000, den: 1001 },
  '30': { num: 30, den: 1 },
  '50': { num: 50, den: 1 },
  '59.94': { num: 60000, den: 1001 },
  '60': { num: 60, den: 1 },
} as const satisfies Record<string, Rate>

/**
 * Cadência de quem não disse qual quer.
 *
 * 29,97 (30000/1001) é a cadência da televisão brasileira, e é a do material
 * que entra aqui. Um canal em 50 Hz tocando arquivo de 30 fps faz o
 * `videorate` duplicar e descartar quadros num padrão que se vê como
 * travadinha rítmica -- e era 50 o padrão antes desta constante existir.
 *
 * Não confundir com 30 exatos: NTSC é 30000/1001, e a diferença de 0,1% vira
 * um quadro de deriva a cada meia hora quando alguém arredonda.
 */
export const RATE_PADRAO: Rate = RATE['29.97']

export type RateName = keyof typeof RATE

/** Frames, sempre inteiro. */
export type Frames = number

export const fps = (rate: Rate): number => rate.num / rate.den

/**
 * Frames por segundo de timecode: 29.97 conta 30 frames por segundo de
 * timecode, não 29.97. É por isso que existe drop-frame.
 */
export const nominalFps = (rate: Rate): number => Math.round(fps(rate))

/** Rates NTSC (den 1001) usam drop-frame por convenção de broadcast. */
export const isDropFrame = (rate: Rate): boolean => rate.den === 1001

export const framesToMs = (frames: Frames, rate: Rate): number =>
  (frames * 1000 * rate.den) / rate.num

export const msToFrames = (ms: number, rate: Rate): Frames =>
  Math.round((ms * rate.num) / (1000 * rate.den))

export const secondsToFrames = (seconds: number, rate: Rate): Frames =>
  msToFrames(seconds * 1000, rate)

export const framesToSeconds = (frames: Frames, rate: Rate): number =>
  framesToMs(frames, rate) / 1000

const pad = (n: number, width = 2): string => String(Math.abs(n)).padStart(width, '0')

/**
 * Converte contagem de frames para os componentes de timecode, aplicando a
 * compensação de drop-frame quando o rate pede.
 *
 * Drop-frame pula os dois (ou quatro, a 59.94) primeiros números de frame de
 * cada minuto, exceto nos minutos múltiplos de dez. O relógio de timecode
 * volta a bater com o relógio de parede; nenhum frame de vídeo é descartado.
 */
export function timecodeParts(
  frames: Frames,
  rate: Rate,
): { hours: number; minutes: number; seconds: number; frames: number; negative: boolean } {
  const negative = frames < 0
  let f = Math.abs(Math.round(frames))
  const nominal = nominalFps(rate)

  if (isDropFrame(rate)) {
    const dropPerMinute = (nominal / 30) * 2
    const framesPer10Min = nominal * 60 * 10 - 9 * dropPerMinute
    const framesPerMin = nominal * 60 - dropPerMinute

    const tenMinBlocks = Math.floor(f / framesPer10Min)
    const remainder = f % framesPer10Min

    f += dropPerMinute * 9 * tenMinBlocks
    if (remainder >= dropPerMinute) {
      f += dropPerMinute * Math.floor((remainder - dropPerMinute) / framesPerMin)
    }
  }

  const framesPerHour = nominal * 3600
  const framesPerMinute = nominal * 60

  const hours = Math.floor(f / framesPerHour)
  const minutes = Math.floor((f % framesPerHour) / framesPerMinute)
  const seconds = Math.floor((f % framesPerMinute) / nominal)
  const frameOfSecond = f % nominal

  return { hours, minutes, seconds, frames: frameOfSecond, negative }
}

/**
 * `HH:MM:SS:FF`, ou `HH:MM:SS;FF` em drop-frame — o ponto e vírgula é a
 * convenção que avisa o operador de que aquele timecode é DF.
 */
export function formatTimecode(frames: Frames, rate: Rate): string {
  const p = timecodeParts(frames, rate)
  const sep = isDropFrame(rate) ? ';' : ':'
  const sign = p.negative ? '-' : ''
  return `${sign}${pad(p.hours)}:${pad(p.minutes)}:${pad(p.seconds)}${sep}${pad(p.frames)}`
}

/** Hora do dia sem frames, para as colunas de entrada e saída do rundown. */
export function formatClock(frames: Frames, rate: Rate, withSeconds = true): string {
  const p = timecodeParts(frames, rate)
  const sign = p.negative ? '-' : ''
  return withSeconds
    ? `${sign}${pad(p.hours)}:${pad(p.minutes)}:${pad(p.seconds)}`
    : `${sign}${pad(p.hours)}:${pad(p.minutes)}`
}

/** Duração compacta: `MM:SS` abaixo de uma hora, `H:MM:SS` acima. */
export function formatDuration(frames: Frames, rate: Rate): string {
  const p = timecodeParts(frames, rate)
  const sign = p.negative ? '-' : ''
  return p.hours > 0
    ? `${sign}${p.hours}:${pad(p.minutes)}:${pad(p.seconds)}`
    : `${sign}${pad(p.minutes)}:${pad(p.seconds)}`
}

const TIMECODE_RE = /^(-)?(\d{1,2}):(\d{1,2}):(\d{1,2})[:;.](\d{1,2})$/
const CLOCK_RE = /^(-)?(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/

/**
 * Aceita `HH:MM:SS:FF`, `HH:MM:SS;FF`, `HH:MM:SS` e `HH:MM`. Devolve null em
 * vez de lançar: o campo de timecode da interface valida enquanto o operador
 * digita, e meio timecode digitado não é um erro.
 */
export function parseTimecode(input: string, rate: Rate): Frames | null {
  const text = input.trim()
  if (text === '') return null

  const nominal = nominalFps(rate)
  const tc = TIMECODE_RE.exec(text)
  const clock = tc ? null : CLOCK_RE.exec(text)
  if (!tc && !clock) return null

  const sign = (tc?.[1] ?? clock?.[1]) === '-' ? -1 : 1
  const hours = Number(tc?.[2] ?? clock?.[2])
  const minutes = Number(tc?.[3] ?? clock?.[3])
  const seconds = Number(tc?.[4] ?? clock?.[4] ?? 0)
  const frameOfSecond = Number(tc?.[5] ?? 0)

  if (minutes > 59 || seconds > 59 || frameOfSecond >= nominal) return null

  let total = hours * nominal * 3600 + minutes * nominal * 60 + seconds * nominal + frameOfSecond

  if (isDropFrame(rate)) {
    const dropPerMinute = (nominal / 30) * 2
    const totalMinutes = hours * 60 + minutes
    total -= dropPerMinute * (totalMinutes - Math.floor(totalMinutes / 10))
  }

  return sign * total
}

/** Frames decorridos desde a meia-noite local do instante informado. */
export function framesSinceMidnight(date: Date, rate: Rate): Frames {
  const ms =
    date.getHours() * 3_600_000 +
    date.getMinutes() * 60_000 +
    date.getSeconds() * 1000 +
    date.getMilliseconds()
  return msToFrames(ms, rate)
}

/** Um dia inteiro em frames — usado para normalizar viradas de meia-noite. */
export const framesPerDay = (rate: Rate): Frames => msToFrames(86_400_000, rate)
