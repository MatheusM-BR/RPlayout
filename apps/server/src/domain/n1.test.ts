import { describe, expect, it, vi } from 'vitest'
import { probeN1Peer } from './n1.js'

describe('heartbeat N+1', () => {
  it('desativado sem peer', async () => {
    expect((await probeN1Peer(null)).configured).toBe(false)
  })

  it('mede peer alcançável sem expor token', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }))
    const result = await probeN1Peer('http://backup:4000', 'segredo')
    expect(result.reachable).toBe(true)
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ headers: { 'x-rplayout-control-token': 'segredo' } })
    fetchMock.mockRestore()
  })
})
