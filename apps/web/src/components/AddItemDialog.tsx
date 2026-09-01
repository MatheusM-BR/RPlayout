import { useState } from 'react'
import {
  durationIn,
  formatTimecode,
  parseTimecode,
  secondsToFrames,
  type Anchor,
  type MediaAsset,
  type Rate,
} from '@rplayout/protocol'
import { dur } from '../format.js'

type AnchorMode = 'FLOW' | 'FIXED' | 'SOFT'

interface Props {
  assets: MediaAsset[]
  /** Arquivo já escolhido, quando a inserção começou por um clique no acervo. */
  initialAssetId?: string
  rate: Rate
  /** Hora sugerida para o campo, normalmente o fim da grade. */
  suggestedAt: number
  onCancel: () => void
  onAdd: (mediaId: string, anchor: Anchor, title: string) => void
}

/**
 * Inserir item com hora de entrada. O servidor acha sozinho a posição na grade
 * e o scheduler reorganiza o resto — o operador só diz o que entra e quando.
 */
export function AddItemDialog({
  assets,
  initialAssetId,
  rate,
  suggestedAt,
  onCancel,
  onAdd,
}: Props) {
  const [assetId, setAssetId] = useState(initialAssetId ?? assets[0]?.id ?? '')
  const [mode, setMode] = useState<AnchorMode>('FLOW')
  const [atText, setAtText] = useState(formatTimecode(suggestedAt, rate))
  const [toleranceSeconds, setToleranceSeconds] = useState(90)

  const at = parseTimecode(atText, rate)
  const asset = assets.find((candidate) => candidate.id === assetId)
  const needsTime = mode !== 'FLOW'
  const valid = asset !== undefined && (!needsTime || at !== null)

  const build = (): Anchor => {
    if (mode === 'FLOW' || at === null) return { kind: 'FLOW' }
    if (mode === 'FIXED') return { kind: 'FIXED', at }
    return {
      kind: 'SOFT',
      at,
      tolerance: secondsToFrames(toleranceSeconds, rate),
      priority: 3,
    }
  }

  return (
    <div className="backdrop" onClick={onCancel}>
      <div className="dialog" onClick={(event) => event.stopPropagation()}>
        <header>
          <h2>Inserir item na grade</h2>
          <div className="sub">a grade se reorganiza em volta da hora que você marcar</div>
        </header>

        <div className="body">
          <div className="field">
            <label>Arquivo</label>
            <select value={assetId} onChange={(event) => setAssetId(event.target.value)}>
              {assets.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.title} · {dur(durationIn(option, rate), rate)}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>Compromisso com o relógio</label>
            <div className="seg-group">
              <button className={mode === 'FLOW' ? 'on' : ''} onClick={() => setMode('FLOW')}>
                NA SEQUÊNCIA
              </button>
              <button className={mode === 'FIXED' ? 'on' : ''} onClick={() => setMode('FIXED')}>
                HORA FIXA
              </button>
              <button className={mode === 'SOFT' ? 'on' : ''} onClick={() => setMode('SOFT')}>
                HORA COM FOLGA
              </button>
            </div>
          </div>

          {needsTime && (
            <div className="row">
              <div className="field">
                <label>Entra às</label>
                <input
                  type="text"
                  className={at === null ? 'bad' : ''}
                  value={atText}
                  onChange={(event) => setAtText(event.target.value)}
                />
              </div>
              {mode === 'SOFT' && (
                <div className="field">
                  <label>Tolerância (segundos)</label>
                  <input
                    type="number"
                    min="0"
                    max="600"
                    value={toleranceSeconds}
                    onChange={(event) => setToleranceSeconds(Number(event.target.value))}
                  />
                </div>
              )}
            </div>
          )}

          <div className="note">
            {mode === 'FLOW' && 'Entra quando o item anterior terminar. Vai para o fim da grade.'}
            {mode === 'FIXED' &&
              'Hora obrigatória. O que estiver na frente é cortado ou descartado para caber.'}
            {mode === 'SOFT' &&
              'Hora alvo com folga para os dois lados. O motor escolhe o melhor ponto da janela.'}
          </div>
        </div>

        <footer>
          <button className="btn" onClick={onCancel}>
            cancelar
          </button>
          <button
            className="btn take"
            disabled={!valid}
            onClick={() => asset && onAdd(asset.id, build(), asset.title)}
          >
            inserir
          </button>
        </footer>
      </div>
    </div>
  )
}
