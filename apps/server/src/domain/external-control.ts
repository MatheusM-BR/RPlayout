import { randomUUID } from 'node:crypto'
import type {
  ExternalControlAuditEntry,
  ExternalControlResult,
  ExternalDeviceCommand,
} from '@rplayout/protocol'
import { EXTERNAL_CONTROL_TOKEN } from '../config.js'
import { secretEquals } from './access.js'
import { VideohubRouterDriver, type DeviceReply } from './videohub-control.js'
export { VideohubRouterDriver } from './videohub-control.js'

/**
 * Contrato ATEM: simulação somente explícita. A integração física via SDK
 * ainda é pendente; um pacote UDP inicial não é comando de comutação.
 */
export class AtemSwitcherDriver {
  constructor(
    private readonly host: string = '127.0.0.1',
    private readonly port: number = 9910,
    private readonly simulated: boolean = false,
  ) {}

  async execute(action: string, params: Record<string, unknown>): Promise<{ success: boolean; details?: Record<string, unknown> }> {
    const input = Number(params.input ?? params.source ?? 1)
    const meIndex = Number(params.meIndex ?? 0)
    const transition = String(params.transition ?? 'CUT').toUpperCase()

    if (this.simulated) {
      // Em ambiente de desenvolvimento ou sem switch físico, simula execução determinística (< 25ms)
      return {
        success: true,
        details: {
          simulated: true,
          physicalExecutionConfirmed: false,
          action,
          input,
          meIndex,
          transition,
          host: this.host,
          port: this.port,
        },
      }
    }

    // A preliminary UDP handshake was not a TAKE. Never report an input
    // change until an actual SDK/driver can issue and read back that command.
    return { success: false, details: { error: 'Driver de comutação ATEM ainda não integrado. Nenhum TAKE físico foi enviado.', physicalExecutionConfirmed: false } }
  }
}

/**
 * Simulação explícita de GPIO para testes. Sem integração do protocolo de um
 * módulo real, PULSE/LATCH não podem anunciar acionamento físico.
 */
export class GpioRelayDriver {
  private pinStates = new Map<number, boolean>()
  constructor(private readonly simulated = false) {}

  async execute(action: string, params: Record<string, unknown>): Promise<{ success: boolean; details?: Record<string, unknown> }> {
    if (!this.simulated) return { success: false, details: { error: 'Protocolo físico de GPIO não integrado. Nenhum relé foi acionado.', physicalExecutionConfirmed: false } }
    const pin = Number(params.pin ?? params.relayIndex ?? 1)
    const normalizedAction = action.toUpperCase()

    if (normalizedAction === 'PULSE') {
      const durationMs = Math.min(500, Math.max(50, Number(params.durationMs ?? 150)))
      this.pinStates.set(pin, true)
      setTimeout(() => {
        this.pinStates.set(pin, false)
      }, durationMs)

      return {
        success: true,
        details: {
          simulated: true,
          physicalExecutionConfirmed: false,
          mode: 'PULSE',
          pin,
          durationMs,
          state: 'PULSED',
        },
      }
    }

    if (normalizedAction === 'LATCH') {
      const state = params.state !== undefined ? Boolean(params.state) : true
      this.pinStates.set(pin, state)
      return {
        success: true,
        details: {
          simulated: true,
          physicalExecutionConfirmed: false,
          mode: 'LATCH',
          pin,
          state,
        },
      }
    }

    return {
      success: false,
      details: { error: `Ação GPIO desconhecida: ${action}` },
    }
  }

  getPinState(pin: number): boolean {
    return this.pinStates.get(pin) ?? false
  }
}

/**
 * Gateway unificado de automação Master Control (MCR) para dispositivos externos.
 * Gerencia validação de token, despacho e auditoria com registro de latência.
 */
export class StudioAutomationGateway {
  private readonly gpioDriver = new GpioRelayDriver()
  private readonly auditLog: ExternalControlAuditEntry[] = []
  private devices = new Map<string, { id: string; kind: string; host: string; port: number; enabled: boolean }>()
  private readonly pending = new Map<string, Promise<unknown>>()

  configureDevices(rows: Array<{ id: string; kind: string; host: string; port: number; enabled: boolean }>): void {
    this.devices = new Map(rows.map(row => [row.id, { ...row }]))
  }

