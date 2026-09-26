import type { ManagedLiveSource } from '@rplayout/protocol'

/**
 * O banco guarda a identificação que o operador digitou. O engine, porém,
 * precisa da referência canônica para hardware/discovery (`ndi:`, `sdi:` e
 * `omt:`). URLs de SRT/RTMP/RTSP já são completas e não são alteradas.
 */
export function canonicalLiveSourceRef(source: Pick<ManagedLiveSource, 'kind' | 'targetUrl'>): string {
  const target = source.targetUrl.trim()
  if (target.includes('://')) return target
  const prefix = source.kind.toLowerCase()
  return target.toLowerCase().startsWith(`${prefix}:`) ? target : `${prefix}:${target}`
}
