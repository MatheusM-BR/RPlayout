/** Alarme sonoro opcional do Master. O navegador só libera áudio depois de um
 * clique, por isso o contexto nasce no clique que liga o som. */
let context: AudioContext | null = null

export function enableAlarmSound(): boolean {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return false
    context ??= new Ctor()
    void context.resume()
    return true
  } catch { return false }
}

/** Bipe curto. Silencioso se o som não foi liberado. */
export function beep(frequency = 880, durationMs = 120, volume = 0.15): void {
  if (!context || context.state !== 'running') return
  const oscillator = context.createOscillator(), gain = context.createGain()
  oscillator.frequency.value = frequency
  gain.gain.setValueAtTime(volume, context.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + durationMs / 1000)
  oscillator.connect(gain).connect(context.destination)
  oscillator.start()
  oscillator.stop(context.currentTime + durationMs / 1000 + 0.02)
}
