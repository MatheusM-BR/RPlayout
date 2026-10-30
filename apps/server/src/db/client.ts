import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema.js'
import { createHash } from 'node:crypto'
import { migrateSecretVault,finishVaultCleanup } from './vault-migration.js'
import {migrateEditorialRevisions} from './editorial-revisions.js'
import {migrateTrimCadence} from './trim-cadence.js'
import {migrateAudioBus} from './audio-bus.js'
import {migrateChannelConfiguration} from './channel-configuration.js'
import {migratePresetConfiguration} from './preset-configuration.js'
import {migrateQcRevisions} from './qc-revisions.js'
import {migrateProjectRevisions} from './project-revisions.js'
import {migrateLiveSourceRevisions} from './live-source-revisions.js'
import {migrateMultiviewRevisions} from './multiview-revisions.js'
import {migrateScheduleRuleRevisions} from './schedule-rule-revisions.js'
import {migrateGraphicsRevisions} from './graphics-revisions.js'
import {migrateGraphicsInitialization} from './graphics-initialization.js'
import {migrateAccountRevisions} from './account-revisions.js'
import {migrateAssetRemovalRevisions} from './asset-removal-revisions.js'
import {migrateExecutionOwnership} from './execution-ownership.js'
import {migrateDistributionOwnership} from './distribution-ownership.js'
import {migrateProxyIntegrity} from './proxy-integrity.js'
import {migrateMediaJobOwnership} from './media-job-ownership.js'
import {migrateCategoryRevisions} from './category-revisions.js'
import {migrateIntegrationRevisions} from './integration-revisions.js'
import {migrateRootRevisions} from './root-revisions.js'
import {migrateIngestOwnership} from './ingest-ownership.js'
import {migrateScanRevisions} from './scan-revisions.js'
import {migrateServerInstances} from './server-instances.js'
import {assertStorageAdmissionOpen,migrateStorageAdmission} from './storage-admission.js'
import {migrateRestorationRecords} from './restoration-records.js'
import {migrateRestoredActivations} from './restored-activations.js'
import {migrateItemSourceBindings} from './item-source-bindings.js'
import {migrateProxyRecipe} from './proxy-recipe.js'
import {migrateHealthResolution} from './health-resolution.js'
import {migrateIncidentContexts} from './incident-context.js'
import {migrateGraphicCommandPending} from './graphic-command-pending.js'
import type {StorageMaintenance} from '../domain/storage-maintenance.js'
import {openProcessDatabase} from './process-database.js'
import {assertSchemaCompatibility} from './schema-compatibility.js'
import {migrateUpgradeBackupRequests} from './upgrade-backup-requests.js'
import {migrateChannelMirrors,migrateMirrorUnlock,migrateMirrorUnlockExpiry} from './channel-mirrors.js'
import {migrateAssetCutMarks} from './asset-cut-marks.js'
import {migrateAuditImmutable} from './audit-immutable.js'
import {assertNoUncertainUpgradeProfile} from '../domain/upgrade-profile-adoption.js'
import {assertNoUnboundReturnCandidate} from './return-candidate-admission.js'

/**
 * DDL idempotente. O banco de um playout tem que sobreviver a queda de energia,
 * então WAL fica ligado e cada alteração é durável antes de responder.
 */
