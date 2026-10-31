/** Abaixo disto (RMS) o canal é tratado como mudo: não há correlação a medir. */
export const MUTED_CHANNEL_DBFS = -70

/** Sample peaks/correlation of the monitor, not LUFS or true peak of the master.
 * Correlation is undefined when either channel is silent: a mute R must read
 * "canal mudo", never "+1.00 positiva". */
export function monitorAudioStatistics(left: Float32Array, right: Float32Array) {
  let peakL = 0, peakR = 0, energyL = 0, energyR = 0, cross = 0
  const count = Math.min(left.length, right.length)
  for (let index = 0; index < count; index++) {
    const l = Number.isFinite(left[index]) ? left[index]! : 0, r = Number.isFinite(right[index]) ? right[index]! : 0
    peakL = Math.max(peakL, Math.abs(l)); peakR = Math.max(peakR, Math.abs(r))
    energyL += l*l; energyR += r*r; cross += l*r
  }
  const db = (value: number) => value > 0 ? 20 * Math.log10(value) : -Infinity
  const rmsL = count ? db(Math.sqrt(energyL / count)) : -Infinity, rmsR = count ? db(Math.sqrt(energyR / count)) : -Infinity
  const mutedL = rmsL < MUTED_CHANNEL_DBFS, mutedR = rmsR < MUTED_CHANNEL_DBFS
  const muted: 'L' | 'R' | 'LR' | null = mutedL && mutedR ? 'LR' : mutedL ? 'L' : mutedR ? 'R' : null
  const denominator = Math.sqrt(energyL * energyR)
  return { peakL: db(peakL), peakR: db(peakR), rmsL, rmsR, muted,
    phase: !muted && denominator > 1e-12 ? Math.max(-1, Math.min(1, cross / denominator)) : null, active: count > 0 }
}
