import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { protectedDiagnosticText, protectedText, protectedJson } from './protected-columns.js'
import type {
  Anchor,
  AudioLevel,
  AudioTrack,
  Elastic,
  Fit,
  GraphicField,
  ItemType,
  LiveSourceType,
  LoudnessMeasurement,
  FieldOrder,
  MediaKind,
  QcStatus,
  OverrunPolicy,
  Scan,
  ScheduleEventType,
  Trim,
  FailoverConfig,
  MultiviewCell,
  MultiviewLayout,
  RedundancyRole,
  SrtConfig,
} from '@rplayout/protocol'

export const channelConfigurationVersions=sqliteTable('channel_configuration_versions',{
  channelId:text('channel_id').primaryKey(),version:integer('version').notNull(),
})
export const qcReviewVersions=sqliteTable('qc_review_versions',{
  assetId:text('asset_id').primaryKey(),version:integer('version').notNull(),
})
export const channels = sqliteTable('channels', {
  archivedAt: text('archived_at'),
  qcProfile: text('qc_profile', { mode: 'json' }).$type<import('@rplayout/protocol').QcProfile | null>(),
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  /** Frame rate como razão: 60000/1001, não 59.94. */
  rateNum: integer('rate_num').notNull(),
  rateDen: integer('rate_den').notNull(),
  width: integer('width').notNull(),
  height: integer('height').notNull(),
  scan: text('scan').$type<Scan>().notNull().default('PROGRESSIVE'),
  fieldOrder: text('field_order').$type<FieldOrder>().notNull().default('TFF'),
  targetLufs: real('target_lufs').notNull(),
  ceilingDbtp: real('ceiling_dbtp').notNull(),
  limiterLookaheadMs: integer('limiter_lookahead_ms').notNull(),
  audioChannels: integer('audio_channels').$type<2|8|16>().notNull().default(2),
  /** Sub-dispositivo Decklink de saída. Preenchido, a placa é o clock mestre. */
  programSdiDeviceId: text('program_sdi_device_id'),
  /** Arte de apresentação técnica: entra quando nada está no ar. */
  slateTemplateId: text('slate_template_id'),
  createdAt: text('created_at').notNull(),
})

/**
 * Perfis de saída do canal.
 *
 * `managed` marca os que o sistema mantém -- programa e preview, cujo destino é
 * o servidor de mídia local e não é do operador escolher. Geometria, cadência e
 * bitrate desses são editáveis; o destino não, e apagar também não.
 */
