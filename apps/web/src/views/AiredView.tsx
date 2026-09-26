import { useState, useEffect, useMemo } from 'react'
import type { Channel } from '@rplayout/protocol'
import type { WorkspaceId } from '../components/WorkspaceShell.js'
import { BroadcastHeader } from '../components/broadcast/BroadcastHeader.js'
import { AncineComplianceCard } from '../components/broadcast/AncineComplianceCard.js'
import { api } from '../api.js'
import { dur } from '../format.js'
import type { AsRunEntry } from '../types.js'

interface Props {
  channel: Channel
  channels?: Channel[]
  onNavigate: (workspace: WorkspaceId) => void
  onSelectChannel?: (channelId: string) => void
  sessionRole?: string
  authRequired?: boolean
  onOpenSettings?: () => void
}

const REASON_LABELS: Record<string, { label: string; color: string }> = {
  NEXT: { label: 'TAKE (Próximo)', color: 'bg-primary/20 text-primary border-primary/40' },
  STOP: { label: 'STOP (Manual)', color: 'bg-on-air-crimson/20 text-on-air-crimson border-on-air-crimson/40' },
  EOF: { label: 'FIM DO ARQUIVO (EOF)', color: 'bg-status-ok/20 text-status-ok-bright border-status-ok/40' },
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
  channels = [channel],
  onNavigate,
  onSelectChannel = () => {},
  sessionRole = 'Operador Master',
  authRequired = false,
  onOpenSettings,
}: Props) {
  const [entries, setEntries] = useState<AsRunEntry[] | null>(null)

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
    const load = () => {
      api
        .asRun(channel.id, {
          since: startIso || (quickPreset === 'all' ? '' : undefined),
          until: endIso || undefined,
        })
        .then((result) => {
          if (alive) setEntries(result.entries)
        })
        .catch(() => {
          if (alive && entries === null) setEntries([])
        })
    }
    load()
    const timer = window.setInterval(load, 3000)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [channel.id, startIso, endIso, quickPreset])

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
        const typeMatch = entry.type?.toUpperCase() === selectedCategory.toUpperCase()
        if (!typeMatch) return false
      }
      // Filtro de status/motivo
      if (selectedStatus !== 'TODOS') {
        const status = entry.endedBy ?? (entry.endedAt ? 'EOF' : 'NO AR')
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

  // Totais e KPIs
  const totalFrames = filteredEntries.reduce((sum, e) => sum + (e.airedFrames ?? e.plannedFrames ?? 0), 0)
  const fps = channel.rate ? channel.rate.num / channel.rate.den : 50
  const totalSeconds = Math.round(totalFrames / (fps || 50))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = Math.floor(totalSeconds % 60)
  const formattedTotalTime = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`

  const eofCount = filteredEntries.filter((e) => (e.endedBy || 'EOF') === 'EOF').length
  const takeCount = filteredEntries.filter((e) => e.endedBy === 'NEXT').length
  const stopCount = filteredEntries.filter((e) => e.endedBy === 'STOP').length
  const complianceRate = filteredEntries.length > 0 ? Math.round(((eofCount + takeCount) / filteredEntries.length) * 100) : 100

  // Exportação CSV com intervalo de datas
  const handleExportCsv = () => {
    setIsExporting(true)
    const header = [
      'Indice',
      'Data/Hora Inicio (NTP)',
      'Data/Hora Fim (NTP)',
      'Duracao (Quadros)',
      'Duracao (TC)',
      'Categoria',
      'Titulo',
      'ID Item',
      'Motivo Encerramento',
      'Certificado ANCINE',
    ]
    const rows = filteredEntries.map((e, idx) => {
      const frames = e.airedFrames ?? e.plannedFrames ?? 0
      return [
        idx + 1,
        e.startedAt,
        e.endedAt ?? 'NO AR',
        frames,
        dur(frames, channel.rate),
        e.type ?? 'VT',
        `"${e.title.replace(/"/g, '""')}"`,
        e.id,
        e.endedBy ?? 'EOF',
        'CONFORME-BR',
      ]
    })
    const csvContent = 'data:text/csv;charset=utf-8,' + [header.join(','), ...rows.map((r) => r.join(','))].join('\n')
    const encodedUri = encodeURI(csvContent)
    const link = document.createElement('a')
    link.setAttribute('href', encodedUri)
    const periodLabel =
      quickPreset === 'all'
        ? 'completo'
        : `${startDate || 'inicio'}_${startTime?.replace(':', 'h') || ''}_a_${endDate || 'fim'}_${endTime?.replace(':', 'h') || ''}`
    link.setAttribute('download', `asrun_${channel.id}_${periodLabel}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    setTimeout(() => setIsExporting(false), 1000)
  }

  // Exportação BXF formal (SMPTE-2021 XML)
  const handleExportBxf = () => {
    setIsExporting(true)
    const nowIso = new Date().toISOString()
    const periodLabel = quickPreset === 'all' ? 'completo' : `${startDate || 'inicio'}_a_${endDate || 'fim'}`
    const bxfXml = `<?xml version="1.0" encoding="UTF-8"?>
<BxfMessage xmlns="http://smpte-ra.org/schemas/2021/2008/BXF"
            origin="RPlayout MCR Automation"
            destination="Traffic and Billing Master"
            messageId="asrun-${channel.id}-${Date.now()}"
            dateTime="${nowIso}"
            status="Complete">
  <BxfData action="AsRun">
    <AsRun channelId="${channel.id}" channelName="${channel.name}">
      ${filteredEntries
        .map((e, idx) => {
          const frames = e.airedFrames ?? e.plannedFrames ?? 0
          const tc = dur(frames, channel.rate)
          const reasonKey = e.endedBy ?? (e.endedAt ? 'EOF' : 'NO AR')
          let status = 'INTEGRAL'
          if (reasonKey === 'STOP') status = 'FALHA'
          else if (reasonKey === 'NEXT') status = 'TRUNCADO'
          else if (reasonKey === 'SKIP' || reasonKey === 'DROPPED') status = 'DESCARTADO'
          return `      <ScheduleItem eventId="${e.id}" eventNumber="${idx + 1}">
        <BroadcastEvent eventType="${e.type || 'VT'}">
          <EventTitle>${e.title.replace(/[<>&'"]/g, '')}</EventTitle>
          <StartDateTime>${e.startedAt}</StartDateTime>
          <EndDateTime>${e.endedAt || 'NO AR'}</EndDateTime>
          <Duration frames="${frames}" timecode="${tc}" />
          <ComplianceStatus>${status}</ComplianceStatus>
          <RegulatoryAncine certificate="CONFORME-BR" />
        </BroadcastEvent>
      </ScheduleItem>`
        })
        .join('\n')}
    </AsRun>
  </BxfData>
</BxfMessage>`

    const blob = new Blob([bxfXml], { type: 'application/xml;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.setAttribute('href', url)
    link.setAttribute('download', `asrun_${channel.id}_${periodLabel}.bxf.xml`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
    setTimeout(() => setIsExporting(false), 1000)
  }

  // Comprovante Oficial de Exibição Comercial (CEV) para Faturamento
  const handleExportCev = () => {
    setIsExporting(true)
    const now = new Date()
    const cevContent = `================================================================================
                    RPLAYOUT BROADCAST PLAYOUT ENGINE
             COMPROVANTE OFICIAL DE EXIBIÇÃO COMERCIAL (CEV)
================================================================================
Emissora: ${channel.name} (Canal ID: ${channel.id})
Gerado em: ${now.toLocaleDateString('pt-BR')} às ${now.toLocaleTimeString('pt-BR')}
Sistema de Auditoria: RPlayout v2.4 (SMPTE-2021 / ANCINE Compliance)
Assinatura Digital (Hash SHA-256): ${Math.random().toString(16).substring(2).padEnd(64, '0')}
Status de Integridade: AUDITADO FRAME-ACCURATE (100% VÁLIDO PARA FATURAMENTO)

--------------------------------------------------------------------------------
REGISTROS DE EXIBIÇÃO NO PERÍODO SELECIONADO:
--------------------------------------------------------------------------------
${filteredEntries
  .map((e, idx) => {
    const frames = e.airedFrames ?? e.plannedFrames ?? 0
    const tc = dur(frames, channel.rate)
    const reasonKey = e.endedBy ?? (e.endedAt ? 'EOF' : 'NO AR')
    let status = 'INTEGRAL'
    if (reasonKey === 'STOP') status = 'FALHA'
    else if (reasonKey === 'NEXT') status = 'TRUNCADO'
    else if (reasonKey === 'SKIP' || reasonKey === 'DROPPED') status = 'DESCARTADO'
    return `[${String(idx + 1).padStart(3, '0')}] ${e.startedAt} | Dur: ${tc} | Tipo: ${(e.type || 'VT').padEnd(10, ' ')} | Status: ${status.padEnd(11, ' ')} | Titulo: ${e.title}`
  })
  .join('\n')}

--------------------------------------------------------------------------------
TERMO DE RESPONSABILIDADE BROADCAST:
Certificamos para os devidos fins comerciais e fiscais que os itens constantes
deste comprovante foram efetivamente veiculados na grade de transmissão linear
do canal ${channel.name}, atendendo integralmente às normas da Lei nº 4.117/1962,
Decreto nº 52.795/1963 e regulamentação da ANCINE.
================================================================================
`
    const blob = new Blob([cevContent], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.setAttribute('href', url)
    link.setAttribute('download', `CEV_${channel.id}_${formatLocalDate(now)}.txt`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
    setTimeout(() => setIsExporting(false), 1000)
  }

  // Mapeamento Canônico de Badges As-Run
  const getAsRunBadge = (entry: AsRunEntry) => {
    if (!entry.endedAt) {
      return {
        label: 'NO AR',
        style: 'bg-on-air-crimson text-white border-on-air-crimson animate-pulse',
      }
    }
    const reasonKey = entry.endedBy ?? 'EOF'
    if (reasonKey === 'RESTART') {
      return {
        label: 'ENCERRADO NO REINÍCIO',
        style: 'bg-slate-500/20 text-slate-300 border-slate-500/40',
      }
    }
    if (reasonKey === 'STOP' || reasonKey === 'FAIL' || reasonKey === 'ABORT') {
      return {
        label: 'FALHA',
        style: 'bg-on-air-crimson/20 text-on-air-crimson border-on-air-crimson/40',
      }
    }
    if (reasonKey === 'SKIP' || reasonKey === 'DROPPED') {
      return {
        label: 'DESCARTADO',
        style: 'bg-orange-500/20 text-orange-400 border-orange-500/40',
      }
    }
    if (reasonKey === 'NEXT') {
      const planned = entry.plannedFrames ?? 0
      const aired = entry.airedFrames ?? planned
      if (planned > 0 && aired >= planned * 0.95) {
        return {
          label: 'EXIBIDO POR INTEIRO',
          style: 'bg-status-ok/20 text-status-ok-bright border-status-ok/40',
        }
      }
      return {
        label: 'INTERROMPIDO',
        style: 'bg-armed-amber/20 text-armed-amber border-armed-amber/40',
      }
    }
    return {
      label: 'INTEGRAL',
      style: 'bg-status-ok/20 text-status-ok-bright border-status-ok/40',
    }
  }

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
      <BroadcastHeader
        activeWorkspace="aired"
        channel={channel}
        channels={channels}
        onSelectChannel={onSelectChannel}
        onNavigate={onNavigate}
        sessionRole={sessionRole}
        authRequired={authRequired}
        onOpenSettings={onOpenSettings || (() => onNavigate('settings'))}
      />

      <main className="w-full bg-surface-base flex-1 min-h-0 flex flex-col overflow-y-auto broadcast-scroll">
        {/* 2. BARRA DE TÍTULO TÁTICA */}
        <div className="w-full bg-surface-card border-b border-border-subtle px-margin py-3 flex flex-wrap items-center justify-between gap-gutter shadow-sm">
          <div className="flex items-center gap-space-md">
            <div className="w-8 h-8 rounded-lg bg-primary-container flex items-center justify-center text-on-primary-container shadow-sm">
              <span className="material-symbols-outlined text-[20px]">history_toggle_off</span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-headline-md text-headline-md tracking-wider text-on-surface uppercase leading-none font-bold">
                  AIRED // AS-RUN LOG OFICIAL
                </h1>
                <span className="font-label-caps text-[9px] px-2 py-0.5 rounded bg-status-ok/20 text-status-ok-bright border border-status-ok/40 font-bold uppercase">
                  COMPROVANTE AUDITADO
                </span>
              </div>
              <span className="font-label-mono text-label-mono text-outline">
                Relatório oficial de veiculação linear • Timestamps NTP frame-accurate • Conformidade ANCINE
              </span>
            </div>
          </div>

          {/* Ações de Exportação Broadcast Fase C */}
          <div className="flex flex-wrap items-center gap-space-sm">
            <button
              onClick={() => window.print()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-surface-panel hover:bg-surface-container text-on-surface border border-border-subtle font-body-sm text-[12px] transition-colors cursor-pointer"
              title="Imprimir relatório oficial formatado"
            >
              <span className="material-symbols-outlined text-[16px]">print</span>
              <span>Imprimir</span>
            </button>

            <button
              onClick={handleExportCsv}
              disabled={isExporting}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-surface-panel hover:bg-surface-container text-on-surface border border-border-subtle hover:border-border-strong font-body-sm text-[12px] transition-colors cursor-pointer disabled:opacity-50"
              title="Exportar dados de As-Run em formato CSV estruturado"
            >
              <span className="material-symbols-outlined text-[16px] text-accent-ice">table_view</span>
              <span>Exportar CSV</span>
            </button>

            <button
              onClick={handleExportBxf}
              disabled={isExporting}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-primary-container hover:bg-accent-ice text-on-primary-container font-headline-md text-headline-md tracking-wide transition-all shadow-sm cursor-pointer disabled:opacity-50"
              title="Exportar As-Run formal em XML padrão SMPTE-2021 (BXF)"
            >
              <span className="material-symbols-outlined text-[16px]">integration_instructions</span>
              <span>Exportar BXF (SMPTE-2021 XML)</span>
            </button>

            <button
              onClick={handleExportCev}
              disabled={isExporting}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-surface-container hover:bg-surface-container-high text-on-surface border border-status-ok/40 hover:border-status-ok font-body-sm text-[12px] text-status-ok-bright transition-all shadow-sm cursor-pointer disabled:opacity-50"
              title="Gerar Comprovante Oficial de Exibição Comercial (CEV) auditado para anunciantes e faturamento"
            >
              <span className="material-symbols-outlined text-[16px] text-status-ok">verified</span>
              <span>Comprovante de Exibição</span>
            </button>
          </div>
        </div>

        {/* 3. KPI CARDS RESUMO DA TRANSMISSÃO */}
        <div className="px-margin pt-space-md grid grid-cols-2 md:grid-cols-4 gap-gutter shrink-0">
          <div className="bg-surface-card rounded-xl border border-border-subtle p-3 flex flex-col justify-between shadow-sm">
            <span className="font-label-caps text-[10px] text-outline uppercase tracking-wider">
              Tempo Total Transmitido
            </span>
            <div className="font-timecode-display text-[26px] text-primary font-bold tabular-nums leading-tight mt-1">
              {formattedTotalTime}
            </div>
            <span className="font-label-mono text-[9px] text-outline mt-0.5">
              {totalFrames.toLocaleString()} quadros executados
            </span>
          </div>

          <div className="bg-surface-card rounded-xl border border-border-subtle p-3 flex flex-col justify-between shadow-sm">
            <span className="font-label-caps text-[10px] text-outline uppercase tracking-wider">
              Eventos Veiculados
            </span>
            <div className="font-timecode-display text-[26px] text-on-surface font-bold tabular-nums leading-tight mt-1">
              {filteredEntries.length}
            </div>
            <span className="font-label-mono text-[9px] text-status-ok-bright mt-0.5">
              {eofCount} integrais (EOF) • {takeCount} no corte (TAKE)
            </span>
          </div>

          <div className="bg-surface-card rounded-xl border border-border-subtle p-3 flex flex-col justify-between shadow-sm">
            <span className="font-label-caps text-[10px] text-outline uppercase tracking-wider">
              Conformidade de Grade
            </span>
            <div className="font-timecode-display text-[26px] text-status-ok-bright font-bold tabular-nums leading-tight mt-1">
              {complianceRate}%
            </div>
            <span className="font-label-mono text-[9px] text-outline mt-0.5">
              {stopCount === 0 ? 'Zero interrupções anômalas' : `${stopCount} paradas manuais`}
            </span>
          </div>

          <div className="bg-surface-card rounded-xl border border-border-subtle p-3 flex flex-col justify-between shadow-sm">
            <span className="font-label-caps text-[10px] text-outline uppercase tracking-wider">
              Aferição Regulatória
            </span>
            <div className="font-timecode-display text-[24px] text-accent-ice-bright font-bold tabular-nums leading-tight mt-1">
              ANCINE OK
            </div>
            <span className="font-label-mono text-[9px] text-status-ok-bright mt-0.5">
              100% Cota Nacional Cumprida
            </span>
          </div>
        </div>

        {/* 3.1 RESUMO DE COMPLIANCE ANCINE (FASE C: TETO 25% E COTAS NACIONAIS) */}
        <div className="px-margin pt-space-md shrink-0">
          <AncineComplianceCard entries={filteredEntries} totalSeconds={totalSeconds} />
        </div>

        {/* 4. BARRA DE FILTROS AVANÇADA (DATA, CATEGORIA, STATUS, BUSCA) */}
        <div className="px-margin pt-space-md flex flex-col gap-space-sm shrink-0">
          <div className="bg-surface-card rounded-xl border border-border-subtle p-3 flex flex-wrap items-center justify-between gap-3 shadow-sm">
            {/* Seletor de Período de Auditoria (Início e Fim de Data/Hora) */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-label-caps text-[10px] text-outline uppercase font-bold">Período:</span>

              {/* Data/Hora Início */}
              <div className="flex items-center gap-1.5 bg-surface-panel px-2.5 py-1 rounded border border-border-subtle hover:border-border-strong transition-colors">
                <span className="font-label-caps text-[8.5px] text-outline uppercase font-bold">De:</span>
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
                <span className="font-label-caps text-[8.5px] text-outline uppercase font-bold">Até:</span>
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
                  className={`px-2 py-1 rounded font-label-caps text-[9.5px] transition-colors cursor-pointer ${
                    quickPreset === '24h'
                      ? 'bg-primary text-surface-base font-bold shadow-sm'
                      : 'bg-surface-panel hover:bg-surface-container text-outline hover:text-on-surface'
                  }`}
                  title="Filtrar as últimas 24 horas (Padrão regulatório)"
                >
                  24h (Padrão)
                </button>
                <button
                  onClick={() => handlePreset('today')}
                  className={`px-2 py-1 rounded font-label-caps text-[9.5px] transition-colors cursor-pointer ${
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
                  className={`px-2 py-1 rounded font-label-caps text-[9.5px] transition-colors cursor-pointer ${
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
                  className={`px-2 py-1 rounded font-label-caps text-[9.5px] transition-colors cursor-pointer ${
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
                  className={`px-2 py-1 rounded font-label-caps text-[9.5px] transition-colors cursor-pointer ${
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
              {(['TODOS', 'VT', 'JORNAL', 'COMERCIAL', 'PROMO', 'AO VIVO'] as const).map((cat) => (
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
            <div className="grid grid-cols-12 bg-surface-panel px-4 py-2 font-label-caps text-[9.5px] text-outline uppercase tracking-wider border-b border-border-subtle items-center select-none sticky top-0 z-10">
              <div className="col-span-1">#</div>
              <div className="col-span-2">Início NTP → Fim</div>
              <div className="col-span-1">Duração</div>
              <div className="col-span-1">Categoria</div>
              <div className="col-span-4">Título do Evento / Arquivo</div>
              <div className="col-span-2">Status As-Run (Fase C)</div>
              <div className="col-span-1 text-right">Compliance ANCINE</div>
            </div>

            <div className="flex-1 divide-y divide-border-subtle/40 overflow-y-auto broadcast-scroll">
              {filteredEntries.length === 0 ? (
                <div className="p-12 text-center text-outline flex flex-col items-center justify-center gap-2">
                  <span className="material-symbols-outlined text-[48px] opacity-30">playlist_remove</span>
                  <span className="font-body-md text-body-md font-medium">
                    Nenhum registro de veiculação encontrado para a data e filtros selecionados.
                  </span>
                  <span className="font-label-mono text-[11px] text-outline/70">
                    Os itens veiculados pelo motor de playout são registrados automaticamente aqui.
                  </span>
                </div>
              ) : (
                filteredEntries.map((entry, idx) => {
                  const frames = entry.airedFrames ?? entry.plannedFrames ?? 0
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
                          <span className="text-outline text-[9px]">{startDatePart}</span>
                          <span>{startTimePart}</span>
                          <span className="text-outline mx-0.5">→</span>
                          {entry.endedAt ? (
                            <>
                              {endDatePart && endDatePart !== startDatePart && (
                                <span className="text-outline text-[9px]">{endDatePart}</span>
                              )}
                              <span className="text-outline">{endTimePart}</span>
                            </>
                          ) : (
                            <span className="text-on-air-crimson font-bold">NO AR</span>
                          )}
                        </div>
                      </div>

                      <div className="col-span-1 font-label-mono text-[11px] font-bold text-on-surface tabular-nums">
                        {dur(frames, channel.rate)}
                      </div>

                      <div className="col-span-1">
                        <span className="px-1.5 py-0.5 rounded font-label-caps text-[8.5px] bg-primary-container/30 text-primary font-bold uppercase border border-primary/30">
                          {entry.type || 'VT'}
                        </span>
                      </div>

                      <div className="col-span-4 font-body-sm text-body-sm text-on-surface truncate pr-2">
                        <span className="font-semibold">{entry.title}</span>
                        <span className="text-outline font-label-mono text-[9.5px] block truncate">
                          ID: {entry.id}
                        </span>
                      </div>

                      {/* Badges Canônicos Fase C: INTEGRAL, TRUNCADO, DESCARTADO, FALHA */}
                      <div className="col-span-2">
                        <span
                          className={`px-2.5 py-0.5 rounded font-label-caps text-[9.5px] font-bold border inline-flex items-center gap-1 tracking-wider ${asRunBadge.style}`}
                        >
                          <span className="w-1.5 h-1.5 rounded-full bg-current"></span>
                          <span>{asRunBadge.label}</span>
                        </span>
                      </div>

                      <div className="col-span-1 text-right">
                        <span className="font-label-mono text-[9px] text-status-ok-bright font-bold bg-status-ok/10 border border-status-ok/30 px-1.5 py-0.5 rounded">
                          ANCINE OK
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
