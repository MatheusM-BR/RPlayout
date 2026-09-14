import { spawn, type ChildProcess } from 'node:child_process'
import { createInterface } from 'node:readline'

function parsed(url: string): URL | null {
  try { return new URL(url) } catch { return null }
}
function transportOf(url: string): 'SRT' | 'RTMP' | 'OTHER' {
  const protocol = parsed(url)?.protocol.toLowerCase()
  if (protocol === 'srt:') return 'SRT'
  if (protocol === 'rtmp:' || protocol === 'rtmps:') return 'RTMP'
  return 'OTHER'
}
function modeOf(url: string): 'CALLER' | 'LISTENER' | 'RENDEZVOUS' | 'UNKNOWN' {
  const value = parsed(url)?.searchParams.get('mode')?.toUpperCase()
  return value === 'CALLER' || value === 'LISTENER' || value === 'RENDEZVOUS' ? value : 'UNKNOWN'
}
function latencyOf(url: string): number | null {
  const value = Number(parsed(url)?.searchParams.get('latency'))
  return Number.isFinite(value) && value >= 0 ? value : null
}
export function redactUrl(url: string): string {
  try {
    const value = new URL(url)
    for (const key of ['passphrase', 'password', 'secret', 'token']) {
      if (value.searchParams.has(key)) value.searchParams.set(key, '••••••')
    }
    return value.toString()
  } catch { return url }
}

export interface RelayTarget {
  readonly id: string
  readonly name: string
  readonly url: string
  readonly source: string
  /** Parâmetros operacionais do destino SRT; não contém senha. */
  readonly transport?: 'SRT' | 'RTMP' | 'OTHER'
  readonly mode?: 'CALLER' | 'LISTENER' | 'RENDEZVOUS' | 'UNKNOWN'
  readonly latencyMs?: number | null
  readonly primary?: boolean
  readonly backupFor?: string | null
}

export type RelayState = 'CONECTANDO' | 'NO AR' | 'CAIU' | 'FALHOU'

/** Só a confirmação de entrega autoriza desligar o backup. */
export const primaryHealthy = (state: RelayState | undefined): boolean => state === 'NO AR'

export interface RelayStatus {
  readonly id: string
  readonly name: string
  readonly url: string
  readonly state: RelayState
  readonly attempts: number
  readonly reason: string | null
  /** Buffers entregues ao destino. Cresce enquanto o sinal está passando. */
  readonly delivered: number
  /** Fluxos que a origem ofereceu, como o relay os classificou. */
  readonly streams: readonly string[]
  readonly transport: 'SRT' | 'RTMP' | 'OTHER'
  readonly mode: 'CALLER' | 'LISTENER' | 'RENDEZVOUS' | 'UNKNOWN'
  readonly latencyMs: number | null
  readonly rttMs: number | null
  readonly lossPct: number | null
  readonly bitrateKbps: number | null
  readonly primary: boolean
  readonly backupFor: string | null
}

interface Relay {
  target: RelayTarget
  child: ChildProcess
  state: RelayState
  attempts: number
  reason: string | null
  delivered: number
  streams: string[]
  rttMs: number | null
  lossPct: number | null
  bitrateKbps: number | null
  nextRetryAt: number
}

/**
 * Um processo por destino externo.
 *
 * É o isolamento que importa: um destino cair não pode tocar no encoder, nos
 * outros destinos nem na saída SDI. Como cada um vive no próprio processo,
 * não tem como tocar.
 */
export class RelaySupervisor {
  private readonly relays = new Map<string, Relay>()
  private desired = new Map<string, RelayTarget>()

  constructor(private readonly binary: string) {}

  /** Faz os processos baterem com a lista de destinos ligados. */
  sync(targets: readonly RelayTarget[]): void {
    if (this.binary === '') return

    const wanted = new Map(targets.map((target) => [target.id, target]))
    this.desired = wanted

    for (const [id, relay] of this.relays) {
      const target = wanted.get(id)
      // Destino removido ou com endereço trocado: o processo antigo não serve.
      if (!target || target.url !== relay.target.url || target.source !== relay.target.source) {
        relay.child.kill()
        this.relays.delete(id)
      }
    }

    for (const target of targets.filter((candidate) => candidate.primary !== false && !candidate.backupFor)) {
      const current = this.relays.get(target.id)
      // Um processo que terminou não volta sozinho. A próxima sincronização
      // deve substituí-lo, mantendo a supervisão viva após uma queda.
      if (current && (current.state === 'FALHOU' || current.state === 'CAIU' || current.child.exitCode !== null)) {
        current.child.kill()
        this.relays.delete(target.id)
      }
      if (this.relays.has(target.id)) continue
      this.spawn(target, target.source)
    }
  }

  private spawn(target: RelayTarget, source: string): void {
    const child = spawn(this.binary, ['--from', source, '--to', target.url], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })

