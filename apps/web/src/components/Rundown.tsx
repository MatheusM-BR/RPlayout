import { Fragment, useEffect, useRef, useState } from 'react'
import { isStill } from '@rplayout/protocol'
import type { Channel, Fit, ItemType, Rate, ResolvedItem } from '@rplayout/protocol'
import type { ItemView } from '../types.js'
import { clock, db, deviation, dur } from '../format.js'

interface Props {
  items: ItemView[]
  schedule: Map<string, ResolvedItem>
  rate: Rate
  /** Geometria do canal: é contra ela que a proporção do arquivo é comparada. */
  channel: Channel
  selectedId: string | null
  onAirId: string | null
  /** Frames que faltam do item no ar. */
  remainingOnAir: number
  errorIds: Set<string>
  /** Linhas marcadas para agrupar. Marcação é diferente de armar. */
  marked: Set<string>
  onSelect: (id: string, modifier: 'none' | 'range' | 'toggle') => void
  onMove: (id: string, toIndex: number) => void
  onUngroup: (blockId: string) => void
  onOpenTrim: (view: ItemView) => void
  onOpenAudio: (view: ItemView) => void
  onSetFit: (id: string, fit: Fit) => void
  onNotes: (id: string, notes: string) => void
}

/**
 * Proporção do arquivo em forma legível, quando ela não é a do canal.
 *
 * Só aparece quando há diferença de verdade: um arquivo 1918x1080 é 16:9 para
 * qualquer efeito prático, e um aviso nesse caso seria ruído.
 */
function aspectLabel(view: ItemView, channel: Channel): string | null {
  const probe = view.asset?.probe
  if (!probe || probe.width <= 0 || probe.height <= 0) return null
  const source = probe.width / probe.height
  const target = channel.width / channel.height
  if (Math.abs(source - target) / target < 0.01) return null

  const divisor = gcd(probe.width, probe.height)
  return `${probe.width / divisor}:${probe.height / divisor}`
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))

const TYPE_LABEL: Record<ItemType, string> = {
  VT: 'VT',
  LIVE: 'AO VIVO',
  GFX: 'GC',
  SLATE: 'SLATE',
  COMMERCIAL: 'COMERCIAL',
  FILLER: 'FILLER',
}

const COLUMNS = 12

/** Campo de observação da linha. Salva ao sair, não a cada tecla. */
function Notes({ value, onSave }: { value: string; onSave: (text: string) => void }) {
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])

  return (
    <input
      className="obs"
      type="text"
      value={text}
      title={text || 'Observação da linha'}
      placeholder="—"
      onClick={(event) => event.stopPropagation()}
      onChange={(event) => setText(event.target.value)}
      onBlur={() => text !== value && onSave(text)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
        if (event.key === 'Escape') setText(value)
      }}
    />
  )
}

