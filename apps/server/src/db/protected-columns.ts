import { customType } from 'drizzle-orm/sqlite-core'
import { installationVault } from '../domain/secret-vault.js'
import { sanitizeDiagnostic } from '../domain/sanitize-diagnostic.js'

// Keep field contexts stable: changing them makes existing envelopes unreadable.
export const protectedColumns = [
  ['output_profiles', 'target'], ['transmission_presets', 'target'],
  ['channel_project_snapshots', 'payload'], ['operational_playlist_revisions', 'payload'],
  ['integrations', 'url'], ['rundown_items', 'source_ref'], ['rundown_items', 'live_endpoint'],
  ['operator_decisions', 'payload'], ['guest_keys', 'stream_key'], ['destinations', 'url'],
  ['live_sources', 'target_url'], ['live_sources', 'srt_config'], ['multiview_configs', 'cells'],
  ['integration_deliveries','target'], ['integration_deliveries','payload'],
  ['secondary_events','definition'],
  ['health_events','message'],
  ['health_events','context'],
  ['channel_cadence_conversions','snapshot'],
] as const

export function protectedText(name: string, context: string) {
  return customType<{ data: string; driverData: string }>({
    dataType: () => 'text',
    toDriver: value => installationVault().encrypt(value, context),
    fromDriver: value => installationVault(false).decrypt(value, context),
  })(name)
}

export function protectedJson<T>(name: string, context: string) {
  return customType<{ data: T; driverData: string }>({
    dataType: () => 'text',
    toDriver: value => {
      const serialized = JSON.stringify(value)
      if (serialized === undefined) throw new Error('Valor inválido para campo protegido.')
      return installationVault().encrypt(serialized, context)
    },
    fromDriver: value => JSON.parse(installationVault(false).decrypt(value, context)) as T,
  })(name)
}

/** Old encrypted incidents can still contain credentials from native errors.
 * Mask both new writes and historical reads at the diagnostic boundary. */
export function protectedDiagnosticText(name:string,context:string) {
  return customType<{data:string;driverData:string}>({
    dataType:()=> 'text',
    toDriver:value=>installationVault().encrypt(sanitizeDiagnostic(value),context),
    fromDriver:value=>sanitizeDiagnostic(installationVault(false).decrypt(value,context)),
  })(name)
}