    const relay: Relay = {
      target,
      child,
      state: 'CONECTANDO',
      attempts: 0,
      reason: null,
      delivered: 0,
      streams: [],
      rttMs: null,
      lossPct: null,
      bitrateKbps: null,
      nextRetryAt: 0,
    }
    this.relays.set(target.id, relay)
    child.on('error', (error) => {
      if (this.relays.get(target.id) !== relay) return
      relay.state = 'FALHOU'
      relay.reason = `Não foi possível iniciar o relay: ${error.message}`
    })

    if (child.stdout) {
      createInterface({ input: child.stdout }).on('line', (line) => {
        if (line.trim() === '') return
        try {
          const event = JSON.parse(line) as {
            event: string
            attempt?: number
            reason?: string
            message?: string
            sink?: number
            streams?: string[]
            rttMs?: number
            lossPct?: number
            bitrateKbps?: number
          }
          switch (event.event) {
            case 'connecting':
              relay.state = 'CONECTANDO'
              relay.attempts = event.attempt ?? relay.attempts
              relay.nextRetryAt = 0
              break
            case 'assembled':
              relay.streams = event.streams ?? []
              break
            case 'connected':
              relay.state = 'NO AR'
              relay.reason = null
              break
            case 'flow':
              // Entregue de verdade, não "conectado": é o número que diz se o
              // destino está recebendo alguma coisa.
              relay.delivered = event.sink ?? relay.delivered
              relay.rttMs = event.rttMs ?? relay.rttMs
              relay.lossPct = event.lossPct ?? relay.lossPct
              relay.bitrateKbps = event.bitrateKbps ?? relay.bitrateKbps
              break
            case 'disconnected':
              relay.state = 'CAIU'
              relay.reason = event.reason ?? null
              relay.nextRetryAt = Date.now() + retryDelay(relay.attempts)
              break
            case 'fatal':
              relay.state = 'FALHOU'
              relay.reason = event.message ?? null
              relay.nextRetryAt = Date.now() + retryDelay(relay.attempts)
              break
            default:
              break
          }
        } catch {
          // Linha malformada não derruba a supervisão.
        }
      })
    }
    child.stderr?.on('data', (chunk: Buffer) => {
      process.stderr.write(`[relay ${target.name}] ${chunk.toString()}`)
    })
    child.on('exit', () => {
      const current = this.relays.get(target.id)
      if (current?.child === child) current.state = 'FALHOU'
      if (current?.child === child) current.nextRetryAt = Date.now() + retryDelay(current.attempts)
    })
  }

  /** Reabre apenas um destino que caiu, com backoff exponencial limitado. */
  tick(now = Date.now()): void {
    for (const [id, relay] of this.relays) {
      if (relay.state !== 'CAIU' && relay.state !== 'FALHOU') continue
      if (relay.nextRetryAt > now) continue
      relay.child.kill()
      this.relays.delete(id)
      this.spawn(relay.target, relay.target.source)
    }
    // Failover N+1: o backup só assume quando o primário está realmente
    // caído. Enquanto o primário voltar, não há dois encoders transmitindo.
    for (const primary of this.desired.values()) {
      if (primary.primary === false || primary.backupFor) continue
      const primaryRelay = this.relays.get(primary.id)
      const backup = [...this.desired.values()].find((candidate) => candidate.backupFor === primary.id)
      if (!backup) continue
      const backupRelay = this.relays.get(backup.id)
      const healthy = primaryHealthy(primaryRelay?.state)
      const failed = !healthy
      if (failed && !backupRelay) {
        this.spawn(backup, backup.source)
      } else if (healthy && backupRelay) {
        backupRelay.child.kill()
        this.relays.delete(backup.id)
      }
    }
  }

  status(): RelayStatus[] {
    return [...this.relays.values()].map((relay) => ({
      id: relay.target.id,
      name: relay.target.name,
      url: redactUrl(relay.target.url),
      state: relay.state,
      attempts: relay.attempts,
      reason: relay.reason,
      delivered: relay.delivered,
      streams: relay.streams,
      transport: relay.target.transport ?? transportOf(relay.target.url),
      mode: relay.target.mode ?? modeOf(relay.target.url),
      latencyMs: relay.target.latencyMs ?? latencyOf(relay.target.url),
      rttMs: relay.rttMs,
      lossPct: relay.lossPct,
      bitrateKbps: relay.bitrateKbps,
      primary: relay.target.primary ?? true,
      backupFor: relay.target.backupFor ?? null,
    }))
  }

  closeAll(): void {
    for (const relay of this.relays.values()) relay.child.kill()
    this.relays.clear()
  }
}

function retryDelay(attempts: number): number {
  return Math.min(30_000, 1_000 * 2 ** Math.min(5, Math.max(0, attempts)))
}
