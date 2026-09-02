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

  useEffect(() => {
    let alive = true
    api
      .asRun(channelId)
      .then((result) => alive && setEntries(result.entries))
      .catch(() => alive && setEntries([]))
    return () => {
      alive = false
    }
  }, [channelId])

  return (
    <div className="backdrop" onClick={onClose}>
      <div className="dialog wide" onClick={(event) => event.stopPropagation()}>
        <header>
          <h2>As-run de hoje</h2>
          <div className="sub">o que foi ao ar, na ordem em que foi</div>
        </header>

        <div className="body">
          {entries === null && <div className="note">carregando…</div>}
          {entries?.length === 0 && (
            <div className="note">Nada foi ao ar hoje ainda neste canal.</div>
          )}

          {entries && entries.length > 0 && (
            <table className="asrun">
              <thead>
                <tr>
                  <th>entrou</th>
                  <th>item</th>
                  <th className="right">previsto</th>
                  <th className="right">no ar</th>
                  <th className="right">diferença</th>
                  <th>saiu</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => {
                  const drift =
                    entry.airedFrames !== null && entry.plannedFrames !== null
                      ? entry.airedFrames - entry.plannedFrames
                      : null
                  return (
                    <tr key={entry.id}>
                      <td className="mono">{entry.startedAt.slice(11, 19)}</td>
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
          <a className="btn take" href={`/api/channels/${channelId}/asrun.csv`} download>
            baixar csv
          </a>
        </footer>
      </div>
    </div>
  )
}
