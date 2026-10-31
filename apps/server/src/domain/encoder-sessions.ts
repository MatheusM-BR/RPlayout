import { spawn } from 'node:child_process'
import type { MonitorTier } from '@rplayout/protocol'
import type { PublisherState } from './transport.js'

/** O que `rplayout-encoders` responde. */
export interface EncoderProbe {
  readonly encoders: readonly { name: string; hardware: boolean; available: boolean; sessions: number | null; unlimited: boolean; error?: string }[]
  /** Melhor codificador de placa que respondeu, ou nulo. */
  readonly hardware: string | null
  /** Sessões de placa (nulo = sem limite de driver; 0 = sem placa). */
  readonly hardwareSessions: number | null
}

export const NO_HARDWARE: EncoderProbe = { encoders: [], hardware: null, hardwareSessions: 0 }

/** Roda a sonda uma vez. Sem binário ou com falha, é "sem placa". */
export function probeEncoders(binary: string | null | undefined, timeoutMs = 30_000): Promise<EncoderProbe> {
  if (!binary) return Promise.resolve(NO_HARDWARE)
  return new Promise((resolve) => {
    let out = ''
    let done = false
    const finish = (value: EncoderProbe) => { if (!done) { done = true; resolve(value) } }
    try {
      const child = spawn(binary, [], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true })
      const timer = setTimeout(() => { child.kill(); finish(NO_HARDWARE) }, timeoutMs)
      child.stdout?.on('data', (chunk: Buffer) => { out += chunk.toString('utf8') })
      child.on('error', () => { clearTimeout(timer); finish(NO_HARDWARE) })
      child.on('exit', () => {
        clearTimeout(timer)
        try {
          const parsed = JSON.parse(out.trim().split('\n').pop() ?? '{}') as Partial<EncoderProbe>
          finish({
            encoders: Array.isArray(parsed.encoders) ? parsed.encoders : [],
            hardware: typeof parsed.hardware === 'string' ? parsed.hardware : null,
            hardwareSessions: parsed.hardwareSessions === null ? null : Number.isInteger(parsed.hardwareSessions) ? parsed.hardwareSessions! : 0,
          })
        } catch { finish(NO_HARDWARE) }
      })
    } catch { finish(NO_HARDWARE) }
  })
}

export interface MonitorKey { readonly channelId: string; readonly bus: string; readonly tier: MonitorTier }
const keyOf = (key: MonitorKey) => `${key.channelId}|${key.bus}|${key.tier}`

/** Situação exposta na tela técnica. */
export interface EncoderSessionStatus {
  readonly hardware: string | null
  /** Total de sessões de placa (nulo = sem limite conhecido). */
  readonly total: number | null
  /** Reservadas para as saídas de programa (prioridade absoluta). */
  readonly reservedForProgram: number
  /** Emprestadas a monitores agora. */
  readonly monitorsInUse: number
  /** Livres para monitores (nulo = sem limite). */
  readonly free: number | null
  readonly grants: readonly MonitorKey[]
  readonly encoders: EncoderProbe['encoders']
  /** Por que a capacidade diminuiu desde a sonda, se diminuiu. */
  readonly learned: string | null
}

/**
 * Contador global de sessões de codificação por placa.
 *
 * Cada canal é um processo de engine, mas a placa é uma só: quem conta as
 * sessões tem de ver todos os canais, e é o servidor. As saídas de programa
 * têm prioridade absoluta: a reserva delas é descontada antes de qualquer
 * monitor ganhar sessão. Monitor sem sessão sai em x264 -- nunca fica preto.
 *
 * A reserva é pessimista: toda saída codificada que não é monitor conta como
 * uma sessão, mesmo que esteja em software. Sobra menos para os monitores, e
 * em troca o programa nunca encontra a placa cheia por causa de uma janela
 * de navegador.
 */
export class EncoderSessions {
  private readonly grants = new Map<string, MonitorKey>()
  private capacity: number | null
  private learnedReason: string | null = null

  constructor(private probe: EncoderProbe, private readonly programSessions: () => number) {
    this.capacity = probe.hardware ? probe.hardwareSessions : 0
  }

  /** Troca a sonda (ex.: a sonda terminou depois de os canais subirem). */
  setProbe(probe: EncoderProbe): void {
    this.probe = probe
    this.capacity = probe.hardware ? probe.hardwareSessions : 0
    this.learnedReason = null
  }

  private free(): number | null {
    if (this.capacity === null) return null
    return Math.max(0, this.capacity - this.programSessions() - this.grants.size)
  }

  /**
   * Pede sessão de placa para um nível de monitor. Devolve se concedeu.
   * O leve nunca pede: 240p em x264 custa menos que a sessão.
   */
  request(key: MonitorKey): boolean {
    if (key.tier === 'lite') return false
    const id = keyOf(key)
    if (this.grants.has(id)) return true
    const free = this.free()
    if (free !== null && free <= 0) return false
    this.grants.set(id, key)
    return true
  }

  release(key: MonitorKey): void {
    this.grants.delete(keyOf(key))
  }

  releaseChannel(channelId: string): void {
    for (const [id, key] of this.grants) if (key.channelId === channelId) this.grants.delete(id)
  }

  has(key: MonitorKey): boolean {
    return this.grants.has(keyOf(key))
  }

  /**
   * Lê o que o engine relatou. Um nível concedido que está em software
   * perdeu a placa (falha no meio ou programa pediu de volta): a sessão
   * volta ao contador e, se foi a placa que recusou, a capacidade aprende o
   * limite real -- o número da sonda pode ter mudado por outro programa
   * (vMix, OBS) usando a mesma placa.
   */
  observe(channelId: string, bus: string, report: PublisherState): void {
    for (const tier of report.tiers ?? []) {
      const key = { channelId, bus, tier: tier.tier }
      if (!this.has(key) || !tier.encoder || tier.hardware) continue
      this.release(key)
      if (tier.degraded && /placa falhou|recus|session/i.test(`${tier.degraded} ${tier.error ?? ''}`) && this.capacity !== null) {
        const inUse = this.programSessions() + this.grants.size
        if (inUse < this.capacity) {
          this.capacity = inUse
          this.learnedReason = `a placa recusou a sessão ${inUse + 1}; capacidade ajustada para ${inUse}`
        }
      }
    }
  }

  status(): EncoderSessionStatus {
    return {
      hardware: this.probe.hardware,
      total: this.capacity,
      reservedForProgram: this.programSessions(),
      monitorsInUse: this.grants.size,
      free: this.free(),
      grants: [...this.grants.values()],
      encoders: this.probe.encoders,
      learned: this.learnedReason,
    }
  }
}

/** Quantas saídas de programa codificadas há num relatório de engine. */
export function programEncodedOutputs(publishers: readonly PublisherState[]): number {
  return publishers.filter((publisher) =>
    !(publisher.tiers && publisher.tiers.length) &&
    publisher.outputId !== 'qc-inspection' &&
    !/^(ndi|omt|sdi):/i.test(publisher.url) &&
    publisher.health !== 'idle',
  ).length
}
