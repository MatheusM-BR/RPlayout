import net from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AtemSwitcherDriver, GpioRelayDriver, StudioAutomationGateway, VideohubRouterDriver } from './external-control.js'

const prelude = 'PROTOCOL PREAMBLE:\nVersion: 2.3\n\nVIDEOHUB DEVICE:\nDevice present: true\nModel name: QA — Matriz\nVideo inputs: 16\nVideo outputs: 16\n\nVIDEO OUTPUT ROUTING:\n4 2\n\n'
afterEach(() => vi.restoreAllMocks())
async function withPeer<T>(handler: (block: string, socket: net.Socket, commands: string[]) => void,
  work: (port: number, commands: string[]) => Promise<T>, initial = prelude): Promise<T> {
  const sockets = new Set<net.Socket>(), commands: string[] = []
  const server = net.createServer(socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('error', () => {})
    socket.setEncoding('utf8'); socket.write(initial)
    let pending = ''
    socket.on('data', text => {
      pending += text
      let end: number
      while ((end = pending.indexOf('\n\n')) >= 0) {
        const block = pending.slice(0, end); pending = pending.slice(end + 2); commands.push(block)
        handler(block, socket, commands)
      }
    })
  })
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  try { return await work((server.address() as net.AddressInfo).port, commands) }
  finally { for (const socket of sockets) socket.destroy(); await new Promise<void>(resolve => server.close(() => resolve())) }
}
const route = (port: number, timeout = 300) => new VideohubRouterDriver('127.0.0.1', port, false, timeout).execute('ROUTE_CROSSPOINT', { destination: 4, source: 2 })

