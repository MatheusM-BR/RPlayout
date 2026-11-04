import { customType } from 'drizzle-orm/sqlite-core'
import { installationVault, SECRET_PREFIX } from '../domain/secret-vault.js'
import { sanitizeDiagnostic } from '../domain/sanitize-diagnostic.js'
import { containsCredential } from '../domain/credential-detection.js'

// Keep field contexts stable: changing them makes existing envelopes unreadable.
// The AAD of every envelope is `rplayout:<table>.<column>`.

/** Credenciais (r88-37). Só estas colunas existem para guardar segredo:
 * chave de stream, URL de saída/destino, passphrase SRT, webhook com token.
 * As de `alwaysProtected` são sempre envelope; as demais só quando o valor
 * carrega credencial (um endereço NDI/OMT ou caminho de arquivo fica em claro). */
export const protectedColumns = [
  ['output_profiles', 'target'], ['transmission_presets', 'target'],
  ['integrations', 'url'], ['rundown_items', 'source_ref'], ['rundown_items', 'live_endpoint'],
  ['guest_keys', 'stream_key'], ['destinations', 'url'],
  ['live_sources', 'target_url'], ['live_sources', 'srt_config'],
  ['integration_deliveries','target'],
] as const
const alwaysProtected = new Set<string>(['integrations.url', 'guest_keys.stream_key', 'destinations.url', 'live_sources.srt_config'])

/** Eram cifradas até a migração 57 e não são segredo: grade publicada,
 * snapshots, eventos secundários, multiview, auditoria, alertas, cadência.
 * Passam a texto normal (migração 58). Continuam aceitando envelope porque
 * (a) backups antigos e o histórico append-only da auditoria ainda os têm e
 * (b) um valor que embute credencial (snapshot de projeto com chave de stream,
 * grade com passphrase SRT no endpoint) continua sendo gravado cifrado. */
export const formerlyProtectedColumns = [
  ['channel_project_snapshots', 'payload'], ['operational_playlist_revisions', 'payload'],
  ['operator_decisions', 'payload'], ['multiview_configs', 'cells'],
  ['integration_deliveries','payload'], ['secondary_events','definition'],
  ['health_events','message'], ['health_events','context'],
  ['channel_cadence_conversions','snapshot'],
] as const

/** Toda coluna que pode conter envelope: verificador de backup, ponte HA e
 * restaurar-sem-cofre precisam olhar todas. */
export const envelopeColumns = [...protectedColumns, ...formerlyProtectedColumns] as const
const known = new Set<string>(envelopeColumns.map(([table, column]) => `${table}.${column}`))
const credentialColumns = new Set<string>(protectedColumns.map(([table, column]) => `${table}.${column}`))

export type VaultPolicy = 'ALWAYS' | 'IF_CREDENTIAL'
export function vaultPolicy(context: string): VaultPolicy {
  if (!known.has(context)) throw new Error('Campo do cofre desconhecido: ' + context)
  return alwaysProtected.has(context) ? 'ALWAYS' : 'IF_CREDENTIAL'
}
export const isEnvelope = (value: string) => value.startsWith(SECRET_PREFIX)
/** Valor em claro que, pela política da coluna, precisaria estar cifrado. */
export const needsEnvelope = (value: string, context: string) => !isEnvelope(value) && (vaultPolicy(context) === 'ALWAYS' || containsCredential(value))

/** Grava: envelope só para credencial; o resto em claro. */
export function sealStoredValue(value: string, context: string): string {
  return needsEnvelope(value, context) ? installationVault().encrypt(value, context) : value
}
/** Lê: envelope é aberto e autenticado com o contexto; texto em claro só é
 * aceito onde a política permite (coluna que não é sempre-segredo). */
export function openStoredValue(value: string, context: string): string {
  if (isEnvelope(value)) return installationVault(false).decrypt(value, context)
  if (vaultPolicy(context) === 'ALWAYS') return installationVault(false).decrypt(value, context)
  return value
}

function assertCredentialColumn(context: string) {
  if (!credentialColumns.has(context)) throw new Error('protectedText/Json é só para colunas de credencial: ' + context)
}
function assertFormerColumn(context: string) {
  if (!known.has(context) || credentialColumns.has(context)) throw new Error('clearText/Json é só para colunas que deixaram de ser segredo: ' + context)
}

/** Coluna de credencial (sempre envelope ou envelope quando há credencial). */
export function protectedText(name: string, context: string) {
  assertCredentialColumn(context)
  return customType<{ data: string; driverData: string }>({
    dataType: () => 'text',
    toDriver: value => sealStoredValue(value, context),
    fromDriver: value => openStoredValue(value, context),
  })(name)
}

export function protectedJson<T>(name: string, context: string) {
  assertCredentialColumn(context)
  return customType<{ data: T; driverData: string }>({
    dataType: () => 'text',
    toDriver: value => {
      const serialized = JSON.stringify(value)
      if (serialized === undefined) throw new Error('Valor inválido para campo protegido.')
      return sealStoredValue(serialized, context)
    },
    fromDriver: value => JSON.parse(openStoredValue(value, context)) as T,
  })(name)
}

/** Texto normal. Lê envelopes antigos; cifra só se o valor embutir credencial. */
export function clearJson<T>(name: string, context: string) {
  assertFormerColumn(context)
  return customType<{ data: T; driverData: string }>({
    dataType: () => 'text',
    toDriver: value => {
      const serialized = JSON.stringify(value)
      if (serialized === undefined) throw new Error('Valor JSON inválido.')
      return sealStoredValue(serialized, context)
    },
    fromDriver: value => JSON.parse(openStoredValue(value, context)) as T,
  })(name)
}

/** Old encrypted incidents can still contain credentials from native errors.
 * Mask both new writes and historical reads at the diagnostic boundary. */
export function clearDiagnosticText(name:string,context:string) {
  assertFormerColumn(context)
  return customType<{data:string;driverData:string}>({
    dataType:()=> 'text',
    toDriver:value=>sealStoredValue(sanitizeDiagnostic(value),context),
    fromDriver:value=>sanitizeDiagnostic(openStoredValue(value,context)),
  })(name)
}
