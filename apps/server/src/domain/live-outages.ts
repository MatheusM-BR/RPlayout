import { outageTotalMs, type LiveOutage, type LiveOutageAction, type LiveOutageClosedBy, type WatchdogDetection } from '@rplayout/protocol'
type Sqlite = import('better-sqlite3').Database
interface Row { id: string; as_run_id: string | null; item_id: string | null; source_name: string; started_at: string; ended_at: string | null; reasons: string; action: string; closed_by: string | null }
interface AsRunLike { id: string; itemId: string | null; startedAt: string; endedAt: string | null }

const toOutage = (row: Row, asRunId: string | null): LiveOutage => {
  let reasons: WatchdogDetection[] = []
  try { const parsed = JSON.parse(row.reasons); if (Array.isArray(parsed)) reasons = parsed } catch { /* motivo ilegível não apaga a parada */ }
  const durationMs = row.ended_at ? Math.max(0, Date.parse(row.ended_at) - Date.parse(row.started_at)) : null
  return { id: row.id, asRunId, itemId: row.item_id, sourceName: row.source_name, startedAt: row.started_at, endedAt: row.ended_at, durationMs, reasons, action: row.action as LiveOutageAction, closedBy: row.closed_by as LiveOutageClosedBy | null }
}

/**
 * Paradas das entradas ao vivo de cada linha as-run.
 *
 * Parada aberta que o watchdog não acompanha mais (item saiu do ar, servidor
 * reiniciado) é fechada no fim do item e marcada assim -- e isso fica gravado,
 * para o relatório não mudar de uma consulta para outra.
 */
export function attachLiveOutages<T extends AsRunLike>(sqlite: Sqlite, channelId: string, entries: readonly T[], activeIds: ReadonlySet<string> = new Set()): Array<T & { outages: LiveOutage[]; outageTotalMs: number }> {
  if (!entries.length) return []
  const times = entries.map(entry => entry.startedAt).sort()
  const rows = sqlite.prepare('SELECT id,as_run_id,item_id,source_name,started_at,ended_at,reasons,action,closed_by FROM live_outages WHERE channel_id=? AND started_at>=? ORDER BY started_at').all(channelId, times[0]) as Row[]
  const byRun = new Map<string, LiveOutage[]>()
  const close = sqlite.prepare("UPDATE live_outages SET ended_at=?,closed_by='ITEM_ENDED',as_run_id=COALESCE(as_run_id,?) WHERE id=? AND ended_at IS NULL")
  for (const row of rows) {
    const entry = (row.as_run_id ? entries.find(candidate => candidate.id === row.as_run_id) : undefined)
      ?? entries.find(candidate => candidate.itemId === row.item_id && candidate.startedAt <= row.started_at && (!candidate.endedAt || candidate.endedAt >= row.started_at))
    if (!entry) continue
    if (!row.ended_at && !activeIds.has(row.id) && entry.endedAt) {
      const ended = entry.endedAt < row.started_at ? row.started_at : entry.endedAt
      close.run(ended, entry.id, row.id)
      row.ended_at = ended; row.closed_by = 'ITEM_ENDED'
    }
    const list = byRun.get(entry.id) ?? []
    list.push(toOutage(row, entry.id)); byRun.set(entry.id, list)
  }
  return entries.map(entry => { const outages = byRun.get(entry.id) ?? []; return { ...entry, outages, outageTotalMs: outageTotalMs(outages) } })
}
