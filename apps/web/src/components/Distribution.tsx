import { useCallback, useEffect, useState } from 'react'
import { api } from '../api.js'
import type {
  Distribution as Payload,
  OutputProfile,
  PublisherStatus,
  RelayStatus,
} from '../types.js'

interface Props {
  channelId: string
  onClose: () => void
  onMessage: (text: string) => void
}

const RELAY_TONE: Record<RelayStatus['state'], string> = {
  'NO AR': 'ok',
  CONECTANDO: 'warn',
  CAIU: 'bad',
  FALHOU: 'bad',
}

const PUBLISHER_TONE: Record<PublisherStatus['health'], string> = {
  onAir: 'ok',
  connecting: 'warn',
  retrying: 'bad',
}

const PUBLISHER_LABEL: Record<PublisherStatus['health'], string> = {
  onAir: 'NO AR',
  connecting: 'CONECTANDO',
  retrying: 'RECONECTANDO',
}

/** Copia e avisa. Endereço que o operador precisa digitar à mão é endereço errado. */
async function copy(text: string, say: (message: string) => void): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    say('Endereço copiado.')
  } catch {
    say('O navegador não deixou copiar. Selecione e copie à mão.')
  }
}

/**
 * Painel de distribuição.
 *
 * Não é tela de operação segundo a segundo -- é onde se configura quem recebe o
 * sinal e se confere quem está conectado. Por isso vive fora do rundown.
 */
/**
 * Resumo do perfil em uma linha.
 *
 * Campo em branco herda do canal, e dizer isso é mais útil do que repetir o
 * valor: quando o canal muda de formato, o herdado acompanha e o escrito não.
 */
function profileSummary(output: OutputProfile): string {
  const parts: string[] = []
  if (output.width !== null && output.height !== null) {
    parts.push(`${output.width}×${output.height}`)
  }
  if (output.rateNum !== null && output.rateDen !== null) {
    parts.push(`${(output.rateNum / output.rateDen).toFixed(2).replace(/\.00$/, '')} fps`)
  }
  if (output.bitrateKbps !== null) parts.push(`${output.bitrateKbps} kbps`)
  if (output.scan !== null) {
    parts.push(output.scan === 'INTERLACED' ? 'entrelaçada' : 'progressiva')
  }

  if (parts.length === 0) return 'tudo como o canal'
  return `${parts.join(' · ')} · resto como o canal`
}

