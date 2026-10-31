import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, type TechnicalLogEntry, type TechnicalLogLevel } from '../../api.js'
import { useCan, deniedReason } from '../../domain/permissions.js'

type LevelFilter = 'ALL' | 'WARN' | 'ERROR'
type SourceFilter = 'ALL' | 'ENGINE' | 'SERVER'
const levelTone: Record<TechnicalLogLevel, string> = {
  ERROR: 'bg-on-air-crimson/20 text-on-air-crimson',
  WARN: 'bg-armed-amber/15 text-armed-amber',
  INFO: 'bg-accent-ice/15 text-accent-ice',
  DEBUG: 'bg-surface-panel text-outline',
}
const levelName: Record<TechnicalLogLevel, string> = { ERROR: 'ERRO', WARN: 'AVISO', INFO: 'INFO', DEBUG: 'DEBUG' }
const RETAIN = 2000

/** Linha copiável: horário local, severidade, origem e mensagem. */
export function formatLogLine(entry: TechnicalLogEntry): string {
  const time = new Date(entry.at).toLocaleTimeString('pt-BR', { hour12: false })
  return `${time} ${levelName[entry.level].padEnd(5)} ${entry.source === 'ENGINE' ? `engine ${entry.channel ?? ''}`.trim() : 'servidor'}: ${entry.message}`
}

/**
 * Logs técnicos de verdade (A6): últimas linhas do engine e do servidor, com
 * severidade, filtro, busca e "copiar últimos 5 min". Lê do buffer em memória
 * do servidor (rota protegida por papel de Supervisor+).
 */
