import { localDateTime, localParts } from '../format.js'
import { useEffect, useState } from 'react'
import type { Rate } from '@rplayout/protocol'
import { api } from '../api.js'
import { dur } from '../format.js'
import type { AsRunEntry } from '../types.js'

interface Props {
  channelId: string
  rate: Rate
  onClose: () => void
}

const REASON: Record<string, string> = {
  NEXT: 'Entrou o seguinte (TAKE)',
  STOP: 'Parada manual (STOP)',
  EOF: 'Fim do arquivo (EOF)',
}

export function AsRunPanel({ channelId, rate, onClose }: Props) {
  const [entries, setEntries] = useState<AsRunEntry[] | null>(null)
  const [filtro, setFiltro] = useState({ nome: '', categoria: '', data: '', hora: '' })

  useEffect(() => {
    let alive = true
    const load = () => {
      api
        .asRun(channelId)
        .then((result) => alive && setEntries(result.entries))
        .catch(() => alive && setEntries([]))
    }
    load()
    const timer = window.setInterval(load, 2000)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [channelId])

  const filtradas =
    entries?.filter(
      (entry) =>
        (!filtro.nome || entry.title.toLowerCase().includes(filtro.nome.toLowerCase())) &&
        (!filtro.categoria || entry.type === filtro.categoria) &&
        (!filtro.data || localParts(entry.startedAt).date === filtro.data) &&
        (!filtro.hora || localParts(entry.startedAt).time.startsWith(filtro.hora)),
    ) ?? null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-4"
      onClick={onClose}
    >
      <div
        className="bg-surface-card w-full max-w-6xl border border-border-subtle rounded shadow-2xl flex flex-col overflow-hidden max-h-[95vh]"
        onClick={(event) => event.stopPropagation()}
      >
        {/* Header */}
        <div className="px-space-lg py-space-sm bg-surface-panel border-b border-border-subtle flex items-center justify-between">
          <div className="flex items-center gap-space-sm">
            <span className="material-symbols-outlined text-primary text-[22px]">history_toggle_off</span>
            <div>
              <h2 className="font-headline-md text-headline-md uppercase text-on-surface font-bold tracking-wide">
                Relatório de Exibição Comercial (As-Run Log)
              </h2>
              <p className="font-label-mono text-label-mono text-outline">
                Registro operacional de veiculação (relógio da estação; não homologado)
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded text-outline hover:text-on-surface hover:bg-surface-container transition-colors"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {/* Filters */}
        <div className="p-space-md bg-surface-container-lowest border-b border-border-subtle flex flex-wrap items-center gap-space-sm">
          <div className="flex-1 min-w-[200px] relative">
            <span className="material-symbols-outlined absolute left-2.5 top-2.5 text-outline text-[16px]">search</span>
            <input
              type="text"
              placeholder="Filtrar por título..."
              value={filtro.nome}
              onChange={(e) => setFiltro({ ...filtro, nome: e.target.value })}
              className="w-full bg-surface-card text-on-surface pl-8 pr-3 py-1.5 rounded border border-border-subtle font-body-sm text-body-sm outline-none focus:border-primary"
            />
          </div>

          <div className="min-w-[160px]">
            <select
              value={filtro.categoria}
              onChange={(e) => setFiltro({ ...filtro, categoria: e.target.value })}
              className="w-full bg-surface-card text-on-surface px-3 py-1.5 rounded border border-border-subtle font-body-sm text-body-sm outline-none focus:border-primary cursor-pointer"
            >
              <option value="">Todas as categorias</option>
              {[...new Set(entries?.map((entry) => entry.type) ?? [])].map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </div>

          <div className="min-w-[140px]">
            <input
              type="date"
              value={filtro.data}
              onChange={(e) => setFiltro({ ...filtro, data: e.target.value })}
              className="w-full bg-surface-card text-on-surface px-3 py-1.5 rounded border border-border-subtle font-label-mono text-label-mono outline-none focus:border-primary"
            />
          </div>

          <div className="min-w-[110px]">
            <input
              type="time"
              value={filtro.hora}
              onChange={(e) => setFiltro({ ...filtro, hora: e.target.value })}
              className="w-full bg-surface-card text-on-surface px-3 py-1.5 rounded border border-border-subtle font-label-mono text-label-mono outline-none focus:border-primary"
            />
          </div>

          <span className="font-label-mono text-label-mono text-outline ml-auto">
            {filtradas?.length ?? 0} VEICULAÇÕES
          </span>
        </div>

        {/* Table Content */}
        <div className="flex-1 overflow-x-auto overflow-y-auto max-h-[550px] p-space-sm bg-surface-container-lowest scrollbar-thin">
          {entries === null ? (
            <div className="p-space-lg text-center text-outline font-body-sm text-body-sm animate-pulse">
              Carregando registros do servidor...
            </div>
          ) : filtradas?.length === 0 ? (
            <div className="p-space-lg text-center text-outline font-body-sm text-body-sm">
              Nenhuma entrada corresponde aos filtros selecionados.
            </div>
          ) : (
            <table className="w-full text-left font-body-sm text-body-sm border border-border-subtle rounded overflow-hidden">
              <thead className="sticky top-0 z-10">
                <tr className="bg-surface-panel text-outline font-label-caps text-label-caps uppercase border-b border-border-subtle">
                  <th className="py-2.5 px-space-sm w-40">ENTRADA REAL</th>
                  <th className="py-2.5 px-space-sm w-40">TÉRMINO REAL</th>
                  <th className="py-2.5 px-space-sm">TÍTULO DO EVENTO</th>
                  <th className="py-2.5 px-space-sm text-right w-28">PREVISTO</th>
                  <th className="py-2.5 px-space-sm text-right w-28">NO AR</th>
                  <th className="py-2.5 px-space-sm text-right w-28">DIFERENÇA</th>
                  <th className="py-2.5 px-space-sm w-40">MOTIVO DE SAÍDA</th>
                </tr>
              </thead>
              <tbody className="font-label-mono text-label-mono">
                {(filtradas ?? []).map((entry) => {
                  const drift =
                    entry.airedFrames !== null && entry.plannedFrames !== null
                      ? entry.airedFrames - entry.plannedFrames
                      : null
                  const isCurrent = entry.endedAt === null

                  return (
                    <tr
                      key={entry.id}
                      className={`border-b border-border-subtle/30 transition-colors ${
                        isCurrent ? 'bg-on-air-crimson/10 font-bold' : 'hover:bg-surface-panel/40'
                      }`}
                    >
                      <td className="py-2 px-space-sm text-outline tabular-nums">
                        <span title={`UTC: ${entry.startedAt}`}>{localDateTime(entry.startedAt)}</span>
                      </td>
                      <td className="py-2 px-space-sm tabular-nums">
                        {entry.endedAt ? (
                          <span className="text-outline"><span title={`UTC: ${entry.endedAt}`}>{localDateTime(entry.endedAt)}</span></span>
                        ) : (
                          <span className="inline-flex items-center gap-1 font-label-caps text-[11px] px-1.5 py-0.5 rounded bg-on-air-crimson text-surface-base font-bold animate-pulse">
                            NO AR AGORA
                          </span>
                        )}
                      </td>
                      <td className="py-2 px-space-sm font-semibold text-on-surface">
                        <div className="truncate max-w-sm" title={entry.title}>
                          {entry.title}
                        </div>
                      </td>
                      <td className="py-2 px-space-sm text-right text-outline tabular-nums">
                        {entry.plannedFrames === null ? '—' : dur(entry.plannedFrames, rate)}
                      </td>
                      <td className="py-2 px-space-sm text-right font-bold text-on-surface tabular-nums">
                        {entry.airedFrames === null ? 'NO AR' : dur(entry.airedFrames, rate)}
                      </td>
                      <td
                        className={`py-2 px-space-sm text-right font-bold tabular-nums ${
                          drift === null
                            ? 'text-outline'
                            : Math.abs(drift) > rate.num
                            ? 'text-on-air-crimson'
                            : 'text-status-ok-bright'
                        }`}
                      >
                        {drift === null ? '—' : `${drift > 0 ? '+' : ''}${dur(drift, rate)}`}
                      </td>
                      <td className="py-2 px-space-sm text-outline truncate text-[11px]">
                        {REASON[entry.endedBy ?? ''] ?? entry.endedBy ?? '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-space-lg py-space-sm bg-surface-panel border-t border-border-subtle flex items-center justify-between">
          <span className="font-label-mono text-label-mono text-outline">
            CERTIFICADO DE EXIBIÇÃO DIGITAL • CONFORMIDADE ANCINE / CONAR
          </span>

          <div className="flex items-center gap-space-sm">
            <button
              onClick={onClose}
              className="px-space-lg py-2 rounded bg-surface-card hover:bg-surface-container text-on-surface font-label-caps text-label-caps uppercase transition-colors border border-border-subtle"
            >
              Fechar
            </button>
            <a
              href={`/api/channels/${channelId}/asrun.csv?${new URLSearchParams({
                ...(filtro.nome ? { nome: filtro.nome } : {}),
                ...(filtro.categoria ? { categoria: filtro.categoria } : {}),
                ...(filtro.data ? { data: filtro.data } : {}),
                ...(filtro.hora ? { hora: filtro.hora } : {}),
              }).toString()}`}
              download
              className="px-space-lg py-2 rounded bg-accent-ice text-surface-base hover:brightness-110 font-label-caps text-label-caps uppercase font-bold transition-all shadow-sm flex items-center gap-1.5"
            >
              <span className="material-symbols-outlined text-[16px]">download</span>
              Exportar As-Run CSV
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