describe('automação externa com confirmação do protocolo, não de qualquer pacote', () => {
  it('ACK e estado solicitado confirmam crosspoint, com blocos fragmentados e Unicode', async () => {
    await withPeer((block, socket) => {
      if (block === 'PING:') socket.write('ACK\r\n\r\n')
      else if (block.includes('\n4 2')) socket.write('A' + 'CK\n\nVIDEO OUTPUT ROUTING:\n4 9\n\n')
      else if (block === 'VIDEO OUTPUT ROUTING:') { socket.write('ACK\n\nVIDEO OUTPUT ROU'); setTimeout(() => socket.write('TING:\r\n4 2\r\n\r\n'), 10) }
    }, async (port, commands) => {
      const result = await route(port)
      expect(result.success).toBe(true)
      expect(result.details).toMatchObject({ routeStatusConfirmed: true, physicalExecutionConfirmed: false, destination: 4, source: 2, model: 'QA — Matriz' })
      expect(commands).toEqual(['PING:', 'VIDEO OUTPUT ROUTING:\n4 2', 'VIDEO OUTPUT ROUTING:'])
    })
  })
  it('PING é consulta sem escrita de crosspoint nem alegação de vídeo', async () => {
    await withPeer((block, socket) => { if (block === 'PING:') socket.write('ACK\n\n') }, async (port, commands) => {
      const reply = await new VideohubRouterDriver('127.0.0.1', port).execute('PING', {})
      expect(reply.success).toBe(true); expect(reply.details).toMatchObject({ protocolResponding: true, routeStatusConfirmed: false, physicalExecutionConfirmed: false })
      expect(commands).toEqual(['PING:'])
    })
  })
  it.each(['stale', 'throws'])('contexto %s após PING impede escrita do crosspoint', async scenario => {
    await withPeer((block, socket) => { if (block === 'PING:') socket.write('ACK\n\n') }, async (port, commands) => {
      const guard = () => { if (scenario === 'throws') throw new Error('Contexto indisponível'); return false }
      const reply = await new VideohubRouterDriver('127.0.0.1', port, false, 300).execute('ROUTE_CROSSPOINT', { destination: 4, source: 2 }, guard)
      expect(reply.success).toBe(false)
      expect(reply.details?.uncertain).toBe(false)
      expect(commands).toEqual(['PING:'])
    })
  })
  it('banner/estado inicial, mesmo no crosspoint desejado, não confirmam o pedido', async () => {
    await withPeer((block, socket) => {
      if (block === 'PING:') socket.write('ACK\n\n')
      // No response after routing. The initial status was already 4 -> 2.
    }, async port => {
      const reply = await route(port, 100)
      expect(reply.success).toBe(false); expect(reply.details?.error).toMatch(/TIMEOUT/)
    })
  })
  it('ACK sozinho e echo anterior à consulta não são confirmação do status posterior', async () => {
    await withPeer((block, socket) => {
      if (block === 'PING:') socket.write('ACK\n\n')
      else if (block.includes('\n4 2')) socket.write('ACK\n\nVIDEO OUTPUT ROUTING:\n4 2\n\n')
      else socket.write('ACK\n\n')
    }, async port => {
      const reply = await route(port, 100)
      expect(reply.success).toBe(false); expect(reply.details).toMatchObject({ acknowledged: true, physicalExecutionConfirmed: false })
    })
  })
  it.each(['NAK', 'OTHER_CROSSPOINT', 'DISCONNECTED', 'FLOOD'])('recusa %s sem repetição automática', async scenario => {
    await withPeer((block, socket, commands) => {
      if (block === 'PING:') socket.write('ACK\n\n')
      else if (block.includes('\n4 2')) {
        if (scenario === 'NAK') socket.write('NAK\n\n')
        else if (scenario === 'DISCONNECTED') socket.end()
        else if (scenario === 'FLOOD') socket.write('x'.repeat(262_145))
        else socket.write('ACK\n\n')
      } else socket.write('ACK\n\nVIDEO OUTPUT ROUTING:\n4 3\n\n')
      expect(commands.filter(value => value.includes('\n4 2')).length).toBeLessThanOrEqual(1)
    }, async port => { expect((await route(port)).success).toBe(false) })
  })
  it('entrada/saída inválida, ação não suportada e firmware incompatível não enviam rota', async () => {
    await withPeer(() => {}, async (port, commands) => {
      const driver = new VideohubRouterDriver('127.0.0.1', port, false, 100)
      for (const params of [{}, { destination: -1, source: 2 }, { destination: 1, source: '2\n\nPING:' }, { destination: 1.5, source: 2 }]) expect((await driver.execute('ROUTE', params)).success).toBe(false)
      expect((await driver.execute('DELETE', { destination: 4, source: 2 })).success).toBe(false)
      expect(commands).toEqual([])
      expect((await driver.execute('ROUTE', { destination: 16, source: 2 })).success).toBe(false)
      expect(commands).toEqual([])
    })
    await withPeer(() => {}, async (port, commands) => {
      expect((await route(port)).success).toBe(false); expect(commands).toEqual([])
    }, prelude.replace('Device present: true', 'Device present: needs_update'))
  })
  it('última atualização contraditória no mesmo bloco/chunk impede sucesso', async () => {
    await withPeer((block, socket) => {
      if (block === 'PING:' || block.includes('\n4 2')) socket.write('ACK\n\n')
      else socket.write('ACK\n\nVIDEO OUTPUT ROUTING:\n4 2\n\nVIDEO OUTPUT ROUTING:\n4 8\n\n')
    }, async port => { expect((await route(port)).success).toBe(false) })
  })
  it('ATEM/GPIO incompletos recusam operação física; simulação exige escolha explícita', async () => {
    expect((await new AtemSwitcherDriver().execute('TAKE', { input: 3 })).success).toBe(false)
    expect((await new GpioRelayDriver().execute('LATCH', { pin: 1, state: true })).success).toBe(false)
    expect((await new GpioRelayDriver(true).execute('LATCH', { pin: 1, state: true })).details).toMatchObject({ simulated: true, physicalExecutionConfirmed: false })
  })
  it('dois equipamentos do mesmo tipo exigem ID, ID errado/desativado nunca envia', async () => {
    const gateway = new StudioAutomationGateway()
    gateway.configureDevices([{ id: 'a', kind: 'VIDEOHUB_ROUTER', host: '127.0.0.1', port: 1, enabled: true }, { id: 'b', kind: 'VIDEOHUB_ROUTER', host: '127.0.0.1', port: 2, enabled: true }, { id: 'off', kind: 'VIDEOHUB_ROUTER', host: '127.0.0.1', port: 3, enabled: false }])
    const execute = vi.spyOn(VideohubRouterDriver.prototype, 'execute').mockResolvedValue({ success: true, details: { routeStatusConfirmed: true } })
    for (const deviceId of [undefined, 'absent', 'off']) expect((await gateway.execute({ deviceId, targetDevice: 'VIDEOHUB_ROUTER', action: 'PING', params: {} })).success).toBe(false)
    expect(execute).not.toHaveBeenCalled()
    expect((await gateway.execute({ deviceId: 'b', targetDevice: 'VIDEOHUB_ROUTER', action: 'PING', params: {} })).details?.deviceId).toBe('b')
    expect(execute).toHaveBeenCalledTimes(1)
  })
  it('serializa comandos do mesmo ID e recusa configuração alterada enquanto aguardava', async () => {
    const gateway = new StudioAutomationGateway(), device = { id: 'a', kind: 'VIDEOHUB_ROUTER', host: '127.0.0.1', port: 9990, enabled: true }
    gateway.configureDevices([device])
    let release!: (value: { success: boolean }) => void
    const execute = vi.spyOn(VideohubRouterDriver.prototype, 'execute').mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
    const command = { deviceId: 'a', targetDevice: 'VIDEOHUB_ROUTER' as const, action: 'PING', params: {} }
    const first = gateway.execute(command), second = gateway.execute(command)
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1))
    gateway.configureDevices([{ ...device, port: 9991 }]); release({ success: true })
    expect((await first).success).toBe(true)
    expect((await second).success).toBe(false)
    expect(execute).toHaveBeenCalledTimes(1)
  })
})
