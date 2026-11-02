import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openDatabase as openDb } from '../db/client.js'
import { ExternalCommandLedger } from './external-command-ledger.js'

let directory: string, database: ReturnType<typeof openDb>, ledger: ExternalCommandLedger
const command = { deviceId: 'matrix', action: 'ROUTE_CROSSPOINT' as const, destination: 4, source: 2 }
const reply = { success: true, targetDevice: 'VIDEOHUB_ROUTER', action: command.action, latencyMs: 12, status: 'SUCCESS' as const, details: { routeStatusConfirmed: true, physicalExecutionConfirmed: false } }
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'playout-device-ledger-')); database = openDb(join(directory, 'ledger.db')); ledger = new ExternalCommandLedger(database.db) })
afterEach(() => { database.sqlite.close(); rmSync(directory, { recursive: true, force: true }) })

describe('registro durável de pedidos manuais de equipamento', () => {
  it('duplicata após reabertura devolve confirmação anterior sem repetir efeito', async () => {
    const requestId = randomUUID(), work = vi.fn(async () => reply)
    expect((await ledger.execute(requestId, command, 'operator', work)).run.state).toBe('EXECUTED')
    database.sqlite.close(); database = openDb(join(directory, 'ledger.db')); ledger = new ExternalCommandLedger(database.db)
    const duplicate = await ledger.execute(requestId, command, 'operator', work)
    expect(duplicate.deduplicated).toBe(true); expect(duplicate.run.result?.details?.routeStatusConfirmed).toBe(true)
    expect(work).toHaveBeenCalledTimes(1); expect(ledger.list()).toHaveLength(1)
  })
  it('registra intenção antes do envio e pedido simultâneo não repete comando', async () => {
    let release!: (value: typeof reply) => void
    const work = vi.fn(() => new Promise<typeof reply>(resolve => { release = resolve })), requestId = randomUUID()
    const pending = ledger.execute(requestId, command, null, work)
    expect(ledger.list()[0]?.state).toBe('FIRING')
    const duplicate = await ledger.execute(requestId, command, null, work)
    expect(duplicate.run.state).toBe('FIRING'); expect(duplicate.deduplicated).toBe(true)
    release(reply); expect((await pending).run.state).toBe('EXECUTED'); expect(work).toHaveBeenCalledTimes(1)
  })
  it('queda/exceção deixa FIRING; reconstruir o ledger não reenvia operação incerta', async () => {
    const requestId = randomUUID(), work = vi.fn(async () => { throw new Error('Crash após envio') })
    await expect(ledger.execute(requestId, command, null, work)).rejects.toThrow('Crash')
    ledger = new ExternalCommandLedger(database.db)
    expect((await ledger.execute(requestId, command, null, work)).run.state).toBe('FIRING')
    expect(work).toHaveBeenCalledTimes(1)
  })
  it('mesmo ID com parâmetros/ator diferentes é recusado, sem efeito ou vazamento', async () => {
    const requestId = randomUUID(), work = vi.fn(async () => reply)
    await ledger.execute(requestId, command, 'a', work)
    await expect(ledger.execute(requestId, { ...command, source: 3 }, 'a', work)).rejects.toThrow('outro pedido')
    await expect(ledger.execute(requestId, command, 'b', work)).rejects.toThrow('outro pedido')
    expect(work).toHaveBeenCalledTimes(1)
  })
  it('resultado em falha é registrado/marcado e consulta não expõe credenciais do driver', async () => {
    const result = await ledger.execute(randomUUID(), command, null, async () => ({ ...reply, success: false, status: 'FAILED', error: 'https://host/PRIVATE_HOOK falhou', details: { authorization: 'PRIVATE_AUTH' } }))
    expect(result.run.state).toBe('FAILED')
    expect(JSON.stringify(ledger.list())).not.toMatch(/PRIVATE_HOOK|PRIVATE_AUTH/)
    expect(JSON.stringify(database.sqlite.prepare('SELECT payload FROM operator_decisions').all())).not.toContain('PRIVATE_HOOK')
  })
  it('novo roteamento fica bloqueado até reconhecimento explícito; consulta e original não são reenviados', async () => {
    const requestId = randomUUID(), work = vi.fn(async () => { throw new Error('Crash') })
    await expect(ledger.execute(requestId, command, 'operator', work)).rejects.toThrow('Crash')
    await expect(ledger.execute(randomUUID(), command, 'operator', work)).rejects.toThrow('outro pedido incerto')
    expect(work).toHaveBeenCalledTimes(1)
    await ledger.execute(randomUUID(), { deviceId: command.deviceId, action: 'PING' }, 'operator', async () => reply)
    expect(ledger.acknowledge(requestId, 'supervisor', 'Conferi a matriz no painel do equipamento')).toBe(true)
    expect(ledger.list().find(run => run.requestId === requestId)).toMatchObject({ state: 'CLOSED_UNCERTAIN', acknowledgedBy: 'supervisor' })
    expect((await ledger.execute(requestId, command, 'operator', work)).deduplicated).toBe(true)
    expect((await ledger.execute(randomUUID(), command, 'operator', async () => reply)).run.state).toBe('EXECUTED')
    expect(work).toHaveBeenCalledTimes(1)
  })
  it('pedido ainda executando não pode ser liberado nem desaparecer após cem consultas', async () => {
    const requestId = randomUUID(); let release!: (value: typeof reply) => void
    const pending = ledger.execute(requestId, command, null, () => new Promise(resolve => { release = resolve }))
    expect(() => ledger.acknowledge(requestId, null, 'Conferência manual inválida enquanto envia')).toThrow('em andamento')
    for (let index = 0; index < 102; index++) await ledger.execute(randomUUID(), { deviceId: 'another', action: 'PING' }, null, async () => reply)
    expect(ledger.list().find(run => run.requestId === requestId)?.state).toBe('FIRING')
    release(reply); await pending
  })
  it('timeout após envio mantém incerteza e bloqueia novo roteamento', async () => {
    const requestId = randomUUID()
    const run = await ledger.execute(requestId, command, null, async () => ({ ...reply, success: false, status: 'ERROR_TIMEOUT', details: { uncertain: true, acknowledged: true } }))
    expect(run.run.state).toBe('FIRING')
    await expect(ledger.execute(randomUUID(), command, null, async () => reply)).rejects.toThrow('outro pedido incerto')
  })
})
