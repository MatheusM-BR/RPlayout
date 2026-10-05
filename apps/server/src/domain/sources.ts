import { spawn } from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { guestKeys, liveSources } from '../db/schema.js'
import { mediaProcessEnvironment } from './media-process-environment.js'

/** Uma fonte ao vivo que o operador pode pôr na grade. */
export interface LiveSource {
  /** Referência que vai no item: `sdi:0`, `ndi:Estúdio`, `guest:<chave>`. */
  readonly reference: string
  readonly label: string
  readonly family: 'SDI' | 'NDI' | 'OMT' | 'GUEST'
  readonly discovery?: 'DISCOVERED' | 'CONFIGURED'
}

export interface SourceFamily {
  readonly available: boolean
  /** Por que não há nada: driver ausente, plugin ausente. */
  readonly reason: string | null
  readonly sources: LiveSource[]
}

export interface SourceList {
  readonly sdi: SourceFamily
  readonly sdiOutputs: SourceFamily
  readonly ndi: SourceFamily
  readonly omt: SourceFamily
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
  decklinkOutputs?: ProbeFamily
  ndi: ProbeFamily
  omt: ProbeFamily
  plugins?: { missing: Faltando[]; optional: Faltando[] }
}

interface ProbeFamily {
  available: boolean
  reason?: string
  sources: { reference: string; label: string }[]
}

