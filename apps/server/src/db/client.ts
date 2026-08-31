import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema.js'

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
  target_lufs REAL NOT NULL,
  ceiling_dbtp REAL NOT NULL,
  limiter_lookahead_ms INTEGER NOT NULL,
  program_sdi_device_id TEXT,
  created_at TEXT NOT NULL
);

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
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS media_assets_hash ON media_assets (content_hash);

CREATE TABLE IF NOT EXISTS rundowns (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES channels (id),
  name TEXT NOT NULL,
  planned_start INTEGER NOT NULL,
  date TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rundown_items (
  id TEXT PRIMARY KEY,
  rundown_id TEXT NOT NULL REFERENCES rundowns (id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  media_id TEXT REFERENCES media_assets (id),
  source_ref TEXT,
  trim TEXT,
  audio TEXT,
  duration_override INTEGER,
  min_duration INTEGER NOT NULL,
  anchor TEXT NOT NULL,
  on_overrun TEXT NOT NULL,
  elastic TEXT,
  locked INTEGER NOT NULL DEFAULT 0,
  auto_next INTEGER NOT NULL DEFAULT 1,
  loop INTEGER NOT NULL DEFAULT 0,
  notes TEXT
);
CREATE INDEX IF NOT EXISTS rundown_items_rundown ON rundown_items (rundown_id, sort_order);
CREATE INDEX IF NOT EXISTS rundown_items_media ON rundown_items (media_id);

CREATE TABLE IF NOT EXISTS operator_decisions (
  id TEXT PRIMARY KEY,
  rundown_id TEXT NOT NULL,
  item_id TEXT,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`

export type Db = ReturnType<typeof openDatabase>['db']

export function openDatabase(file: string) {
  const sqlite = new Database(file)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  sqlite.exec(DDL)
  return { sqlite, db: drizzle(sqlite, { schema }) }
}
