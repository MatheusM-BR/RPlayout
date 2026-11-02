import { StringDecoder } from 'node:string_decoder'

const secretField = '(?:passphrase|password|passwd|secret|token|stream[_-]?key|streamid|key|api[_-]?key|access[_-]?token|authorization)'

/** Só para telemetria/diagnóstico. Nunca devolver esta cópia ao decoder ou
 * salvar como configuração: destinos redigidos não são endereços executáveis. */
export function diagnosticValue<T>(value: T): T {
  if(typeof value==='string')return sanitizeDiagnostic(value) as T
  if(Array.isArray(value))return value.map(entry=>diagnosticValue(entry)) as T
  if(value && typeof value==='object'){
    return Object.fromEntries(Object.entries(value).map(([key,entry])=>[key,
      new RegExp(`^${secretField}$`,'i').test(key) && entry!==null && entry!==undefined ? 'REDACTED' : diagnosticValue(entry)])) as T
  }
  return value
}

/** Diagnostic text is not a configuration endpoint. Hide HTTP paths too:
 * webhook tokens are frequently embedded in their path rather than query. */
export function sanitizeDiagnostic(message: string): string {
  const urls = message.replace(/\b(?:https?|srt|rtmps?|rtsp|udp|tcp):\/\/[^\s<>"'`]+/gi, raw => {
    const suffix = raw.match(/[),.;\]}]+$/)?.[0] ?? ''
    const address = suffix ? raw.slice(0, -suffix.length) : raw
    try {
      const url = new URL(address)
      if (url.username) url.username = 'REDACTED'
      if (url.password) url.password = 'REDACTED'
      if (/^https?:$/.test(url.protocol)) {
        url.pathname = '/REDACTED'; url.search = ''; url.hash = ''
      } else {
        for (const key of [...url.searchParams.keys()]) if (new RegExp(`^${secretField}$`, 'i').test(key)) url.searchParams.set(key, 'REDACTED')
        if (/^rtmps?:$/.test(url.protocol)) {
          const segments = url.pathname.split('/').filter(Boolean)
          if (segments.length) { segments[segments.length - 1] = 'REDACTED'; url.pathname = '/' + segments.join('/') }
        }
        url.hash = ''
      }
      return url.toString() + suffix
    } catch { return '[endereço omitido]' + suffix }
  })
  return urls.replace(/\bBearer\s+[^\s,"';]+/gi, 'Bearer REDACTED')
    .replace(new RegExp(`(["']?${secretField}["']?\\s*[:=]\\s*)("(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*'|[^\\s&,;}\\]]+)`, 'gi'), '$1REDACTED')
}

/** Never sanitize individual chunks: UTF-8 and credential-bearing URLs may
 * span chunks. Hold a complete line; discard overlong lines without emitting
 * a prefix that could reveal part of a credential. Memory stays bounded. */
export class DiagnosticLines {
  private readonly decoder = new StringDecoder('utf8')
  private pending = ''
  private discarding = false
  constructor(private readonly emit: (line: string) => void, private readonly maxLength = 65_536) {}
  write(chunk: Buffer): void { this.accept(this.decoder.write(chunk)) }
  end(): void {
    this.accept(this.decoder.end())
    if (this.pending && !this.discarding) this.emit(sanitizeDiagnostic(this.pending.replace(/\r$/, '')))
    this.pending = ''; this.discarding = false
  }
  private accept(text: string): void {
    for (const [index, part] of text.split('\n').entries()) {
      if (index > 0) {
        if (!this.discarding) this.emit(sanitizeDiagnostic(this.pending.replace(/\r$/, '')))
        this.pending = ''; this.discarding = false
      }
      if (this.discarding) continue
      if (this.pending.length + part.length > this.maxLength) {
        this.pending = ''; this.discarding = true
        this.emit('[linha de diagnóstico excedeu o limite e foi omitida]')
      } else this.pending += part
    }
  }
}
