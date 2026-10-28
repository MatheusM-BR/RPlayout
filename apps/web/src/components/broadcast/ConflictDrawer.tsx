import React, { useMemo } from 'react'
import type { Rate } from '@rplayout/protocol'
import type { ItemView } from '../../types.js'
import { clock, dur } from '../../format.js'
import {OperationalCompensationPanel} from './OperationalCompensationPanel.js'

interface ConflictDrawerProps {
  open: boolean
  onClose: () => void
  items: ItemView[]
  rate: Rate
  /** Conflitos calculados pelo scheduler a cada atualização da grade. */
  conflicts: readonly { kind: string; itemId: string; frames: number; severity: string; message: string }[]
  onAutoFill: () => void
  channelId?:string
}

interface DetectedIssue {
  id: string
  index: number
  type: 'GAP' | 'OVERRUN' | 'ANCHOR' | 'MISSING_MEDIA' | 'OFFLINE' | 'DURATION_ZERO'
  title: string
  timecode: string
  details: string
}

export const ConflictDrawer: React.FC<ConflictDrawerProps> = ({
  open,
  onClose,
  items,
  rate,
  conflicts,
  onAutoFill,
  channelId,
}) => {
  const issues = useMemo(() => {
    const list: DetectedIssue[] = []
    // A fonte de verdade para atraso de 2 min, sobra de 20 s e LIVE que
    // estourou é o scheduler. Ele já considera duração real no ar, mínimos,
    // itens protegidos e a próxima âncora; recalcular por soma simples aqui
    // esconderia justamente os conflitos operacionais.
    for (const conflict of conflicts) {
      const index = items.findIndex((item) => item.item.id === conflict.itemId)
      const item = items[index]
      list.push({
        id: `scheduler-${conflict.kind}-${conflict.itemId}`,
        index,
        type: conflict.kind === 'GAP'
          ? 'GAP'
          : conflict.kind === 'OVERRUN'
            ? 'OVERRUN'
            : conflict.kind === 'MEDIA_UNAVAILABLE'
              ? 'MISSING_MEDIA'
              : 'ANCHOR',
        title: item?.item.title ?? 'Conflito de programação',
        timecode: conflict.frames > 0 ? dur(conflict.frames, rate) : '--:--:--:--',
        details: conflict.message,
      })
    }
    let cumulativeFrames = 0

    items.forEach((iv, index) => {
      const duration = iv.trim ? Math.max(0, iv.trim.out - iv.trim.in) : (iv.item.durationOverride ?? iv.asset?.durationFrames ?? 0)
      const tc = clock(cumulativeFrames, rate)

      const isLive = iv.item.type === 'LIVE' || Boolean(iv.item.sourceRef)
      if (duration <= 0 && !isLive) {
        list.push({
          id: `dur-zero-${iv.item.id}`,
          index,
          type: 'DURATION_ZERO',
          title: iv.item.title || 'Evento sem duração',
          timecode: tc,
          details: 'Duração zerada - causará travamento no ar.',
        })
      }

      // Live não mora no MAM. Tratar uma fonte configurada como "mídia
      // ausente" escondia justamente o conflito real de tempo após um TAKE.
      if (!iv.asset && !isLive) {
        list.push({
          id: `missing-${iv.item.id}`,
          index,
          type: 'MISSING_MEDIA',
          title: iv.item.title,
          timecode: tc,
          details: 'Arquivo de mídia não encontrado no storage MAM.',
        })
      } else if (iv.asset?.probeError) {
        list.push({
          id: `probe-err-${iv.item.id}`,
          index,
          type: 'OFFLINE',
          title: iv.item.title,
          timecode: tc,
          details: `Falha na verificação de QC: ${iv.asset.probeError}`,
        })
      }

      cumulativeFrames += duration
    })

    return list
  }, [items, rate, conflicts])

  if (!open) return null

  return (
    <aside
      className="fixed top-14 right-0 bottom-8 z-40 w-80 min-w-[280px] max-w-sm bg-surface-card border-l border-border-subtle shadow-2xl flex flex-col transition-transform duration-200 ease-in-out"
      aria-label="Painel de Conflitos e Gaps da Grade"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-space-md py-space-sm border-b border-border-subtle bg-surface-panel">
        <div className="flex items-center gap-space-xs">
          <span className="material-symbols-outlined text-armed-amber text-[20px]">warning</span>
          <span className="font-headline-md text-headline-md uppercase text-on-surface font-bold tracking-wide">
            Gaps &amp; Conflitos
          </span>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded text-outline hover:text-on-surface hover:bg-surface-container transition-colors"
          title="Fechar painel"
        >
          <span className="material-symbols-outlined text-[18px]">close</span>
        </button>
      </div>

      {/* Quick Action Toolbar */}
      <div className="p-space-sm bg-surface-container-lowest border-b border-border-subtle flex flex-col gap-space-xs">
        <div className="flex items-center justify-between font-label-mono text-label-mono">
          <span className="text-outline uppercase">Ocorrências detectadas:</span>
          <span className={`font-bold px-1.5 py-0.5 rounded ${issues.length > 0 ? 'bg-on-air-crimson text-surface-base' : 'bg-status-ok text-surface-base'}`}>
            {issues.length} {issues.length === 1 ? 'ALERTA' : 'ALERTAS'}
          </span>
        </div>

        <button
          onClick={onAutoFill}
          className="w-full mt-1 py-1.5 px-space-sm rounded bg-armed-amber hover:bg-armed-amber-hover text-surface-base font-label-caps text-label-caps font-bold flex items-center justify-center gap-space-xs transition-colors shadow-sm"
        >
          <span className="material-symbols-outlined text-[16px]">auto_fix_high</span>
          Abrir preenchimento editorial
        </button>
        {channelId&&<OperationalCompensationPanel channelId={channelId} items={items} rate={rate} conflicts={conflicts}/>}
      </div>

      {/* List of Conflicts */}
      <div className="flex-1 overflow-y-auto p-space-sm flex flex-col gap-space-xs scrollbar-thin">
        {issues.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-space-md text-outline">
            <span className="material-symbols-outlined text-status-ok text-[40px] mb-2">check_circle</span>
            <div className="font-label-caps text-label-caps font-bold text-on-surface uppercase">Sem conflitos calculados</div>
            <div className="font-body-sm text-body-sm text-outline mt-1">
              Nenhum conflito nesta visão. Confira sinal, cobertura de horário e saídas.
            </div>
          </div>
        ) : (
          issues.map((issue) => (
            <div
              key={issue.id}
              className="p-space-sm rounded bg-surface-panel border border-border-subtle hover:border-border-strong flex flex-col gap-1 transition-colors"
            >
              <div className="flex items-center justify-between">
                <span className="font-label-mono text-[10px] text-outline">#{issue.index + 1} • {issue.timecode}</span>
                <span
                  className={`font-label-caps text-[10px] px-1 py-0.5 rounded font-bold ${
                  issue.type === 'GAP' || issue.type === 'OVERRUN' || issue.type === 'ANCHOR' || issue.type === 'DURATION_ZERO'
                      ? 'bg-on-air-crimson/20 text-on-air-crimson border border-on-air-crimson/40'
                      : 'bg-armed-amber/20 text-armed-amber border border-armed-amber/40'
                  }`}
                >
                  {issue.type}
                </span>
              </div>
              <div className="font-body-sm text-body-sm font-semibold text-on-surface truncate">
                {issue.title}
              </div>
              <div className="font-body-sm text-[11px] text-outline leading-tight">
                {issue.details}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Footer Info */}
      <div className="p-space-xs bg-surface-panel border-t border-border-subtle font-label-mono text-[10px] text-outline flex items-center justify-between">
        <span>VARREDURA EM TEMPO REAL</span>
        <span className="text-outline">TIMING ESTIMADO</span>
      </div>
    </aside>
  )
}
