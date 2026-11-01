import { useEffect, useState } from 'react'
import { MONITOR_TIER_LABEL } from '@rplayout/protocol'
import { api, type MonitorEngineering } from '../../api.js'
import { monitorStatsStore, percentile, useClockTest, useMonitorEntries } from '../../domain/monitor-stats-store.js'

const n = (value: number | null | undefined, digits = 0, unit = '') => (value == null || !Number.isFinite(value) ? '—' : `${value.toFixed(digits)}${unit}`)

/**
 * Tela técnica dos monitores do navegador.
 *
 * Do servidor: sessões de placa (total, reservadas ao programa, emprestadas,
 * livres) e o encoder/perfil de cada nível no engine. Desta página: as
 * estatísticas WebRTC de cada monitor aberto e, com o relógio de teste
 * ligado, o atraso de vidro a vidro medido.
 */
export function MonitorEngineeringPanel({ channelId }: { channelId: string }) {
  const [status, setStatus] = useState<MonitorEngineering | null>(null)
  const [error, setError] = useState<string | null>(null)
  const entries = useMonitorEntries()
  const clockTest = useClockTest()
  useEffect(() => {
    let active = true
    const refresh = () => void api.monitorStatus(channelId).then((value) => { if (active) { setStatus(value); setError(null) } }).catch((failure: unknown) => { if (active) setError(failure instanceof Error ? failure.message : 'indisponível') })
    refresh()
    const timer = window.setInterval(refresh, 2000)
    return () => { active = false; window.clearInterval(timer) }
  }, [channelId])
  const toggleClock = async () => {
    const on = !clockTest
    try { await api.setMonitorClock(channelId, on); monitorStatsStore.setClockTest(on) } catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível mudar o relógio de teste.') }
  }
  const sessions = status?.sessions
  return (
    <section aria-label="Monitores do navegador" className="rounded border border-border-subtle p-2 text-[12px]">
      <header className="mb-1 flex items-center justify-between gap-2">
        <h3 className="font-bold uppercase">Monitores do navegador</h3>
        <button type="button" className="btn small" aria-pressed={clockTest} onClick={() => void toggleClock()}>
          {clockTest ? 'DESLIGAR RELÓGIO DE TESTE' : 'MEDIR ATRASO (RELÓGIO DE TESTE)'}
        </button>
      </header>
      {error && <p role="alert" className="text-armed-amber">{error}</p>}
      <p data-testid="encoder-sessions">
        Codificação por placa: {sessions?.hardware ? `${sessions.hardware} — ${sessions.total === null ? 'sem limite de sessões' : `${sessions.total} sessões`}, ${sessions.reservedForProgram} reservadas ao programa, ${sessions.monitorsInUse} em monitores, ${sessions.free === null ? 'livres sem limite' : `${sessions.free} livres`}` : 'sem placa — monitores em x264 (veryfast/zerolatency)'}
        {sessions?.learned ? ` (${sessions.learned})` : ''}
      </p>
      <table className="mt-1 w-full t-data">
        <thead><tr><th>Monitor</th><th>Nível</th><th>Encoder</th><th>Perfil</th><th>Estado</th></tr></thead>
        <tbody>
          {(status?.monitors ?? []).flatMap((monitor) => monitor.tiers.map((tier) => (
            <tr key={`${monitor.bus}-${tier.tier}`}>
              <td>{monitor.bus === 'mon' ? 'PGM' : monitor.bus === 'pvw' ? 'PVW' : String(monitor.bus).toUpperCase()}</td>
              <td>{MONITOR_TIER_LABEL[tier.tier]}</td>
              <td>{tier.encoder ?? '—'}{tier.hardware ? ' (placa)' : ''}</td>
              <td>{tier.profile ? `${tier.profile.width}×${tier.profile.height} ${n(tier.profile.fpsN / tier.profile.fpsD, 2)} fps ≤${tier.profile.bitrateKbps} kbps` : '—'}{tier.degraded ? ` — ${tier.degraded}` : ''}</td>
              <td>{tier.health}{tier.error ? ` — ${tier.error}` : ''}</td>
            </tr>
          )))}
          {!(status?.monitors ?? []).some((monitor) => monitor.tiers.length) && <tr><td colSpan={5}>Nenhum nível codificando agora (ninguém assistindo).</td></tr>}
        </tbody>
      </table>
      <h4 className="mt-2 font-bold uppercase">Recebido nesta estação (WebRTC)</h4>
      <table className="w-full t-data">
        <thead><tr><th>Monitor</th><th>Nível</th><th>Imagem</th><th>fps</th><th>Descartados</th><th>Jitter buffer</th><th>Decodificação</th><th>Bitrate</th><th>Perda</th><th>Vidro a vidro</th></tr></thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id}>
              <td>{entry.role.toUpperCase()}</td>
              <td>{entry.tier ? MONITOR_TIER_LABEL[entry.tier] : '—'}{entry.mode === 'auto' ? ' (auto)' : ''}</td>
              <td>{entry.stats ? `${entry.stats.width}×${entry.stats.height}` : '—'}</td>
              <td>{n(entry.stats?.fps, 1)}</td>
              <td>{entry.stats ? `${entry.stats.droppedTotal}` : '—'}</td>
              <td>{n(entry.stats?.jitterBufferMs, 0, ' ms')}</td>
              <td>{n(entry.stats?.decodeMs, 1, ' ms')}</td>
              <td>{n(entry.stats?.kbps, 0, ' kbps')}</td>
              <td>{entry.stats ? `${(entry.stats.loss * 100).toFixed(1)}%` : '—'}</td>
              <td>{clockTest ? (entry.glass.length ? `p50 ${percentile(entry.glass, 0.5)} ms · p95 ${percentile(entry.glass, 0.95)} ms` : 'aguardando faixa') : '—'}</td>
            </tr>
          ))}
          {!entries.length && <tr><td colSpan={10}>Nenhum monitor aberto nesta página.</td></tr>}
        </tbody>
      </table>
      {clockTest && <p className="mt-1 text-outline">O vidro a vidro compara o relógio gravado na imagem pelo engine com o relógio desta página; em outra máquina, os dois relógios precisam estar sincronizados (NTP).</p>}
    </section>
  )
}
