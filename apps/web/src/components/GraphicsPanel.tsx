import { useEffect, useState } from 'react'
import type { GraphicOnAir, GraphicTemplate } from '@rplayout/protocol'
import { api } from '../api.js'

interface Props {
  channelId: string
  /** Arte usada como apresentação técnica, quando há uma. */
  slateTemplateId: string | null
  /** O que está no ar agora, vindo do estado ao vivo. */
  onAir: GraphicOnAir | null
  onClose: () => void
  onMessage: (text: string) => void
}

/**
 * Gerador de caracteres.
 *
 * O operador escolhe a arte, preenche os campos e põe no ar. O que sai daqui
 * é sempre o mesmo caminho: o servidor preenche o template e manda SVG pronto
 * para o engine -- não há um segundo caminho "de emergência" que se comporte
 * diferente na hora do aperto.
 */
export function GraphicsPanel({
  channelId,
  slateTemplateId,
  onAir,
  onClose,
  onMessage,
}: Props) {
  const [slate, setSlate] = useState(slateTemplateId)
  const [templates, setTemplates] = useState<GraphicTemplate[] | null>(null)
  const [chosen, setChosen] = useState<string>('')
  const [values, setValues] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    api
      .graphics(channelId)
      .then((list) => {
        if (!alive) return
        setTemplates(list.templates)
        setChosen((current) => current || (list.templates[0]?.id ?? ''))
      })
      .catch(() => alive && setTemplates([]))
    return () => {
      alive = false
    }
  }, [channelId])

  const template = templates?.find((entry) => entry.id === chosen) ?? null

  const fire = (): void => {
    if (!template) return
    setBusy(true)
    api
      .showGraphic(channelId, template.id, values)
      .then(() => onMessage(`${template.name} no ar.`))
      .catch((failure: Error) => onMessage(failure.message))
      .finally(() => setBusy(false))
  }

  const clear = (): void => {
    setBusy(true)
    api
      .hideGraphic(channelId)
      .then(() => onMessage('Grafismo fora do ar.'))
      .catch((failure: Error) => onMessage(failure.message))
      .finally(() => setBusy(false))
  }

  return (
    <div className="backdrop" onClick={onClose}>
      <div className="dialog wide" onClick={(event) => event.stopPropagation()}>
        <header>
          <h2>Gerador de caracteres</h2>
          <div className="sub">
            {onAir ? `no ar: ${onAir.name}` : 'nada no ar'} · a arte entra e sai com transição
          </div>
        </header>

        <div className="body">
          {templates === null && <div className="note">carregando as artes…</div>}
          {templates?.length === 0 && (
            <div className="note warn">
              Nenhuma arte cadastrada. As três que vêm com o sistema aparecem depois que o
              servidor sobe pela primeira vez.
            </div>
          )}

          {templates && templates.length > 0 && (
            <>
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
                      {entry.holdSeconds === null ? ' · fica até tirar' : ` · ${entry.holdSeconds}s`}
                    </option>
                  ))}
                </select>
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

              {template?.fields.length === 0 && (
                <div className="note">Esta arte não tem campo para preencher.</div>
              )}

              <label className="check">
                <input
                  type="checkbox"
                  checked={slate === chosen}
                  onChange={(event) => {
                    const next = event.target.checked ? chosen : null
                    setSlate(next)
                    api
                      .setSlate(channelId, next)
                      .then(() =>
                        onMessage(
                          next
                            ? 'Esta arte entra quando nada estiver no ar.'
                            : 'Canal vazio volta a ficar no preto.',
                        ),
                      )
                      .catch((failure: Error) => onMessage(failure.message))
                  }}
                />
                Usar como apresentação técnica — entra sozinha quando nada estiver no ar
              </label>

              <div className="note">
                {template?.holdSeconds === null
                  ? 'Fica no ar até alguém tirar. É o certo para selo de canal.'
                  : `Sai sozinha depois de ${template?.holdSeconds ?? 0} segundos — crédito esquecido no ar é erro clássico.`}
              </div>
            </>
          )}
        </div>

        <footer>
          <button className="btn" onClick={onClose}>
            fechar
          </button>
          <button className="btn" disabled={busy || !onAir} onClick={clear}>
            tirar do ar
          </button>
          <button className="btn take" disabled={busy || !template} onClick={fire}>
            pôr no ar
          </button>
        </footer>
      </div>
    </div>
  )
}
