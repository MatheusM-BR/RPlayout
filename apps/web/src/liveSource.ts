import type { ManagedLiveSource } from '@rplayout/protocol'

/** Ciphertext may rotate after restart/cache eviction. Compare the server's
 * authenticated stable identity, not the random encryption envelope. The
 * server still verifies identity/envelope before executing any operation. */
export function liveSourceIdentity(reference: string): string {
  const match = /^([a-z][a-z0-9+.-]*):protected:v1:([A-Za-z0-9_-]{43})\.[A-Za-z0-9_-]+$/i.exec(reference)
  return match ? `${match[1]!.toLowerCase()}:protected-id:${match[2]}` : reference
}
export const sameLiveSource = (first: string, second: string): boolean => liveSourceIdentity(first) === liveSourceIdentity(second)

/**
 * O banco guarda a identificação que o operador digitou. O engine, porém,
 * precisa da referência canônica para hardware/discovery (`ndi:`, `sdi:` e
 * `omt:`). URLs de SRT/RTMP/RTSP já são completas e não são alteradas.
 */
export function canonicalLiveSourceRef(source: Pick<ManagedLiveSource, 'kind' | 'targetUrl' | 'controlRef'>): string {
  if (source.controlRef) return source.controlRef
  const target = source.targetUrl.trim()
  if (target.includes('://')) return target
  const prefix = source.kind.toLowerCase()
  return target.toLowerCase().startsWith(`${prefix}:`) ? target : `${prefix}:${target}`
}

/** Selo curto do protocolo de uma fonte ao vivo (NDI, OMT, SRT, RTMP, SDI…),
 * para distinguir entradas com o mesmo nome na biblioteca. */
export function liveProtocolLabel(ref: string | null | undefined): string {
  const match = /^([a-z0-9+.-]+):/i.exec(ref ?? '')
  const scheme = match?.[1]?.toLowerCase() ?? ''
  const known: Record<string, string> = { ndi: 'NDI', omt: 'OMT', srt: 'SRT', rtmp: 'RTMP', rtmps: 'RTMPS', rtsp: 'RTSP', sdi: 'SDI', decklink: 'SDI', http: 'HLS', https: 'HLS', whip: 'WHIP', udp: 'UDP' }
  return known[scheme] ?? 'AO VIVO'
}

/** Duração estimada de uma live nova na grade (Master e Playlist usavam 15 min
 * e 60 min). Arredonda para cima para não exibir 59:59 em 29,97. */
export const LIVE_DEFAULT_MINUTES = 60
export function liveDefaultFrames(rate: { num: number; den: number }): number {
  return Math.ceil(LIVE_DEFAULT_MINUTES * 60 * rate.num / rate.den)
}
