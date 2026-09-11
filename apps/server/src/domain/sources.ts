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

/**
 * Há decodificador de AAC, dado o que falta na instalação?
 *
 * Separado da classe porque é a decisão que muda o alerta de "pode faltar o
 * decodificador" para "está indo ao ar MUDO" -- e um alerta que afirma errado
 * é pior que um que não afirma. Nulo é "ainda não sei", que não é "não falta".
 */
export function temAac(faltando: readonly Faltando[] | null): boolean | null {
  if (faltando === null) return null
  return !faltando.some((entrada) => entrada.element.includes('avdec_aac'))
}

/** Um elemento do GStreamer que a instalação não tem. */
export interface Faltando {
  element: string
  plugin: string
  breaks: string
}

/** O que o binário de descoberta devolve. */
interface Descoberta {
  decklink: ProbeFamily
  ndi: ProbeFamily
  plugins?: { missing: Faltando[]; optional: Faltando[] }
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
  /** O que a descoberta disse que falta na instalação. Nulo é "ainda não sei". */
  private faltandoPlugins: Faltando[] | null = null

  constructor(
    private readonly db: Db,
    /** Binário de descoberta. Vazio deixa só os convidados. */
    private readonly binary: string,
    private readonly ttlMs = 15_000,
  ) {}

  /**
   * O que falta na instalação, do que já foi descoberto -- sem esperar.
   *
   * Os alertas são montados a cada tique e não podem parar para rodar a
   * descoberta. Nulo quer dizer "ainda não sei", que é diferente de "não falta
   * nada": um alerta que afirma com base em desconhecimento é pior que
   * nenhum.
   */
  faltando(): Faltando[] | null {
    return this.faltandoPlugins
  }

  /** Existe decodificador de AAC nesta instalação? Nulo é "ainda não sei". */
  temDecodificadorAac(): boolean | null {
    return temAac(this.faltando())
  }

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
    // O que falta na instalação vem na mesma leitura e vale para os alertas,
    // que não podem esperar por uma descoberta a cada tique.
    if (hardware) this.faltandoPlugins = hardware.plugins?.missing ?? []
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

  private probe(): Promise<Descoberta | null> {
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
