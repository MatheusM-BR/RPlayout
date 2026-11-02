import type Database from 'better-sqlite3'

/**
 * Índices de leitura dos incidentes (não são migração: não mudam colunas nem
 * dados, e uma edição anterior abre o banco com eles sem notar).
 *
 * - open_alerts: notificações/pendências abertas (SIGNAL crítico sem ciente e
 *   sem resolução). Sem ele, cada leitura varria a tabela inteira e ordenava:
 *   ~120 ms com 100 mil incidentes; com ele, < 1 ms.
 * - ack/resolved/observation/severity: os tópicos `health` e `alarms` perguntam "mudou
 *   alguma coisa?" com max() de cada coluna -- O(log n) com índice, em vez
 *   de contar pendentes a cada segundo.
 */
export const HEALTH_QUERY_INDEXES = [
  'CREATE INDEX IF NOT EXISTS health_events_open_alerts ON health_events(component,severity,occurred_at) WHERE acknowledged_at IS NULL AND resolved_at IS NULL',
  'CREATE INDEX IF NOT EXISTS health_events_ack_time ON health_events(acknowledged_at)',
  'CREATE INDEX IF NOT EXISTS health_events_resolved_time ON health_events(resolved_at)',
  'CREATE INDEX IF NOT EXISTS health_events_observation_time ON health_events(observation_ended_at)',
  'CREATE INDEX IF NOT EXISTS health_events_severity ON health_events(severity)',
]

export function ensureHealthQueryIndexes(sqlite: Database.Database): void {
  const columns = new Set((sqlite.prepare('PRAGMA table_info(health_events)').all() as Array<{ name: string }>).map(row => row.name))
  if (!['acknowledged_at', 'resolved_at', 'observation_ended_at'].every(name => columns.has(name))) return
  for (const ddl of HEALTH_QUERY_INDEXES) sqlite.exec(ddl)
}

/** Selo ALERTAS (pendentes aviso/crítico): muda quando entra aviso ou crítico,
 * ou quando algo é reconhecido. INFO (recuperado, partida…) não mexe no selo. */
export const HEALTH_PENDING_SIGNATURE_SQL = `SELECT (SELECT max(rowid) FROM health_events WHERE severity='WARN') AS warn,
  (SELECT max(rowid) FROM health_events WHERE severity='CRITICAL') AS critical,
  (SELECT max(acknowledged_at) FROM health_events) AS acknowledged`

/** Pendências que tocam alarme (SIGNAL crítico aberto): muda só quando um
 * alarme abre, é reconhecido, resolvido ou deixa de ser observado. */
export const HEALTH_ALARM_SIGNATURE_SQL = `SELECT count(*) AS open, max(rowid) AS last,
  (SELECT max(observation_ended_at) FROM health_events) AS ended
  FROM health_events WHERE component='SIGNAL' AND severity='CRITICAL' AND acknowledged_at IS NULL AND resolved_at IS NULL`
