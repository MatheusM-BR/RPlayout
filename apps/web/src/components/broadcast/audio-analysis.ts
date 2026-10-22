/** Sample peaks/correlation of the monitor, not LUFS or true peak of the master. */
export function monitorAudioStatistics(left: Float32Array, right: Float32Array) {
  let peakL = 0, peakR = 0, energyL = 0, energyR = 0, cross = 0
  const count = Math.min(left.length, right.length)
  for (let index = 0; index < count; index++) {
    const l = Number.isFinite(left[index]) ? left[index]! : 0, r = Number.isFinite(right[index]) ? right[index]! : 0
    peakL = Math.max(peakL, Math.abs(l)); peakR = Math.max(peakR, Math.abs(r))
    energyL += l*l; energyR += r*r; cross += l*r
  }
  const denominator = Math.sqrt(energyL * energyR)
  return { peakL: 20 * Math.log10(Math.max(1e-5, peakL)), peakR: 20 * Math.log10(Math.max(1e-5, peakR)),
    phase: denominator > 1e-12 ? Math.max(-1, Math.min(1, cross / denominator)) : null, active: count > 0 }
}
