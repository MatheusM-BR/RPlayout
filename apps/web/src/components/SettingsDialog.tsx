import { useState } from 'react'
import { formatVideoFormat, type Channel } from '@rplayout/protocol'
import { api } from '../api.js'
import { BUILD_COMMIT, buildDate } from '../build.js'
import { CategoriasPanel } from './CategoriasPanel.js'
import { PastasPanel } from './PastasPanel.js'

interface Props {
  channel: Channel
  channels: Channel[]
  onClose: () => void
  onMessage: (text: string) => void
  /** Recarrega canais e grade depois de mexer. */
  onChanged: () => void
  /** Abre a edição de um canal. Outro que não o em foco troca o foco antes. */
  onOpenFormat: (channelId: string) => void
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
          <div className="sub">
            canal em foco: {channel.name} · {formatVideoFormat(channel)}
            <button
              className="lapis"
              title={`Editar ${channel.name}`}
              aria-label={`Editar ${channel.name}`}
              onClick={() => onOpenFormat(channel.id)}
            >
              ✎
            </button>
          </div>
        </header>

        <div className="body">
          {/* Cada canal numa linha, com o que ele é escrito na própria linha.
              Antes a lista dizia só o nome, e o formato de um canal que não
              estava em foco não aparecia em lugar nenhum -- para saber em que
              formato o outro canal estava era preciso trocar de canal. */}
          <div className="field">
            <label>Canais</label>
            <ul className="canais">
              {channels.map((entrada) => (
                <li key={entrada.id} className={entrada.id === channel.id ? 'foco' : undefined}>
                  <button
                    className="lapis"
                    title={
                      entrada.id === channel.id
                        ? `Editar ${entrada.name}`
                        : `Editar ${entrada.name} (troca o canal em foco)`
                    }
                    aria-label={`Editar ${entrada.name}`}
                    onClick={() => onOpenFormat(entrada.id)}
                  >
                    ✎
                  </button>
                  <div className="quem">
                    <div className="nome">
                      {entrada.name}
                      {entrada.id === channel.id && <span className="pill">em foco</span>}
                    </div>
                    <div className="detalhe mono">
                      {formatVideoFormat(entrada)} · {entrada.width}×{entrada.height} ·{' '}
                      {entrada.scan === 'INTERLACED' ? 'entrelaçado' : 'progressivo'} · alvo{' '}
                      {entrada.targetLufs} LUFS · teto {entrada.ceilingDbtp} dBTP
                    </div>
                  </div>
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
            <div className="pastas-add">
              <input
                type="text"
                placeholder="nome do canal novo"
                value={novo}
                onChange={(event) => setNovo(event.target.value)}
                onKeyDown={(event) => event.key === 'Enter' && criar()}
              />
              <button className="btn small" disabled={busy || novo.trim() === ''} onClick={criar}>
                CRIAR CANAL
              </button>
            </div>
            <div className="note">
              Canal novo nasce no formato do primeiro e com grade vazia. Cada um tem engine
              próprio: é isso que faz um cair sem levar o outro — e é isso que faz vários canais
              somarem CPU.
            </div>
          </div>

          <PastasPanel onMessage={onMessage} onChanged={onChanged} />
          <CategoriasPanel onMessage={onMessage} onChanged={onChanged} />

          <div className="field">
            <label>Ajustes deste canal</label>
            <div className="atalhos">
              <button className="btn" onClick={onOpenDistribution}>
                saídas
                <i>RTMP, SRT, Decklink, convidados e destinos</i>
              </button>
              <button className="btn" onClick={onOpenGraphics}>
                grafismo
                <i>artes e apresentação técnica</i>
              </button>
            </div>
          </div>
        </div>

        <footer>
          {/* De qual código esta tela saiu. Numa máquina de playout a interface
              é um arquivo estático: uma build velha continua funcionando
              perfeitamente com o código de ontem, e sem isto a única forma de
              descobrir é procurar botão que deveria estar lá. */}
          <div className="carimbo" title="Versão da interface que está rodando">
            build {BUILD_COMMIT}
            {buildDate() !== '' && ` · ${buildDate()}`}
          </div>
          <button className="btn" onClick={onClose}>
            fechar
          </button>
        </footer>
      </div>
    </div>
  )
}
