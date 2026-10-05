import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import type { ExternalControlResult, SecondaryEvent } from '@rplayout/protocol'
import { openDatabase } from '../db/client.js'
import { externalDevices, secondaryEventRuns } from '../db/schema.js'
import { equipmentIdentity, freezeDeviceAutomation, scheduledDeviceSchema, ScheduledDeviceAutomation } from './device-automation.js'
import { ExternalCommandLedger } from './external-command-ledger.js'
import { SecondaryEventLedger, SecondaryEventUncertain } from './secondary-event-ledger.js'

let database: ReturnType<typeof openDatabase>
const device = { id: 'router', name: 'QA local', kind: 'VIDEOHUB_ROUTER' as const, host: '127.0.0.1', port: 9990, enabled: true, createdAt: 'now' }
const event: SecondaryEvent = { id: 'event', rundownItemId: 'item', channelId: 'ch', name: 'Roteamento', type: 'DEVICE_AUTOMATION', triggerMode: 'OFFSET_FROM_START', offsetFrames: 25, targetLayer: 'LOWER_THIRD', templateId: '', payload: {}, enabled: true, deviceConfig: { deviceId: device.id, targetDevice: 'VIDEOHUB_ROUTER', action: 'ROUTE_CROSSPOINT', params: { destination: 4, source: 2 } } }
const context = { channelId: 'ch', itemId: 'item', eventId: event.id, executionId: 'pass', revisionId: 'revision' }
const result = (success = true, uncertain = false): ExternalControlResult => ({ success, action: 'ROUTE_CROSSPOINT', targetDevice: 'VIDEOHUB_ROUTER', latencyMs: 1, status: success ? 'SUCCESS' : 'FAILED', details: { routeStatusConfirmed: success, physicalExecutionConfirmed: false, uncertain } })
beforeEach(() => { database = openDatabase(':memory:'); database.db.insert(externalDevices).values(device).run() })
afterEach(() => database.sqlite.close())

