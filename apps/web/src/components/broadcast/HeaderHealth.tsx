import { useEffect, useState } from 'react'
import { api, type ClockStatusView, type HostMetricSample } from '../../api.js'

type Level = 'ok' | 'warn' | 'bad' | 'unknown'
interface Tag { label: string; value: string; level: Level; title: string }

const dot: Record<Level, string> = { ok: 'bg-status-ok', warn: 'bg-armed-amber', bad: 'bg-on-air-crimson', unknown: 'bg-outline' }
const text: Record<Level, string> = { ok: 'text-status-ok-bright', warn: 'text-armed-amber', bad: 'text-on-air-crimson', unknown: 'text-outline' }

/** Saúde real no cabeçalho (antes eram selos fixos "CONFIG."): engine, saídas,
 * disco e alertas pendentes, lidos do servidor a cada 10 s. */
/** Relógio do servidor contra NTP (SNTP). Não verificado é atenção, não falha:
 * a rede de ar pode bloquear UDP 123. */
export function clockTag(clock: ClockStatusView | null | undefined): Tag {
  if (!clock) return { label: 'RELÓGIO', value: 'N/D', level: 'unknown', title: 'Sem leitura do relógio do servidor.' }
  const when = clock.checkedAt ? new Date(clock.checkedAt).toLocaleTimeString() : 'nunca'
  const offset = clock.offsetMs == null ? 'sem medida' : `${clock.offsetMs > 0 ? '+' : ''}${clock.offsetMs} ms`
  const title = `Desvio do servidor: ${offset} · última checagem: ${when}\n${clock.reason}`
  if (clock.state === 'OK') return { label: 'RELÓGIO', value: 'OK', level: 'ok', title }
  if (clock.state === 'CRITICAL') return { label: 'RELÓGIO', value: 'CRÍTICO', level: 'bad', title }
  if (clock.state === 'WARN') return { label: 'RELÓGIO', value: 'AVISO', level: 'warn', title }
  return { label: 'RELÓGIO', value: clock.checkedAt ? 'N/VERIF.' : 'AGUARDE', level: clock.checkedAt ? 'warn' : 'unknown', title }
}

export function headerHealthTags(sample: HostMetricSample | null, channelId: string, pending: { critical: number; warn: number } | null): Tag[] {
  const channel = sample?.operations?.channels.find(entry => entry.channelId === channelId)
  const engine: Tag = !channel ? { label: 'ENGINE', value: 'N/D', level: 'unknown', title: 'Sem leitura do engine.' }
    : channel.engine.hasError || !channel.engine.ready ? { label: 'ENGINE', value: channel.engine.ready ? 'ERRO' : 'PARADO', level: 'bad', title: `Reinícios: ${channel.engine.restarts}` }
    : { label: 'ENGINE', value: channel.engine.restarts || channel.engine.stalls ? `OK${channel.engine.restarts ? ` · ${channel.engine.restarts}↻` : ''}${channel.engine.stalls ? ` · ${channel.engine.stalls} trav.` : ''}` : 'OK', level: channel.engine.restarts || channel.engine.stalls ? 'warn' : 'ok', title: `Reinícios: ${channel.engine.restarts} · travamentos de saída (quadros parados): ${channel.engine.stalls}. Quadros por segundo e perdidos ainda não são informados pelo engine.` }
  const outputs = channel?.outputs ?? []
  const live = outputs.filter(output => output.state === 'onAir').length
  const failing = outputs.filter(output => output.state === 'failed' || output.state === 'retrying' || (output.hasError && output.state !== 'onAir')).length
  const out: Tag = !channel ? { label: 'SAÍDAS', value: 'N/D', level: 'unknown', title: 'Sem leitura das saídas.' }
    : { label: 'SAÍDAS', value: `${live}/${outputs.length}`, level: failing ? 'bad' : live === outputs.length ? 'ok' : 'warn', title: failing ? `${failing} saída(s) com falha ou reconectando` : 'Saídas no ar / configuradas' }
  const used = sample?.disk.percentUsed
  const disk: Tag = used == null ? { label: 'DISCO', value: 'N/D', level: 'unknown', title: sample?.disk.error ?? 'Sem leitura do disco.' }
    : { label: 'DISCO', value: `${Math.round(used)}%`, level: used > 90 ? 'bad' : used > 80 ? 'warn' : 'ok', title: `${sample!.disk.path}: ${Math.round((sample!.disk.freeBytes ?? 0) / 1e9)} GB livres` }
  const alerts: Tag = !pending ? { label: 'ALERTAS', value: 'N/D', level: 'unknown', title: 'Sem leitura dos alertas.' }
    : { label: 'ALERTAS', value: String(pending.critical + pending.warn), level: pending.critical ? 'bad' : pending.warn ? 'warn' : 'ok', title: `${pending.critical} críticos e ${pending.warn} avisos sem ciente` }
  return [engine, out, disk, alerts]
}

