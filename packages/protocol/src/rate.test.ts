import { describe, expect, it } from 'vitest'
import {
  RATE,
  formatClock,
  formatDuration,
  formatTimecode,
  framesToMs,
  isDropFrame,
  msToFrames,
  nominalFps,
  parseTimecode,
  secondsToFrames,
} from './rate.js'

describe('rates', () => {
  it('trata NTSC como razão exata, não como decimal arredondado', () => {
    expect(RATE['59.94']).toEqual({ num: 60000, den: 1001 })
    expect(nominalFps(RATE['59.94'])).toBe(60)
    expect(isDropFrame(RATE['59.94'])).toBe(true)
    expect(isDropFrame(RATE['50'])).toBe(false)
  })

  it('converte frames e milissegundos sem perder a razão', () => {
    expect(framesToMs(50, RATE['50'])).toBe(1000)
    expect(msToFrames(1000, RATE['50'])).toBe(50)
    // Uma hora a 59.94 tem 215784 frames, não 215784.2.
    expect(msToFrames(3_600_000, RATE['59.94'])).toBe(215784)
  })
})

describe('timecode sem drop-frame', () => {
  it('formata horas, minutos, segundos e frames', () => {
    const rate = RATE['50']
    expect(formatTimecode(secondsToFrames(19 * 3600 + 58 * 60 + 12, rate) + 14, rate)).toBe(
      '19:58:12:14',
    )
  })

  it('faz o caminho de volta', () => {
    const rate = RATE['25']
    const frames = parseTimecode('01:02:03:04', rate)
    expect(frames).toBe(((1 * 3600 + 2 * 60 + 3) * 25) + 4)
    expect(formatTimecode(frames!, rate)).toBe('01:02:03:04')
  })
})

describe('timecode com drop-frame', () => {
  const rate = RATE['29.97']

  it('um minuto de relógio marca 00:00:59;28', () => {
    // 1798 frames é exatamente um minuto de tempo real a 29.97.
    expect(formatTimecode(1798, rate)).toBe('00:00:59;28')
  })

  it('nos múltiplos de dez minutos o timecode volta a bater com o relógio', () => {
    // 17982 frames = dez minutos reais; é onde o drop-frame se acerta.
    expect(formatTimecode(17982, rate)).toBe('00:10:00;00')
  })

  it('usa ponto e vírgula para avisar que é drop-frame', () => {
    expect(formatTimecode(0, rate)).toBe('00:00:00;00')
    expect(formatTimecode(0, RATE['30'])).toBe('00:00:00:00')
  })

  it('faz o caminho de volta em vários pontos', () => {
    for (const frames of [0, 1798, 17982, 53946, 107892]) {
      const text = formatTimecode(frames, rate)
      expect(parseTimecode(text, rate)).toBe(frames)
    }
  })
})

describe('entrada do operador', () => {
  const rate = RATE['50']

  it('aceita hora sem frames e hora sem segundos', () => {
    expect(parseTimecode('20:00', rate)).toBe(secondsToFrames(20 * 3600, rate))
    expect(parseTimecode('20:00:30', rate)).toBe(secondsToFrames(20 * 3600 + 30, rate))
  })

  it('devolve null em vez de lançar enquanto o campo está pela metade', () => {
    expect(parseTimecode('', rate)).toBeNull()
    expect(parseTimecode('20:', rate)).toBeNull()
    expect(parseTimecode('abc', rate)).toBeNull()
    // 50 frames não existe num rate de 50fps: vai de 00 a 49.
    expect(parseTimecode('00:00:00:50', rate)).toBeNull()
    expect(parseTimecode('00:99:00:00', rate)).toBeNull()
  })
})

describe('formatos da interface', () => {
  const rate = RATE['50']

  it('coluna de horário não mostra frames', () => {
    expect(formatClock(secondsToFrames(20 * 3600 + 15, rate) + 33, rate)).toBe('20:00:15')
    expect(formatClock(secondsToFrames(20 * 3600, rate), rate, false)).toBe('20:00')
  })

  it('duração curta esconde a hora', () => {
    expect(formatDuration(secondsToFrames(168, rate), rate)).toBe('02:48')
    expect(formatDuration(secondsToFrames(3725, rate), rate)).toBe('1:02:05')
  })

  it('duração negativa mantém o sinal', () => {
    expect(formatDuration(-secondsToFrames(32, rate), rate)).toBe('-00:32')
  })
})