const EMPTY: SourceFamily = { available: false, reason: null, sources: [] }
const probeFamilySchema = z.object({
  available: z.boolean(), reason: z.string().optional(),
  sources: z.array(z.object({ reference: z.string().min(1), label: z.string() })),
})
const discoverySchema = z.object({
  decklink: probeFamilySchema, decklinkOutputs: probeFamilySchema.optional(),
  ndi: probeFamilySchema, omt: probeFamilySchema,
  plugins: z.object({ missing: z.array(z.object({ element: z.string(), plugin: z.string(), breaks: z.string() })), optional: z.array(z.object({ element: z.string(), plugin: z.string(), breaks: z.string() })) }).optional(),
})

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
  private probeError: string | null = null

  constructor(
    private readonly db: Db,
    /** Binário de descoberta. Vazio deixa só os convidados. */
    private readonly binary: string,
    private readonly ttlMs = 15_000,
    private readonly probeTimeoutMs = 12_000,
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
    const [hardware, guests, savedLive] = await Promise.all([
      this.probe(),
      this.guests(),
      this.savedLiveSources(),
    ])
    // O que falta na instalação vem na mesma leitura e vale para os alertas,
    // que não podem esperar por uma descoberta a cada tique.
    if (hardware) this.faltandoPlugins = hardware.plugins?.missing ?? []

    const sdiFamily = toFamily(hardware?.decklink, 'SDI')
    const sdiOutputs = toFamily(hardware?.decklinkOutputs, 'SDI')
    const ndiFamily = toFamily(hardware?.ndi, 'NDI')
    const omtFamily = toFamily(hardware?.omt, 'OMT')

    // Mescla fontes salvas no banco com as descobertas pelo hardware
    const savedSdi = savedLive.filter((s) => s.family === 'SDI')
    const savedNdi = savedLive.filter((s) => s.family === 'NDI')
    const savedOmt = savedLive.filter((s) => s.family === 'OMT')

    const mergedSdiSources = [...sdiFamily.sources]
    for (const saved of savedSdi) {
      if (!mergedSdiSources.some((s) => s.reference === saved.reference)) {
        mergedSdiSources.push(saved)
      }
    }

    const mergedNdiSources = [...ndiFamily.sources]
    for (const saved of savedNdi) {
      if (!mergedNdiSources.some((s) => s.reference === saved.reference)) {
        mergedNdiSources.push(saved)
      }
    }
    const mergedOmtSources = [...omtFamily.sources]
    for (const saved of savedOmt) {
      if (!mergedOmtSources.some((s) => s.reference === saved.reference)) {
        mergedOmtSources.push(saved)
      }
    }

    const list: SourceList = {
      sdi: {
        available: sdiFamily.available,
        reason: this.probeError ?? sdiFamily.reason,
        sources: mergedSdiSources,
      },
      sdiOutputs: {
        ...sdiOutputs,
        reason: this.probeError ?? (hardware && !hardware.decklinkOutputs
          ? 'O binário de descoberta precisa ser atualizado para listar saídas DeckLink separadamente.' : sdiOutputs.reason),
      },
      ndi: {
        available: ndiFamily.available,
        reason: this.probeError ?? ndiFamily.reason,
        sources: mergedNdiSources,
      },
      omt: {
        available: omtFamily.available,
        reason: this.probeError ?? omtFamily.reason,
        sources: mergedOmtSources,
      },
      guests,
    }
    this.cached = list
    this.cachedAt = Date.now()
    return list
  }

  /** Fontes ao vivo cadastradas manualmente pelos operadores no banco de dados. */
  private async savedLiveSources(): Promise<LiveSource[]> {
    try {
      const rows = await this.db.select().from(liveSources).where(eq(liveSources.enabled, true))
      // Só as famílias que este endpoint descobre pertencem aos cards de
      // hardware/rede. Antes, qualquer SRT/RTMP cadastrado caía no `else` e
      // era exibido falsamente como uma porta DeckLink SDI.
      return rows
        .filter((row) => row.kind === 'SDI' || row.kind === 'NDI' || row.kind === 'OMT')
        .map((row) => ({
        reference: row.targetUrl.startsWith('ndi:') || row.targetUrl.startsWith('sdi:')
          ? row.targetUrl
          : row.kind === 'NDI'
            ? `ndi:${row.targetUrl}`
          : row.kind === 'SDI'
              ? `sdi:${row.targetUrl}`
              : row.kind === 'OMT' && !row.targetUrl.startsWith('omt:')
                ? `omt:${row.targetUrl}`
                : row.targetUrl,
        label: row.name,
        discovery: 'CONFIGURED' as const,
        family: (row.kind === 'NDI' ? 'NDI' : row.kind === 'OMT' ? 'OMT' : 'SDI') as 'SDI' | 'NDI' | 'OMT',
        }))
    } catch {
      return []
    }
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
    this.probeError = null
    if (!this.binary) {
      this.probeError = 'A descoberta de dispositivos não está configurada no servidor.'
      return Promise.resolve(null)
    }

    return new Promise((done) => {
      const child = spawn(this.binary, [], { windowsHide: true, env: mediaProcessEnvironment() })
      let out = ''
      let err = ''
      let settled = false
      const decoder = new StringDecoder('utf8')
      const finish = (result: Descoberta | null, reason: string | null = null) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        this.probeError = reason
        done(result)
      }
      const timeout = setTimeout(() => {
        finish(null, 'A descoberta excedeu o tempo limite; o driver ou runtime não respondeu. Tente reescanear no servidor.')
        child.kill()
      }, this.probeTimeoutMs)
      child.stdout?.on('data', (chunk: Buffer) => {
        out += decoder.write(chunk)
        if (out.length > 1_000_000) {
          finish(null, 'O binário de descoberta retornou uma resposta excessiva ou inválida.')
          child.kill()
        }
      })
      child.stderr?.on('data', (chunk: Buffer) => { err = (err + chunk.toString()).slice(-1500) })
      child.on('error', (error) => finish(null, `Não foi possível iniciar a descoberta no servidor: ${error.message}`))
      child.on('close', (code) => {
        if (settled) return
        if (code !== 0) return finish(null, `Descoberta encerrada com erro (${code}): ${err.trim() || 'verifique o GStreamer e os runtimes no servidor'}`)
        try {
          out += decoder.end()
          finish(discoverySchema.parse(JSON.parse(out.trim().split('\n').pop() ?? '')))
        } catch {
          finish(null, 'O binário de descoberta retornou dados inválidos; atualize o engine e o servidor juntos.')
        }
      })
    })
  }
}

function toFamily(probe: ProbeFamily | undefined, family: 'SDI' | 'NDI' | 'OMT'): SourceFamily {
  if (!probe) {
    return {
      ...EMPTY,
      reason: 'a descoberta de dispositivos não está configurada nesta máquina',
    }
  }
  return {
    available: probe.available,
    reason: probe.reason ?? null,
    sources: probe.sources.map((source) => ({ ...source, family, discovery: 'DISCOVERED' })),
  }
}
