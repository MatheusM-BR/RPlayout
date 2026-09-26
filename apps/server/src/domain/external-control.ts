import { randomUUID } from 'node:crypto'
import dgram from 'node:dgram'
import net from 'node:net'
import type {
  ExternalControlAuditEntry,
  ExternalControlResult,
  ExternalDeviceCommand,
} from '@rplayout/protocol'
import { EXTERNAL_CONTROL_TOKEN } from '../config.js'

/**
 * Driver para switcher de produção Blackmagic ATEM.
 * Comunica via protocolo UDP (porta padrão 9910).
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
          action,
          input,
          meIndex,
          transition,
          host: this.host,
          port: this.port,
        },
      }
    }

    return new Promise((resolve) => {
      const socket = dgram.createSocket('udp4')
      let finished = false
      const finish = (value: { success: boolean; details?: Record<string, unknown> }) => {
        if (finished) return
        finished = true
        clearTimeout(timeout)
        try { socket.close() } catch {}
        resolve(value)
      }
      const timeout = setTimeout(() => {
        finish({ success: false, details: { error: 'TIMEOUT_WAITING_ATEM_ACK', host: this.host, port: this.port } })
      }, 500)

      // Montagem preliminar do pacote binário ATEM
      const msg = Buffer.alloc(12)
      msg.writeUInt8(0x08, 0) // Bit flag ATEM Init
      msg.writeUInt16BE(12, 2) // Packet length

      socket.send(msg, this.port, this.host, (err) => {
        if (err) {
          finish({ success: false, details: { error: err.message } })
          return
        }
      })
      socket.once('message', () => finish({ success: true, details: { host: this.host, port: this.port, input, meIndex, acknowledged: true } }))
    })
  }
}

/**
 * Driver para matriz de roteamento Blackmagic Videohub.
 * Comunica via protocolo de texto TCP (porta padrão 9990).
 */
export class VideohubRouterDriver {
  constructor(
    private readonly host: string = '127.0.0.1',
    private readonly port: number = 9990,
    private readonly simulated: boolean = false,
  ) {}

  async execute(action: string, params: Record<string, unknown>): Promise<{ success: boolean; details?: Record<string, unknown> }> {
    const destination = Number(params.destination ?? params.dest ?? params.output ?? 0)
    const source = Number(params.source ?? params.src ?? params.input ?? 0)

    if (this.simulated) {
      return {
        success: true,
        details: {
          simulated: true,
          action,
          destination,
          source,
          host: this.host,
          port: this.port,
        },
      }
    }

    return new Promise((resolve) => {
      const socket = new net.Socket()
      let finished = false
      const finish = (value: { success: boolean; details?: Record<string, unknown> }) => {
        if (finished) return
        finished = true
        clearTimeout(timeout)
        socket.destroy()
        resolve(value)
      }
      const timeout = setTimeout(() => {
        finish({ success: false, details: { error: 'TIMEOUT_VIDEOHUB_TCP', host: this.host, port: this.port } })
      }, 500)

      socket.connect(this.port, this.host, () => {
        const cmd = `VIDEO OUTPUT ROUTING:\n${destination} ${source}\n\n`
        socket.write(cmd, () => {
          // A escrita no TCP só confirma o buffer local. O sucesso operacional
          // exige retorno do Videohub, recebido no handler abaixo.
        })
      })

      socket.once('data', () => finish({ success: true, details: { destination, source, routed: true, acknowledged: true } }))

      socket.on('error', (err) => {
        finish({ success: false, details: { error: err.message } })
      })
    })
  }
}

/**
 * Driver para módulos de relé GPIO e sinalizadores Tally ópticos.
 * Suporta acionamento por pulso temporizado (50ms a 500ms) e retenção (LATCH).
 */
export class GpioRelayDriver {
  private pinStates = new Map<number, boolean>()

  async execute(action: string, params: Record<string, unknown>): Promise<{ success: boolean; details?: Record<string, unknown> }> {
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
  private devices = new Map<string, { host: string; port: number; enabled: boolean }>()

  configureDevices(rows: Array<{ kind: string; host: string; port: number; enabled: boolean }>): void {
    this.devices = new Map(rows.map((row) => [row.kind, { host: row.host, port: row.port, enabled: row.enabled }]))
  }

  validateToken(token?: string): boolean {
    if (!EXTERNAL_CONTROL_TOKEN || EXTERNAL_CONTROL_TOKEN.trim() === '') {
      // Se não há token configurado no ambiente, acesso interno é liberado
      return true
    }
    return Boolean(token && token.trim() === EXTERNAL_CONTROL_TOKEN.trim())
  }

  async execute(
    cmd: ExternalDeviceCommand,
    clientToken?: string,
    pgmTimecode = '00:00:00:00',
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

    let result: { success: boolean; details?: Record<string, unknown> }
    const target = cmd.targetDevice.toUpperCase()

    try {
      if (target === 'ATEM_SWITCHER' || target === 'BLACKMAGIC_ATEM') {
        const device = this.devices.get('ATEM_SWITCHER')
        result = !device || !device.enabled
          ? { success: false, details: { error: 'ATEM não configurado ou desabilitado.' } }
          : await new AtemSwitcherDriver(device.host, device.port, false).execute(cmd.action, cmd.params)
      } else if (target === 'VIDEOHUB_ROUTER' || target === 'LEITCH_ROUTER') {
        const device = this.devices.get('VIDEOHUB_ROUTER')
        result = !device || !device.enabled
          ? { success: false, details: { error: 'Videohub não configurado ou desabilitado.' } }
          : await new VideohubRouterDriver(device.host, device.port, false).execute(cmd.action, cmd.params)
      } else if (target === 'GPIO_RELAY') {
        const device = this.devices.get('GPIO_RELAY')
        result = !device || !device.enabled
          ? { success: false, details: { error: 'GPIO não configurado ou desabilitado.' } }
          : await this.gpioDriver.execute(cmd.action, cmd.params)
      } else {
        result = { success: false, details: { error: `Dispositivo não suportado: ${cmd.targetDevice}` } }
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
