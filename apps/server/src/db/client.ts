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
CREATE INDEX IF NOT EXISTS output_profiles_channel ON output_profiles (channel_id);

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
    return new Database(file)
  } catch (falha) {
    const texto = falha instanceof Error ? falha.message : String(falha)
    if (!texto.includes('bindings file')) throw falha
    throw new Error(
      `O SQLite não abriu: não há binário do better-sqlite3 para o Node ${process.version}.\n` +
        'Este projeto roda em Node 22 ou 24. Rodando noutra versão (23, por exemplo),\n' +
        'o pacote não acha binário pronto e tentaria compilar, o que exige as ferramentas\n' +
        'de compilação do Visual Studio.\n' +
        'Conserto: instale o Node 22 LTS ou o 24, apague node_modules e rode `pnpm install`.',
    )
  }
}

export function openDatabase(file: string) {
  const sqlite = abrirSqlite(file)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
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
    'ALTER TABLE media_assets ADD COLUMN audio_tracks TEXT',
    'CREATE UNIQUE INDEX IF NOT EXISTS media_assets_path ON media_assets (path)',
  ]) {
    try {
      sqlite.exec(alter)
    } catch {
      // Coluna já existe.
    }
  }
  return { sqlite, db: drizzle(sqlite, { schema }) }
}
