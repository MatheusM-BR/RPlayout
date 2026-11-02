/** Cor semântica de uma leitura de loudness contra o alvo do canal.
 * −70 LUFS de silêncio nunca aparece em verde. */
export type LoudnessTone = 'ok' | 'warn' | 'bad' | 'silence' | 'unknown'
export const SILENCE_LUFS = -60
export function loudnessTone(lufs: number | null | undefined, targetLufs: number): LoudnessTone {
  if (lufs == null || !Number.isFinite(lufs)) return 'unknown'
  if (lufs <= SILENCE_LUFS) return 'silence'
  const distance = Math.abs(lufs - targetLufs)
  return distance <= 2 ? 'ok' : distance <= 5 ? 'warn' : 'bad'
}
export const loudnessToneClass: Record<LoudnessTone, string> = {
  ok: 'text-status-ok-bright', warn: 'text-armed-amber', bad: 'text-on-air-crimson', silence: 'text-on-air-crimson', unknown: 'text-outline',
}