const DDL = `
CREATE TABLE IF NOT EXISTS channels (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  rate_num INTEGER NOT NULL,
  rate_den INTEGER NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  scan TEXT NOT NULL DEFAULT 'PROGRESSIVE',
  field_order TEXT NOT NULL DEFAULT 'TFF',
  target_lufs REAL NOT NULL,
  ceiling_dbtp REAL NOT NULL,
  limiter_lookahead_ms INTEGER NOT NULL,
  program_sdi_device_id TEXT,
  slate_template_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS output_profiles (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES channels (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  target TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'EXTRA',
  width INTEGER,
  height INTEGER,
  rate_num INTEGER,
  rate_den INTEGER,
  scan TEXT,
  bitrate_kbps INTEGER,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS channel_project_snapshots (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES channels (id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS channel_project_snapshots_channel ON channel_project_snapshots (channel_id, created_at DESC);
CREATE INDEX IF NOT EXISTS output_profiles_channel ON output_profiles (channel_id);

CREATE TABLE IF NOT EXISTS transmission_presets (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES channels (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  target TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS transmission_presets_channel ON transmission_presets (channel_id, created_at);

CREATE TABLE IF NOT EXISTS media_assets (
  id TEXT PRIMARY KEY,
  content_hash TEXT NOT NULL,
  path TEXT NOT NULL,
  title TEXT NOT NULL,
  kind TEXT NOT NULL,
  duration_frames INTEGER NOT NULL,
  category_id TEXT,
  default_trim TEXT,
  default_audio TEXT,
  loudness_file TEXT,
  suggested_trim TEXT,
  qc_status TEXT NOT NULL DEFAULT 'APPROVED',
  qc_notes TEXT,
  qc_checked_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS media_assets_hash ON media_assets (content_hash);

CREATE TABLE IF NOT EXISTS rundowns (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES channels (id),
  name TEXT NOT NULL,
  planned_start INTEGER NOT NULL,
  loop INTEGER NOT NULL DEFAULT 1,
  date TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rundown_items (
  id TEXT PRIMARY KEY,
  rundown_id TEXT NOT NULL REFERENCES rundowns (id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL,
  type TEXT NOT NULL,
  event_type TEXT NOT NULL DEFAULT 'SEQUENTIAL',
  title TEXT NOT NULL,
  media_id TEXT REFERENCES media_assets (id),
  source_ref TEXT,
  trimmable INTEGER NOT NULL DEFAULT 0,
  optional INTEGER NOT NULL DEFAULT 0,
  protected INTEGER NOT NULL DEFAULT 0,
  live_source_type TEXT,
  live_endpoint TEXT,
  live_estimated_duration INTEGER,
  live_max_duration INTEGER,
  live_auto_follow_on_end INTEGER DEFAULT 0,
  live_fallback_media_id TEXT,
  trim TEXT,
  audio TEXT,
  duration_override INTEGER,
  min_duration INTEGER NOT NULL,
  anchor TEXT NOT NULL,
  on_overrun TEXT NOT NULL,
  elastic TEXT,
  block_id TEXT,
  fit TEXT,
  audio_track INTEGER,
  locked INTEGER NOT NULL DEFAULT 0,
  auto_next INTEGER NOT NULL DEFAULT 1,
  loop INTEGER NOT NULL DEFAULT 0,
  notes TEXT
);
CREATE INDEX IF NOT EXISTS rundown_items_rundown ON rundown_items (rundown_id, sort_order);
CREATE INDEX IF NOT EXISTS rundown_items_media ON rundown_items (media_id);

CREATE TABLE IF NOT EXISTS playlist_versions (
  id TEXT PRIMARY KEY,
  rundown_id TEXT NOT NULL REFERENCES rundowns (id) ON DELETE CASCADE,
  source_path TEXT,
  source_name TEXT NOT NULL,
  mode TEXT NOT NULL,
  loaded INTEGER NOT NULL,
  skipped INTEGER NOT NULL,
  published_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS playlist_versions_rundown ON playlist_versions (rundown_id, published_at);

-- A grade editável e a lista operacional publicada são coisas diferentes.
-- Cada publicação preserva itens e resultado de timing para auditoria/rollback.
CREATE TABLE IF NOT EXISTS operational_playlist_revisions (
  id TEXT PRIMARY KEY,
  rundown_id TEXT NOT NULL REFERENCES rundowns (id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  state TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 0,
  payload TEXT NOT NULL,
  published_by TEXT,
  published_at TEXT NOT NULL,
  activated_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS operational_playlist_revision ON operational_playlist_revisions (rundown_id, revision);
CREATE INDEX IF NOT EXISTS operational_playlist_active ON operational_playlist_revisions (rundown_id, active);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions (expires_at);
CREATE TABLE IF NOT EXISTS health_events (
  id TEXT PRIMARY KEY,
  channel_id TEXT,
  component TEXT NOT NULL,
  state TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'INFO',
  message TEXT,
  occurred_at TEXT NOT NULL,
  acknowledged_at TEXT
);
CREATE INDEX IF NOT EXISTS health_events_time ON health_events (occurred_at);
CREATE TABLE IF NOT EXISTS integrations (
  id TEXT PRIMARY KEY,
  channel_id TEXT,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  events TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS external_devices (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  host TEXT NOT NULL,
  port INTEGER NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS guest_keys (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES channels (id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  stream_key TEXT NOT NULL UNIQUE,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS destinations (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES channels (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS graphic_templates (
  id TEXT PRIMARY KEY,
  channel_id TEXT REFERENCES channels (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  svg TEXT NOT NULL,
  fields TEXT NOT NULL,
  fade_ms INTEGER NOT NULL DEFAULT 300,
  hold_seconds INTEGER,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS item_graphics (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES rundown_items (id) ON DELETE CASCADE,
  template_id TEXT NOT NULL REFERENCES graphic_templates (id) ON DELETE CASCADE,
  field_values TEXT NOT NULL,
  at_seconds INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS item_graphics_item ON item_graphics (item_id);

CREATE TABLE IF NOT EXISTS schedule_rules (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES channels (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  weekdays TEXT NOT NULL,
  start_minute INTEGER NOT NULL,
  end_minute INTEGER NOT NULL,
  categories TEXT NOT NULL,
  avoid_hours INTEGER NOT NULL DEFAULT 6,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS schedule_rules_channel ON schedule_rules (channel_id, start_minute);

CREATE TABLE IF NOT EXISTS as_run (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  rundown_id TEXT,
  item_id TEXT,
  media_id TEXT,
  title TEXT NOT NULL,
  type TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  planned_start INTEGER,
  actual_start INTEGER NOT NULL,
  aired_frames INTEGER,
  planned_frames INTEGER,
  ended_by TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS as_run_channel ON as_run (channel_id, started_at);

-- Categorias do acervo. O id é o próprio nome, que é o que já estava gravado
-- em media_assets.category_id antes desta tabela existir: assim o que o
-- operador digitou continua valendo, e a tabela só acrescenta a cor.
CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  color TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Pastas do acervo.
--
-- Antes disto havia uma só, fixada por variável de ambiente na hora de subir:
-- trocar de pasta exigia mexer no atalho do Windows e reiniciar, e apontar
-- para duas pastas era impossível. Numa emissora o material chega em mais de
-- um lugar -- programação, comerciais, avulsos --, e obrigar tudo a morar sob
-- a mesma raiz é obrigar a mover arquivo.
CREATE TABLE IF NOT EXISTS media_roots (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS operator_decisions (
  id TEXT PRIMARY KEY,
  rundown_id TEXT NOT NULL,
  item_id TEXT,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS live_sources (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES channels (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  target_url TEXT NOT NULL,
  srt_config TEXT,
  role TEXT NOT NULL DEFAULT 'PRIMARY',
  paired_source_id TEXT,
  auto_failover INTEGER NOT NULL DEFAULT 1,
  failover_config TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS live_sources_channel ON live_sources (channel_id);

CREATE TABLE IF NOT EXISTS multiview_configs (
  id TEXT PRIMARY KEY,
  channel_id TEXT,
  layout TEXT NOT NULL DEFAULT 'GRID_2X2',
  cells TEXT,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS channel_checkpoints (
  channel_id TEXT PRIMARY KEY REFERENCES channels (id) ON DELETE CASCADE,
  payload TEXT NOT NULL,
  saved_at TEXT NOT NULL
);
`

