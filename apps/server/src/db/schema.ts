import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import type {
  Anchor,
  AudioLevel,
  Elastic,
  ItemType,
  LoudnessMeasurement,
  MediaKind,
  OverrunPolicy,
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
  targetLufs: real('target_lufs').notNull(),
  ceilingDbtp: real('ceiling_dbtp').notNull(),
  limiterLookaheadMs: integer('limiter_lookahead_ms').notNull(),
  /** Sub-dispositivo Decklink de saída. Preenchido, a placa é o clock mestre. */
  programSdiDeviceId: text('program_sdi_device_id'),
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
  locked: integer('locked', { mode: 'boolean' }).notNull(),
  autoNext: integer('auto_next', { mode: 'boolean' }).notNull(),
  loop: integer('loop', { mode: 'boolean' }).notNull(),
  notes: text('notes'),
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