  validateToken(token?: string): boolean {
    if (!EXTERNAL_CONTROL_TOKEN || EXTERNAL_CONTROL_TOKEN.trim() === '') {
      // Se não há token configurado no ambiente, acesso interno é liberado
      return true
    }
    return Boolean(token && secretEquals(token.trim(), EXTERNAL_CONTROL_TOKEN.trim()))
  }

  async execute(
    cmd: ExternalDeviceCommand,
    clientToken?: string,
    pgmTimecode = '00:00:00:00',
    canDispatch?: () => boolean,
  ): Promise<ExternalControlResult> {
    const start = performance.now()
    const token = cmd.token ?? clientToken

    if (!this.validateToken(token)) {
      const latencyMs = Math.round((performance.now() - start) * 100) / 100
      const audit: ExternalControlAuditEntry = {
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        pgmTimecode,
        targetDevice: cmd.targetDevice,
        action: cmd.action,
        latencyMs,
        executionStatus: 'FAILED',
        error: 'Chave de controle externo inválida ou ausente.',
      }
      this.recordAudit(audit)

      return {
        success: false,
        targetDevice: cmd.targetDevice,
        action: cmd.action,
        latencyMs,
        pgmTimecode,
        status: 'FAILED',
        error: audit.error,
      }
    }

    let result: DeviceReply
    const target = cmd.targetDevice.toUpperCase()
    const candidates = [...this.devices.values()].filter(device => device.kind === target && device.enabled)
    const device = cmd.deviceId ? this.devices.get(cmd.deviceId) : candidates.length === 1 ? candidates[0] : undefined
    try {
      if (!['ATEM_SWITCHER', 'VIDEOHUB_ROUTER', 'GPIO_RELAY'].includes(target)) {
        result = { success: false, details: { error: `Dispositivo não suportado: ${cmd.targetDevice}` } }
      } else if (!device || !device.enabled || device.kind !== target) {
        result = { success: false, details: { error: candidates.length > 1 && !cmd.deviceId ? 'Mais de um equipamento deste tipo está ativo. Selecione o dispositivo pelo ID.' : 'Equipamento não configurado, desabilitado ou de outro tipo.' } }
      } else {
        const previous = this.pending.get(device.id) ?? Promise.resolve()
        const task = previous.catch(() => {}).then(async (): Promise<DeviceReply> => {
          const current = this.devices.get(device.id)
          if (!current?.enabled || current.kind !== device.kind || current.host !== device.host || current.port !== device.port || canDispatch && !canDispatch()) return { success: false, details: { error: 'Configuração ou contexto operacional mudou antes do envio. Comando não enviado.' } }
          if (target === 'VIDEOHUB_ROUTER') return new VideohubRouterDriver(device.host, device.port).execute(cmd.action, cmd.params, canDispatch)
          if (target === 'ATEM_SWITCHER') return new AtemSwitcherDriver(device.host, device.port).execute(cmd.action, cmd.params)
          return this.gpioDriver.execute(cmd.action, cmd.params)
        })
        this.pending.set(device.id, task)
        try { result = await task } finally { if (this.pending.get(device.id) === task) this.pending.delete(device.id) }
        result = { ...result, details: { ...result.details, deviceId: device.id } }
      }
    } catch (err) {
      result = { success: false, details: { error: (err as Error).message } }
    }

    const latencyMs = Math.round((performance.now() - start) * 100) / 100
    const status = result.success
      ? 'SUCCESS'
      : (result.details?.error?.toString().includes('TIMEOUT') ? 'ERROR_TIMEOUT' : 'FAILED')

    const audit: ExternalControlAuditEntry = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      pgmTimecode,
      targetDevice: cmd.targetDevice,
      action: cmd.action,
      latencyMs,
      executionStatus: status,
      details: result.details,
      error: !result.success ? String(result.details?.error ?? 'Falha de execução') : undefined,
    }
    this.recordAudit(audit)

    return {
      success: result.success,
      targetDevice: cmd.targetDevice,
      action: cmd.action,
      latencyMs,
      pgmTimecode,
      status,
      error: audit.error,
      details: result.details,
    }
  }

  private recordAudit(entry: ExternalControlAuditEntry): void {
    this.auditLog.push(entry)
    if (this.auditLog.length > 1000) {
      this.auditLog.shift()
    }
  }

  getAuditEntries(limit = 100): ExternalControlAuditEntry[] {
    return this.auditLog.slice(-limit).reverse()
  }

  getGpioDriver(): GpioRelayDriver {
    return this.gpioDriver
  }
}

export const globalStudioAutomationGateway = new StudioAutomationGateway()
