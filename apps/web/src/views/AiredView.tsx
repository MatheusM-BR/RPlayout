import { useState, useEffect, useMemo } from 'react'
import type { Channel } from '@rplayout/protocol'
import type { WorkspaceId } from '../components/WorkspaceShell.js'
import { BroadcastHeader } from '../components/broadcast/BroadcastHeader.js'
import { AncineComplianceCard } from '../components/broadcast/AncineComplianceCard.js'
import { api } from '../api.js'
import { dur } from '../format.js'
import { asRunCsv, asRunDuration, asRunReport, asRunStatus, asRunXml, summarizeAsRun } from '../domain/asrun-evidence.js'
import type { AsRunEntry } from '../types.js'

interface Props {
  channel?: Channel
  channels?: Channel[]
  onNavigate: (workspace: WorkspaceId) => void
  onSelectChannel?: (channelId: string) => void
  sessionRole?: string
  authRequired?: boolean
  onOpenSettings?: () => void
}

function formatLocalDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function formatLocalTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function AiredView({
  channel,
  channels = channel ? [channel] : [],
  onNavigate,
  onSelectChannel = () => {},
  sessionRole = 'Operador Master',
  authRequired = false,
  onOpenSettings,
}: Props) {
  const [entries, setEntries] = useState<AsRunEntry[] | null>(null)
  const [loadError,setLoadError]=useState<string|null>(null)
  const [archivedChannels,setArchivedChannels]=useState<Channel[]>([])
  const [archivedSelection,setArchivedSelection]=useState<string>('')
  const [archiveError,setArchiveError]=useState<string|null>(null)
  const historyChannel=archivedChannels.find(candidate=>candidate.id===archivedSelection) ?? channel ?? archivedChannels[0]
  useEffect(()=>{
    let active=true
    setArchiveError(null)
    api.archivedChannels().then(result=>{if(active)setArchivedChannels(result.channels)}).catch(error=>{if(active)setArchiveError(error instanceof Error ? error.message : 'Não foi possível consultar os canais arquivados.')})
    return ()=>{active=false}
  },[channel?.id])

  // Por padrão operacional, filtro inicial cobre exatamente as últimas 24 horas móveis:
  const [startDate, setStartDate] = useState<string>(() => {
    const d = new Date(Date.now() - 24 * 60 * 60 * 1000)
    return formatLocalDate(d)
  })
  const [startTime, setStartTime] = useState<string>(() => {
    const d = new Date(Date.now() - 24 * 60 * 60 * 1000)
    return formatLocalTime(d)
  })
  const [endDate, setEndDate] = useState<string>(() => {
    return formatLocalDate(new Date())
  })
  const [endTime, setEndTime] = useState<string>(() => {
    return formatLocalTime(new Date())
  })
  const [quickPreset, setQuickPreset] = useState<'24h' | 'today' | 'yesterday' | '7days' | 'all' | null>('24h')

  const [selectedCategory, setSelectedCategory] = useState<string>('TODOS')
  const [selectedStatus, setSelectedStatus] = useState<string>('TODOS')
  const [searchTerm, setSearchTerm] = useState<string>('')
  const [isExporting, setIsExporting] = useState(false)

  // Cálculo dos limites ISO 8601 correspondentes ao período selecionado
  const { startIso, endIso } = useMemo(() => {
    if (quickPreset === 'all' || (!startDate && !endDate)) {
      return { startIso: '', endIso: '' }
    }

    let sIso = ''
    if (startDate) {
      const parts = startDate.split('-').map(Number)
      const y = parts[0] ?? 2026
      const m = (parts[1] ?? 1) - 1
      const d = parts[2] ?? 1
      const timeParts = (startTime || '00:00').split(':').map(Number)
      const hh = timeParts[0] ?? 0
      const mm = timeParts[1] ?? 0
      const startObj = new Date(y, m, d, hh, mm, 0, 0)
      sIso = startObj.toISOString()
    }

    let eIso = ''
    if (endDate) {
      const parts = endDate.split('-').map(Number)
      const y = parts[0] ?? 2026
      const m = (parts[1] ?? 1) - 1
      const d = parts[2] ?? 1
      const timeParts = (endTime || '23:59').split(':').map(Number)
      const hh = timeParts[0] ?? 23
      const mm = timeParts[1] ?? 59
      const endObj = new Date(y, m, d, hh, mm, 59, 999)
      eIso = endObj.toISOString()
    }

    return { startIso: sIso, endIso: eIso }
  }, [startDate, startTime, endDate, endTime, quickPreset])

  // Polling de dados de As-Run com os limites selecionados
  useEffect(() => {
    let alive = true
    let inFlight = false
    setEntries(null);setLoadError(null)
    if (!historyChannel) return
    const load = () => {
      if (inFlight) return
      inFlight = true
      api
        .asRun(historyChannel.id, {
          since: startIso || (quickPreset === 'all' ? '' : undefined),
          until: endIso || undefined,
        })
        .then((result) => {
          if (alive) {setEntries(result.entries);setLoadError(null)}
        })
        .catch(() => {
          if (alive) setLoadError('Consulta indisponível; não foi possível confirmar os registros atuais.')
        })
        .finally(() => { inFlight = false })
    }
    load()
    const timer = window.setInterval(load, 3000)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [historyChannel?.id, startIso, endIso, quickPreset])

  // Filtragem local refinada
  const filteredEntries = useMemo(() => {
    if (!entries) return []
    return entries.filter((entry) => {
      // Filtro de data/hora (Início e Fim)
      if (startIso && entry.startedAt < startIso) {
        return false
      }
      if (endIso && entry.startedAt > endIso) {
        return false
      }
      // Filtro de categoria
      if (selectedCategory !== 'TODOS') {
        const type = entry.type?.toUpperCase()
        // Tipos reais do item (VT/LIVE/GFX/SLATE/COMMERCIAL/FILLER); antes havia JORNAL/PROMO, que nunca casavam.
        const typeMatch = selectedCategory === 'AO VIVO' ? ['LIVE', 'AO VIVO'].includes(type) : selectedCategory === 'COMERCIAL' ? ['COMERCIAL', 'COMMERCIAL', 'SPOT', 'PUB'].includes(type) : selectedCategory === 'ENCHIMENTO' ? type === 'FILLER' : type === selectedCategory.toUpperCase()
        if (!typeMatch) return false
      }
      // Filtro de status/motivo
      if (selectedStatus !== 'TODOS') {
        const status = !entry.endedAt ? 'RUNNING' : entry.endedBy ?? 'UNKNOWN'
        if (status !== selectedStatus) return false
      }
      // Busca textual
      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase()
        const matchTitle = entry.title?.toLowerCase().includes(q)
        const matchId = entry.id?.toLowerCase().includes(q)
        if (!matchTitle && !matchId) return false
      }
      return true
    })
  }, [entries, startIso, endIso, selectedCategory, selectedStatus, searchTerm])

  const summary = summarizeAsRun(filteredEntries)
  const totalFrames = summary.frames
  const totalSeconds = Math.round(summary.seconds)
  const hours = Math.floor(totalSeconds / 3600), minutes = Math.floor(totalSeconds % 3600 / 60), seconds = totalSeconds % 60
  const formattedTotalTime = [hours, minutes, seconds].map(value => String(value).padStart(2, '0')).join(':')
  const eofCount = summary.eof, takeCount = summary.takes, stopCount = summary.stops

  const download = (content: string, mime: string, extension: string) => {
    if (!historyChannel) return
    if (!entries || loadError) return
    setIsExporting(true)
    const url = URL.createObjectURL(new Blob([content], { type: mime }))
    const link = document.createElement('a')
    link.href = url; link.download = `asrun_${historyChannel.id}_${startDate || 'inicio'}_a_${endDate || 'fim'}.${extension}`
    document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url)
    setIsExporting(false)
  }
  const handleExportCsv = () => download(asRunCsv(filteredEntries), 'text/csv;charset=utf-8', 'csv')
  const handleExportBxf = () => { if (historyChannel) download(asRunXml(filteredEntries, historyChannel), 'application/xml;charset=utf-8', 'xml') }
  const handleExportCev = () => { if (historyChannel) download(asRunReport(filteredEntries, historyChannel, new Date()), 'text/plain;charset=utf-8', 'txt') }
  const getAsRunBadge = (entry: AsRunEntry) => ({
    label: asRunStatus(entry),
    style: !entry.endedAt ? 'bg-armed-amber/20 text-armed-amber border-armed-amber/40' : 'bg-surface-panel text-on-surface border-border-subtle',
  })

  // Atalhos rápidos de seleção de período
  const handlePreset = (preset: '24h' | 'today' | 'yesterday' | '7days' | 'all') => {
    setQuickPreset(preset)
    const current = new Date()
    if (preset === '24h') {
      const p24 = new Date(current.getTime() - 24 * 60 * 60 * 1000)
      setStartDate(formatLocalDate(p24))
      setStartTime(formatLocalTime(p24))
      setEndDate(formatLocalDate(current))
      setEndTime(formatLocalTime(current))
    } else if (preset === 'today') {
      setStartDate(formatLocalDate(current))
      setStartTime('00:00')
      setEndDate(formatLocalDate(current))
      setEndTime('23:59')
    } else if (preset === 'yesterday') {
      const y = new Date(current.getTime() - 24 * 60 * 60 * 1000)
      setStartDate(formatLocalDate(y))
      setStartTime('00:00')
      setEndDate(formatLocalDate(y))
      setEndTime('23:59')
    } else if (preset === '7days') {
      const p7 = new Date(current.getTime() - 7 * 24 * 60 * 60 * 1000)
      setStartDate(formatLocalDate(p7))
      setStartTime('00:00')
      setEndDate(formatLocalDate(current))
      setEndTime('23:59')
    } else if (preset === 'all') {
      setStartDate('')
      setStartTime('')
      setEndDate('')
      setEndTime('')
    }
  }

  return (
    <div className="w-full h-full bg-surface-base text-on-surface antialiased select-none flex flex-col overflow-hidden font-body-md text-body-md">
      {/* 1. CABEÇALHO PADRÃO RPLAYOUT */}
      {channel ? <BroadcastHeader
        activeWorkspace="aired"
        channel={channel}
        channels={channels}
        onSelectChannel={onSelectChannel}
        onNavigate={onNavigate}
        sessionRole={sessionRole}
        authRequired={authRequired}
        onOpenSettings={onOpenSettings || (() => onNavigate('settings'))}
      /> : <header className="p-4 bg-surface-card border-b border-border-subtle flex items-center justify-between"><span>RPlayout — consulta de histórico, sem canal ativo autorizado</span><button type="button" onClick={()=>onNavigate('master')} className="btn">Voltar</button></header>}

      <main className="w-full bg-surface-base flex-1 min-h-0 flex flex-col overflow-y-auto broadcast-scroll">
        {archiveError && <p role="alert" className="px-margin py-2 text-xs text-armed-amber">Histórico de canais arquivados indisponível: {archiveError}</p>}
        {archivedChannels.length>0 && <div className="px-margin py-2 border-b border-border-subtle flex items-center gap-3 bg-surface-panel">
          <label className="text-xs" htmlFor="aired-archived-channel">Histórico de canal</label>
          <select id="aired-archived-channel" value={historyChannel?.archivedAt ? historyChannel.id : ''} onChange={event=>setArchivedSelection(event.target.value)} className="bg-surface-base border border-border-subtle rounded p-2 text-xs">
            {channel && <option value="">Canal ativo: {channel.name}</option>}
            {archivedChannels.map(candidate=><option key={candidate.id} value={candidate.id}>{candidate.name} — arquivado</option>)}
          </select>
          {historyChannel?.archivedAt && <span className="text-xs text-armed-amber">Somente histórico. Esta seleção não reativa o canal nem altera PGM/CUE.</span>}
        </div>}
        {!historyChannel && !archiveError && <p role="status" className="px-margin py-4 text-outline">Nenhum histórico de canal autorizado disponível.</p>}
        {/* 2. BARRA DE TÍTULO TÁTICA */}
        <div className="w-full bg-surface-card border-b border-border-subtle px-margin py-3 flex flex-wrap items-center justify-between gap-gutter shadow-sm">
          <div className="flex items-center gap-space-md">
            <div className="w-8 h-8 rounded-lg bg-primary-container flex items-center justify-center text-on-primary-container shadow-sm">
              <span className="material-symbols-outlined text-[20px]">history_toggle_off</span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-headline-md text-headline-md tracking-wider text-on-surface uppercase leading-none font-bold">
                  AIRED // REGISTRO AS-RUN
                </h1>
                <span className="font-label-caps text-[10px] px-2 py-0.5 rounded bg-status-ok/20 text-status-ok-bright border border-status-ok/40 font-bold uppercase">
                  REGISTRO OPERACIONAL
                </span>
              </div>
              <span className="font-label-mono text-label-mono text-outline">
                Registro operacional • Relógio local do host • Sem homologação regulatória
              </span>
            </div>
          </div>

          {/* Ações de Exportação Broadcast Fase C */}
          <div className="flex flex-wrap items-center gap-space-sm">
            <button
              onClick={() => window.print()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-surface-panel hover:bg-surface-container text-on-surface border border-border-subtle font-body-sm text-[12px] transition-colors cursor-pointer"
              disabled={!entries || !!loadError}
              title="Imprimir o registro operacional consultado"
            >
              <span className="material-symbols-outlined text-[16px]">print</span>
              <span>Imprimir</span>
            </button>

            <button
              onClick={handleExportCsv}
              disabled={isExporting || !entries || !!loadError}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-surface-panel hover:bg-surface-container text-on-surface border border-border-subtle hover:border-border-strong font-body-sm text-[12px] transition-colors cursor-pointer disabled:opacity-50"
              title="Exportar dados de As-Run em formato CSV estruturado"
            >
              <span className="material-symbols-outlined text-[16px] text-accent-ice">table_view</span>
              <span>Exportar CSV</span>
            </button>

            <button
              onClick={handleExportBxf}
              disabled={isExporting || !entries || !!loadError}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-primary-container hover:bg-accent-ice text-on-primary-container font-headline-md text-headline-md tracking-wide transition-all shadow-sm cursor-pointer disabled:opacity-50"
              title="Exportar registro operacional no formato XML As-run do RPlayout"
            >
              <span className="material-symbols-outlined text-[16px]">integration_instructions</span>
              <span>Exportar XML As-run</span>
            </button>

            <button
              onClick={handleExportCev}
              disabled={isExporting || !entries || !!loadError}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-surface-container hover:bg-surface-container-high text-on-surface border border-status-ok/40 hover:border-status-ok font-body-sm text-[12px] text-status-ok-bright transition-all shadow-sm cursor-pointer disabled:opacity-50"
              title="Gerar relatório operacional; não substitui comprovante certificado de exibição"
            >
              <span className="material-symbols-outlined text-[16px] text-status-ok">verified</span>
              <span>Relatório Operacional</span>
            </button>
          </div>
        </div>

        {loadError && <p role="alert" className="px-margin text-armed-amber">{loadError}</p>}
        {/* 3. KPI CARDS RESUMO DA TRANSMISSÃO */}
        <div className="px-margin pt-space-md grid grid-cols-2 md:grid-cols-4 gap-gutter shrink-0">
          <div className="bg-surface-card rounded-xl border border-border-subtle p-3 flex flex-col justify-between shadow-sm">
            <span className="font-label-caps text-[10px] text-outline uppercase tracking-wider">
              Duração registrada / estimada
            </span>
            <div className="font-timecode-display text-[26px] text-primary font-bold tabular-nums leading-tight mt-1">
              {entries === null ? '—' : formattedTotalTime}
            </div>
            <span className="font-label-mono text-[10px] text-outline mt-0.5">
              {entries === null ? 'Consultando o registro…' : `${totalFrames.toLocaleString()} quadros no log · inclui registros legados`}
            </span>
          </div>

          <div className="bg-surface-card rounded-xl border border-border-subtle p-3 flex flex-col justify-between shadow-sm">
            <span className="font-label-caps text-[10px] text-outline uppercase tracking-wider">
              Ocorrências registradas
            </span>
            <div className="font-timecode-display text-[26px] text-on-surface font-bold tabular-nums leading-tight mt-1">
              {entries === null ? '—' : filteredEntries.length}
            </div>
            <span className="font-label-mono text-[10px] text-status-ok-bright mt-0.5">
              {eofCount} fins de arquivo • {takeCount} cortes (TAKE/live)
            </span>
          </div>

          <div className="bg-surface-card rounded-xl border border-border-subtle p-3 flex flex-col justify-between shadow-sm">
            <span className="font-label-caps text-[10px] text-outline uppercase tracking-wider">
              Paradas registradas
            </span>
            <div className="font-timecode-display text-[26px] text-status-ok-bright font-bold tabular-nums leading-tight mt-1">
              {entries === null ? '—' : stopCount}
            </div>
            <span className="font-label-mono text-[10px] text-outline mt-0.5">
              {summary.missingDurations} durações N/D · {summary.estimates} estimadas
            </span>
          </div>

          <div className="bg-surface-card rounded-xl border border-border-subtle p-3 flex flex-col justify-between shadow-sm">
            <span className="font-label-caps text-[10px] text-outline uppercase tracking-wider">
              Aferição Regulatória
            </span>
            <div className="font-timecode-display text-[24px] text-accent-ice-bright font-bold tabular-nums leading-tight mt-1">
              NÃO HOMOLOGADA
            </div>
            <span className="font-label-mono text-[10px] text-status-ok-bright mt-0.5">
              Origem/certificados não aferidos
            </span>
          </div>
        </div>

        {/* 3.1 RESUMO DE COMPLIANCE ANCINE (FASE C: TETO 25% E COTAS NACIONAIS) */}
        <div className="px-margin pt-space-md shrink-0">
          <AncineComplianceCard entries={filteredEntries} />
        </div>

        {/* 4. BARRA DE FILTROS AVANÇADA (DATA, CATEGORIA, STATUS, BUSCA) */}
        <div className="px-margin pt-space-md flex flex-col gap-space-sm shrink-0">
          <div className="bg-surface-card rounded-xl border border-border-subtle p-3 flex flex-wrap items-center justify-between gap-3 shadow-sm">
            {/* Seletor de Período de Auditoria (Início e Fim de Data/Hora) */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-label-caps text-[10px] text-outline uppercase font-bold">Período:</span>

              {/* Data/Hora Início */}
              <div className="flex items-center gap-1.5 bg-surface-panel px-2.5 py-1 rounded border border-border-subtle hover:border-border-strong transition-colors">
                <span className="font-label-caps text-[10px] text-outline uppercase font-bold">De:</span>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => {
                    setStartDate(e.target.value)
                    setQuickPreset(null)
                  }}
                  className="bg-transparent text-on-surface font-label-mono text-[11px] outline-none cursor-pointer"
                  title="Data Inicial de Veiculação"
                />
                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => {
                    setStartTime(e.target.value)
                    setQuickPreset(null)
                  }}
                  className="bg-transparent text-primary font-label-mono text-[11px] font-bold outline-none cursor-pointer border-l border-border-subtle pl-1.5 w-14"
                  title="Hora Inicial"
                />
              </div>

              <span className="text-outline font-label-caps text-[11px]">→</span>

              {/* Data/Hora Fim */}
              <div className="flex items-center gap-1.5 bg-surface-panel px-2.5 py-1 rounded border border-border-subtle hover:border-border-strong transition-colors">
                <span className="font-label-caps text-[10px] text-outline uppercase font-bold">Até:</span>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => {
                    setEndDate(e.target.value)
                    setQuickPreset(null)
                  }}
                  className="bg-transparent text-on-surface font-label-mono text-[11px] outline-none cursor-pointer"
                  title="Data Final de Veiculação"
                />
                <input
                  type="time"
                  value={endTime}
                  onChange={(e) => {
                    setEndTime(e.target.value)
                    setQuickPreset(null)
                  }}
                  className="bg-transparent text-primary font-label-mono text-[11px] font-bold outline-none cursor-pointer border-l border-border-subtle pl-1.5 w-14"
                  title="Hora Final"
                />
              </div>

              {/* Atalhos Rápidos de Período */}
              <div className="flex items-center gap-1">
                <button
                  onClick={() => handlePreset('24h')}
                  className={`px-2 py-1 rounded font-label-caps text-[11px] transition-colors cursor-pointer ${
                    quickPreset === '24h'
                      ? 'bg-primary text-surface-base font-bold shadow-sm'
                      : 'bg-surface-panel hover:bg-surface-container text-outline hover:text-on-surface'
                  }`}
                  title="Filtrar as últimas 24 horas de registros"
                >
                  24h (Padrão)
                </button>
                <button
                  onClick={() => handlePreset('today')}
                  className={`px-2 py-1 rounded font-label-caps text-[11px] transition-colors cursor-pointer ${
                    quickPreset === 'today'
                      ? 'bg-primary text-surface-base font-bold shadow-sm'
                      : 'bg-surface-panel hover:bg-surface-container text-outline hover:text-on-surface'
                  }`}
                  title="Filtrar hoje (00:00 até 23:59)"
                >
                  Hoje
                </button>
                <button
                  onClick={() => handlePreset('yesterday')}
                  className={`px-2 py-1 rounded font-label-caps text-[11px] transition-colors cursor-pointer ${
                    quickPreset === 'yesterday'
                      ? 'bg-primary text-surface-base font-bold shadow-sm'
                      : 'bg-surface-panel hover:bg-surface-container text-outline hover:text-on-surface'
                  }`}
                  title="Filtrar ontem (00:00 até 23:59)"
                >
                  Ontem
                </button>
                <button
                  onClick={() => handlePreset('7days')}
                  className={`px-2 py-1 rounded font-label-caps text-[11px] transition-colors cursor-pointer ${
                    quickPreset === '7days'
                      ? 'bg-primary text-surface-base font-bold shadow-sm'
                      : 'bg-surface-panel hover:bg-surface-container text-outline hover:text-on-surface'
                  }`}
                  title="Filtrar últimos 7 dias"
                >
                  7 Dias
                </button>
                <button
                  onClick={() => handlePreset('all')}
                  className={`px-2 py-1 rounded font-label-caps text-[11px] transition-colors cursor-pointer ${
                    quickPreset === 'all'
                      ? 'bg-primary text-surface-base font-bold shadow-sm'
                      : 'bg-surface-panel hover:bg-surface-container text-outline hover:text-on-surface'
                  }`}
                  title="Visualizar todo o histórico sem corte de data"
                >
                  Todo Histórico
                </button>
              </div>
            </div>

            {/* Pílulas de Categoria */}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-label-caps text-[10px] text-outline uppercase font-bold mr-1">Categoria:</span>
              {(['TODOS', 'VT', 'AO VIVO', 'COMERCIAL', 'GFX', 'SLATE', 'ENCHIMENTO'] as const).map((cat) => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-2.5 py-1 rounded-full font-label-caps text-[10px] transition-all cursor-pointer ${
                    selectedCategory === cat
                      ? 'bg-primary text-surface-base font-bold shadow-sm'
                      : 'bg-surface-panel hover:bg-surface-container text-outline hover:text-on-surface'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>

            {/* Filtro de Status / Encerramento */}
            <div className="flex items-center gap-1.5">
              <span className="font-label-caps text-[10px] text-outline uppercase font-bold">Status:</span>
              <select
                value={selectedStatus}
                onChange={(e) => setSelectedStatus(e.target.value)}
                className="bg-surface-panel text-on-surface px-2.5 py-1.5 rounded border border-border-subtle font-label-caps text-[10px] outline-none focus:border-primary cursor-pointer"
              >
                <option value="TODOS">Todos os Encerramentos</option>
                <option value="EOF">Fim Normal (EOF)</option>
                <option value="NEXT">Transição Take (NEXT)</option>
                <option value="STOP">Parada Manual (STOP)</option>
                <option value="LIVE_PRIORITY">Corte por live prioritária</option>
                <option value="CONTINGENCY_RETURN">Retorno da contingência</option>
                <option value="RESTART">Reconciliação após reinício</option>
                <option value="RUNNING">Ocorrência sem encerramento</option>
                <option value="UNKNOWN">Motivo não registrado</option>
              </select>
            </div>

            {/* Busca Textual */}
            <div className="relative min-w-[240px] flex-1 max-w-sm">
              <span className="material-symbols-outlined absolute left-2.5 top-2 text-outline text-[16px]">
                search
              </span>
              <input
                type="text"
                placeholder="Buscar por título, ID ou arquivo..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full bg-surface-panel text-on-surface pl-8 pr-3 py-1.5 rounded border border-border-subtle font-body-sm text-[12px] placeholder-outline outline-none focus:border-primary"
              />
            </div>
          </div>
        </div>

        {/* 5. TABELA DENSA DE AS-RUN */}
        <div className="px-margin py-space-md flex flex-col min-h-[400px]">
          <div className="bg-surface-card rounded-xl border border-border-subtle shadow-md overflow-hidden flex flex-col min-h-[360px]">
            <div className="grid grid-cols-12 bg-surface-panel px-4 py-2 font-label-caps text-[11px] text-outline uppercase tracking-wider border-b border-border-subtle items-center select-none sticky top-0 z-10">
              <div className="col-span-1">#</div>
              <div className="col-span-2">Início UTC → Fim</div>
              <div className="col-span-1">Duração</div>
              <div className="col-span-1">Categoria</div>
              <div className="col-span-4">Título do Evento / Arquivo</div>
              <div className="col-span-2">Encerramento</div>
              <div className="col-span-1 text-right">Conferência</div>
            </div>

            <div className="flex-1 divide-y divide-border-subtle/40 overflow-y-auto broadcast-scroll">
              {filteredEntries.length === 0 ? (
                <div className="p-12 text-center text-outline flex flex-col items-center justify-center gap-2">
                  <span className="material-symbols-outlined text-[48px] opacity-30">playlist_remove</span>
                  <span className="font-body-md text-body-md font-medium">
                    {entries === null ? 'Aguardando consulta do registro...' : 'Nenhum registro encontrado para a data e filtros selecionados.'}
                  </span>
                  <span className="font-label-mono text-[11px] text-outline/70">
                    Os itens veiculados pelo motor de playout são registrados automaticamente aqui.
                  </span>
                </div>
              ) : (
                filteredEntries.map((entry, idx) => {
                  const duration = asRunDuration(entry)
                  const frames = duration.frames
                  const asRunBadge = getAsRunBadge(entry)
                  const startDatePart = entry.startedAt ? `${entry.startedAt.slice(8, 10)}/${entry.startedAt.slice(5, 7)}` : ''
                  const startTimePart = entry.startedAt ? entry.startedAt.slice(11, 19) : '--:--:--'
                  const endDatePart = entry.endedAt ? `${entry.endedAt.slice(8, 10)}/${entry.endedAt.slice(5, 7)}` : ''
                  const endTimePart = entry.endedAt ? entry.endedAt.slice(11, 19) : 'NO AR'

                  return (
                    <div
                      key={`${entry.id}-${idx}`}
                      className="grid grid-cols-12 px-4 py-2 bg-surface-card hover:bg-surface-panel items-center text-body-sm font-body-sm transition-colors"
                    >
                      <div className="col-span-1 font-label-mono text-[11px] text-outline">{idx + 1}</div>

                      <div className="col-span-2 font-label-mono text-[11px] text-on-surface tabular-nums">
                        <div className="flex items-center gap-1 flex-wrap">
                          <span className="text-outline text-[10px]">{startDatePart}</span>
                          <span>{startTimePart}</span>
                          <span className="text-outline mx-0.5">→</span>
                          {entry.endedAt ? (
                            <>
                              {endDatePart && endDatePart !== startDatePart && (
                                <span className="text-outline text-[10px]">{endDatePart}</span>
                              )}
                              <span className="text-outline">{endTimePart}</span>
                            </>
                          ) : (
                            <span className="text-armed-amber font-bold">SEM ENCERRAMENTO</span>
                          )}
                        </div>
                      </div>

                      <div className="col-span-1 font-label-mono text-[11px] font-bold text-on-surface tabular-nums">
                        {frames !== null && duration.rate ? dur(frames, duration.rate) : duration.seconds !== null ? `≈ ${duration.seconds.toFixed(1)}s` : 'N/D'}
                      </div>

                      <div className="col-span-1">
                        <span className="px-1.5 py-0.5 rounded font-label-caps text-[10px] bg-primary-container/30 text-primary font-bold uppercase border border-primary/30">
                          {entry.type || 'VT'}
                        </span>
                      </div>

                      <div className="col-span-4 font-body-sm text-body-sm text-on-surface truncate pr-2">
                        <span className="font-semibold">{entry.title}</span>
                        <span className="text-outline font-label-mono text-[11px] block truncate">
                          ID: {entry.id} · {entry.executionKind ?? 'UNKNOWN'} · {duration.evidence}
                        </span>
                      </div>

                      {/* Badges Canônicos Fase C: INTEGRAL, TRUNCADO, DESCARTADO, FALHA */}
                      <div className="col-span-2">
                        <span
                          className={`max-w-full px-1.5 py-0.5 rounded font-label-caps text-[11px] font-bold border inline-flex items-center gap-1 break-words ${asRunBadge.style}`}
                        >
                          <span className="w-1.5 h-1.5 rounded-full bg-current"></span>
                          <span>{asRunBadge.label}</span>
                        </span>
                      </div>

                      <div className="col-span-1 text-right">
                        <span className="inline-block max-w-full break-words font-label-mono text-[10px] text-armed-amber font-bold bg-armed-amber/10 border border-armed-amber/30 px-1 py-0.5 rounded">
                          NÃO HOMOLOGADA
                        </span>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