describe('automação publicada usa equipamento explícito e ledger durável compartilhado', () => {
  it('congela identidade do equipamento sem token, não envia nada na simulação e não confunde portas/configuração', () => {
    const frozen = freezeDeviceAutomation(database.db, event)
    expect(frozen.deviceConfig?.configurationHash).toBe(equipmentIdentity(device))
    expect(event.deviceConfig?.configurationHash).toBeUndefined()
    expect(new ExternalCommandLedger(database.db).list()).toEqual([])
    for (const value of [{ ...event.deviceConfig, token: 'PRIVATE_TOKEN' }, { ...event.deviceConfig, params: { source: 2 } }, { ...event.deviceConfig, params: { source: 2, destination: '4' } }, { ...event.deviceConfig, targetDevice: 'ATEM_SWITCHER' }]) expect(scheduledDeviceSchema.safeParse(value).success).toBe(false)
    expect(() => freezeDeviceAutomation(database.db, { ...event, durationFrames: 25 })).toThrow('retorno')
  })
  it('despacha uma vez e conserva confirmação/metadados após recriar serviço', async () => {
    const frozen = freezeDeviceAutomation(database.db, event), dispatch = vi.fn(async () => result())
    await new ScheduledDeviceAutomation(database.db, dispatch).execute(context, frozen, () => true)
    await new ScheduledDeviceAutomation(database.db, dispatch).execute(context, frozen, () => true)
    expect(dispatch).toHaveBeenCalledOnce()
    expect(new ExternalCommandLedger(database.db).list()[0]).toMatchObject({ state: 'EXECUTED', command: { deviceId: device.id, destination: 4, source: 2, origin: { kind: 'SECONDARY_EVENT', executionId: 'pass', revisionId: 'revision', channelId: 'ch', eventId: event.id } }, result: { details: { physicalExecutionConfirmed: false } } })
  })
  it('equipamento alterado/desativado ou PGM diferente não recebe o comando da revisão antiga', async () => {
    const frozen = freezeDeviceAutomation(database.db, event), dispatch = vi.fn(async () => result()), service = new ScheduledDeviceAutomation(database.db, dispatch)
    await expect(service.execute(context, frozen, () => false)).rejects.toThrow('PGM')
    await database.db.update(externalDevices).set({ port: 9991 }).where(eq(externalDevices.id, device.id))
    await expect(service.execute(context, frozen, () => true)).rejects.toThrow('mudou')
    expect(freezeDeviceAutomation(database.db, event).deviceConfig?.configurationHash).not.toBe(frozen.deviceConfig?.configurationHash)
    await database.db.update(externalDevices).set({ enabled: false }).where(eq(externalDevices.id, device.id))
    expect(() => freezeDeviceAutomation(database.db, event)).toThrow('desativado')
    expect(dispatch).not.toHaveBeenCalled(); expect(new ExternalCommandLedger(database.db).list()).toHaveLength(0)
  })
  it('resultado incerto fica FIRING nos dois registros, bloqueia comando manual e não se repete', async () => {
    const frozen = freezeDeviceAutomation(database.db, event), dispatch = vi.fn(async () => result(false, true)), service = new ScheduledDeviceAutomation(database.db, dispatch)
    const ledger = new SecondaryEventLedger(database.db, 'ch'), passage = { executionId: context.executionId, itemId: context.itemId, revisionId: context.revisionId, frames: 25 }
    await ledger.execute(passage, frozen, 'FIRE', () => service.execute(context, frozen, () => true))
    await ledger.execute(passage, frozen, 'FIRE', () => service.execute(context, frozen, () => true))
    expect(dispatch).toHaveBeenCalledOnce()
    expect(database.db.select().from(secondaryEventRuns).get()).toMatchObject({ state: 'FIRING', completedAt: null })
    const commands = new ExternalCommandLedger(database.db)
    await expect(commands.execute('new-manual', { deviceId: device.id, action: 'ROUTE_CROSSPOINT', destination: 1, source: 1 }, 'operator', async () => result())).rejects.toThrow('incerto')
    expect(commands.acknowledge(commands.list()[0]!.requestId, 'operator', 'Destino conferido na bancada, sem repetir o pedido.')).toBe(true)
    await ledger.execute(passage, frozen, 'FIRE', () => service.execute(context, frozen, () => true))
    expect(dispatch).toHaveBeenCalledOnce()
  })
  it('sucesso sem confirmação do crosspoint é incerto, não EXECUTED', async () => {
    const dispatch = vi.fn(async () => ({ ...result(), details: { routeStatusConfirmed: false } }))
    await expect(new ScheduledDeviceAutomation(database.db, dispatch).execute(context, freezeDeviceAutomation(database.db, event), () => true)).rejects.toBeInstanceOf(SecondaryEventUncertain)
    expect(new ExternalCommandLedger(database.db).list()[0]?.state).toBe('FIRING')
  })
  it('falha do driver antes de confirmar mantém intenção incerta e protege reenvio', async () => {
    const dispatch = vi.fn(async () => { throw new Error('PASSWORD=PRIVATE_DRIVER') })
    await expect(new ScheduledDeviceAutomation(database.db, dispatch).execute(context, freezeDeviceAutomation(database.db, event), () => true)).rejects.toBeInstanceOf(SecondaryEventUncertain)
    expect(JSON.stringify(new ExternalCommandLedger(database.db).list())).not.toContain('PRIVATE_DRIVER')
  })
  it('a conferência de PGM/equipamento continua válida até a chamada do driver', async () => {
    let current = true
    const dispatch = vi.fn(async (_command, guard) => { current = false; expect(guard()).toBe(false); return result(false) })
    await expect(new ScheduledDeviceAutomation(database.db, dispatch).execute(context, freezeDeviceAutomation(database.db, event), () => current)).rejects.toThrow('recusada')
    expect(new ExternalCommandLedger(database.db).list()[0]?.state).toBe('FAILED')
  })
})
