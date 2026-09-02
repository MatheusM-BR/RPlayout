import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import type {
  Anchor,
  AudioLevel,
  AudioTrack,
  Elastic,
  Fit,
  GraphicField,
  ItemType,
  LoudnessMeasurement,
  FieldOrder,
  MediaKind,
  OverrunPolicy,
  Scan,
  Trim,
} from '@rplayout/protocol'

export const channels = sqliteTable('channels', {
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
  kind: text('kind').$type<'RTMP' | 'SRT' | 'FILE' | 'SDI'>().notNull(),
  /** URL de rede ou caminho de arquivo. Vazio nos gerenciados: vem do servidor. */
  target: text('target').notNull().default(''),
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

export const mediaAssets = sqliteTable('media_assets', {
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
  defaultAudio: text('default_audio', { mode: 'json' }).$type<AudioLevel | null>(),
  loudnessFile: text('loudness_file', { mode: 'json' }).$type<LoudnessMeasurement | null>(),
  suggestedTrim: text('suggested_trim', { mode: 'json' }).$type<Trim | null>(),
  createdAt: text('created_at').notNull(),
})

export const rundowns = sqliteTable('rundowns', {
  id: text('id').primaryKey(),
  channelId: text('channel_id').notNull(),
  name: text('name').notNull(),
  /** Início da grade, em frames desde a meia-noite. */
  plannedStart: integer('planned_start').notNull(),
  loop: integer('loop', { mode: 'boolean' }).notNull(),
  date: text('date').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const rundownItems = sqliteTable('rundown_items', {
  id: text('id').primaryKey(),
  rundownId: text('rundown_id').notNull(),
  sortOrder: integer('sort_order').notNull(),
  type: text('type').$type<ItemType>().notNull(),
  title: text('title').notNull(),
  mediaId: text('media_id'),
  sourceRef: text('source_ref'),
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
  payload: text('payload', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
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
  streamKey: text('stream_key').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull(),
  createdAt: text('created_at').notNull(),
})

/** Destino externo. Cada um ganha o seu processo de relay. */
export const destinations = sqliteTable('destinations', {
  id: text('id').primaryKey(),
  channelId: text('channel_id').notNull(),
  name: text('name').notNull(),
  url: text('url').notNull(),
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
export const categories = sqliteTable('categories', {
  id: text('id').primaryKey(),
  /** Cor em hex, `#rrggbb`. */
  color: text('color').notNull(),
  createdAt: text('created_at').notNull(),
})