export type Db = ReturnType<typeof openDatabase>['db']

/**
 * Abre o SQLite, e explica quando o binário nativo não serve para este Node.
 *
 * O `better-sqlite3` é compilado, e o pacote traz um binário pronto por versão
 * de Node. Rodando numa versão para a qual não há binário, ele não falha
 * dizendo isso: despeja treze caminhos onde procurou e uma pilha de vinte
 * linhas. Quem está numa máquina de playout às três da manhã não tem como
 * concluir dali que o problema é a versão do Node -- e é sempre isso.
 */
function abrirSqlite(file: string): Database.Database {
  try {
    const mode=process.env.RPLAYOUT_STORAGE_MODE??(process.argv[1]?.endsWith('.cjs')?'PROCESS':'INLINE')
    if(!['PROCESS','INLINE'].includes(mode))throw new Error('RPLAYOUT_STORAGE_MODE deve ser PROCESS ou INLINE.')
    // Tests/dev keep their explicit in-process fixture. Compiled production
    // uses a private separate process; a missing helper is never silent fallback.
    if(mode==='PROCESS')return openProcessDatabase(file)
    return new Database(file)
  } catch (falha) {
    const texto = falha instanceof Error ? falha.message : String(falha)
    if (!texto.includes('bindings file') && !texto.includes('NODE_MODULE_VERSION')) throw falha
    throw new Error(
      `O SQLite nativo não é compatível com o runtime Node ${process.version} desta instalação.\n` +
        'O pacote portátil deve incluir o Node e o SQLite testados juntos.\n' +
        'Execute pelo iniciador do pacote completo e use o verificador de integridade; não é necessário instalar tsx, tsc ou módulos manualmente.\n' +
        `Detalhe: ${texto}`,
    )
  }
}

