import { useState } from 'react'
import { formatTimecode, parseTimecode, type EditScope, type Rate, type Trim } from '@rplayout/protocol'
import type { ItemView } from '../types.js'
import { dur } from '../format.js'
import { ScopePicker } from './ScopePicker.js'

interface Props {
  view: ItemView
  rate: Rate
  onCancel: () => void
  onApply: (trim: Trim, scope: EditScope) => void
}

const SOURCE_LABEL: Record<string, string> = {
  ITEM: 'corte próprio deste item',
  ASSET: 'herdado do padrão do acervo',
  FILE: 'arquivo inteiro, sem corte',
  NONE: 'sem arquivo',
}

export function TrimDialog({ view, rate, onCancel, onApply }: Props) {
  const asset = view.asset
  const [scope, setScope] = useState<EditScope>('ITEM')
  const [inText, setInText] = useState(formatTimecode(view.trim.in, rate))
  const [outText, setOutText] = useState(formatTimecode(view.trim.out, rate))

  const inFrames = parseTimecode(inText, rate)
  const outFrames = parseTimecode(outText, rate)
  const total = asset?.durationFrames ?? 0

  const inBad = inFrames === null || inFrames < 0 || inFrames >= total
  const outBad = outFrames === null || outFrames > total || (inFrames !== null && outFrames <= inFrames)
  const valid = !inBad && !outBad && inFrames !== null && outFrames !== null

  const applySuggested = (): void => {
    if (!asset?.suggestedTrim) return
    setInText(formatTimecode(asset.suggestedTrim.in, rate))
    setOutText(formatTimecode(asset.suggestedTrim.out, rate))
  }

  return (
    <div className="backdrop" onClick={onCancel}>
      <div className="dialog" onClick={(event) => event.stopPropagation()}>
        <header>
          <h2>Marcação de entrada e saída</h2>
          <div className="sub">
            {view.item.title} · arquivo {dur(total, rate)} · {SOURCE_LABEL[view.trimSource]}
          </div>
        </header>

        <div className="body">
          <div className="row">
            <div className="field">
              <label>Entrada (I)</label>
              <input
                type="text"
                className={inBad ? 'bad' : ''}
                value={inText}
                onChange={(event) => setInText(event.target.value)}
                autoFocus
              />
            </div>
            <div className="field">
              <label>Saída (O)</label>
              <input
                type="text"
                className={outBad ? 'bad' : ''}
                value={outText}
                onChange={(event) => setOutText(event.target.value)}
              />
            </div>
          </div>

          <div className="note">
            Duração no ar:{' '}
            <b>{valid ? dur(outFrames - inFrames, rate) : '—'}</b>
            {valid && total > 0 && (
              <> · descarta {dur(total - (outFrames - inFrames), rate)} do arquivo</>
            )}
          </div>

          {asset?.suggestedTrim && (
            <button className="btn small" onClick={applySuggested}>
              usar pontas detectadas ({dur(asset.suggestedTrim.in, rate)} de preto na cabeça)
            </button>
          )}

          <ScopePicker
            value={scope}
            onChange={setScope}
            siblingCount={view.siblingCount}
            hasAsset={asset !== null}
            what="corte"
          />
        </div>

        <footer>
          <button className="btn" onClick={onCancel}>
            cancelar
          </button>
          <button
            className="btn take"
            disabled={!valid}
            onClick={() => valid && onApply({ in: inFrames, out: outFrames }, scope)}
          >
            aplicar
          </button>
        </footer>
      </div>
    </div>
  )
}
