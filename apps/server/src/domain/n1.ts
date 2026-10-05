import { redactUrl } from './relays.js'

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
  const publicPeer = redactUrl(peer)
  try {
    const endpoint = new URL(peer)
    if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password) {
      return { configured: true, peer: publicPeer, reachable: false, latencyMs: null, checkedAt, error: 'Use um endereço HTTP/HTTPS sem usuário/senha na URL; autenticação utiliza o token de controle.' }
    }
    endpoint.pathname = `${endpoint.pathname.replace(/\/$/, '')}/api/health`
    endpoint.hash = ''
    const headers: Record<string, string> = {}
    if (token) headers['x-rplayout-control-token'] = token
    // Um redirect poderia encaminhar o header secreto a um host não autorizado.
    const response = await fetch(endpoint.toString(), { headers, redirect: 'error', signal: AbortSignal.timeout(2_000) })
    if (!response.ok) return { configured: true, peer: publicPeer, reachable: false, latencyMs: Math.round(performance.now() - started), checkedAt, error: `peer respondeu HTTP ${response.status}` }
    return { configured: true, peer: publicPeer, reachable: true, latencyMs: Math.round(performance.now() - started), checkedAt, error: null }
  } catch {
    return { configured: true, peer: publicPeer, reachable: false, latencyMs: null, checkedAt, error: 'Peer indisponível: confira endereço, conectividade, certificado e token de controle. Redirecionamentos não são seguidos.' }
  }
}
