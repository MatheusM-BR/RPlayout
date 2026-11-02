import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import type { ExternalControlResult, SecondaryEvent } from '@rplayout/protocol'
import type { Db } from '../db/client.js'
import { externalDevices } from '../db/schema.js'
import { EXTERNAL_CONTROL_TOKEN } from '../config.js'
import { globalStudioAutomationGateway } from './external-control.js'
import { ExternalCommandLedger } from './external-command-ledger.js'
import { SecondaryEventUncertain } from './secondary-event-ledger.js'

const port = z.number().int().min(0).max(65_535)
export const scheduledDeviceSchema = z.object({
  deviceId: z.string().min(1).max(200), targetDevice: z.literal('VIDEOHUB_ROUTER'),
  action: z.enum(['PING', 'ROUTE_CROSSPOINT']),
  params: z.object({ destination: port.optional(), source: port.optional() }).strict(),
  configurationHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict().refine(value => value.action === 'PING' || value.params.destination !== undefined && value.params.source !== undefined, 'Informe entrada e saída explícitas.')
type Device = { id: string; kind: string; host: string; port: number; enabled: boolean }
export const equipmentIdentity = (device: Device) => createHash('sha256').update(JSON.stringify([device.id, device.kind, device.host, device.port])).digest('hex')

export function freezeDeviceAutomation(db: Pick<Db,'select'>, event: SecondaryEvent): SecondaryEvent {
  if (event.type !== 'DEVICE_AUTOMATION' && !event.deviceConfig) return event
  if (event.type !== 'DEVICE_AUTOMATION' || event.scteConfig || event.durationFrames) throw new Error('Automação exige tipo DEVICE_AUTOMATION explícito e não possui retorno/descarte automático.')
  const parsed = scheduledDeviceSchema.safeParse(event.deviceConfig)
  if (!parsed.success) throw new Error('Automação de equipamento inválida. Escolha Videohub, ação e portas explícitas; não inclua token ou credencial.')
  const device = db.select().from(externalDevices).where(eq(externalDevices.id, parsed.data.deviceId)).get()
  if (!device?.enabled || device.kind !== 'VIDEOHUB_ROUTER') throw new Error('Equipamento ausente/desativado ou driver indisponível. Nenhum comando foi enviado.')
  return { ...event, deviceConfig: { ...parsed.data, configurationHash: equipmentIdentity(device) } }
}

interface Execution { channelId: string; itemId: string; eventId: string; executionId: string; revisionId: string }
type Dispatch = (command: NonNullable<SecondaryEvent['deviceConfig']>, canDispatch: () => boolean) => Promise<ExternalControlResult>

/** Share the manual equipment ledger. Unknown crosspoint blocks ALL later
 * manual/scheduled routes, not just retries of this event or this channel. */
export class ScheduledDeviceAutomation {
  private readonly ledger: ExternalCommandLedger
  constructor(private readonly db: Db, private readonly dispatch?: Dispatch) { this.ledger = new ExternalCommandLedger(db) }
  async execute(context: Execution, event: SecondaryEvent, isCurrent: () => boolean): Promise<void> {
    const parsed = scheduledDeviceSchema.safeParse(event.deviceConfig)
    if (!parsed.success || !parsed.data.configurationHash || event.type !== 'DEVICE_AUTOMATION' || event.durationFrames || event.scteConfig) throw new Error('Publique uma configuração explícita e válida do equipamento antes do disparo.')
    if (!context.revisionId || context.eventId !== event.id || context.itemId !== event.rundownItemId || !isCurrent()) throw new Error('Automação exige o item publicado confirmado no PGM.')
    const command = parsed.data
    const canDispatch = () => {
      const current = this.db.select().from(externalDevices).where(eq(externalDevices.id, command.deviceId)).get()
      return Boolean(current?.enabled && current.kind === 'VIDEOHUB_ROUTER' && equipmentIdentity(current) === command.configurationHash && isCurrent())
    }
    if (!canDispatch()) throw new Error('Cadastro do equipamento mudou após publicação ou PGM não corresponde. Publique uma nova revisão; nenhum comando foi enviado.')
    const requestId = 'secondary-' + createHash('sha256').update(JSON.stringify([context.channelId, context.executionId, event.id])).digest('hex')
    const normalized = { deviceId: command.deviceId, action: command.action, ...command.params, origin: { kind: 'SECONDARY_EVENT' as const, channelId: context.channelId, eventId: event.id, executionId: context.executionId, revisionId: context.revisionId } }
    try {
      const outcome = await this.ledger.execute(requestId, normalized, '@secondary', async () => {
        if (!canDispatch()) return { success: false, targetDevice: 'VIDEOHUB_ROUTER', action: command.action, status: 'FAILED', latencyMs: 0, error: 'Contexto mudou antes do envio.' }
        let result: ExternalControlResult
        if (this.dispatch) result = await this.dispatch(command, canDispatch)
        else {
          globalStudioAutomationGateway.configureDevices(this.db.select().from(externalDevices).all())
          result = await globalStudioAutomationGateway.execute(command, EXTERNAL_CONTROL_TOKEN, undefined, canDispatch)
        }
        if (result.success && command.action === 'ROUTE_CROSSPOINT' && result.details?.routeStatusConfirmed !== true) return { ...result, success: false, status: 'FAILED', details: { ...result.details, uncertain: true }, error: 'Crosspoint não confirmado pelo estado do equipamento.' }
        return result
      })
      if (outcome.run.state === 'FIRING') throw new SecondaryEventUncertain('Resultado de equipamento incerto.')
      if (outcome.run.state !== 'EXECUTED') throw new Error('Automação recusada; consulte o pedido persistente do equipamento.')
    } catch (error) {
      if (this.ledger.list().some(run => run.requestId === requestId && run.state === 'FIRING')) throw new SecondaryEventUncertain('Pedido sem confirmação persistida; confira o equipamento.')
      throw error
    }
  }
}