export function Distribution({ channelId, onClose, onMessage }: Props) {
  const [data, setData] = useState<Payload | null>(null)
  const [outputs, setOutputs] = useState<OutputProfile[]>([])
  const [outName, setOutName] = useState('')
  const [outTarget, setOutTarget] = useState('')
  const [outKind, setOutKind] = useState<'RTMP' | 'SRT' | 'FILE'>('RTMP')
  const [guestLabel, setGuestLabel] = useState('')
  const [destName, setDestName] = useState('')
  const [destUrl, setDestUrl] = useState('')
  const [error, setError] = useState<string | null>(null)
  /**
   * O que está digitado no campo de qualidade, por saída.
   *
   * A lista se recarrega a cada dois segundos; sem guardar o que a pessoa está
   * escrevendo, o número sumiria do campo no meio da digitação.
   */
  const [rascunho, setRascunho] = useState<Record<string, string>>({})

  const refresh = useCallback(async () => {
    try {
      const [payload, profiles] = await Promise.all([
        api.distribution(),
        api.outputs(channelId),
      ])
      setData(payload)
      setOutputs(profiles.outputs)
      setError(null)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Falha ao ler a distribuição.')
    }
  }, [channelId])

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => void refresh(), 2000)
    return () => window.clearInterval(timer)
  }, [refresh])

  const guard = async (action: () => Promise<void>): Promise<void> => {
    try {
      await action()
      await refresh()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Não consegui aplicar.')
    }
  }

  /** Grava o que foi digitado. Campo vazio quer dizer "volte ao automático". */
  const salvarBitrate = (output: OutputProfile): void => {
    const digitado = rascunho[output.id]
    if (digitado === undefined) return

    const limpo = digitado.trim()
    const valor = limpo === '' ? null : Number(limpo)
    if (valor !== null && (!Number.isFinite(valor) || valor < 500)) {
      setError('Qualidade em kbps, de 500 para cima.')
      return
    }
    if (valor === output.bitrateKbps) {
      setRascunho((atual) => {
        const proximo = { ...atual }
        delete proximo[output.id]
        return proximo
      })
      return
    }

    void guard(async () => {
      await api.patchOutput(output.id, { bitrateKbps: valor === null ? null : Math.round(valor) })
      setRascunho((atual) => {
        const proximo = { ...atual }
        delete proximo[output.id]
        return proximo
      })
      onMessage('Qualidade guardada. Vale no próximo início do canal.')
    })
  }

  const channel = data?.channels.find((entry) => entry.channelId === channelId) ?? data?.channels[0]

  return (
    <div className="backdrop" onClick={onClose}>
      <div className="dialog wide" onClick={(event) => event.stopPropagation()}>
        <header>
          <h2>Distribuição</h2>
          <div className="sub">
            {data?.server.running
              ? `servidor local no ar em ${data.server.host}`
              : 'servidor local desligado'}
          </div>
        </header>

        <div className="body">
          {error && <div className="note warn">{error}</div>}

          {data?.server.exposed && (
            <div className="note warn">
              O servidor está aberto para todas as interfaces de rede, não só para a rede local.
              Só mantenha assim se for isso mesmo que você quer.
            </div>
          )}

          {channel?.format && (
            <div className="note">
              Canal em <b>{channel.format.channel}</b>
              {channel.format.channel !== channel.format.network && (
                <>
                  {' '}
                  · a saída de rede vai em <b>{channel.format.network}</b>, porque o RTMP não
                  declara entrelaçamento e a maior parte dos destinos assume progressivo
                </>
              )}
            </div>
          )}

          {channel?.urls && (
            <div className="field">
              <label>Endereços do programa</label>
              <div className="addresses">
                {Object.entries(channel.urls).map(([protocol, url]) => (
                  <button
                    key={protocol}
                    className="address"
                    onClick={() => void copy(url, onMessage)}
                    title="Clique para copiar"
                  >
                    <b>{protocol.toUpperCase()}</b>
                    <span>{url}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Saída do canal. Caminho existir no servidor não quer dizer que
              alguém esteja publicando nele: quem responde por isso é o engine. */}
          {channel && channel.publishers.length > 0 && (
            <div className="field">
              <label>Saída do canal</label>
              <div className="rows">
                {channel.publishers.map((publisher) => (
                  <div key={publisher.url} className="row-item">
                    <div>
                      <div className="t">
                        {outputs.find((entry) => entry.resolvedTarget === publisher.url)?.name ??
                          'Saída'}
                        <span className={`pill ${PUBLISHER_TONE[publisher.health]}`}>
                          {PUBLISHER_LABEL[publisher.health]}
                        </span>
                      </div>
                      <div className="d mono">{publisher.url}</div>
                      <div className="d">
                        {publisher.delivered > 0
                          ? `${publisher.delivered.toLocaleString('pt-BR')} pacotes entregues`
                          : 'nada entregue ainda'}
                        {publisher.attempts > 1 && ` · ${publisher.attempts} tentativas`}
                        {publisher.error && ` · ${publisher.error}`}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ---- perfis de saída ---- */}
          <div className="field">
            <label>Perfis de saída</label>
            <div className="rows">
              {outputs.map((output) => (
                <div key={output.id} className="row-item">
                  <div>
                    <div className="t">
                      {output.name}
                      <span className="pill">{output.kind}</span>
                      {output.role !== 'EXTRA' && <span className="pill">do sistema</span>}
                      {!output.enabled && <span className="pill bad">desligada</span>}
                    </div>
                    <div className="d mono">{output.resolvedTarget ?? '(sem destino)'}</div>
                    <div className="d">{profileSummary(output)}</div>
                    {/* Qualidade por saída, escrita à mão.
                        O mesmo canal costuma ir para lugares com fôlego
                        diferente: a transmissão principal aguenta o que o
                        arquivo de gravação nem precisa, e o YouTube tem outro
                        teto que a operadora do estúdio. Um número só para todas
                        obriga a escolher entre imagem pobre onde sobra banda e
                        travamento onde falta. */}
                    <div className="qualidade">
                      <label htmlFor={`br-${output.id}`}>qualidade</label>
                      <input
                        id={`br-${output.id}`}
                        type="number"
                        min={500}
                        max={80000}
                        step={250}
                        value={rascunho[output.id] ?? output.bitrateKbps ?? ''}
                        placeholder={
                          output.suggestedBitrateKbps === null
                            ? 'automático'
                            : `automático (${output.suggestedBitrateKbps})`
                        }
                        onChange={(event) =>
                          setRascunho((atual) => ({ ...atual, [output.id]: event.target.value }))
                        }
                        onBlur={() => salvarBitrate(output)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') event.currentTarget.blur()
                          if (event.key === 'Escape') {
                            setRascunho((atual) => {
                              const proximo = { ...atual }
                              delete proximo[output.id]
                              return proximo
                            })
                          }
                        }}
                      />
                      <span className="unidade">kbps</span>
                      {/* Apagar o campo volta ao automático, que acompanha o
                          formato do canal quando ele muda. */}
                      {output.bitrateKbps !== null && (
                        <button
                          className="btn small"
                          onClick={() =>
                            void guard(async () => {
                              setRascunho((atual) => {
                                const proximo = { ...atual }
                                delete proximo[output.id]
                                return proximo
                              })
                              await api.patchOutput(output.id, { bitrateKbps: null })
                              onMessage('Qualidade no automático. Vale no próximo início do canal.')
                            })
                          }
                          title="Volta a acompanhar o formato do canal"
                        >
                          AUTO
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="actions">
                    <button
                      className="btn small"
                      onClick={() =>
                        void guard(async () => {
                          await api.patchOutput(output.id, { enabled: !output.enabled })
                          onMessage('Vale no próximo início do canal.')
                        })
                      }
                    >
                      {output.enabled ? 'DESLIGAR' : 'LIGAR'}
                    </button>
                    {output.role === 'EXTRA' && (
                      <button
                        className="btn small"
                        onClick={() =>
                          void guard(async () => {
                            await api.removeOutput(output.id)
                          })
                        }
                      >
                        REMOVER
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            {/* Mexer no conjunto de saídas de um pipeline que está no ar é o
                tipo de cirurgia que este projeto já pagou caro para evitar. */}
            <div className="note">
              Mudança em perfil de saída vale no próximo início do canal.
            </div>
            <div className="add-row">
              <input
                type="text"
                placeholder="nome"
                value={outName}
                onChange={(event) => setOutName(event.target.value)}
              />
              <select
                value={outKind}
                onChange={(event) => setOutKind(event.target.value as typeof outKind)}
              >
                <option value="RTMP">RTMP</option>
                <option value="SRT">SRT</option>
                <option value="FILE">Arquivo</option>
              </select>
              <input
                type="text"
                placeholder={outKind === 'FILE' ? 'caminho do arquivo' : 'rtmp://...'}
                value={outTarget}
                onChange={(event) => setOutTarget(event.target.value)}
              />
              <button
                className="btn small"
                disabled={!outName.trim() || !outTarget.trim()}
                onClick={() =>
                  void guard(async () => {
                    await api.addOutput(channelId, {
                      name: outName.trim(),
                      kind: outKind,
                      target: outTarget.trim(),
                    })
                    setOutName('')
                    setOutTarget('')
                    onMessage('Saída criada. Vale no próximo início do canal.')
                  })
                }
              >
                ADICIONAR
              </button>
            </div>
          </div>

          {/* ---- convidados ---- */}
          <div className="field">
            <label>Convidados</label>
            <div className="rows">
              {(data?.guests ?? []).map((guest) => {
                const path = data?.paths.find((entry) => entry.name.endsWith(guest.streamKey))
                return (
                  <div key={guest.id} className="row-item">
                    <div>
                      <div className="t">
                        {guest.label}
                        {path?.ready && <span className="pill ok">conectado</span>}
                      </div>
                      <button
                        className="mono-link"
                        onClick={() => void copy(guest.publishUrl, onMessage)}
                        title="Clique para copiar"
                      >
                        {guest.publishUrl}
                      </button>
                    </div>
                    <button
                      className="btn small"
                      onClick={() =>
                        void guard(async () => {
                          await api.removeGuest(guest.id)
                          onMessage(`Chave de ${guest.label} revogada.`)
                        })
                      }
                    >
                      revogar
                    </button>
                  </div>
                )
              })}
              {(data?.guests ?? []).length === 0 && (
                <div className="empty">Nenhum convidado. Crie uma chave para alguém publicar.</div>
              )}
            </div>
            <div className="inline">
              <input
                type="text"
                placeholder="nome do convidado"
                value={guestLabel}
                onChange={(event) => setGuestLabel(event.target.value)}
              />
              <button
                className="btn"
                disabled={guestLabel.trim() === ''}
                onClick={() =>
                  void guard(async () => {
                    const created = await api.addGuest(channelId, guestLabel.trim())
                    setGuestLabel('')
                    await copy(created.publishUrl, onMessage)
                  })
                }
              >
                criar chave
              </button>
            </div>
          </div>

          {/* ---- destinos ---- */}
          <div className="field">
            <label>Destinos</label>
            <div className="rows">
              {(data?.destinations ?? []).map((destination) => {
                const relay = data?.relays.find((entry) => entry.id === destination.id)
                return (
                  <div key={destination.id} className="row-item">
                    <div>
                      <div className="t">
                        {destination.name}
                        {relay && (
                          <span className={`pill ${RELAY_TONE[relay.state]}`}>{relay.state}</span>
                        )}
                      </div>
                      <div className="d mono">{destination.url}</div>
                      {relay && (
                        <div className="d">
                          {relay.delivered > 0
                            ? `${relay.delivered.toLocaleString('pt-BR')} pacotes entregues`
                            : 'nada entregue ainda'}
                          {relay.attempts > 1 && ` · ${relay.attempts} tentativas`}
                          {relay.reason && ` · ${relay.reason}`}
                        </div>
                      )}
                    </div>
                    <div className="actions">
                      <button
                        className="btn small"
                        onClick={() =>
                          void guard(() =>
                            api
                              .setDestination(destination.id, { enabled: !destination.enabled })
                              .then(() => undefined),
                          )
                        }
                      >
                        {destination.enabled ? 'desligar' : 'ligar'}
                      </button>{' '}
                      <button
                        className="btn small"
                        onClick={() =>
                          void guard(() =>
                            api.removeDestination(destination.id).then(() => undefined),
                          )
                        }
                      >
                        remover
                      </button>
                    </div>
                  </div>
                )
              })}
              {(data?.destinations ?? []).length === 0 && (
                <div className="empty">
                  Nenhum destino. O programa continua disponível na rede local.
                </div>
              )}
            </div>
            <div className="inline">
              <input
                type="text"
                placeholder="nome"
                value={destName}
                onChange={(event) => setDestName(event.target.value)}
              />
              <input
                type="text"
                placeholder="rtmp://..."
                value={destUrl}
                onChange={(event) => setDestUrl(event.target.value)}
              />
              <button
                className="btn"
                disabled={destName.trim() === '' || destUrl.trim() === ''}
                onClick={() =>
                  void guard(async () => {
                    await api.addDestination(channelId, destName.trim(), destUrl.trim())
                    setDestName('')
                    setDestUrl('')
                    onMessage('Destino criado. O relay começa a entregar em alguns segundos.')
                  })
                }
              >
                adicionar
              </button>
            </div>
          </div>

          {/* ---- o que está passando ---- */}
          <div className="field">
            <label>No servidor agora</label>
            <div className="rows">
              {(data?.paths ?? []).map((path) => (
                <div key={path.name} className="row-item">
                  <div>
                    <div className="t mono">
                      {path.name}
                      <span className={`pill ${path.ready ? 'ok' : ''}`}>
                        {path.ready ? 'no ar' : 'parado'}
                      </span>
                    </div>
                    <div className="d">
                      {(path.bytesReceived / 1048576).toFixed(1)} MiB recebidos ·{' '}
                      {path.readers} {path.readers === 1 ? 'leitor' : 'leitores'}
                    </div>
                  </div>
                </div>
              ))}
              {(data?.paths ?? []).length === 0 && (
                <div className="empty">O servidor local não está respondendo.</div>
              )}
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
