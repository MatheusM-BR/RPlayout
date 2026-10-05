import { useEffect, useState } from 'react'
import { api, type HostMetricSample } from '../../api.js'

const pct = (value: number | null | undefined) => value == null ? 'N/D' : `${value.toFixed(1)}%`
const bytes = (value: number | null | undefined) => value == null ? 'N/D' : `${(value / 1024 ** 3).toFixed(2)} GB`
const traffic = (value: number | null | undefined) => value == null ? 'N/D' : `${(value * 8 / 1_000_000).toFixed(2)} Mbps`

/** History is collected by the server even with every browser disconnected. */
export function HostResourcesPanel() {
  const [history, setHistory] = useState<Awaited<ReturnType<typeof api.hostMetricHistory>> | null>(null)
  const [current, setCurrent] = useState<HostMetricSample | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hours, setHours] = useState(1)
  useEffect(() => {
    let active = true
    const refresh = async () => {
      try {
        const sample = await api.hostMetrics()
        const stored = await api.hostMetricHistory(hours)
        if (!active) return
        setCurrent(sample); setHistory(stored); setError(null)
      } catch (failure) {
        if (active) setError(failure instanceof Error ? failure.message : 'Histórico indisponível.')
      }
    }
    setHistory(null)
    void refresh()
    const timer = window.setInterval(() => void refresh(), 15_000)
    return () => { active = false; window.clearInterval(timer) }
  }, [hours])
  return <section aria-label="Recursos e histórico do servidor" className="h-full overflow-auto rounded-lg border border-border-subtle bg-surface-panel p-4 text-on-surface">
    <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
      <div><h2 className="font-semibold">Recursos e histórico do servidor</h2>
        <p className="text-xs text-outline">Coleta central a cada 10 s · retenção de 14 dias · ausência de medição aparece como N/D.</p></div>
      <label className="text-xs">Período <select aria-label="Período do histórico" value={hours} onChange={event => setHours(Number(event.target.value))} className="ml-2 bg-surface-base border border-border-subtle rounded px-2 py-1">
        <option value={1}>Última hora</option><option value={6}>Últimas 6 horas</option><option value={24}>Últimas 24 horas</option><option value={336}>Últimos 14 dias</option>
      </select></label>
    </div>
    {error && <p role="alert" className="text-on-air-crimson text-sm mb-3">{error} Os dados exibidos abaixo podem estar desatualizados.</p>}
    <div className="grid sm:grid-cols-3 gap-3 mb-3 text-sm">
      <div className="bg-surface-base p-3 rounded"><h3>Volume do acervo</h3><p>{pct(current?.disk.percentUsed)} utilizado · {bytes(current?.disk.freeBytes)} livres</p><p className="text-xs text-outline break-all">{current?.disk.path}</p>{current?.disk.error && <p className="text-armed-amber text-xs">{current.disk.error}</p>}</div>
      <div className="bg-surface-base p-3 rounded"><h3>Tráfego da máquina</h3><p>Recepção {traffic(current?.network.receivedBytesPerSecond)} · envio {traffic(current?.network.sentBytesPerSecond)}</p><p className="text-xs text-outline">{current?.network.source ?? current?.network.error ?? 'Aguardando dois contadores válidos.'}</p></div>
      <div className="bg-surface-base p-3 rounded"><h3>Processo do servidor</h3><p>RAM {bytes(current?.process.rssBytes)} · heap {bytes(current?.process.heapUsedBytes)}</p><p className="text-xs text-outline">Última coleta: {current ? new Date(current.generatedAt).toLocaleString('pt-BR') : 'aguardando'}</p></div>
    </div>
    <p className="text-xs text-outline mb-2">{history ? `${history.totalSamples} amostras no período. Exibindo as 120 mais recentes disponíveis${history.truncated ? ' (consulta limitada; não cobre toda a janela)' : ''}.` : 'Carregando amostras persistidas…'} GPU indica utilização geral; rede soma adaptadores, não apenas a transmissão deste canal.</p>
    <table className="w-full text-xs text-left"><caption className="sr-only">Amostras reais de utilização do servidor</caption>
      <thead><tr className="border-b border-border-subtle">{['Coleta', 'CPU', 'RAM', 'GPU', 'Disco usado', 'Recepção', 'Envio'].map(label => <th key={label} className="py-2 pr-3">{label}</th>)}</tr></thead>
      <tbody>{history?.samples.slice(0, 120).map(sample => <tr key={sample.generatedAt} className="border-b border-border-subtle/30">
        <td className="py-2 pr-3">{new Date(sample.generatedAt).toLocaleString('pt-BR')}</td><td>{pct(sample.cpu.percent)}</td><td>{pct(sample.memory.percent)}</td><td>{pct(sample.gpu.utilizationPercent)}</td><td>{pct(sample.disk.percentUsed)}</td><td>{traffic(sample.network.receivedBytesPerSecond)}</td><td>{traffic(sample.network.sentBytesPerSecond)}</td>
      </tr>)}</tbody>
    </table>
    {history?.samples.length === 0 && <p className="text-sm py-3">Ainda não há amostras nessa janela. O histórico começa com a execução desta versão; não é preenchido com valores estimados.</p>}
  </section>
}
