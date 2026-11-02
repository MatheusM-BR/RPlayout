import {describe, expect, it} from 'vitest'
import {formatFileIntegrated, formatLoudness, formatPeak, kWeightingCoefficients, loudnessFromPower, loudnessTone, meanSquare, ShortTermLoudness, truePeakTone} from './qc-loudness.js'

describe('loudness da escuta do QC (BS.1770)', () => {
  it('filtro K em 48 kHz reproduz os coeficientes tabelados da BS.1770', () => {
    const {shelf, highpass} = kWeightingCoefficients(48000)
    expect(shelf.b[0]).toBeCloseTo(1.53512485958697, 10)
    expect(shelf.b[1]).toBeCloseTo(-2.69169618940638, 10)
    expect(shelf.b[2]).toBeCloseTo(1.19839281085285, 10)
    expect(shelf.a[1]).toBeCloseTo(-1.69065929318241, 10)
    expect(shelf.a[2]).toBeCloseTo(0.73248077421585, 10)
    expect(highpass.a[1]).toBeCloseTo(-1.99004745483398, 10)
    expect(highpass.a[2]).toBeCloseTo(0.99007225036621, 10)
  })
  it('seno de 1 kHz a −20 dBFS nos dois canais ≈ −20 LUFS (o filtro K vale ~0 dB em 1 kHz)', () => {
    const amplitude = Math.pow(10, -20 / 20), samples = Float32Array.from({length: 19200}, (_, index) => amplitude * Math.sin(2 * Math.PI * 1000 * index / 48000))
    // Ganho do filtro K em 1 kHz ≈ +0,69 dB compensa o −0,691: dois canais somam +3 dB.
    expect(loudnessFromPower(meanSquare(samples) * 2 * Math.pow(10, 0.0691))).toBeCloseTo(-20, 1)
    expect(loudnessFromPower(0)).toBe(-Infinity)
  })
  it('S só aparece com ~3 s de leituras e é a média das potências', () => {
    const short = new ShortTermLoudness()
    short.push(0, 1e-3)
    expect(short.value()).toBeNull()
    for (let at = 100; at <= 3000; at += 100) short.push(at, 1e-3)
    expect(short.value()).toBeCloseTo(loudnessFromPower(1e-3), 6)
  })
})

describe('apresentação dos números de áudio do QC', () => {
  it('silêncio é −∞ / abaixo do gate, não −70 LUFS nem −90 dBTP', () => {
    expect(formatFileIntegrated(-70)).toBe('−∞ · abaixo do gate')
    expect(formatPeak(-90, 'dBTP')).toBe('−∞ dBTP')
    expect(formatLoudness(-Infinity)).toBe('−∞ LUFS')
    expect(formatFileIntegrated(-22.99)).toBe('−23.0 LUFS')
    expect(formatPeak(2.35, 'dBTP')).toBe('+2.4 dBTP')
  })
  it('cores seguem a faixa do perfil do canal', () => {
    const profile = {minLufs: -25, maxLufs: -21, maxTruePeakDbtp: -1}
    expect(loudnessTone(-23, profile)).toBe('ok')
    expect(loudnessTone(2.3, profile)).toBe('warn')
    expect(loudnessTone(-41.1, profile)).toBe('warn')
    expect(loudnessTone(undefined, profile)).toBe('none')
    expect(truePeakTone(-1.08, profile)).toBe('ok')
    expect(truePeakTone(-0.4, profile)).toBe('bad')
  })
})
