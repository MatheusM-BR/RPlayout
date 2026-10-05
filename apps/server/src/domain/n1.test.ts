import { afterEach, describe, expect, it, vi } from 'vitest'
import { probeN1Peer } from './n1.js'
afterEach(() => vi.restoreAllMocks())

describe('heartbeat N+1', () => {
  it('desativado sem peer', async () => {
    expect((await probeN1Peer(null)).configured).toBe(false)
  })

  it('mede peer alcançável sem expor token', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }))
    const result = await probeN1Peer('http://backup:4000', 'segredo')
    expect(result.reachable).toBe(true)
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ headers: { 'x-rplayout-control-token': 'segredo' } })
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ redirect: 'error' })
    fetchMock.mockRestore()
  })
  it('mascara o endereço e o erro sem encaminhar credenciais a redirect', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Redirect https://outra-maquina/PRIVATE_TOKEN headers PRIVATE_CONTROL'))
    const result = await probeN1Peer('https://backup:4000?token=PRIVATE_TOKEN', 'PRIVATE_CONTROL')
    expect(result.reachable).toBe(false)
    expect(JSON.stringify(result)).not.toContain('PRIVATE_')
    expect(result.peer).toContain('REDACTED')
    expect(result.error).toContain('Redirecionamentos')
  })
  it.each(['file:///etc/passwd', 'http://usuario:SENHA@backup:4000'])('recusa destino não HTTP ou credencial embutida: %s', async peer => {
    const request = vi.spyOn(globalThis, 'fetch')
    const result = await probeN1Peer(peer, 'CONTROLE')
    expect(result.reachable).toBe(false)
    expect(request).not.toHaveBeenCalled()
    expect(JSON.stringify(result)).not.toContain('SENHA')
  })
})
