import type { Rate, ResolvedItem } from '@rplayout/protocol'
import { describeAdjustment } from '@rplayout/scheduler'
import type { ItemView } from '../types.js'
import { clock, db, deviation, dur } from '../format.js'

interface Props {
  items: ItemView[]
  schedule: Map<string, ResolvedItem>
  rate: Rate
  selectedId: string | null
  onAirId: string | null
  /** Frames que faltam do item no ar. */
  remainingOnAir: number
  errorIds: Set<string>
  onSelect: (id: string) => void
  onOpenTrim: (view: ItemView) => void
  onOpenAudio: (view: ItemView) => void
}

function anchorChip(view: ItemView, rate: Rate) {
  const anchor = view.item.anchor
  switch (anchor.kind) {
    case 'FLOW':
      return <span className="chip flow">FLOW</span>
    case 'FIXED':
      return <span className="chip fixed">FIXO {clock(anchor.at, rate)}</span>
    case 'SOFT':
      return (
        <span className="chip soft">
          {clock(anchor.at, rate)} ±{dur(anchor.tolerance, rate)}
        </span>
      )
    case 'WINDOW':
      return (
        <span className="chip window">
          {clock(anchor.from, rate)}–{clock(anchor.to, rate)}
        </span>
      )
  }
}

export function Rundown(props: Props) {
  const { rate } = props

  return (
    <table className="rd">
      <thead>
        <tr>
          <th style={{ width: 34 }}>#</th>
          <th style={{ width: 56 }}>estado</th>
          <th>item</th>
          <th style={{ width: 82 }}>entrada</th>
          <th style={{ width: 66 }}>duração</th>
          <th style={{ width: 82 }}>saída</th>
          <th style={{ width: 78 }}>restante</th>
          <th style={{ width: 140 }}>âncora</th>
          <th style={{ width: 62 }} className="right">
            ganho
          </th>
          <th style={{ width: 92 }} />
        </tr>
      </thead>
      <tbody>
        {props.items.map((view, index) => {
          const id = view.item.id
          const scheduled = props.schedule.get(id)
          if (!scheduled) return null

          const live = id === props.onAirId
          const classes = [
            live ? 'live' : '',
            scheduled.state === 'DONE' ? 'done' : '',
            scheduled.state === 'DROPPED' ? 'dropped' : '',
            props.selectedId === id ? 'sel' : '',
            props.errorIds.has(id) ? 'err' : '',
          ]
            .filter(Boolean)
            .join(' ')

          const progress =
            live && scheduled.duration > 0
              ? Math.min(1, Math.max(0, 1 - props.remainingOnAir / scheduled.duration))
              : 0

          const trimmed = view.item.trim !== null
          const levelled = Math.abs(view.gainDb) >= 0.05

          return (
            <tr key={id} className={classes} onClick={() => props.onSelect(id)}>
              <td className="num">{String(index + 1).padStart(2, '0')}</td>
              <td>
                {live ? (
                  <span className="state air">NO AR</span>
                ) : scheduled.state === 'DONE' ? (
                  <span className="state done">FEITO</span>
                ) : props.selectedId === id ? (
                  <span className="state nxt">CUE</span>
                ) : (
                  <span className="num">—</span>
                )}
              </td>
              <td className="title">
                {view.item.title}
                <div style={{ marginTop: 3 }}>
                  <span className="chip src">{view.item.type}</span>
                  {view.item.sourceRef && <span className="chip src">{view.item.sourceRef}</span>}
                  {view.item.locked && <span className="chip lock">TRAVADO</span>}
                  {trimmed && <span className="chip">CORTE PRÓPRIO</span>}
                  {view.trimSource === 'ASSET' && <span className="chip">CORTE DO ACERVO</span>}
                  {scheduled.adjustments.map((adjustment, position) => (
                    <span
                      key={position}
                      className={`chip ${adjustment.kind === 'GAP_BEFORE' ? 'warn' : 'adj'}`}
                      title={adjustment.reason}
                    >
                      {describeAdjustment(adjustment)} {dur(adjustment.frames, rate)}
                    </span>
                  ))}
                </div>
              </td>
              <td>{clock(scheduled.start, rate)}</td>
              <td>
                {dur(scheduled.duration, rate)}
                {scheduled.duration !== scheduled.plannedDuration && (
                  <span className="num"> / {dur(scheduled.plannedDuration, rate)}</span>
                )}
              </td>
              <td>{clock(scheduled.end, rate)}</td>
              <td>
                {live ? (
                  <div className="bar">
                    <i style={{ width: `${progress * 100}%` }} />
                  </div>
                ) : (
                  <span className="num">—</span>
                )}
              </td>
              <td>
                {anchorChip(view, rate)}
                {view.item.anchor.kind !== 'FLOW' && (
                  <div className="num" style={{ fontSize: 10, marginTop: 2 }}>
                    {scheduled.anchorHit ? deviation(scheduled.deviation, rate) : 'fora da janela'}
                  </div>
                )}
              </td>
              <td className="right">
                <span
                  className={`gain ${levelled ? (view.gainDb > 0 ? 'up' : 'down') : 'zero'}`}
                  title={`Nível ${view.audio.mode}, origem ${view.audioSource}`}
                >
                  {levelled ? db(view.gainDb) : '—'}
                </span>
              </td>
              <td>
                <button
                  className="btn small"
                  disabled={!view.asset}
                  onClick={(event) => {
                    event.stopPropagation()
                    props.onOpenTrim(view)
                  }}
                  title="Marcar entrada e saída"
                >
                  I/O
                </button>{' '}
                <button
                  className="btn small"
                  disabled={!view.asset}
                  onClick={(event) => {
                    event.stopPropagation()
                    props.onOpenAudio(view)
                  }}
                  title="Nivelar áudio"
                >
                  dB
                </button>
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