export function openDatabase(file: string, options:{onOpened?:(sqlite:Database.Database)=>void;maintenance?:StorageMaintenance;assertAdmission?:(sqlite:Database.Database)=>void}={}) {
  const sqlite = abrirSqlite(file)
  const assertAdmission=()=>{if(options.maintenance)options.maintenance.assertHeldOn(sqlite);else assertStorageAdmissionOpen(sqlite);options.assertAdmission?.(sqlite)}
  try{assertSchemaCompatibility(sqlite);assertNoUnboundReturnCandidate(sqlite);assertAdmission()}catch(error){sqlite.close();throw error}
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  sqlite.pragma('synchronous = FULL')
  let vaultCleanup=false
  const initialize=sqlite.transaction(()=>{
  assertSchemaCompatibility(sqlite)
  assertAdmission()
  // A legacy database may predate migration tracking. Only a truly empty
  // database may receive factory templates, never an existing empty catalog.
  const freshDatabase = !sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' LIMIT 1").get()
  sqlite.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)')
  const migrateBaseline = sqlite.transaction(() => {
  if (sqlite.prepare('SELECT version FROM schema_migrations WHERE version = 1').get()) return
  sqlite.exec(DDL)
  // Colunas acrescentadas depois. Um banco de playout não pode ser recriado do
  // zero a cada versão, então a adição é tentada e ignorada se já existir.
  for (const alter of [
    'ALTER TABLE rundowns ADD COLUMN loop INTEGER NOT NULL DEFAULT 1',
    'ALTER TABLE rundown_items ADD COLUMN block_id TEXT',
    'ALTER TABLE media_assets ADD COLUMN duration_ns INTEGER',
    'ALTER TABLE media_assets ADD COLUMN size_bytes INTEGER',
    'ALTER TABLE media_assets ADD COLUMN modified_at TEXT',
    'ALTER TABLE media_assets ADD COLUMN width INTEGER',
    'ALTER TABLE media_assets ADD COLUMN height INTEGER',
    'ALTER TABLE media_assets ADD COLUMN rate_num INTEGER',
    'ALTER TABLE media_assets ADD COLUMN rate_den INTEGER',
    'ALTER TABLE media_assets ADD COLUMN interlace_mode TEXT',
    'ALTER TABLE media_assets ADD COLUMN has_audio INTEGER',
    'ALTER TABLE media_assets ADD COLUMN audio_channels INTEGER',
    'ALTER TABLE media_assets ADD COLUMN probe_error TEXT',
    "ALTER TABLE channels ADD COLUMN scan TEXT NOT NULL DEFAULT 'PROGRESSIVE'",
    "ALTER TABLE channels ADD COLUMN field_order TEXT NOT NULL DEFAULT 'TFF'",
    'ALTER TABLE channels ADD COLUMN slate_template_id TEXT',
    'ALTER TABLE rundown_items ADD COLUMN fit TEXT',
    'ALTER TABLE rundown_items ADD COLUMN audio_track INTEGER',
    "ALTER TABLE rundown_items ADD COLUMN event_type TEXT NOT NULL DEFAULT 'SEQUENTIAL'",
    'ALTER TABLE rundown_items ADD COLUMN trimmable INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE rundown_items ADD COLUMN optional INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE rundown_items ADD COLUMN protected INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE rundown_items ADD COLUMN live_source_type TEXT',
    'ALTER TABLE rundown_items ADD COLUMN live_endpoint TEXT',
    'ALTER TABLE rundown_items ADD COLUMN live_estimated_duration INTEGER',
    'ALTER TABLE rundown_items ADD COLUMN live_max_duration INTEGER',
    'ALTER TABLE rundown_items ADD COLUMN live_auto_follow_on_end INTEGER DEFAULT 0',
    'ALTER TABLE rundown_items ADD COLUMN live_fallback_media_id TEXT',
    'ALTER TABLE media_assets ADD COLUMN audio_tracks TEXT',
    'ALTER TABLE media_assets ADD COLUMN ignored INTEGER NOT NULL DEFAULT 0',
    "ALTER TABLE media_assets ADD COLUMN qc_status TEXT NOT NULL DEFAULT 'APPROVED'",
    'ALTER TABLE media_assets ADD COLUMN qc_notes TEXT',
    'ALTER TABLE media_assets ADD COLUMN qc_checked_at TEXT',
    'ALTER TABLE operator_decisions ADD COLUMN actor_username TEXT',
    'ALTER TABLE health_events ADD COLUMN acknowledged_at TEXT',
    "ALTER TABLE health_events ADD COLUMN severity TEXT NOT NULL DEFAULT 'INFO'",
    'ALTER TABLE playlist_versions ADD COLUMN scheduled_date TEXT',
    'CREATE UNIQUE INDEX IF NOT EXISTS media_assets_path ON media_assets (path)',
  ]) {
    const column = /^ALTER TABLE (\w+) ADD COLUMN (\w+) /i.exec(alter)
    if (column) {
      const columns = sqlite.pragma(`table_info(${column[1]})`) as Array<{ name: string }>
      if (columns.some((entry) => entry.name === column[2])) continue
    }
    // Ignore only a column confirmed present; disk/corruption/constraint errors
    // must abort and roll back the migration instead of leaving half a schema.
    sqlite.exec(alter)
  }
  sqlite.prepare('INSERT INTO schema_migrations VALUES (1, ?, ?)').run('legacy-baseline-and-checkpoints', new Date().toISOString())
  })
  const migratePolicies = sqlite.transaction(() => {
    if (sqlite.prepare('SELECT version FROM schema_migrations WHERE version=2').get()) return
    sqlite.exec(`CREATE TABLE channel_operational_policies (
      channel_id TEXT PRIMARY KEY REFERENCES channels(id) ON DELETE CASCADE,
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`)
    sqlite.prepare('INSERT INTO schema_migrations VALUES (2, ?, ?)').run('durable-probe-policies', new Date().toISOString())
  })
  const migrateMediaWorkflow = sqlite.transaction(() => {
    if (sqlite.prepare('SELECT version FROM schema_migrations WHERE version=3').get()) return
    sqlite.exec(`
      CREATE TABLE ingest_batches (id TEXT PRIMARY KEY, roots TEXT NOT NULL, measure INTEGER NOT NULL,
        state TEXT NOT NULL, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE media_versions (id TEXT PRIMARY KEY, asset_id TEXT NOT NULL REFERENCES media_assets(id),
        revision INTEGER NOT NULL, content_hash TEXT NOT NULL, metadata TEXT NOT NULL, archive_path TEXT,
        created_at TEXT NOT NULL, UNIQUE(asset_id,revision), UNIQUE(asset_id,content_hash));
      CREATE TABLE media_jobs (id TEXT PRIMARY KEY, version_id TEXT NOT NULL REFERENCES media_versions(id),
        kind TEXT NOT NULL, state TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
        output_path TEXT, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        UNIQUE(version_id,kind));
      CREATE INDEX media_jobs_pending ON media_jobs(state,created_at);
    `)
    sqlite.prepare('INSERT INTO schema_migrations VALUES (3, ?, ?)').run('durable-ingest-versions-and-proxies', new Date().toISOString())
  })
  const migrateSessions = sqlite.transaction(() => {
    if (sqlite.prepare('SELECT version FROM schema_migrations WHERE version=4').get()) return
    for (const row of sqlite.prepare('SELECT token FROM sessions').all() as Array<{ token: string }>) {
      sqlite.prepare('UPDATE sessions SET token=? WHERE token=?').run(createHash('sha256').update(row.token).digest('hex'), row.token)
    }
    sqlite.prepare('INSERT INTO schema_migrations VALUES (4, ?, ?)').run('hashed-session-tokens', new Date().toISOString())
  })
  const migrateAccess = sqlite.transaction(() => {
    if (sqlite.prepare('SELECT version FROM schema_migrations WHERE version=5').get()) return
    sqlite.exec(`CREATE TABLE user_access (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      channel_ids TEXT, station_ips TEXT, updated_at TEXT NOT NULL)`)
    sqlite.prepare('INSERT INTO schema_migrations VALUES (5, ?, ?)').run('channel-and-station-access', new Date().toISOString())
  })
  const migrateExecutionAudit = sqlite.transaction(() => {
    if (sqlite.prepare('SELECT version FROM schema_migrations WHERE version=6').get()) return
    sqlite.exec(`ALTER TABLE as_run ADD COLUMN revision_id TEXT;
      ALTER TABLE as_run ADD COLUMN media_hash TEXT;
      ALTER TABLE as_run ADD COLUMN start_position_frames INTEGER;
      ALTER TABLE as_run ADD COLUMN end_position_frames INTEGER;
      CREATE TABLE interrupted_items (id TEXT PRIMARY KEY, channel_id TEXT NOT NULL REFERENCES channels(id),
        rundown_id TEXT NOT NULL, item_id TEXT NOT NULL, revision_id TEXT, title TEXT NOT NULL,
        frames INTEGER NOT NULL, specification TEXT NOT NULL, state TEXT NOT NULL,
        created_at TEXT NOT NULL, resolved_at TEXT, resolved_by TEXT);
      CREATE INDEX interrupted_items_pending ON interrupted_items(channel_id,state);`)
    sqlite.prepare('INSERT INTO schema_migrations VALUES (6, ?, ?)').run('execution-provenance-and-interrupted-items', new Date().toISOString())
  })
  const migrateQc = sqlite.transaction(() => {
    if (sqlite.prepare('SELECT version FROM schema_migrations WHERE version=7').get()) return
    sqlite.exec(`ALTER TABLE channels ADD COLUMN qc_profile TEXT;
      ALTER TABLE media_assets ADD COLUMN video_codec TEXT;
      CREATE TABLE qc_decisions (id TEXT PRIMARY KEY, asset_id TEXT NOT NULL, content_hash TEXT NOT NULL,
        channel_id TEXT NOT NULL, status TEXT NOT NULL, notes TEXT, checks TEXT NOT NULL, actor TEXT, created_at TEXT NOT NULL);
      CREATE INDEX qc_decisions_version ON qc_decisions(asset_id,content_hash,channel_id,created_at);`)
    sqlite.prepare('INSERT INTO schema_migrations VALUES (7, ?, ?)').run('qc-profiles-and-version-decisions', new Date().toISOString())
  })
  const migrateHostMetrics = sqlite.transaction(() => {
    if (sqlite.prepare('SELECT version FROM schema_migrations WHERE version=8').get()) return
    sqlite.exec('CREATE TABLE host_metric_samples (sampled_at TEXT PRIMARY KEY,payload TEXT NOT NULL)')
    sqlite.prepare('INSERT INTO schema_migrations VALUES (8, ?, ?)').run('host-resource-history', new Date().toISOString())
  })
  const migrateIntegrationOutbox = sqlite.transaction(() => {
    if (sqlite.prepare('SELECT version FROM schema_migrations WHERE version=10').get()) return
    sqlite.exec(`CREATE TABLE integration_deliveries (id TEXT PRIMARY KEY,integration_id TEXT NOT NULL,channel_id TEXT,
      event TEXT NOT NULL,target TEXT NOT NULL,payload TEXT NOT NULL,state TEXT NOT NULL,attempts INTEGER NOT NULL,
      next_attempt_at TEXT NOT NULL,last_error TEXT,created_at TEXT NOT NULL,delivered_at TEXT);
      CREATE INDEX integration_deliveries_due ON integration_deliveries(state,next_attempt_at);`)
    sqlite.prepare('INSERT INTO schema_migrations VALUES (10,?,?)').run('durable-external-alert-deliveries', new Date().toISOString())
  })
  const migrateSecondaryEvents = sqlite.transaction(() => {
    if (sqlite.prepare('SELECT version FROM schema_migrations WHERE version=11').get()) return
    sqlite.exec(`CREATE TABLE secondary_events (id TEXT PRIMARY KEY,channel_id TEXT NOT NULL REFERENCES channels(id),
      item_id TEXT NOT NULL REFERENCES rundown_items(id) ON DELETE CASCADE,definition TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
      CREATE INDEX secondary_events_item ON secondary_events(item_id);
      CREATE TABLE secondary_event_runs (id TEXT PRIMARY KEY,channel_id TEXT NOT NULL,execution_id TEXT NOT NULL,
      item_id TEXT NOT NULL,revision_id TEXT,event_id TEXT NOT NULL,mode TEXT NOT NULL,state TEXT NOT NULL,
      frames INTEGER NOT NULL,created_at TEXT NOT NULL,completed_at TEXT,error TEXT);
      CREATE UNIQUE INDEX secondary_event_runs_pass ON secondary_event_runs(execution_id,event_id,mode);
      CREATE INDEX secondary_event_runs_channel ON secondary_event_runs(channel_id,created_at);`)
    sqlite.prepare('INSERT INTO schema_migrations VALUES (11,?,?)').run('published-secondary-events-and-durable-dispatch-ledger',new Date().toISOString())
  })
  const migrateTimingZones = sqlite.transaction(() => {
    if (sqlite.prepare('SELECT version FROM schema_migrations WHERE version=13').get()) return
    sqlite.exec("ALTER TABLE rundowns ADD COLUMN protected_zones TEXT NOT NULL DEFAULT '[]'")
    sqlite.prepare('INSERT INTO schema_migrations VALUES (13,?,?)').run('published-protected-timing-zones', new Date().toISOString())
  })
  const migrateAsRunEvidence = sqlite.transaction(() => {
    if (sqlite.prepare('SELECT version FROM schema_migrations WHERE version=14').get()) return
    sqlite.exec("ALTER TABLE as_run ADD COLUMN rate_num INTEGER; ALTER TABLE as_run ADD COLUMN rate_den INTEGER; ALTER TABLE as_run ADD COLUMN execution_kind TEXT NOT NULL DEFAULT 'UNKNOWN'; ALTER TABLE as_run ADD COLUMN duration_evidence TEXT NOT NULL DEFAULT 'UNKNOWN'")
    sqlite.prepare('INSERT INTO schema_migrations VALUES (14,?,?)').run('asrun-historical-rate-and-execution-evidence', new Date().toISOString())
  })
  const migrateChannelArchive = sqlite.transaction(() => {
    if (sqlite.prepare('SELECT version FROM schema_migrations WHERE version=15').get()) return
    sqlite.exec('ALTER TABLE channels ADD COLUMN archived_at TEXT')
    sqlite.prepare('INSERT INTO schema_migrations VALUES (15,?,?)').run('non-destructive-channel-archive',new Date().toISOString())
  })
  const migrateCadence=sqlite.transaction(()=>{
    if(sqlite.prepare('SELECT version FROM schema_migrations WHERE version=16').get())return
    sqlite.exec(`ALTER TABLE rundowns ADD COLUMN publication_required INTEGER NOT NULL DEFAULT 0;
      CREATE TABLE channel_cadence_conversions(id TEXT PRIMARY KEY,channel_id TEXT NOT NULL REFERENCES channels(id),
      fingerprint TEXT NOT NULL,from_num INTEGER NOT NULL,from_den INTEGER NOT NULL,to_num INTEGER NOT NULL,to_den INTEGER NOT NULL,
      snapshot TEXT NOT NULL,created_at TEXT NOT NULL,actor TEXT);
      CREATE INDEX cadence_conversions_channel ON channel_cadence_conversions(channel_id,created_at);`)
    sqlite.prepare('INSERT INTO schema_migrations VALUES (16,?,?)').run('reviewed-editorial-cadence-conversion',new Date().toISOString())
  })
    migrateBaseline(); migratePolicies(); migrateMediaWorkflow(); migrateSessions()
    migrateAccess(); migrateExecutionAudit(); migrateQc(); migrateHostMetrics()
    migrateIntegrationOutbox(); migrateSecondaryEvents(); migrateTimingZones()
    migrateAsRunEvidence(); migrateChannelArchive(); migrateCadence()
    migrateEditorialRevisions(sqlite); migrateTrimCadence(sqlite); migrateAudioBus(sqlite)
    migrateChannelConfiguration(sqlite); migratePresetConfiguration(sqlite); migrateQcRevisions(sqlite)
    migrateProjectRevisions(sqlite); migrateLiveSourceRevisions(sqlite); migrateMultiviewRevisions(sqlite)
    migrateScheduleRuleRevisions(sqlite); migrateGraphicsRevisions(sqlite)
    migrateGraphicsInitialization(sqlite,freshDatabase); migrateAccountRevisions(sqlite)
    migrateAssetRemovalRevisions(sqlite)
    vaultCleanup=migrateSecretVault(sqlite,{deferCleanup:true})
    migrateExecutionOwnership(sqlite)
    migrateDistributionOwnership(sqlite)
    migrateProxyIntegrity(sqlite)
    migrateMediaJobOwnership(sqlite)
    migrateCategoryRevisions(sqlite)
    migrateIntegrationRevisions(sqlite)
    migrateRootRevisions(sqlite)
    migrateIngestOwnership(sqlite)
    migrateScanRevisions(sqlite)
    migrateServerInstances(sqlite)
    migrateStorageAdmission(sqlite)
    migrateRestorationRecords(sqlite)
    migrateRestoredActivations(sqlite)
    migrateItemSourceBindings(sqlite)
    migrateProxyRecipe(sqlite)
    migrateHealthResolution(sqlite)
    migrateIncidentContexts(sqlite)
    migrateGraphicCommandPending(sqlite)
    migrateUpgradeBackupRequests(sqlite)
    migrateChannelMirrors(sqlite)
    migrateMirrorUnlock(sqlite)
    migrateMirrorUnlockExpiry(sqlite)
    migrateAssetCutMarks(sqlite)
    migrateAuditImmutable(sqlite)
    assertSchemaCompatibility(sqlite,true)
    assertNoUncertainUpgradeProfile(sqlite)
    options.onOpened?.(sqlite)
  })
  try {initialize.immediate();if(vaultCleanup)finishVaultCleanup(sqlite)} catch (error) { sqlite.close(); throw error }
  return { sqlite, db: drizzle(sqlite, { schema }) }
}
