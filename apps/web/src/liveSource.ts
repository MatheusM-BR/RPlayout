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
