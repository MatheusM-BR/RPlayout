import type Database from 'better-sqlite3'
/** Explicit executable contract. Unknown IDs or changed migration identities
 * must be refused BEFORE journal settings, DDL or operational admission. */
export const supportedSchemaMigrations=Object.freeze([
  'legacy-baseline-and-checkpoints','durable-probe-policies','durable-ingest-versions-and-proxies','hashed-session-tokens','channel-and-station-access','execution-provenance-and-interrupted-items','qc-profiles-and-version-decisions','host-resource-history','authenticated-secret-vault','durable-external-alert-deliveries','published-secondary-events-and-durable-dispatch-ledger','protected-health-diagnostics','published-protected-timing-zones','asrun-historical-rate-and-execution-evidence','non-destructive-channel-archive','reviewed-editorial-cadence-conversion','durable-editorial-revisions-all-writers','global-qc-editorial-revision-invalidation','shared-trim-explicit-cadence','numbered-pgm-embedded-audio-bus','durable-channel-configuration-revisions','preset-channel-configuration-revisions','durable-qc-review-revisions','durable-project-restore-revisions','durable-live-source-revisions','durable-owner-scoped-multiview-revisions','durable-schedule-rule-revisions','durable-graphics-and-slate-review','once-only-factory-graphics-initialization','durable-account-and-session-reviews','durable-asset-removal-impact','durable-native-execution-ownership','durable-distribution-process-ownership','verified-proxy-cache-content','durable-media-job-ownership','durable-category-original-review','integration-original-review-and-delivery-ownership','durable-root-original-review','durable-ingest-worker-ownership','durable-scan-original-review','signed-server-instance-lifecycle','signed-storage-maintenance-admission','signed-immutable-restoration-receipts','signed-restored-activation-journal','explicit-item-source-binding','proxy-picture-raster-recipe','durable-health-resolution','durable-incident-context','indexed-durable-graphic-command-pending','durable-upgrade-backup-requests','multichannel-programming-mirrors','mirror-operator-unlock',
])
export function assertSchemaCompatibility(sqlite:Database.Database,requireCurrent=false){
  const table=sqlite.prepare("SELECT type FROM sqlite_master WHERE name='schema_migrations'").get() as {type:string}|undefined
  if(table&&table.type!=='table')throw new Error('Registro de migrações inválido; banco preservado sem migração.')
  const rows=table?sqlite.prepare('SELECT version,name FROM schema_migrations ORDER BY version').all() as Array<{version:number;name:string}>:[]
  const versions=new Set<number>()
  for(const row of rows){
    if(!Number.isSafeInteger(row.version)||row.version<1||versions.has(row.version)||supportedSchemaMigrations[row.version-1]!==row.name)throw new Error('Banco de outra versão ou migração desconhecida/adulterada. Use binário compatível ou restaure uma cópia compatível; não apague marcadores.')
    versions.add(row.version)
  }
  const current=rows.length===supportedSchemaMigrations.length
  if(requireCurrent&&!current)throw new Error('Banco ainda exige migração isolada e revisão para esta edição; não está pronto para ativação.')
  return {version:1 as const,supportedThrough:supportedSchemaMigrations.length,applied:rows.length,current,migrationRequired:!current,rollbackReady:false as const}
}
