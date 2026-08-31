import { spawn, type ChildProcess } from 'node:child_process'
import { createInterface } from 'node:readline'

export interface RelayTarget {
  readonly id: string
  readonly name: string
  readonly url: string
}

export type RelayState = 'CONECTANDO' | 'NO AR' | 'CAIU' | 'FALHOU'

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
}

interface Relay {
  target: RelayTarget
  child: ChildProcess
  state: RelayState
  attempts: number
  reason: string | null
  delivered: number
  streams: string[]
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

  constructor(private readonly binary: string) {}

  /** Faz os processos baterem com a lista de destinos ligados. */
  sync(targets: readonly RelayTarget[], source: string): void {
    if (this.binary === '') return

    const wanted = new Map(targets.map((target) => [target.id, target]))

    for (const [id, relay] of this.relays) {
      const target = wanted.get(id)
      // Destino removido ou com endereço trocado: o processo antigo não serve.
      if (!target || target.url !== relay.target.url) {
        relay.child.kill()
        this.relays.delete(id)
      }
    }

    for (const target of targets) {
      if (this.relays.has(target.id)) continue
      this.spawn(target, source)
    }
  }

  private spawn(target: RelayTarget, source: string): void {
    const child = spawn(this.binary, ['--from', source, '--to', target.url], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const relay: Relay = {
      target,
      child,
      state: 'CONECTANDO',
      attempts: 0,
      reason: null,
      delivered: 0,
      streams: [],
    }
    this.relays.set(target.id, relay)

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
          }
          switch (event.event) {
            case 'connecting':
              relay.state = 'CONECTANDO'
              relay.attempts = event.attempt ?? relay.attempts
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
              break
            case 'disconnected':
              relay.state = 'CAIU'
              relay.reason = event.reason ?? null
              break
            case 'fatal':
              relay.state = 'FALHOU'
              relay.reason = event.message ?? null
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
    })
  }

  status(): RelayStatus[] {
    return [...this.relays.values()].map((relay) => ({
      id: relay.target.id,
      name: relay.target.name,
      url: relay.target.url,
      state: relay.state,
      attempts: relay.attempts,
      reason: relay.reason,
      delivered: relay.delivered,
      streams: relay.streams,
    }))
  }

  closeAll(): void {
    for (const relay of this.relays.values()) relay.child.kill()
    this.relays.clear()
  }
}
