import { installationVault, SECRET_PREFIX, type SecretVault } from './secret-vault.js'
import { sanitizeDiagnostic } from './sanitize-diagnostic.js'

const endpointFields = new Set(['source', 'sourceRef', 'liveEndpoint', 'sourceEndpoint', 'sourceUrl'])
const diagnosticFields = new Set(['error', 'lastError', 'message', 'reason', 'statusReason', 'stderr'])
const secretQuery = /^(?:passphrase|password|passwd|secret|token|stream[_-]?key|key|api[_-]?key|access[_-]?token|authorization|streamid)$/i
const marker = /^([a-z][a-z0-9+.-]*):protected:v1:(?:([A-Za-z0-9_-]{43})\.)?([A-Za-z0-9_-]+)$/i

/** Human-readable copy only. An address with REDACTED is never executable. */
export function sourceAddress(value: string): string {
  // NDI/OMT names and SDI references are not URL paths. URL.toString would
  // percent-encode Unicode and change the source selected by discovery.
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return value
  try {
    const url = new URL(value)
    const original = url.toString()
    if (url.username) url.username = 'REDACTED'
    if (url.password) url.password = 'REDACTED'
    for (const key of [...url.searchParams.keys()]) if (secretQuery.test(key)) url.searchParams.set(key, 'REDACTED')
    if (/^rtmps?:$/.test(url.protocol)) {
      const parts = url.pathname.split('/').filter(Boolean)
      if (parts.length) { parts[parts.length - 1] = 'REDACTED'; url.pathname = '/' + parts.join('/') }
    }
    url.hash = ''
    const redacted = url.toString()
    return redacted === original ? value : redacted
  } catch { return value }
}

function protectedAddress(value: string): boolean {
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return false
  try { new URL(value); return sourceAddress(value) !== value } catch { return false }
}

/** Exact display copies retain the original credential-bearing address.
 * Changing a masked URI requires a complete replacement, never guessing. */
export function credentialAddress(submitted: string, current?: string): string {
  if (current !== undefined && submitted === sourceAddress(current)) return current
  if (submitted.includes('://') && /(?:REDACTED|•{3,})/.test(submitted)) throw new Error('O endereço contém uma máscara de segurança. Preserve a conexão atual ou informe o endereço completo da nova conexão.')
  return submitted
}

/** Opaque, authenticated references are NOT credentials and NOT permission.
 * Existing route/channel/session checks still authorize each operation.
 * The envelope is bound to its protocol and a context unrelated to DB fields;
 * copying an encrypted DB value cannot manufacture a control reference.
 * Resolution survives restart with the same installation vault. */
export class SourceWire {
  private readonly references = new Map<string, string>()
  constructor(private readonly vault: SecretVault, private readonly maxCached = 16_384) {}
  reference(value: string): string {
    if (marker.test(value) || !protectedAddress(value)) return value
    let reference = this.references.get(value)
    if (!reference) {
      const protocol = new URL(value).protocol.slice(0, -1).toLowerCase()
      const envelope = this.vault.encrypt(value, `source-control:${protocol}`).slice(SECRET_PREFIX.length)
      reference = `${protocol}:protected:v1:${this.vault.sourceIdentity(value)}.${Buffer.from(envelope, 'base64').toString('base64url')}`
      if (this.references.size >= this.maxCached) this.references.delete(this.references.keys().next().value!)
      this.references.set(value, reference)
    }
    return reference
  }
  resolve(value: string): string {
    if (!value.includes(':protected:')) return value
    const match = marker.exec(value)
    if (!match || match[3]!.length > 32_768) throw new Error('Referência de entrada inválida. Atualize a lista e selecione a fonte novamente.')
    try {
      const protocol = match[1]!.toLowerCase()
      const bytes = Buffer.from(match[3]!, 'base64url')
      if (bytes.toString('base64url') !== match[3]) throw new Error('Envelope inválido')
      const raw = this.vault.decrypt(SECRET_PREFIX + bytes.toString('base64'), `source-control:${protocol}`)
      if (!raw.startsWith(`${protocol}://`) || raw.length > 16_384) throw new Error('Protocolo inválido')
      if (match[2] && match[2] !== this.vault.sourceIdentity(raw)) throw new Error('Identidade inválida')
      return raw
    } catch { throw new Error('Referência de entrada inválida ou de outra instalação. Atualize a lista e selecione a fonte novamente.') }
  }
  publicValue<T>(value: T): T {
    if (Array.isArray(value)) return value.map(entry => this.publicValue(entry)) as T
    if (!value || typeof value !== 'object' || value instanceof Date || Buffer.isBuffer(value)) return value
    const record = value as Record<string, unknown>
    const liveRecord = typeof record.targetUrl === 'string' && typeof record.channelId === 'string' && ['SRT', 'RTMP', 'SDI', 'NDI', 'OMT'].includes(String(record.kind))
    const result: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(record)) {
      if (typeof entry === 'string' && endpointFields.has(key)) result[key] = this.reference(entry)
      else if (typeof entry === 'string' && diagnosticFields.has(key)) result[key] = sanitizeDiagnostic(entry)
      else if (liveRecord && key === 'targetUrl') result[key] = sourceAddress(String(entry))
      else if (key === 'deviceConfig' && entry && typeof entry === 'object') {
        // Legacy editorial events accepted a service token. It must never be
        // returned in an HTTP response, published snapshot or initial WS state.
        result[key] = this.publicValue(Object.fromEntries(Object.entries(entry).map(([field, value]) => [field, secretQuery.test(field) ? 'REDACTED' : value])))
      }
      else if (key === 'srtConfig' || key === 'srt') {
        const config = entry && typeof entry === 'object' ? { ...entry as Record<string, unknown> } : entry
        if (config && typeof config === 'object') {
          const fields = config as Record<string, unknown>
          if (fields.passphrase) fields.passphrase = '••••••••'
          if (fields.streamId) fields.streamId = 'REDACTED'
        }
        result[key] = config
      } else result[key] = this.publicValue(entry)
    }
    if (liveRecord && !record.controlRef && protectedAddress(record.targetUrl as string)) {
      result.controlRef = this.reference(record.targetUrl as string)
      result.credentialProtected = true
    }
    return result as T
  }
  incoming<T>(value: T, liveSourceCrud = false): T {
    if (Array.isArray(value)) return value.map(entry => this.incoming(entry, liveSourceCrud)) as T
    if (!value || typeof value !== 'object') return value
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => {
      if (typeof entry === 'string' && (endpointFields.has(key) || (liveSourceCrud && key === 'targetUrl'))) {
        const raw = this.resolve(entry)
        if (raw.includes('://') && /(?:REDACTED|•{3,})/.test(raw)) throw new Error('Endereço mascarado não é uma fonte executável.')
        return [key, raw]
      }
      return [key, this.incoming(entry, liveSourceCrud)]
    })) as T
  }
}

let wire: SourceWire | undefined
export function sourceWire(): SourceWire { return wire ??= new SourceWire(installationVault()) }
