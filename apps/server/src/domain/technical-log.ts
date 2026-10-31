import { sanitizeDiagnostic } from './sanitize-diagnostic.js'

/**
 * Logs técnicos em memória para a tela do Monitor (aba LOGS TÉCNICOS).
 *
 * O servidor já escreve tudo o que interessa ao plantonista no stdout/stderr:
 * linhas do engine ("[engine QA] ERRO …", erros do GStreamer, "encerrado:
 * sinal SIGKILL; relatório em …") e o log JSON do Fastify. Aqui guardamos as
 * últimas linhas num buffer limitado, para diagnosticar pela tela sem SSH.
 * Nada vai para disco; reiniciar o servidor esvazia o buffer.
 */
export type TechnicalLogLevel = 'ERROR' | 'WARN' | 'INFO' | 'DEBUG'
export interface TechnicalLogEntry {
  seq: number
  at: string
  level: TechnicalLogLevel
  source: 'ENGINE' | 'SERVER'
  /** Nome do canal quando a linha é do engine. */
  channel: string | null
  message: string
  /** Caminho do relatório de crash citado na linha, quando houver. */
  crashReport: string | null
}
const RANK: Record<TechnicalLogLevel, number> = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 }
const MAX_MESSAGE = 4000
/** Requisições HTTP de rotina (polling a cada 3 s) afogariam o que importa. */
const ROUTINE = new Set(['incoming request', 'request completed', 'stream closed prematurely'])

export function classifyEngineLine(text: string): TechnicalLogLevel {
  if (/^(ERRO\b|encerrado:)|\b(ERROR|CRITICAL|FATAL|panicked)\b/.test(text)) return 'ERROR'
  if (/^AVISO\b|\b(WARN|WARNING)\b/.test(text)) return 'WARN'
  if (/\bDEBUG\b|\bTRACE\b/.test(text)) return 'DEBUG'
  return 'INFO'
}

export class TechnicalLog {
  private readonly entries: TechnicalLogEntry[] = []
  private seq = 0
  constructor(private readonly capacity = 5000) {}

  /** Uma escrita no stdout/stderr. Pino escreve um JSON por linha; o engine
   * pode escrever uma mensagem de várias linhas numa escrita só. */
  ingest(chunk: string, now = Date.now()): void {
    const text = chunk.replace(/\r/g, '').replace(/\n+$/, '')
    if (!text.trim()) return
    if (text.startsWith('{')) { for (const line of text.split('\n')) if (line.trim()) this.ingestJson(line, now); return }
    this.ingestText(text, now)
  }

  private ingestJson(line: string, now: number): void {
    let value: Record<string, unknown>
    try { value = JSON.parse(line) as Record<string, unknown> } catch { this.ingestText(line, now); return }
    const msg = typeof value.msg === 'string' ? value.msg : ''
    const statusCode = (value.res as { statusCode?: unknown } | undefined)?.statusCode
    if (ROUTINE.has(msg) && !(typeof statusCode === 'number' && statusCode >= 500)) return
    const numeric = typeof value.level === 'number' ? value.level : 30
    const level: TechnicalLogLevel = numeric >= 50 ? 'ERROR' : numeric >= 40 ? 'WARN' : numeric >= 30 ? 'INFO' : 'DEBUG'
    const err = value.err as { message?: unknown; type?: unknown } | undefined
    const details = [
      typeof value.diagnostic === 'string' ? value.diagnostic : '',
      err && typeof err.message === 'string' && !/Detalhes privados omitidos/.test(err.message) ? `${typeof err.type === 'string' ? err.type + ': ' : ''}${err.message}` : '',
      typeof statusCode === 'number' && statusCode >= 500 ? `HTTP ${statusCode} em ${String((value.req as { route?: unknown } | undefined)?.route ?? '')}` : '',
    ].filter(Boolean).join(' · ')
    const at = typeof value.time === 'number' && Number.isFinite(value.time) ? value.time : now
    this.push({ at, level, source: 'SERVER', channel: null, message: [msg, details].filter(Boolean).join(' — ') || line })
  }

  private ingestText(text: string, now: number): void {
    const engine = /^\[engine ([^\]]*)\] ?([\s\S]*)$/.exec(text)
    const body = engine ? engine[2]! : text
    this.push({ at: now, level: classifyEngineLine(body), source: engine ? 'ENGINE' : 'SERVER', channel: engine ? engine[1]! : null, message: body })
  }

  private push(entry: { at: number; level: TechnicalLogLevel; source: 'ENGINE' | 'SERVER'; channel: string | null; message: string }): void {
    const message = sanitizeDiagnostic(entry.message).slice(0, MAX_MESSAGE)
    const crash = /relatório em (\S+\.txt)/.exec(message)
    this.entries.push({ seq: ++this.seq, at: new Date(entry.at).toISOString(), level: entry.level, source: entry.source, channel: entry.channel, message, crashReport: crash ? crash[1]! : null })
    if (this.entries.length > this.capacity) this.entries.splice(0, this.entries.length - this.capacity)
  }

  /** Mais antigas primeiro. `afterSeq` permite leitura incremental. */
  read(filter: { minLevel?: TechnicalLogLevel; source?: 'ENGINE' | 'SERVER'; channel?: string; query?: string; sinceMs?: number; afterSeq?: number; limit?: number } = {}): { entries: TechnicalLogEntry[]; lastSeq: number; capacity: number; retained: number } {
    const query = filter.query?.trim().toLowerCase()
    const limit = Math.max(1, Math.min(this.capacity, Math.trunc(filter.limit ?? 1000)))
    const selected = this.entries.filter(entry =>
      (!filter.minLevel || RANK[entry.level] >= RANK[filter.minLevel]) &&
      (!filter.source || entry.source === filter.source) &&
      (!filter.channel || entry.channel === filter.channel || entry.source === 'SERVER') &&
      (filter.sinceMs === undefined || Date.parse(entry.at) >= filter.sinceMs) &&
      (filter.afterSeq === undefined || entry.seq > filter.afterSeq) &&
      (!query || entry.message.toLowerCase().includes(query) || (entry.channel ?? '').toLowerCase().includes(query)))
    return { entries: selected.slice(-limit), lastSeq: this.seq, capacity: this.capacity, retained: this.entries.length }
  }
  /** Últimos relatórios de crash citados no log (mais recente primeiro). */
  crashReports(limit = 10): Array<{ at: string; channel: string | null; path: string }> {
    return this.entries.filter(entry => entry.crashReport).slice(-limit).reverse().map(entry => ({ at: entry.at, channel: entry.channel, path: entry.crashReport! }))
  }
}

/** Buffer único do processo. */
export const technicalLog = new TechnicalLog()

let installed = false
/** Espelha stdout/stderr no buffer sem alterar o que vai para o terminal/arquivo. */
export function installTechnicalLogCapture(log: TechnicalLog = technicalLog): void {
  if (installed) return
  installed = true
  for (const stream of [process.stdout, process.stderr]) {
    const original = stream.write.bind(stream) as (...args: unknown[]) => boolean
    stream.write = ((chunk: unknown, ...rest: unknown[]) => {
      try { log.ingest(typeof chunk === 'string' ? chunk : Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)) } catch { /* o log nunca derruba o servidor */ }
      return original(chunk, ...rest)
    }) as typeof stream.write
  }
}