export function TechnicalLogsPanel({ channelId, channelName }: { channelId: string; channelName: string }) {
  const canRead = useCan('OUTPUT_CONTROL')
  const [entries, setEntries] = useState<TechnicalLogEntry[]>([])
  const [crashReports, setCrashReports] = useState<Array<{ path: string; at: string; bytes: number }>>([])
  const [level, setLevel] = useState<LevelFilter>('ALL')
  const [source, setSource] = useState<SourceFilter>('ALL')
  const [onlyChannel, setOnlyChannel] = useState(true)
  const [search, setSearch] = useState('')
  const [paused, setPaused] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const lastSeq = useRef<number | undefined>(undefined)
  const box = useRef<HTMLDivElement>(null)
  const stick = useRef(true)

  const poll = useCallback(async () => {
    try {
      const result = await api.engineeringLogs({ afterSeq: lastSeq.current, limit: RETAIN })
      lastSeq.current = result.lastSeq
      setCrashReports(result.crashReports)
      if (result.entries.length) setEntries(current => [...current, ...result.entries].slice(-RETAIN))
      setFailure(null)
    } catch (error) { setFailure(error instanceof Error ? error.message : 'Não foi possível ler os logs técnicos.') }
  }, [])
  useEffect(() => {
    if (!canRead || paused) return
    void poll()
    const timer = window.setInterval(() => void poll(), 3000)
    return () => window.clearInterval(timer)
  }, [canRead, paused, poll])

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase()
    return entries.filter(entry =>
      (level === 'ALL' || (level === 'WARN' ? entry.level === 'WARN' || entry.level === 'ERROR' : entry.level === 'ERROR')) &&
      (source === 'ALL' || entry.source === source) &&
      (!onlyChannel || entry.source === 'SERVER' || entry.channel === channelName) &&
      (!query || entry.message.toLowerCase().includes(query)))
  }, [entries, level, source, onlyChannel, search, channelName])
  useEffect(() => { if (stick.current && box.current) box.current.scrollTop = box.current.scrollHeight }, [visible.length])

  const copyLastMinutes = async () => {
    try {
      // Direto do servidor: a lista na tela pode estar filtrada ou pausada.
      const result = await api.engineeringLogs({ sinceMs: Date.now() - 5 * 60_000, limit: RETAIN, channelId: onlyChannel ? channelId : undefined })
      const text = [`# RPlayout · logs técnicos · últimos 5 min · ${new Date().toISOString()}`, ...result.entries.map(formatLogLine)].join('\n')
      await navigator.clipboard.writeText(text)
      setNotice(`${result.entries.length} linha(s) copiada(s).`)
    } catch (error) { setNotice(error instanceof Error ? `Não copiou: ${error.message}` : 'Não copiou.') }
    window.setTimeout(() => setNotice(null), 5000)
  }

  if (!canRead) return <p role="status" className="font-label-mono text-[12px] text-outline p-3">{deniedReason('ler os logs técnicos')}</p>
  const chip = (active: boolean) => `px-2.5 py-1 rounded font-label-caps text-[11px] cursor-pointer transition-colors ${active ? 'bg-primary-container text-on-primary-container font-bold' : 'bg-surface-panel hover:bg-surface-container text-outline'}`
  const errors = entries.filter(entry => entry.level === 'ERROR').length
  return (
    <div className="flex-1 min-h-0 flex flex-col gap-2">
      <div className="bg-surface-card p-2.5 rounded-lg border border-border-subtle flex flex-wrap items-center gap-2 shadow-sm">
        <span className="material-symbols-outlined text-accent-ice text-[18px]">terminal</span>
        <h2 className="font-headline-md text-[15px] font-bold text-on-surface uppercase tracking-wide mr-2">Logs técnicos · engine e servidor</h2>
        <span className="font-label-mono text-[12px] text-outline">{entries.length} linhas · {errors} erro(s)</span>
        <div className="flex flex-wrap items-center gap-1.5 ml-auto">
          {(['ALL', 'WARN', 'ERROR'] as const).map(value => <button key={value} type="button" aria-pressed={level === value} onClick={() => setLevel(value)} className={chip(level === value)}>{value === 'ALL' ? 'TODAS' : value === 'WARN' ? 'AVISO+' : 'ERRO'}</button>)}
          <span className="w-px h-5 bg-border-subtle" />
          {(['ALL', 'ENGINE', 'SERVER'] as const).map(value => <button key={value} type="button" aria-pressed={source === value} onClick={() => setSource(value)} className={chip(source === value)}>{value === 'ALL' ? 'TUDO' : value === 'ENGINE' ? 'ENGINE' : 'SERVIDOR'}</button>)}
          <label className="flex items-center gap-1 font-label-caps text-[11px] text-outline"><input type="checkbox" checked={onlyChannel} onChange={event => setOnlyChannel(event.target.checked)} />SÓ {channelName}</label>
          <input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar (ex.: not-negotiated, SIGKILL)" aria-label="Buscar nos logs" className="w-56 bg-surface-base border border-border-subtle rounded px-2 py-1 font-label-mono text-[12px]" />
          <button type="button" onClick={() => setPaused(value => !value)} className="px-2.5 py-1 rounded font-label-caps text-[11px] bg-surface-panel hover:bg-surface-container border border-border-subtle text-outline">{paused ? 'RETOMAR' : 'PAUSAR'}</button>
          <button type="button" onClick={() => void copyLastMinutes()} className="px-2.5 py-1 rounded font-label-caps text-[11px] font-bold bg-primary-container/30 text-primary border border-primary-container/50">COPIAR ÚLTIMOS 5 MIN</button>
        </div>
      </div>
      {(failure || notice) && <p role={failure ? 'alert' : 'status'} className={`font-label-mono text-[12px] ${failure ? 'text-on-air-crimson' : 'text-status-ok'}`}>{failure ?? notice}</p>}
      {crashReports.length > 0 && (
        <div className="rounded-lg border border-on-air-crimson/40 bg-on-air-crimson/10 px-3 py-1.5 font-label-mono text-[12px] text-on-surface">
          <strong className="text-on-air-crimson font-label-caps text-[11px] mr-2">RELATÓRIOS DE CRASH</strong>
          {crashReports.slice(0, 3).map(report => <span key={report.path} className="block break-all" title={`${report.bytes} bytes`}>{new Date(report.at).toLocaleString('pt-BR')} — {report.path}</span>)}
        </div>
      )}
      <div ref={box} onScroll={event => { const el = event.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40 }}
        role="log" aria-live="off" aria-label="Linhas de log"
        className="flex-1 min-h-0 bg-[#04060d] rounded-lg border border-border-subtle p-3 overflow-y-auto font-mono text-[12px] leading-relaxed flex flex-col gap-0.5 broadcast-scroll">
        {visible.length === 0 && <p className="text-outline">{entries.length ? 'Nenhuma linha com estes filtros.' : 'Sem linhas desde a partida do servidor (o buffer guarda as últimas 5 000, só em memória).'}</p>}
        {visible.map(entry => (
          <div key={entry.seq} className="flex items-start gap-2">
            <span className="text-outline tabular-nums shrink-0">{new Date(entry.at).toLocaleTimeString('pt-BR', { hour12: false })}</span>
            <span className={`font-bold text-[11px] px-1.5 rounded shrink-0 ${levelTone[entry.level]}`}>{levelName[entry.level]}</span>
            <span className="text-outline shrink-0">{entry.source === 'ENGINE' ? `engine${entry.channel ? ` ${entry.channel}` : ''}` : 'servidor'}</span>
            <span className={`flex-1 whitespace-pre-wrap break-all ${entry.level === 'ERROR' ? 'text-on-surface' : 'text-on-surface-variant'}`}>{entry.message}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
