import { useState } from 'react'
import { framesToSeconds, secondsToFrames, type Rate } from '@rplayout/protocol'
import type { ItemView } from '../types.js'

interface Props {
  view: ItemView
  rate: Rate
  onCancel: () => void
  onApply: (durationFrames: number) => void
}

/**
 * Quanto tempo uma imagem parada fica no ar.
 *
 * Ela não tem entrada nem saída para marcar -- o arquivo é um quadro só --,
 * então o que o botão de I/O abre aqui é a única coisa que existe para
 * decidir: a duração, que é da grade e não do arquivo.
 */
export function StillDialog({ view, rate, onCancel, onApply }: Props) {
  const current = view.item.durationOverride ?? 0
  const [seconds, setSeconds] = useState(Math.round(framesToSeconds(current, rate)))
  const valid = Number.isFinite(seconds) && seconds > 0

  return (
    <div className="backdrop" onClick={onCancel}>
      <div className="dialog" onClick={(event) => event.stopPropagation()}>
        <header>
          <h2>Tempo da imagem parada</h2>
          <div className="sub">{view.item.title} · o arquivo é um quadro, o tempo é da grade</div>
        </header>

        <div className="body">
          <div className="field">
            <label>Fica no ar (segundos)</label>
            <input
              type="number"
              min="1"
              max="3600"
              value={seconds}
              onChange={(event) => setSeconds(Number(event.target.value))}
            />
          </div>

          <div className="note">
            A grade se reorganiza em volta desta duração, como faz com qualquer item.
          </div>
        </div>

        <footer>
          <button className="btn" onClick={onCancel}>
            cancelar
          </button>
          <button
            className="btn take"
            disabled={!valid}
            onClick={() => onApply(secondsToFrames(seconds, rate))}
          >
            aplicar
          </button>
        </footer>
      </div>
    </div>
  )
}
