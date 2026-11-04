import { installationVault } from './secret-vault.js'
import { sanitizeDiagnostic } from './sanitize-diagnostic.js'

/** Endereço de fonte na forma canônica, a mesma do engine (`ingest::key_for`):
 * `decklink://0`, `sdi://0` e `decklink:0` viram `sdi:0`; `ndi://X` vira
 * `ndi:X` (idem `omt://X` → `omt:X`). Espaços nas pontas saem. O resto fica
 * como está: a query de SRT/RTMP faz parte da identidade da conexão. */
export function canonicalSourceAddress(endpoint: string): string {
  const source = endpoint.trim()
  const sdi = /^(?:decklink:\/\/|sdi:\/\/|decklink:)(.*)$/i.exec(source)
  if (sdi) return 'sdi:' + sdi[1]
  const named = /^(ndi|omt):\/\/(.*)$/i.exec(source)
  if (named) return named[1]!.toLowerCase() + ':' + named[2]
  return source.replace(/^(sdi|ndi|omt):/i, (_, scheme: string) => scheme.toLowerCase() + ':')
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
