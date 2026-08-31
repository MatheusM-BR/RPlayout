import { useCallback, useEffect, useState } from 'react'
import { api } from '../api.js'
import type { Distribution as Payload, RelayStatus } from '../types.js'

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
export function Distribution({ channelId, onClose, onMessage }: Props) {
  const [data, setData] = useState<Payload | null>(null)
  const [guestLabel, setGuestLabel] = useState('')
  const [destName, setDestName] = useState('')
  const [destUrl, setDestUrl] = useState('')
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setData(await api.distribution())
      setError(null)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Falha ao ler a distribuição.')
    }
  }, [])

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