export function HeaderHealth({ channelId, onClick }: { channelId: string; onClick?: () => void }) {
  const [sample, setSample] = useState<HostMetricSample | null>(null)
  const [pending, setPending] = useState<{ critical: number; warn: number } | null>(null)
  const [clock, setClock] = useState<ClockStatusView | null>(null)
  useEffect(() => {
    let alive = true
    const read = () => {
      void api.hostMetrics().then(value => { if (alive) setSample(value) }).catch(() => { if (alive) setSample(null) })
      void api.clock().then(value => { if (alive) setClock(value) }).catch(() => { if (alive) setClock(null) })
      void api.healthEvents(channelId, { acknowledgement: 'PENDING' }).then(value => { if (alive) setPending(value.pending) }).catch(() => { if (alive) setPending(null) })
    }
    read()
    const timer = window.setInterval(read, 10_000)
    return () => { alive = false; window.clearInterval(timer) }
  }, [channelId])
  const tags = [...headerHealthTags(sample, channelId, pending), clockTag(clock)]
  const rank: Record<Level, number> = { ok: 0, unknown: 1, warn: 2, bad: 3 }
  const worst = tags.reduce<Level>((level, tag) => rank[tag.level] > rank[level] ? tag.level : level, 'ok')
  const worstLabel = worst === 'ok' ? 'OK' : worst === 'bad' ? 'FALHA' : worst === 'warn' ? 'ATENÇÃO' : 'N/D'
  return (
    <>
    {/* Telas médias: um selo só com o pior estado; o detalhe fica no título. */}
    <button type="button" onClick={onClick} className="flex 2xl:hidden items-center gap-1.5 px-2 py-1 rounded-lg bg-surface-panel border border-border-subtle"
      title={tags.map(tag => `${tag.label}: ${tag.value} — ${tag.title}`).join('\n')}>
      <span className={`w-2 h-2 rounded-full ${dot[worst]}`}></span>
      <span className="font-label-caps text-[11px] text-on-surface-variant">SAÚDE</span>
      <span className={`font-label-caps text-[11px] font-bold ${text[worst]}`}>{worstLabel}</span>
    </button>
    <div onClick={onClick} className={`hidden 2xl:grid grid-cols-2 gap-1 bg-surface-panel p-1 rounded-lg border border-border-subtle ${onClick ? 'cursor-pointer hover:border-border-strong transition-colors' : ''}`} title="Saúde do canal. Detalhe no Monitor.">
      {tags.map(tag => (
        <div key={tag.label} title={tag.title} className="flex items-center gap-space-xs px-2 py-0.5 rounded bg-surface-container border border-border-subtle/50">
          <span className={`w-1.5 h-1.5 rounded-full ${dot[tag.level]}`}></span>
          <span className="font-label-caps text-[11px] text-on-surface-variant">{tag.label}:</span>
          <span className={`font-label-caps text-[11px] font-bold ${text[tag.level]}`}>{tag.value}</span>
        </div>
      ))}
    </div>
    </>
  )
}
