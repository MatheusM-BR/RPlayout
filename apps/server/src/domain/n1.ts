export interface N1Snapshot {
  configured: boolean
  peer: string | null
  reachable: boolean
  latencyMs: number | null
  checkedAt: string
  error: string | null
}

export async function probeN1Peer(peer: string | null, token = ''): Promise<N1Snapshot> {
  const checkedAt = new Date().toISOString()
  if (!peer) return { configured: false, peer: null, reachable: false, latencyMs: null, checkedAt, error: null }
  const started = performance.now()
  try {
    const headers: Record<string, string> = {}
    if (token) headers['x-rplayout-control-token'] = token
    const response = await fetch(`${peer.replace(/\/$/, '')}/api/health`, { headers, signal: AbortSignal.timeout(2_000) })
    if (!response.ok) return { configured: true, peer, reachable: false, latencyMs: Math.round(performance.now() - started), checkedAt, error: `peer respondeu HTTP ${response.status}` }
    return { configured: true, peer, reachable: true, latencyMs: Math.round(performance.now() - started), checkedAt, error: null }
  } catch (error) {
    return { configured: true, peer, reachable: false, latencyMs: null, checkedAt, error: error instanceof Error ? error.message : 'peer indisponível' }
  }
}
