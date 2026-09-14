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
  NEXT: 'entrou o seguinte',
  STOP: 'parado',
}

/**
 * O que realmente foi ao ar.
 *
 * A grade responde o que era para acontecer; esta tela responde o que
 * aconteceu -- é o que a emissora mostra quando o anunciante pergunta se o
 * comercial entrou, e é onde a diferença entre o previsto e o real aparece.
 */
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
    // O último registro pode estar sendo fechado/atualizado pelo motor. Uma
    // consulta curta mantém o Aired vivo e mostra também o item atual.
    const timer = window.setInterval(load, 2000)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [channelId])
  const filtradas = entries?.filter((entry) =>
    (!filtro.nome || entry.title.toLowerCase().includes(filtro.nome.toLowerCase())) &&
    (!filtro.categoria || entry.type === filtro.categoria) &&
    (!filtro.data || entry.startedAt.slice(0, 10) === filtro.data) &&
    (!filtro.hora || entry.startedAt.slice(11, 16).startsWith(filtro.hora)),
  ) ?? null

  return (
    <div className="backdrop" onClick={onClose}>
      <div className="dialog wide" onClick={(event) => event.stopPropagation()}>
        <header>
          <h2>Aired</h2>
          <div className="sub">o que foi ao ar, na ordem em que foi</div>
        </header>

        <div className="body">
          <div className="aired-filters">
            <input placeholder="filtrar por nome" value={filtro.nome} onChange={(e) => setFiltro({ ...filtro, nome: e.target.value })} />
            <select value={filtro.categoria} onChange={(e) => setFiltro({ ...filtro, categoria: e.target.value })}>
              <option value="">todas as categorias</option>
              {[...new Set(entries?.map((entry) => entry.type) ?? [])].map((type) => <option key={type}>{type}</option>)}
            </select>
            <input type="date" value={filtro.data} onChange={(e) => setFiltro({ ...filtro, data: e.target.value })} />
            <input type="time" value={filtro.hora} onChange={(e) => setFiltro({ ...filtro, hora: e.target.value })} />
          </div>
          {entries === null && <div className="note">carregando…</div>}
          {filtradas?.length === 0 && (
            <div className="note">Nenhuma entrada corresponde aos filtros.</div>
          )}

          {filtradas && filtradas.length > 0 && (
            <table className="asrun">
              <thead>
                <tr>
                  <th>entrada real</th>
                  <th>término real</th>
                  <th>item</th>
                  <th className="right">previsto</th>
                  <th className="right">no ar</th>
                  <th className="right">diferença</th>
                  <th>saiu</th>
                </tr>
              </thead>
              <tbody>
                {filtradas.map((entry) => {
                  const drift =
                    entry.airedFrames !== null && entry.plannedFrames !== null
                      ? entry.airedFrames - entry.plannedFrames
                      : null
                  return (
                    <tr key={entry.id}>
                      <td className="mono">{entry.startedAt.replace('T', ' ').slice(0, 19)}</td>
                      <td className="mono">{entry.endedAt ? entry.endedAt.replace('T', ' ').slice(0, 19) : 'NO AR'}</td>
                      <td>{entry.title}</td>
                      <td className="right mono">
                        {entry.plannedFrames === null ? '—' : dur(entry.plannedFrames, rate)}
                      </td>
                      <td className="right mono">
                        {entry.airedFrames === null ? 'no ar' : dur(entry.airedFrames, rate)}
                      </td>
                      <td className={`right mono${drift !== null && Math.abs(drift) > rate.num ? ' bad' : ''}`}>
                        {drift === null ? '—' : `${drift > 0 ? '+' : ''}${dur(drift, rate)}`}
                      </td>
                      <td className="dim">{REASON[entry.endedBy ?? ''] ?? entry.endedBy ?? '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        <footer>
          <button className="btn" onClick={onClose}>
            fechar
          </button>
          {/* O relatório de veiculação acaba sempre numa planilha: o caminho
              mais curto até lá é um CSV que o navegador baixa. */}
          <a
            className="btn take"
            href={`/api/channels/${channelId}/asrun.csv?${new URLSearchParams({
              ...(filtro.nome ? { nome: filtro.nome } : {}),
              ...(filtro.categoria ? { categoria: filtro.categoria } : {}),
              ...(filtro.data ? { data: filtro.data } : {}),
              ...(filtro.hora ? { hora: filtro.hora } : {}),
            }).toString()}`}
            download
          >
            baixar csv
          </a>
        </footer>
      </div>
    </div>
  )
}