export function Rundown(props: Props) {
  const { rate } = props
  const liveRow = useRef<HTMLTableRowElement | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)

  // A linha no ar não pode sumir da tela numa grade de duzentos itens.
  useEffect(() => {
    liveRow.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [props.onAirId])

  const airIndex = props.items.findIndex((view) => view.item.id === props.onAirId)
  const nextId =
    airIndex >= 0
      ? (props.items
          .slice(airIndex + 1)
          .find((view) => props.schedule.get(view.item.id)?.state !== 'DROPPED')?.item.id ?? null)
      : null

  /** Duração somada de um bloco, com os ajustes do scheduler já aplicados. */
  const blockTotal = (blockId: string): number =>
    props.items
      .filter((view) => view.item.blockId === blockId)
      .reduce((sum, view) => sum + (props.schedule.get(view.item.id)?.duration ?? 0), 0)

  return (
    <table className="rd">
      <thead>
        <tr>
          <th style={{ width: 42 }}>#</th>
          <th style={{ width: 46 }} />
          <th>item</th>
          <th style={{ width: 150 }}>obs</th>
          <th style={{ width: 74 }}>entrada</th>
          <th style={{ width: 62 }}>duração</th>
          <th style={{ width: 74 }}>saída</th>
          <th style={{ width: 66 }} className="right">
            restante
          </th>
          <th style={{ width: 118 }}>âncora</th>
          <th style={{ width: 54 }} className="right">
            ganho
          </th>
          <th style={{ width: 84 }} />
        </tr>
      </thead>
      <tbody>
        {props.items.map((view, index) => {
          const id = view.item.id
          const scheduled = props.schedule.get(id)
          if (!scheduled) return null

          const live = id === props.onAirId
          const armed = id === props.selectedId
          const shortened = scheduled.duration < scheduled.plannedDuration
          const anchor = view.item.anchor
          const aspect = aspectLabel(view, props.channel)
          const trackCount = view.asset?.probe?.audioTracks.length ?? 0
          const blockId = view.item.blockId
          const opensBlock = blockId !== null && props.items[index - 1]?.item.blockId !== blockId

          const classes = [
            live ? 'live' : '',
            scheduled.state === 'DROPPED' ? 'dropped' : '',
            armed ? 'sel' : '',
            props.marked.has(id) ? 'marked' : '',
            props.errorIds.has(id) ? 'err' : '',
            blockId ? 'block' : '',
            dragId === id ? 'dragging' : '',
            dropIndex === index ? 'dropinto' : '',
          ]
            .filter(Boolean)
            .join(' ')

          const progress =
            live && scheduled.duration > 0
              ? Math.min(1, Math.max(0, 1 - props.remainingOnAir / scheduled.duration))
              : 0

          return (
            <Fragment key={id}>
              {opensBlock && blockId && (
                <tr className="block-head">
                  <td colSpan={COLUMNS}>
                    <div className="wrap">
                      <span className="rail" />
                      bloco
                      <span className="tot">{dur(blockTotal(blockId), rate)}</span>
                      <button
                        className="btn small push"
                        onClick={() => props.onUngroup(blockId)}
                        title="Separar os itens deste bloco"
                      >
                        desagrupar
                      </button>
                    </div>
                  </td>
                </tr>
              )}
              <tr
                ref={live ? liveRow : null}
                className={classes}
                draggable
                onDragStart={(event) => {
                  setDragId(id)
                  event.dataTransfer.effectAllowed = 'move'
                }}
                onDragOver={(event) => {
                  event.preventDefault()
                  setDropIndex(index)
                }}
                onDragEnd={() => {
                  setDragId(null)
                  setDropIndex(null)
                }}
                onDrop={(event) => {
                  event.preventDefault()
                  if (dragId && dragId !== id) props.onMove(dragId, index)
                  setDragId(null)
                  setDropIndex(null)
                }}
                onClick={(event) =>
                  props.onSelect(
                    id,
                    event.shiftKey ? 'range' : event.ctrlKey || event.metaKey ? 'toggle' : 'none',
                  )
                }
              >
                <td className="num">
                  <span className="grip" title="Arraste para reordenar">
                    ⠿
                  </span>{' '}
                  {String(index + 1).padStart(2, '0')}
                </td>
                <td>
                  {live ? (
                    <span className="state air">NO AR</span>
                  ) : armed ? (
                    <span className="state nxt">CUE</span>
                  ) : id === nextId ? (
                    <span className="state next">PRÓX</span>
                  ) : null}
                </td>
                <td className="title">
                  {view.item.title}
                  <div className="tags">
                    <span className="chip src">{TYPE_LABEL[view.item.type]}</span>
                    {view.item.sourceRef && <span className="chip src">{view.item.sourceRef}</span>}
                    {view.item.locked && <span className="chip lock">TRAVADO</span>}
                    {/* Arquivo sem trilha entra e toca; o que não pode é o
                        operador descobrir isso no ar. */}
                    {view.asset && isStill(view.asset) && (
                      <span className="chip still" title="Imagem parada: o tempo é o da grade">
                        PARADA
                      </span>
                    )}
                    {view.asset?.kind === 'AUDIO' && (
                      <span className="chip still" title="Arquivo só de áudio: a tela fica no preto do canal">
                        SEM IMAGEM
                      </span>
                    )}
                    {view.asset?.probe?.hasAudio === false && (
                      <span className="chip mute" title="O arquivo não tem trilha de áudio">
                        MUDO
                      </span>
                    )}
                    {trackCount > 1 && (
                      <span
                        className="chip track"
                        title={`${trackCount} trilhas de áudio; tocando a ${(view.item.audioTrack ?? 0) + 1}ª`}
                      >
                        TRILHA {(view.item.audioTrack ?? 0) + 1}/{trackCount}
                      </span>
                    )}
                  </div>
                </td>
                <td>
                  <Notes value={view.item.notes ?? ''} onSave={(text) => props.onNotes(id, text)} />
                </td>
                <td>{clock(scheduled.start, rate)}</td>
                <td
                  className={shortened ? 'shortened' : ''}
                  title={
                    shortened
                      ? `Planejado ${dur(scheduled.plannedDuration, rate)}. ${scheduled.adjustments
                          .map((adjustment) => adjustment.reason)
                          .join(' ')}`
                      : undefined
                  }
                >
                  {dur(scheduled.duration, rate)}
                </td>
                <td>{clock(scheduled.end, rate)}</td>
                <td className="right">
                  {live ? (
                    <>
                      <span className="remain">{dur(props.remainingOnAir, rate)}</span>
                      <div className="bar">
                        <i style={{ width: `${progress * 100}%` }} />
                      </div>
                    </>
                  ) : null}
                </td>
                <td>
                  {anchor.kind === 'FIXED' && (
                    <span className="chip fixed">FIXO {clock(anchor.at, rate)}</span>
                  )}
                  {anchor.kind === 'SOFT' && (
                    <span className="chip soft">
                      {clock(anchor.at, rate)} ±{dur(anchor.tolerance, rate)}
                    </span>
                  )}
                  {anchor.kind === 'WINDOW' && (
                    <span className="chip window">
                      {clock(anchor.from, rate)}–{clock(anchor.to, rate)}
                    </span>
                  )}
                  {anchor.kind !== 'FLOW' && (
                    <div className={`devi${scheduled.anchorHit ? '' : ' bad'}`}>
                      {scheduled.anchorHit ? deviation(scheduled.deviation, rate) : 'fora da janela'}
                    </div>
                  )}
                </td>
                <td className="right">
                  <span
                    className={`gain ${
                      Math.abs(view.gainDb) >= 0.05 ? (view.gainDb > 0 ? 'up' : 'down') : 'zero'
                    }`}
                    title={`Nível ${view.audio.mode}, origem ${view.audioSource}`}
                  >
                    {Math.abs(view.gainDb) >= 0.05 ? db(view.gainDb) : ''}
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
                  {/* Só existe quando a proporção do arquivo não é a do canal:
                      o operador escolhe entre ver tudo e encher a tela. */}
                  {aspect && (
                    <>
                      {' '}
                      <button
                        className={`btn small${view.item.fit === 'CROP' ? ' on' : ''}`}
                        onClick={(event) => {
                          event.stopPropagation()
                          props.onSetFit(
                            view.item.id,
                            view.item.fit === 'CROP' ? 'PILLARBOX' : 'CROP',
                          )
                        }}
                        title={
                          view.item.fit === 'CROP'
                            ? `${aspect} enchendo a tela: sobra cortada`
                            : `${aspect} inteiro: barra preta na sobra`
                        }
                      >
                        {aspect}
                      </button>
                    </>
                  )}
                </td>
              </tr>
            </Fragment>
          )
        })}
      </tbody>
    </table>
  )
}
