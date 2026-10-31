import { createHash } from 'node:crypto'
import { eq, desc } from 'drizzle-orm'
import type { ExternalControlResult } from '@rplayout/protocol'
import type { Db } from '../db/client.js'
import { operatorDecisions } from '../db/schema.js'
import { diagnosticValue } from './sanitize-diagnostic.js'

export interface ManualDeviceCommand { deviceId: string; action: 'PING' | 'ROUTE_CROSSPOINT'; destination?: number; source?: number; origin?: { kind: 'SECONDARY_EVENT'; channelId: string; eventId: string; executionId: string; revisionId: string } }
export interface DeviceCommandRun { requestId: string; state: 'FIRING' | 'EXECUTED' | 'FAILED' | 'CLOSED_UNCERTAIN'; command: ManualDeviceCommand; result?: ExternalControlResult; createdAt: string; actor: string | null; acknowledgedBy?: string | null; acknowledgedAt?: string; acknowledgement?: string }
export class DeviceCommandConflict extends Error {}
const key = (requestId: string) => 'device-command:' + requestId
const digest = (command: ManualDeviceCommand) => createHash('sha256').update(JSON.stringify([command.deviceId, command.action, command.destination ?? null, command.source ?? null, ...(command.origin ? [command.origin] : [])])).digest('hex')

/** Reuse the durable operator audit, with a stable unique intent ID. A crash
 * between dispatch and confirmation remains FIRING and is never replayed.
 * This does not claim exactly-once execution on an external device. */
export class ExternalCommandLedger {
  private readonly inFlight = new Set<string>()
  constructor(private readonly db: Db) {}
  async execute(requestId: string, command: ManualDeviceCommand, actor: string | null, work: () => Promise<ExternalControlResult>): Promise<{ run: DeviceCommandRun; deduplicated: boolean }> {
    const id = key(requestId), createdAt = new Date().toISOString(), hash = digest(command)
    if (!this.db.select().from(operatorDecisions).where(eq(operatorDecisions.id, id)).get() && command.action === 'ROUTE_CROSSPOINT' && this.all().some(run => run.command.deviceId === command.deviceId && run.state === 'FIRING')) throw new DeviceCommandConflict('Há outro pedido incerto neste equipamento. Confira o destino e reconheça a incerteza antes de um novo roteamento. Consulta sem corte continua disponível.')
    const claim = this.db.insert(operatorDecisions).values({ id, rundownId: '@devices', itemId: null, kind: 'DEVICE_COMMAND', actorUsername: actor,
      payload: { hash, requestId, command, state: 'FIRING' }, createdAt }).onConflictDoNothing().run()
    if (!claim.changes) {
      const previous = this.db.select().from(operatorDecisions).where(eq(operatorDecisions.id, id)).get()!
      const payload = previous.payload as unknown as DeviceCommandRun & { hash: string }
      if (previous.kind !== 'DEVICE_COMMAND' || previous.actorUsername !== actor || payload.hash !== hash) throw new DeviceCommandConflict('O identificador já pertence a outro pedido. Nenhum comando foi repetido.')
      return { run: { ...payload, createdAt: previous.createdAt, actor: previous.actorUsername }, deduplicated: true }
    }
    // Do not erase uncertain intent if the process, database or driver fails.
    // The caller must check the equipment before issuing a NEW request ID.
    this.inFlight.add(requestId)
    try {
      const result = diagnosticValue(await work())
      const run: DeviceCommandRun = { requestId, command, state: result.success ? 'EXECUTED' : result.details?.uncertain ? 'FIRING' : 'FAILED', result, createdAt, actor }
      this.db.update(operatorDecisions).set({ payload: { ...run, hash } }).where(eq(operatorDecisions.id, id)).run()
      return { run, deduplicated: false }
    } finally { this.inFlight.delete(requestId) }
  }
  acknowledge(requestId: string, actor: string | null, acknowledgement: string): boolean {
    if (this.inFlight.has(requestId)) throw new DeviceCommandConflict('O pedido ainda está em andamento. Aguarde sua conclusão antes de reconhecer a incerteza.')
    return this.db.transaction(tx => {
      const row = tx.select().from(operatorDecisions).where(eq(operatorDecisions.id, key(requestId))).get()
      const run = row?.payload as unknown as (DeviceCommandRun & { hash: string }) | undefined
      if (!row || row.kind !== 'DEVICE_COMMAND' || run?.state !== 'FIRING') return false
      tx.update(operatorDecisions).set({ payload: { ...run, state: 'CLOSED_UNCERTAIN', acknowledgedBy: actor, acknowledgedAt: new Date().toISOString(), acknowledgement: diagnosticValue(acknowledgement) } }).where(eq(operatorDecisions.id, row.id)).run()
      return true
    })
  }
  private all(): DeviceCommandRun[] {
    return this.db.select().from(operatorDecisions).where(eq(operatorDecisions.kind, 'DEVICE_COMMAND')).all().map(row => ({ ...(row.payload as unknown as DeviceCommandRun), createdAt: row.createdAt, actor: row.actorUsername }))
  }
  list(limit = 100): DeviceCommandRun[] {
    const latest = this.db.select().from(operatorDecisions).where(eq(operatorDecisions.kind, 'DEVICE_COMMAND')).orderBy(desc(operatorDecisions.createdAt)).limit(limit).all()
      .map(row => { const { hash: _hash, ...run } = row.payload as unknown as DeviceCommandRun & { hash: string }; return { ...run, createdAt: row.createdAt, actor: row.actorUsername } })
    // An old unresolved command must not disappear just because 100 later
    // read-only PINGs were recorded. Keep it visible until acknowledged.
    return [...latest, ...this.all().filter(run => run.state === 'FIRING' && !latest.some(recent => recent.requestId === run.requestId))]
  }
}
