import { spawn } from 'node:child_process'
import { eq } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { guestKeys } from '../db/schema.js'

/** Uma fonte ao vivo que o operador pode pôr na grade. */
export interface LiveSource {
  /** Referência que vai no item: `sdi:0`, `ndi:Estúdio`, `guest:<chave>`. */
  readonly reference: string
  readonly label: string
  readonly family: 'SDI' | 'NDI' | 'GUEST'
}

export interface SourceFamily {
  readonly available: boolean
  /** Por que não há nada: driver ausente, plugin ausente. */
  readonly reason: string | null
  readonly sources: LiveSource[]
}

export interface SourceList {
  readonly sdi: SourceFamily
  readonly ndi: SourceFamily
  readonly guests: SourceFamily
}

interface ProbeFamily {
  available: boolean
  reason?: string
  sources: { reference: string; label: string }[]
}

const EMPTY: SourceFamily = { available: false, reason: null, sources: [] }

/**
 * Descoberta de fontes ao vivo.
 *
 * Quem enumera é o próprio GStreamer, pelo binário que também vai abrir a
 * entrada: a interface não adivinha quantos sub-dispositivos uma placa expõe.
 *
 * O resultado é guardado por alguns segundos porque a varredura de NDI vasculha
 * a rede -- abrir o diálogo de inserir item não pode custar isso toda vez.
 */
export class Sources {
  private cached: SourceList | null = null
  private cachedAt = 0
  private running: Promise<SourceList> | null = null

  constructor(
    private readonly db: Db,
    /** Binário de descoberta. Vazio deixa só os convidados. */
    private readonly binary: string,
    private readonly ttlMs = 15_000,
  ) {}

  async list(force = false): Promise<SourceList> {
    if (!force && this.cached && Date.now() - this.cachedAt < this.ttlMs) return this.cached
    // Duas aberturas simultâneas do diálogo não devem virar duas varreduras.
    this.running ??= this.build().finally(() => {
      this.running = null
    })
    return this.running
  }

  private async build(): Promise<SourceList> {
    const [hardware, guests] = await Promise.all([this.probe(), this.guests()])
    const list: SourceList = {
      sdi: toFamily(hardware?.decklink, 'SDI'),
      ndi: toFamily(hardware?.ndi, 'NDI'),
      guests,
    }
    this.cached = list
    this.cachedAt = Date.now()
    return list
  }

  /** Convidados publicando no servidor local também são fonte ao vivo. */
  private async guests(): Promise<SourceFamily> {
    const rows = await this.db.select().from(guestKeys).where(eq(guestKeys.enabled, true))
    return {
      available: true,
      reason: null,
      sources: rows.map((row) => ({
        reference: `guest:${row.streamKey}`,
        label: row.label,
        family: 'GUEST' as const,
      })),
    }
  }

  private probe(): Promise<{ decklink: ProbeFamily; ndi: ProbeFamily } | null> {
    if (!this.binary) return Promise.resolve(null)

    return new Promise((done) => {
      const child = spawn(this.binary, [])
      let out = ''
      child.stdout?.on('data', (chunk: Buffer) => {
        out += chunk.toString()
      })
      child.on('error', () => done(null))
      child.on('close', () => {
        try {
          done(JSON.parse(out.trim().split('\n').pop() ?? '') as never)
        } catch {
          done(null)
        }
      })
    })
  }
}

function toFamily(probe: ProbeFamily | undefined, family: 'SDI' | 'NDI'): SourceFamily {
  if (!probe) {
    return {
      ...EMPTY,
      reason: 'a descoberta de dispositivos não está configurada nesta máquina',
    }
  }
  return {
    available: probe.available,
    reason: probe.reason ?? null,
    sources: probe.sources.map((source) => ({ ...source, family })),
  }
}