export const outputProfiles = sqliteTable('output_profiles', {
  id: text('id').primaryKey(),
  channelId: text('channel_id').notNull(),
  name: text('name').notNull(),
  kind: text('kind').$type<'RTMP' | 'SRT' | 'FILE' | 'SDI' | 'NDI' | 'OMT'>().notNull(),
  /** URL de rede ou caminho de arquivo. Vazio nos gerenciados: vem do servidor. */
  target: protectedText('target', 'output_profiles.target').notNull(),
  role: text('role').$type<'PROGRAM' | 'PREVIEW' | 'MONITOR' | 'EXTRA'>().notNull().default('EXTRA'),
  width: integer('width'),
  height: integer('height'),
  rateNum: integer('rate_num'),
  rateDen: integer('rate_den'),
  scan: text('scan').$type<Scan>(),
  bitrateKbps: integer('bitrate_kbps'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull(),
})

/** Destinos SRT/RTMP reutilizáveis. O destino completo fica apenas no SQLite. */
export const transmissionPresets = sqliteTable('transmission_presets', {
  id: text('id').primaryKey(),
  channelId: text('channel_id').notNull(),
  name: text('name').notNull(),
  kind: text('kind').$type<'SRT' | 'RTMP'>().notNull(),
  target: protectedText('target', 'transmission_presets.target').notNull(),
  createdAt: text('created_at').notNull(),
})

/** Ponto de restauração de um único canal, sem copiar ou afetar os demais. */
export const channelProjectSnapshots = sqliteTable('channel_project_snapshots', {
  id: text('id').primaryKey(),
  channelId: text('channel_id').notNull(),
  label: text('label').notNull(),
  payload: protectedJson<Record<string, unknown>>('payload', 'channel_project_snapshots.payload').notNull(),
  createdAt: text('created_at').notNull(),
})

export const mediaAssets = sqliteTable('media_assets', {
  videoCodec: text('video_codec'),
  id: text('id').primaryKey(),
  /** SHA-256 do conteúdo: acha o mesmo arquivo renomeado ou movido de pasta. */
  contentHash: text('content_hash').notNull(),
  path: text('path').notNull(),
  title: text('title').notNull(),
  kind: text('kind').$type<MediaKind>().notNull(),
  durationFrames: integer('duration_frames').notNull(),
  /** Duração de verdade. Frame só existe relativo a uma cadência. */
  durationNs: integer('duration_ns'),
  /** Tamanho e data, para a varredura pular o que não mudou sem reler o arquivo. */
  sizeBytes: integer('size_bytes'),
  modifiedAt: text('modified_at'),
  width: integer('width'),
  height: integer('height'),
  rateNum: integer('rate_num'),
  rateDen: integer('rate_den'),
  interlaceMode: text('interlace_mode'),
  hasAudio: integer('has_audio', { mode: 'boolean' }),
  audioChannels: integer('audio_channels'),
  /** Todas as trilhas de áudio, como a sonda as viu. */
  audioTracks: text('audio_tracks', { mode: 'json' }).$type<AudioTrack[] | null>(),
  /** Motivo de a sonda não ter aberto. Preenchido, o arquivo não é tocável. */
  probeError: text('probe_error'),
  categoryId: text('category_id'),
  defaultTrim: text('default_trim', { mode: 'json' }).$type<Trim | null>(),
  defaultTrimRateNum: integer('default_trim_rate_num'),
  defaultTrimRateDen: integer('default_trim_rate_den'),
  defaultAudio: text('default_audio', { mode: 'json' }).$type<AudioLevel | null>(),
  loudnessFile: text('loudness_file', { mode: 'json' }).$type<LoudnessMeasurement | null>(),
  suggestedTrim: text('suggested_trim', { mode: 'json' }).$type<Trim | null>(),
  qcStatus: text('qc_status').$type<QcStatus>().notNull().default('APPROVED'),
  qcNotes: text('qc_notes'),
  qcCheckedAt: text('qc_checked_at'),
  /** Removido da listagem pelo operador; permanece para não voltar no próximo scan. */
  ignored: integer('ignored', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
})

export const qcDecisions = sqliteTable('qc_decisions', {
  id: text('id').primaryKey(), assetId: text('asset_id').notNull(), contentHash: text('content_hash').notNull(),
  channelId: text('channel_id').notNull(), status: text('status').$type<QcStatus>().notNull(), notes: text('notes'),
  checks: text('checks', { mode: 'json' }).$type<ReturnType<typeof import('@rplayout/protocol').assessQc>>().notNull(),
  actor: text('actor'), createdAt: text('created_at').notNull(),
})

export const rundowns = sqliteTable('rundowns', {
  publicationRequired: integer('publication_required',{mode:'boolean'}).notNull().default(false),
  id: text('id').primaryKey(),
  channelId: text('channel_id').notNull(),
  name: text('name').notNull(),
  /** Início da grade, em frames desde a meia-noite. */
  plannedStart: integer('planned_start').notNull(),
  protectedZones: text('protected_zones', { mode: 'json' }).$type<import('@rplayout/protocol').ProtectedTimingZone[]>().notNull().default([]),
  loop: integer('loop', { mode: 'boolean' }).notNull(),
  date: text('date').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

/** Versões publicadas de uma playlist, para auditoria e rollback operacional. */
export const playlistVersions = sqliteTable('playlist_versions', {
  id: text('id').primaryKey(),
  rundownId: text('rundown_id').notNull().references(() => rundowns.id, { onDelete: 'cascade' }),
  sourcePath: text('source_path'),
  sourceName: text('source_name').notNull(),
  mode: text('mode').$type<'APPEND' | 'PUBLISH_NEXT'>().notNull(),
  loaded: integer('loaded').notNull(),
  skipped: integer('skipped').notNull(),
  scheduledDate: text('scheduled_date'),
  publishedAt: text('published_at').notNull(),
})

/** Revisão imutável da playlist operacional, separada da grade em edição. */
export const operationalPlaylistRevisions = sqliteTable('operational_playlist_revisions', {
  id: text('id').primaryKey(),
  rundownId: text('rundown_id').notNull().references(() => rundowns.id, { onDelete: 'cascade' }),
  revision: integer('revision').notNull(),
  state: text('state').$type<'PUBLISHED' | 'SUPERSEDED'>().notNull(),
  active: integer('active', { mode: 'boolean' }).notNull().default(false),
  payload: protectedJson<Record<string, unknown>>('payload', 'operational_playlist_revisions.payload').notNull(),
  publishedBy: text('published_by'),
  publishedAt: text('published_at').notNull(),
  activatedAt: text('activated_at'),
})

/** Original editable frames retained separately from immutable publications. */
export const channelCadenceConversions=sqliteTable('channel_cadence_conversions',{
  id:text('id').primaryKey(),channelId:text('channel_id').notNull().references(()=>channels.id),
  fingerprint:text('fingerprint').notNull(),fromNum:integer('from_num').notNull(),fromDen:integer('from_den').notNull(),
  toNum:integer('to_num').notNull(),toDen:integer('to_den').notNull(),
  snapshot:protectedJson<Record<string,unknown>>('snapshot','channel_cadence_conversions.snapshot').notNull(),
  createdAt:text('created_at').notNull(),actor:text('actor'),
})

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull(),
})

export const sessions = sqliteTable('sessions', {
  token: text('token').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: text('expires_at').notNull(),
  createdAt: text('created_at').notNull(),
})

export const healthEvents = sqliteTable('health_events', {
  id: text('id').primaryKey(),
  channelId: text('channel_id'),
  component: text('component').notNull(),
  state: text('state').notNull(),
  severity: text('severity').$type<'INFO' | 'WARN' | 'CRITICAL'>().notNull().default('INFO'),
  message: protectedDiagnosticText('message', 'health_events.message'),
  occurredAt: text('occurred_at').notNull(),
  acknowledgedAt: text('acknowledged_at'),
})

export const integrations = sqliteTable('integrations', {
  id: text('id').primaryKey(),
  channelId: text('channel_id'),
  name: text('name').notNull(),
  url: protectedText('url', 'integrations.url').notNull(),
  events: text('events', { mode: 'json' }).$type<string[]>().notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
})

/** Editorial definitions; execution always reads the published snapshot. */
export const secondaryEvents = sqliteTable('secondary_events', {
  id: text('id').primaryKey(), channelId: text('channel_id').notNull(), itemId: text('item_id').notNull(),
  definition: protectedJson<import('@rplayout/protocol').SecondaryEvent>('definition','secondary_events.definition').notNull(),
  createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
})
export const secondaryEventRuns = sqliteTable('secondary_event_runs', {
  id: text('id').primaryKey(), channelId:text('channel_id').notNull(), executionId:text('execution_id').notNull(),
  itemId:text('item_id').notNull(), revisionId:text('revision_id'), eventId:text('event_id').notNull(),
  mode:text('mode').$type<'FIRE'|'DISMISS'>().notNull(),
  state:text('state').$type<'FIRING'|'EXECUTED'|'FAILED'>().notNull(),
  frames:integer('frames').notNull(), createdAt:text('created_at').notNull(), completedAt:text('completed_at'), error:text('error'),
})

/** At-least-once deliveries. The receiver can deduplicate with the stable ID. */
export const integrationDeliveries = sqliteTable('integration_deliveries', {
  id: text('id').primaryKey(), integrationId: text('integration_id').notNull(), channelId: text('channel_id'),
  event: text('event').notNull(), target: protectedText('target','integration_deliveries.target').notNull(),
  payload: protectedJson<Record<string, unknown>>('payload','integration_deliveries.payload').notNull(),
  state: text('state').$type<'QUEUED' | 'SENDING' | 'DELIVERED' | 'FAILED' | 'CANCELLED'>().notNull(),
  attempts: integer('attempts').notNull(), nextAttemptAt: text('next_attempt_at').notNull(),
  lastError: text('last_error'), createdAt: text('created_at').notNull(), deliveredAt: text('delivered_at'),
})

/** Equipamentos externos que podem receber comandos de automação. */
export const externalDevices = sqliteTable('external_devices', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  kind: text('kind').$type<'ATEM_SWITCHER' | 'VIDEOHUB_ROUTER' | 'GPIO_RELAY'>().notNull(),
  host: text('host').notNull(),
  port: integer('port').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull(),
})

export const rundownItems = sqliteTable('rundown_items', {
  id: text('id').primaryKey(),
  rundownId: text('rundown_id').notNull(),
  sortOrder: integer('sort_order').notNull(),
  type: text('type').$type<ItemType>().notNull(),
  eventType: text('event_type').$type<ScheduleEventType>().notNull().default('SEQUENTIAL'),
  title: text('title').notNull(),
  mediaId: text('media_id'),
  sourceRef: protectedText('source_ref', 'rundown_items.source_ref'),
  trimmable: integer('trimmable', { mode: 'boolean' }).notNull().default(false),
  optional: integer('optional', { mode: 'boolean' }).notNull().default(false),
  protected: integer('protected', { mode: 'boolean' }).notNull().default(false),
  liveSourceType: text('live_source_type').$type<LiveSourceType>(),
  liveEndpoint: protectedText('live_endpoint', 'rundown_items.live_endpoint'),
  liveEstimatedDuration: integer('live_estimated_duration'),
  liveMaxDuration: integer('live_max_duration'),
  liveAutoFollowOnEnd: integer('live_auto_follow_on_end', { mode: 'boolean' }).default(false),
  liveFallbackMediaId: text('live_fallback_media_id'),
  /** Corte só deste item. Nulo herda do asset. */
  trim: text('trim', { mode: 'json' }).$type<Trim | null>(),
  /** Nivelamento só deste item. Nulo herda do asset. */
  audio: text('audio', { mode: 'json' }).$type<AudioLevel | null>(),
  durationOverride: integer('duration_override'),
  minDuration: integer('min_duration').notNull(),
  anchor: text('anchor', { mode: 'json' }).$type<Anchor>().notNull(),
  onOverrun: text('on_overrun').$type<OverrunPolicy>().notNull(),
  elastic: text('elastic', { mode: 'json' }).$type<Elastic | null>(),
  /** Itens do mesmo bloco andam juntos na grade. */
  blockId: text('block_id'),
  /** Proporção diferente da do canal. Nulo é pillarbox. */
  fit: text('fit').$type<Fit>(),
  /** Trilha de áudio escolhida. Nulo é a primeira do arquivo. */
  audioTrack: integer('audio_track'),
  locked: integer('locked', { mode: 'boolean' }).notNull(),
  autoNext: integer('auto_next', { mode: 'boolean' }).notNull(),
  loop: integer('loop', { mode: 'boolean' }).notNull(),
  notes: text('notes'),
})

/**
 * Templates de grafismo. SVG é texto: cabe no banco e sai numa caixa de
 * edição, sem navegador embutido no engine.
 */
export const graphicTemplates = sqliteTable('graphic_templates', {
  id: text('id').primaryKey(),
  /** Nulo vale para qualquer canal. */
  channelId: text('channel_id'),
  name: text('name').notNull(),
  svg: text('svg').notNull(),
  fields: text('fields', { mode: 'json' }).$type<GraphicField[]>().notNull(),
  fadeMs: integer('fade_ms').notNull(),
  /** Segundos no ar antes de sair sozinho. Nulo fica até tirarem. */
  holdSeconds: integer('hold_seconds'),
  createdAt: text('created_at').notNull(),
})

/** Grafismo preso a um item: entra sozinho no tempo marcado. */
export const itemGraphics = sqliteTable('item_graphics', {
  id: text('id').primaryKey(),
  itemId: text('item_id')
    .notNull()
    .references(() => rundownItems.id, { onDelete: 'cascade' }),
  templateId: text('template_id')
    .notNull()
    .references(() => graphicTemplates.id, { onDelete: 'cascade' }),
  // `values` é palavra reservada no SQLite: a coluna tem outro nome, o campo
  // continua sendo `values` para quem lê o código.
  values: text('field_values', { mode: 'json' }).$type<Record<string, string>>().notNull(),
  /** Segundos desde o início do item. */
  atSeconds: integer('at_seconds').notNull(),
  createdAt: text('created_at').notNull(),
})

/**
 * Pauta: o que entra em cada faixa do dia.
 *
 * É a diferença entre "monte trinta minutos" e "monte o dia": a faixa diz que
 * às sete da manhã entra chamada e comercial, e à meia-noite entra reprise.
 */
export const scheduleRules = sqliteTable('schedule_rules', {
  id: text('id').primaryKey(),
  channelId: text('channel_id').notNull(),
  name: text('name').notNull(),
  /** Dias da semana em que vale, como dígitos de 0 (domingo) a 6. */
  weekdays: text('weekdays').notNull(),
  /** Início e fim da faixa, em minutos desde a meia-noite. */
  startMinute: integer('start_minute').notNull(),
  endMinute: integer('end_minute').notNull(),
  categories: text('categories', { mode: 'json' }).$type<string[]>().notNull(),
  /** Não repetir o que foi ao ar nas últimas N horas. */
  avoidHours: integer('avoid_hours').notNull(),
  createdAt: text('created_at').notNull(),
})

/**
 * As-run: o que realmente foi ao ar.
 *
 * A grade diz o que era para acontecer; isto diz o que aconteceu. É o
 * documento que a emissora precisa quando o anunciante pergunta se o comercial
 * entrou -- e é também a matéria-prima do aprendizado, porque a diferença
 * entre o planejado e o que foi ao ar é o que ensina.
 */
export const asRun = sqliteTable('as_run', {
  id: text('id').primaryKey(),
  channelId: text('channel_id').notNull(),
  rundownId: text('rundown_id'),
  itemId: text('item_id'),
  mediaId: text('media_id'),
  revisionId: text('revision_id'),
  mediaHash: text('media_hash'),
  startPositionFrames: integer('start_position_frames'),
  endPositionFrames: integer('end_position_frames'),
  title: text('title').notNull(),
  type: text('type').notNull(),
  /** Instante real de entrada e saída, em ISO -- o relógio de parede manda. */
  startedAt: text('started_at').notNull(),
  endedAt: text('ended_at'),
  /** Frames desde a meia-noite: entrada planejada e a que aconteceu. */
  plannedStart: integer('planned_start'),
  actualStart: integer('actual_start').notNull(),
  /** Duração no ar, em frames, e a que a grade previa. */
  airedFrames: integer('aired_frames'),
  rateNum: integer('rate_num'),
  rateDen: integer('rate_den'),
  executionKind: text('execution_kind').$type<'NATIVE' | 'SIMULATED' | 'UNKNOWN'>().notNull().default('UNKNOWN'),
  durationEvidence: text('duration_evidence').$type<'ENGINE_POSITION' | 'CLOCK_ESTIMATE' | 'UNKNOWN'>().notNull().default('UNKNOWN'),
  plannedFrames: integer('planned_frames'),
  /** Como saiu: fim do arquivo, take manual, parada, ou queda da fonte. */
  endedBy: text('ended_by'),
  createdAt: text('created_at').notNull(),
})

/**
 * Log de decisões do operador. É a matéria-prima do aprendizado: a diferença
 * entre o que foi proposto e o que realmente foi ao ar.
 */
export const operatorDecisions = sqliteTable('operator_decisions', {
  id: text('id').primaryKey(),
  rundownId: text('rundown_id').notNull(),
  itemId: text('item_id'),
  kind: text('kind').notNull(),
  payload: protectedJson<Record<string, unknown>>('payload', 'operator_decisions.payload').notNull(),
  actorUsername: text('actor_username'),
  createdAt: text('created_at').notNull(),
})

/**
 * Chave de convidado. O caminho no servidor local é a própria chave, então
 * publicar sem ela é impossível: o caminho simplesmente não existe.
 */
export const guestKeys = sqliteTable('guest_keys', {
  id: text('id').primaryKey(),
  channelId: text('channel_id').notNull(),
  label: text('label').notNull(),
  streamKey: protectedText('stream_key', 'guest_keys.stream_key').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull(),
  createdAt: text('created_at').notNull(),
})

/** Destino externo. Cada um ganha o seu processo de relay. */
export const destinations = sqliteTable('destinations', {
  id: text('id').primaryKey(),
  channelId: text('channel_id').notNull(),
  name: text('name').notNull(),
  url: protectedText('url', 'destinations.url').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull(),
  createdAt: text('created_at').notNull(),
})

/**
 * Categorias do acervo, com a cor que pinta a linha na grade.
 *
 * O `id` é o próprio nome. Antes desta tabela, `media_assets.category_id` já
 * guardava texto livre digitado pelo operador; usar o nome como chave faz o
 * que já estava lá continuar valendo sem migração nenhuma.
 */
/**
 * Pastas onde o acervo procura arquivo.
 *
 * O caminho é a chave: apontar duas vezes para a mesma pasta é a mesma pasta,
 * e o banco recusa em vez de varrer duas vezes.
 */
export const mediaRoots = sqliteTable('media_roots', {
  id: text('id').primaryKey(),
  path: text('path').notNull().unique(),
  /** Nome que o operador vê. Vazio nunca: cai no nome da última pasta. */
  label: text('label').notNull(),
  createdAt: text('created_at').notNull(),
})

export const categories = sqliteTable('categories', {
  id: text('id').primaryKey(),
  /** Cor em hex, `#rrggbb`. */
  color: text('color').notNull(),
  createdAt: text('created_at').notNull(),
})

/**
 * Fontes ao vivo gerenciadas (SRT Caller/Listener/Rendezvous, NDI, RTMP, SDI)
 * com suporte nativo a contingência e paridade redundante (Primary / Backup).
 */
export const liveSources = sqliteTable('live_sources', {
  id: text('id').primaryKey(),
  channelId: text('channel_id').notNull(),
  name: text('name').notNull(),
  kind: text('kind').$type<'SRT' | 'RTMP' | 'SDI' | 'NDI' | 'OMT'>().notNull(),
  targetUrl: protectedText('target_url', 'live_sources.target_url').notNull(),
  srtConfig: protectedJson<SrtConfig | null>('srt_config', 'live_sources.srt_config'),
  role: text('role').$type<RedundancyRole>().notNull().default('PRIMARY'),
  pairedSourceId: text('paired_source_id'),
  autoFailover: integer('auto_failover', { mode: 'boolean' }).notNull().default(true),
  failoverConfig: text('failover_config', { mode: 'json' }).$type<FailoverConfig | null>(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull(),
})

/**
 * Configuração de Multiview operacional do MCR por canal ou geral.
 */
export const multiviewConfigs = sqliteTable('multiview_configs', {
  id: text('id').primaryKey(),
  channelId: text('channel_id'),
  layout: text('layout').$type<MultiviewLayout>().notNull().default('GRID_2X2'),
  cells: protectedJson<MultiviewCell[] | null>('cells', 'multiview_configs.cells'),
  updatedAt: text('updated_at').notNull(),
})
