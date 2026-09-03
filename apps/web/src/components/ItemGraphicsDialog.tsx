import { useEffect, useState } from 'react'
import type { GraphicTemplate, ItemGraphic } from '@rplayout/protocol'
import { api } from '../api.js'
import type { ItemView } from '../types.js'

interface Props {
  view: ItemView
  channelId: string
  onClose: () => void
  onMessage: (text: string) => void
}

const mmss = (seconds: number): string =>
  `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`

/**
 * Grafismo preso ao item.
 *
 * É o que tira o GC do improviso: o crédito entra sozinho no segundo marcado,
 * toda vez que aquele item for ao ar. O operador continua podendo pôr arte na
 * mão pelo painel de GC -- as duas coisas passam pelo mesmo caminho.
 */
export function ItemGraphicsDialog({ view, channelId, onClose, onMessage }: Props) {
  const [templates, setTemplates] = useState<GraphicTemplate[]>([])
  const [cues, setCues] = useState<ItemGraphic[] | null>(null)
  const [chosen, setChosen] = useState('')
  const [atSeconds, setAtSeconds] = useState(5)
  const [values, setValues] = useState<Record<string, string>>({})

  useEffect(() => {
    let alive = true
    void Promise.all([api.graphics(channelId), api.itemGraphics(view.item.id)])
      .then(([list, current]) => {
        if (!alive) return
        setTemplates(list.templates)
        setCues(current.cues)
        setChosen((now) => now || (list.templates[0]?.id ?? ''))
      })
      .catch(() => alive && setCues([]))
    return () => {
      alive = false
    }
  }, [channelId, view.item.id])

  const template = templates.find((entry) => entry.id === chosen) ?? null

  const add = (): void => {
    if (!template) return
    api
      .addItemGraphic(view.item.id, template.id, values, atSeconds)
      .then((result) => {
        setCues(result.cues)
        setValues({})
        onMessage(`${template.name} entra aos ${mmss(atSeconds)} deste item.`)
      })
      .catch((failure: Error) => onMessage(failure.message))
  }

  const remove = (id: string): void => {
    api
      .removeItemGraphic(id)
      .then((result) => setCues(result.cues))
      .catch((failure: Error) => onMessage(failure.message))
  }

  return (
    <div className="backdrop" onClick={onClose}>
      <div className="dialog wide" onClick={(event) => event.stopPropagation()}>
        <header>
          <h2>Grafismo deste item</h2>
          <div className="sub">{view.item.title} · entra sozinho, toda vez que o item for ao ar</div>
        </header>

        <div className="body">
          {cues === null && <div className="note">carregando…</div>}
          {cues?.length === 0 && (
            <div className="note">Nenhuma arte presa a este item. Ele vai ao ar limpo.</div>
          )}

          {cues && cues.length > 0 && (
            <ul className="cues">
              {cues.map((cue) => (
                <li key={cue.id}>
                  <b>{mmss(cue.atSeconds)}</b>
                  <span>{cue.templateName}</span>
                  <i>{Object.values(cue.values).filter(Boolean).join(' · ') || 'sem campos'}</i>
                  <button className="btn small" onClick={() => remove(cue.id)}>
                    tirar
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="row">
            <div className="field">
              <label>Arte</label>
              <select
                value={chosen}
                onChange={(event) => {
                  setChosen(event.target.value)
                  setValues({})
                }}
              >
                {templates.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Entra aos (segundos)</label>
              <input
                type="number"
                min="0"
                max="3600"
                value={atSeconds}
                onChange={(event) => setAtSeconds(Number(event.target.value))}
              />
            </div>
          </div>

          {template?.fields.map((field) => (
            <div className="field" key={field.key}>
              <label>{field.label}</label>
              <input
                type="text"
                value={values[field.key] ?? ''}
                placeholder={field.defaultValue || '—'}
                onChange={(event) =>
                  setValues((current) => ({ ...current, [field.key]: event.target.value }))
                }
              />
            </div>
          ))}
        </div>

        <footer>
          <button className="btn" onClick={onClose}>
            fechar
          </button>
          <button className="btn take" disabled={!template} onClick={add}>
            prender ao item
          </button>
        </footer>
      </div>
    </div>
  )
}
