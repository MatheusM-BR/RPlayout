import { useState } from 'react'
import type { Rate } from '@rplayout/protocol'
import { api } from '../api.js'
import { dur } from '../format.js'
import type { FillPlan, Snapshot } from '../types.js'

interface Props {
  rundownId: string
  rate: Rate
  onCancel: () => void
  onApplied: (snapshot: Snapshot, message: string) => void
  onMessage: (text: string) => void
}

/**
 * Montagem automática.
 *
 * Planejar é de graça e aplicar mexe na grade, então são dois passos: o
 * operador vê a proposta inteira antes de ela virar programação. Grade que
 * aparece pronta sem ninguém ter visto é grade que o operador desmonta na mão.
 */
export function AutoFillDialog({ rundownId, rate, onCancel, onApplied, onMessage }: Props) {
  const [minutes, setMinutes] = useState(30)
  const [avoidHours, setAvoidHours] = useState(6)
  const [plan, setPlan] = useState<FillPlan | null>(null)
  const [busy, setBusy] = useState(false)

  const run = (preview: boolean): void => {
    setBusy(true)
    api
      .autoFill(rundownId, { minutes, avoidHours, preview })
      .then((result) => {
        setPlan(result.plan)
        if (!preview && result.view) {
          onApplied(
            result as Snapshot,
            `${result.plan.items.length} itens montados no fim da grade.`,
          )
        }
      })
      .catch((failure: Error) => onMessage(failure.message))
      .finally(() => setBusy(false))
  }

  return (
    <div className="backdrop" onClick={onCancel}>
      <div className="dialog wide" onClick={(event) => event.stopPropagation()}>
        <header>
          <h2>Montar automaticamente</h2>
          <div className="sub">o motor propõe; quem decide é você</div>
        </header>

        <div className="body">
          <div className="row">
            <div className="field">
              <label>Preencher (minutos)</label>
              <input
                type="number"
                min="1"
                max="720"
                value={minutes}
                onChange={(event) => setMinutes(Number(event.target.value))}
              />
            </div>
            <div className="field">
              <label>Não repetir nas últimas (horas)</label>
              <input
                type="number"
                min="0"
                max="240"
                value={avoidHours}
                onChange={(event) => setAvoidHours(Number(event.target.value))}
              />
            </div>
          </div>

          <div className="note">
            A escolha pesa três coisas: o encaixe no tempo que falta, há quanto tempo o arquivo
            não vai ao ar, e o que você costuma inserir ou tirar. Nada é sorteado — a grade
            precisa poder explicar por que cada item entrou.
          </div>

          {plan && (
            <>
              <div className={`note${plan.reason === 'OUT_OF_MATERIAL' ? ' warn' : ''}`}>
                {plan.reason === 'FILLED'
                  ? `Janela preenchida; sobraram ${dur(plan.leftover, rate)}.`
                  : `O acervo acabou antes: faltaram ${dur(plan.leftover, rate)} para fechar a janela.`}
              </div>
              <ul className="cues">
                {plan.items.map((item, index) => (
                  <li key={`${item.mediaId}-${index}`}>
                    <b>{dur(item.durationFrames, rate)}</b>
                    <span>{item.title}</span>
                    <i />
                    <span />
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        <footer>
          <button className="btn" onClick={onCancel}>
            cancelar
          </button>
          <button className="btn" disabled={busy} onClick={() => run(true)}>
            propor
          </button>
          <button className="btn take" disabled={busy || plan === null} onClick={() => run(false)}>
            aplicar na grade
          </button>
        </footer>
      </div>
    </div>
  )
}
