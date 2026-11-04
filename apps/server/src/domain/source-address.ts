import { installationVault } from './secret-vault.js'
import { sanitizeDiagnostic } from './sanitize-diagnostic.js'

/** Endereço de fonte na forma canônica, exatamente a do engine
 * (`channel::source_for` e `ingest::key_for`): `decklink://0`, `sdi://0` e
 * `decklink:0` viram `sdi:0`; `ndi://X` vira `ndi:X`. Espaços nas pontas saem.
 * O resto fica como está (`omt://` vai ao uridecodebin no engine, não é
 * `omt:`), e a query de SRT/RTMP faz parte da identidade da conexão. */
export function canonicalSourceAddress(endpoint: string): string {
  const source = endpoint.trim()
  const sdi = /^(?:decklink:\/\/|sdi:\/\/|decklink:)(.*)$/.exec(source)
  if (sdi) return 'sdi:' + sdi[1]
  const ndi = /^ndi:\/\/(.*)$/.exec(source)
  if (ndi) return 'ndi:' + ndi[1]
  return source
}

/** Identificador estável e sem segredo de uma fonte, para gravar no banco
 * (paradas do ao vivo): HMAC do endereço canônico com a chave derivada do
 * cofre (`sourceIdentity`). Não revela passphrase nem usuário/senha. */
export const STORED_SOURCE_KEY_PREFIX = 'src:v1:'
export function storedSourceKey(endpoint: string): string {
  if (endpoint.startsWith(STORED_SOURCE_KEY_PREFIX)) return endpoint
  return STORED_SOURCE_KEY_PREFIX + installationVault().sourceIdentity(canonicalSourceAddress(endpoint))
}

/** Endereço para exibição: o mesmo mascaramento do diagnóstico. */
export const displaySourceAddress = (endpoint: string): string => sanitizeDiagnostic(endpoint)
