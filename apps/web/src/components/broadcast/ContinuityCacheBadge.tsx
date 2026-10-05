import { useEffect, useState } from 'react'
import type { ContinuityCacheStatus } from '@rplayout/protocol'
import { api } from '../../api.js'

/** File coverage is not proof of temporal autonomy or a redundant channel. */
export function ContinuityCacheBadge({ className = '', channelId }: { className?: string; channelId?: string }) {
  const [status, setStatus] = useState<ContinuityCacheStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  useEffect(() => {
    setStatus(null)
    let cancelled = false
    const refresh = async () => {
      try { const value = await api.continuityCacheStatus(channelId); if (!cancelled) { setStatus(value); setError(null) } }
      catch (failure) { if (!cancelled) { setStatus(null); setError(failure instanceof Error ? failure.message : 'Telemetria indisponível') } }
    }
    void refresh()
    const interval = setInterval(() => { void refresh() }, 30_000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [channelId])
  return <div className={`relative inline-flex ${className}`}>
    <button type="button" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}
      title="Cache local; não equivale a redundância ou autonomia temporal homologada"
      className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-surface-panel border border-border-subtle text-on-surface-variant cursor-pointer">
      <span className="material-symbols-outlined text-[15px]">offline_bolt</span>
      <span className="font-label-caps text-[10px] font-bold whitespace-nowrap">{status ? `CACHE: ${status.totalCachedFiles} ARQUIVOS` : 'CACHE: N/D'}</span>
    </button>
    {expanded && <div className="absolute top-full mt-2 right-0 z-50 w-72 bg-surface-card border border-border-strong rounded-xl p-3 shadow-2xl text-on-surface text-xs">
      {status ? <>
        <p>{status.coverageBasis === 'ORDERED_PLAYLIST' ? 'Cobertura temporal de 48h' : 'Cobertura do acervo consultado'}: {status.coverage48hPercent.toFixed(1)}%</p>
        {status.coverageBasis === 'ORDERED_PLAYLIST' && <><p>Autonomia local consecutiva: {status.offlineAutonomyHours.toFixed(2)} h</p><p>Playlist planejada: {(status.plannedHours ?? 0).toFixed(2)} h</p><p className="mt-2">{status.proofMessage}</p></>}
        <p className="mt-1">Cache ocupado: {(status.totalCachedBytes / 1024 ** 3).toFixed(2)} GB</p>
        <p>Quota de cache: {Number.isFinite(status.maxQuotaBytes) ? `${(status.maxQuotaBytes / 1024 ** 3).toFixed(2)} GB` : 'sem limite'}</p>
        {status.prefetch && <div className="mt-2 border-t border-border-subtle pt-2">
          <p>Pré-cópia 48h: {status.prefetch.preparedFiles48h}/{status.prefetch.plannedFiles48h} arquivos</p>
          <p>Pré-cópia 7 dias: {status.prefetch.preparedFiles7d}/{status.prefetch.plannedFiles7d} arquivos</p>
          <p>Revisões futuras publicadas: {status.prefetch.publishedRevisions}</p>
          {(status.prefetch.blockedItems > 0 || status.prefetch.unversionedItems > 0) && <p className="text-tertiary">Não preparados: {status.prefetch.blockedItems} bloqueados por QC; {status.prefetch.unversionedItems} sem versão verificada.</p>}
        </div>}
        <p className="mt-2 text-outline">Cobertura de arquivos não garante 48h de transmissão, áudio/vídeo válidos ou disponibilidade de entradas ao vivo.</p>
      </> : <p>{error ?? 'Consultando o servidor...'}</p>}
    </div>}
  </div>
}
