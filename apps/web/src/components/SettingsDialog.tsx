import { useState } from 'react'
import { formatVideoFormat, type Channel } from '@rplayout/protocol'
import { api } from '../api.js'

interface Props {
  channel: Channel
  channels: { id: string; name: string }[]
  onClose: () => void
  onMessage: (text: string) => void
  /** Recarrega canais e grade depois de mexer. */
  onChanged: () => void
  onOpenFormat: () => void
  onOpenDistribution: () => void
  onOpenGraphics: () => void
}

/**
 * Configurações.
 *
 * O que muda o comportamento do sistema fica atrás da engrenagem; o que o
 * operador usa no ar fica na barra. Misturar as duas coisas é como alguém
 * apaga um canal com a mão no take.
 */
export function SettingsDialog({
  channel,
  channels,
  onClose,
  onMessage,
  onChanged,
  onOpenFormat,
  onOpenDistribution,
  onOpenGraphics,
}: Props) {
  const [novo, setNovo] = useState('')
  const [busy, setBusy] = useState(false)

  const criar = (): void => {
    const nome = novo.trim()
    if (nome === '') return
    setBusy(true)
    api
      .addChannel(nome)
      .then(() => {
        setNovo('')
        onChanged()
        onMessage(`${nome} criado, com grade vazia.`)
      })
      .catch((failure: Error) => onMessage(failure.message))
      .finally(() => setBusy(false))
  }

  const apagar = (id: string, nome: string): void => {
    // Apagar canal leva grade, saídas e as-run junto: pergunta com o nome
    // escrito, para ninguém confirmar no automático.
    if (!window.confirm(`Apagar o canal "${nome}"? A grade dele vai junto.`)) return
    setBusy(true)
    api
      .removeChannel(id)
      .then(() => {
        onChanged()
        onMessage(`${nome} apagado.`)
      })
      .catch((failure: Error) => onMessage(failure.message))
      .finally(() => setBusy(false))
  }

  return (
    <div className="backdrop" onClick={onClose}>
      <div className="dialog wide" onClick={(event) => event.stopPropagation()}>
        <header>
          <h2>Configurações</h2>
          <div className="sub">canal em foco: {channel.name} · {formatVideoFormat(channel)}</div>
        </header>

        <div className="body">
          <div className="field">
            <label>Canais</label>
            <ul className="cues">
              {channels.map((entrada) => (
                <li key={entrada.id}>
                  <b>{entrada.id === channel.id ? 'no ar' : '—'}</b>
                  <span>{entrada.name}</span>
                  <i />
                  <button
                    className="btn small"
                    disabled={busy || channels.length <= 1}
                    title={
                      channels.length <= 1
                        ? 'É o único canal: crie outro antes de apagar'
                        : 'Apagar este canal'
                    }
                    onClick={() => apagar(entrada.id, entrada.name)}
                  >
                    apagar
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div className="row">
            <div className="field">
              <label>Novo canal</label>
              <input
                type="text"
                placeholder="nome do canal"
                value={novo}
                onChange={(event) => setNovo(event.target.value)}
                onKeyDown={(event) => event.key === 'Enter' && criar()}
              />
            </div>
            <div className="field">
              <label>&nbsp;</label>
              <button className="btn" disabled={busy || novo.trim() === ''} onClick={criar}>
                criar
              </button>
            </div>
          </div>

          <div className="note">
            Canal novo nasce no formato do primeiro e com grade vazia. Cada um tem engine próprio:
            é isso que faz um cair sem levar o outro — e é isso que faz vários canais somarem CPU.
          </div>

          <div className="field">
            <label>Ajustes deste canal</label>
            <div className="atalhos">
              <button className="btn" onClick={onOpenFormat}>
                formato de vídeo
                <i>{formatVideoFormat(channel)}</i>
              </button>
              <button className="btn" onClick={onOpenDistribution}>
                distribuição
                <i>saídas, convidados e destinos</i>
              </button>
              <button className="btn" onClick={onOpenGraphics}>
                grafismo
                <i>artes e apresentação técnica</i>
              </button>
            </div>
          </div>
        </div>

        <footer>
          <button className="btn" onClick={onClose}>
            fechar
          </button>
        </footer>
      </div>
    </div>
  )
}
