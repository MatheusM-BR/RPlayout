import type Database from 'better-sqlite3'

/**
 * Índices de leitura dos incidentes (não são migração: não mudam colunas nem
 * dados, e uma edição anterior abre o banco com eles sem notar).
 *
 * - open_alerts: notificações/pendências abertas (SIGNAL crítico sem ciente e
 *   sem resolução). Sem ele, cada leitura varria a tabela inteira e ordenava:
 *   ~120 ms com 100 mil incidentes; com ele, < 1 ms.
 * - ack/resolved/observation: o tópico `health` do WebSocket pergunta "mudou
 *   alguma coisa?" com max() de cada coluna -- O(log n) com índice, em vez
 *   de contar pendentes a cada segundo.
 */
export const HEALTH_QUERY_INDEXES = [
  'CREATE INDEX IF NOT EXISTS health_events_open_alerts ON health_events(component,severity,occurred_at) WHERE acknowledged_at IS NULL AND resolved_at IS NULL',
  'CREATE INDEX IF NOT EXISTS health_events_ack_time ON health_events(acknowledged_at)',
  'CREATE INDEX IF NOT EXISTS health_events_resolved_time ON health_events(resolved_at)',
  'CREATE INDEX IF NOT EXISTS health_events_observation_time ON health_events(observation_ended_at)',
]

export function ensureHealthQueryIndexes(sqlite: Database.Database): void {
  const columns = new Set((sqlite.prepare('PRAGMA table_info(health_events)').all() as Array<{ name: string }>).map(row => row.name))
  if (!['acknowledged_at', 'resolved_at', 'observation_ended_at'].every(name => columns.has(name))) return
  for (const ddl of HEALTH_QUERY_INDEXES) sqlite.exec(ddl)
}

/** "Algum incidente entrou, foi reconhecido, resolvido ou encerrado?" -- só
 * leituras de ponta de índice; a resposta muda junto com o selo e as pendências. */
export const HEALTH_CHANGE_SIGNATURE_SQL = `SELECT (SELECT max(rowid) FROM health_events) AS last,
  (SELECT max(acknowledged_at) FROM health_events) AS acknowledged,
  (SELECT max(resolved_at) FROM health_events) AS resolved,
  (SELECT max(observation_ended_at) FROM health_events) AS ended,
  (SELECT count(*) FROM health_events WHERE acknowledged_at IS NULL AND resolved_at IS NULL AND component='SIGNAL' AND severity='CRITICAL') AS open`
