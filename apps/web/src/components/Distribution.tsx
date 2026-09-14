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

/**
 * Como cada tipo de saída se chama para quem opera.
 *
 * "SDI" é o nome da norma; quem está com a placa na mão chama de Decklink, e
 * era em "Decklink" que se procurava na tela sem achar.
 */
const TIPO_LABEL: Record<string, string> = {
  RTMP: 'RTMP',
  SRT: 'SRT',
  FILE: 'ARQUIVO',
  SDI: 'DECKLINK',
}

const PUBLISHER_TONE: Record<PublisherStatus['health'], string> = {
  onAir: 'ok',
  connecting: 'warn',
  retrying: 'bad',
  // Monitor parado não é falha: é uma janela que ninguém abriu.
  idle: '',
}

const PUBLISHER_LABEL: Record<PublisherStatus['health'], string> = {
  onAir: 'NO AR',
  connecting: 'CONECTANDO',
  retrying: 'RECONECTANDO',
  idle: 'EM ESPERA',
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
  const [processes, setProcesses] = useState<Awaited<ReturnType<typeof api.processes>>['processes']>([])
  const [healthEvents, setHealthEvents] = useState<Awaited<ReturnType<typeof api.healthEvents>>['events']>([])
  const [scheduler, setScheduler] = useState<Awaited<ReturnType<typeof api.schedulerStatus>>['channels'][number] | null>(null)
  const [n1, setN1] = useState<Awaited<ReturnType<typeof api.n1Status>> | null>(null)
  const [timeline, setTimeline] = useState<Awaited<ReturnType<typeof api.timeline>>['items']>([])
  const [healthFilter, setHealthFilter] = useState<'ALL' | 'WARN' | 'CRITICAL'>('ALL')
  const [processKind, setProcessKind] = useState<'ALL' | 'ENGINE' | 'OUTPUT' | 'MEDIAMTX'>('ALL')
  const [processChannel, setProcessChannel] = useState<'ALL' | 'CURRENT'>('CURRENT')
  const [outputs, setOutputs] = useState<OutputProfile[]>([])
  const [decklinkSources, setDecklinkSources] = useState<{ reference: string; label: string }[]>([])
  const [outName, setOutName] = useState('')
  const [outTarget, setOutTarget] = useState('')
  const [outKind, setOutKind] = useState<'RTMP' | 'SRT' | 'FILE' | 'SDI'>('RTMP')
  const [guestLabel, setGuestLabel] = useState('')
  const [reiniciando, setReiniciando] = useState(false)
  const [destName, setDestName] = useState('')
  const [destUrl, setDestUrl] = useState('')
  const [srtMode, setSrtMode] = useState<'caller' | 'listener' | 'rendezvous'>('caller')
  const [srtLatency, setSrtLatency] = useState('800')
  const [srtStreamId, setSrtStreamId] = useState('')
  const [srtPassphrase, setSrtPassphrase] = useState('')
  const [error, setError] = useState<string | null>(null)
  /**
   * O que está digitado no campo de qualidade, por saída.
   *
   * A lista se recarrega a cada dois segundos; sem guardar o que a pessoa está
   * escrevendo, o número sumiria do campo no meio da digitação.
   */
  const [rascunho, setRascunho] = useState<Record<string, string>>({})

  useEffect(() => {
    if (outKind !== 'SDI') return
    void api.sources().then((sources) => setDecklinkSources(sources.sdi.sources)).catch(() => setDecklinkSources([]))
  }, [outKind])

  const refresh = useCallback(async () => {
    try {
      const [payload, profiles, processReport, healthReport, schedulerReport, n1Report, timelineReport] = await Promise.all([
        api.distribution(),
        api.outputs(channelId),
        api.processes(),
        api.healthEvents(channelId),
        api.schedulerStatus(),
        api.n1Status(),
        api.timeline(channelId),
      ])
      setData(payload)
      setOutputs(profiles.outputs)
      setProcesses(processReport.processes)
      setHealthEvents(healthReport.events)
      setScheduler(schedulerReport.channels.find((entry) => entry.channelId === channelId) ?? null)
      setN1(n1Report)
      setTimeline(timelineReport.items)
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
      onMessage('Qualidade guardada. O canal foi reaplicado com a nova configuração.')
    })
  }

  const channel = data?.channels.find((entry) => entry.channelId === channelId) ?? data?.channels[0]
  const criticalPending = healthEvents.filter((event) => event.severity === 'CRITICAL' && !event.acknowledgedAt).length
  const warnPending = healthEvents.filter((event) => event.severity === 'WARN' && !event.acknowledgedAt).length
  const visibleProcesses = processes.filter((process) =>
    (processKind === 'ALL' || process.kind === processKind) &&
    (processChannel === 'ALL' || process.channelId === channelId || (process.kind === 'MEDIAMTX' && processChannel === 'CURRENT')),
  )
  const visibleHealthEvents = healthEvents.filter((event) => healthFilter === 'ALL' || event.severity === healthFilter)

  /**
   * O tipo que a saída de fato usa.
   *
   * Preview e monitor guardam `RTMP` desde o tempo em que todo mundo saía por
   * RTMP, mas hoje vão por SRT -- é o único caminho daqui até o servidor de
   * mídia que carrega Opus. Mostrar o campo guardado fazia a tela dizer RTMP
   * para uma saída que é SRT.
   */
  const tipoReal = (output: OutputProfile): string => {
    const alvo = output.resolvedTarget ?? ''
    if (alvo.startsWith('srt://')) return 'SRT'
    if (alvo.startsWith('rtmp://')) return 'RTMP'
    return TIPO_LABEL[output.kind] ?? output.kind
  }

  /** A saúde que o engine reporta para esta saída, quando há. */
  const saudeDe = (output: OutputProfile) =>
    channel?.publishers.find((publisher) => publisher.url === output.resolvedTarget) ?? null

  return (
    <div className="backdrop" onClick={onClose}>
      <div className="dialog wide" onClick={(event) => event.stopPropagation()}>
        <header>
          <h2>Saídas do canal</h2>
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

          <div className="field">
            <label>Processos do playout</label>
            <div className="note">Monitores desligados não consomem encoder. O PID e a memória abaixo são lidos do sistema operacional.</div>
            <div className="health-summary">
              <select aria-label="filtrar processos por tipo" value={processKind} onChange={(event) => setProcessKind(event.target.value as typeof processKind)}>
                <option value="ALL">todos os usos</option><option value="ENGINE">engines</option><option value="OUTPUT">saídas RTMP/SRT</option><option value="MEDIAMTX">MediaMTX</option>
              </select>
              <select aria-label="filtrar processos por canal" value={processChannel} onChange={(event) => setProcessChannel(event.target.value as typeof processChannel)}>
                <option value="CURRENT">canal atual</option><option value="ALL">todos os canais</option>
              </select>
            </div>
            <table className="asrun process-table">
              <thead><tr><th>processo</th><th>PID</th><th>estado</th><th className="right">CPU acumulada</th><th className="right">memória</th><th>saídas</th></tr></thead>
              <tbody>
                {visibleProcesses.map((process) => {
                  const publishers = Array.isArray(process.details?.publishers) ? process.details.publishers : []
                  return <tr key={process.id}>
                    <td>{process.kind === 'MEDIAMTX' ? 'MediaMTX' : process.kind === 'ENGINE' ? `Engine ${process.channelId ?? ''}` : `${String((process.details?.transport as string | undefined) ?? 'OUTPUT')} · ${String((process.details?.url as string | undefined) ?? process.id)}`}</td>
                    <td className="mono">{process.pid ?? '—'}</td>
                    <td>{process.state}</td>
                    <td className="right mono">{process.cpuTimeMs === null ? '—' : `${(process.cpuTimeMs / 1000).toFixed(1)} s`}</td>
                    <td className="right mono">{process.memoryBytes === null ? '—' : `${(process.memoryBytes / 1024 / 1024).toFixed(0)} MB`}</td>
                    <td>{publishers.length > 0 ? publishers.map((publisher) => String((publisher as { health?: unknown }).health ?? '')).join(', ') : '—'}</td>
                  </tr>
                })}
                {visibleProcesses.length === 0 && <tr><td colSpan={6} className="dim">nenhum processo corresponde ao filtro</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="field">
            <label>Histórico de saúde deste canal</label>
            {scheduler && <div className="note">Faixa ativa: <b>{scheduler.activeRule?.name ?? 'nenhuma'}</b> · grade termina em aproximadamente <b>{scheduler.minutesRemaining} min</b> · cobertura {scheduler.coverageHours} h.</div>}
            {n1?.configured && <div className="note">Peer N+1: <span className={`pill ${n1.reachable ? 'ok' : 'bad'}`}>{n1.reachable ? 'alcançável' : 'indisponível'}</span>{n1.latencyMs != null && ` · ${n1.latencyMs} ms`}{n1.error && ` · ${n1.error}`}</div>}
            {timeline.length > 0 && <div className="timeline-strip" aria-label="timeline operacional">
              {timeline.slice(0, 12).map((item) => <span key={item.itemId} className={`timeline-chip ${item.state === 'ON_AIR' ? 'active' : ''}`} title={`${item.title} · ${item.state}`}>{item.state === 'ON_AIR' ? '● ' : ''}{item.title}</span>)}
            </div>}
            <a className="btn small" href={`/api/health-events.csv?channelId=${encodeURIComponent(channelId)}`} download>baixar CSV de saúde</a>
            <div className="health-summary"><span className="pill bad">críticos pendentes: {criticalPending}</span><span className="pill warn">atenção pendente: {warnPending}</span><select value={healthFilter} onChange={(event) => setHealthFilter(event.target.value as typeof healthFilter)}><option value="ALL">todos os níveis</option><option value="CRITICAL">somente críticos</option><option value="WARN">somente atenção</option></select></div>
            <table className="asrun process-table"><thead><tr><th>horário</th><th>componente</th><th>severidade</th><th>estado</th><th>mensagem</th></tr></thead><tbody>
              {visibleHealthEvents.slice(0, 30).map((event) => <tr key={event.id}><td className="mono">{event.occurredAt.replace('T', ' ').slice(0, 19)}</td><td>{event.component}</td><td className={event.severity === 'CRITICAL' ? 'bad' : event.severity === 'WARN' ? 'warn' : 'ok'}>{event.severity}</td><td>{event.state}</td><td>{event.message ?? '—'} {event.acknowledgedAt ? <span className="pill">RECONHECIDO</span> : <button className="btn small" onClick={() => void api.acknowledgeHealth(event.id).then(refresh)}>reconhecer</button>}</td></tr>)}
              {healthEvents.length === 0 && <tr><td colSpan={5} className="dim">nenhum evento registrado</td></tr>}
            </tbody></table>
          </div>

          {/* ---- perfis de saída ---- */}
          <div className="field">
            <label>Perfis de saída</label>
            <div className="rows">
              {outputs.map((output) => {
                const saude = saudeDe(output)
                return (
                <div key={output.id} className="row-item">
                  <div>
                    <div className="t">
                      {output.name}
                      <span className="pill">{tipoReal(output)}</span>
                      {output.role !== 'EXTRA' && <span className="pill">do sistema</span>}
                      {!output.enabled && <span className="pill bad">desligada</span>}
                      {/* A saúde vinha numa seção à parte, e a mesma saída
                          aparecia duas vezes na tela: uma com o que ela é,
                          outra com como ela está. Quem opera precisa das duas
                          juntas -- é olhando para a saída que se pergunta se
                          ela está no ar. */}
                      {saude && (
                        <span className={`pill ${PUBLISHER_TONE[saude.health]}`}>
                          {PUBLISHER_LABEL[saude.health]}
                        </span>
                      )}
                    </div>
                    <div className="d mono">{output.resolvedTarget ?? '(sem destino)'}</div>
                    <div className="d">{profileSummary(output)}</div>
                    {saude && (
                      <div className="d">
                        {saude.delivered > 0
                          ? `${saude.delivered.toLocaleString('pt-BR')} pacotes entregues`
                          : 'nada entregue ainda'}
                        {saude.attempts > 1 && ` · ${saude.attempts} tentativas`}
                        {saude.error && ` · ${saude.error}`}
                      </div>
                    )}
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
                              onMessage('Qualidade no automático. O canal foi reaplicado.')
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
                          onMessage(output.enabled ? 'Saída desligada e canal atualizado.' : 'Saída ligada e canal atualizado.')
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
                )
              })}
            </div>
            {/* Mexer no conjunto de saídas de um pipeline que está no ar é o
                tipo de cirurgia que este projeto já pagou caro para evitar. */}
            {/* Dizer que a mudança só vale no próximo início e não oferecer
                como fazer é o que deixava o operador ligando o preview e
                olhando a tela preta sem ter o que clicar. */}
            <div className="note reiniciar">
              <span>
                Mudança em perfil de saída só vale quando o canal sobe de novo — ligar aqui
                não põe a saída no ar sozinho.
              </span>
              <button
                className="btn small"
                disabled={reiniciando}
                title="O canal sai do ar por um instante"
                onClick={() => {
                  if (!channelId) return
                  if (!window.confirm('Levantar o canal de novo? Ele sai do ar por um instante.'))
                    return
                  setReiniciando(true)
                  void api
                    .restartChannel(channelId)
                    .then(() => onMessage('Canal levantado de novo com os perfis de agora.'))
                    .catch((falha: Error) => onMessage(falha.message))
                    .finally(() => setReiniciando(false))
                }}
              >
                {reiniciando ? 'LEVANTANDO…' : 'LEVANTAR O CANAL'}
              </button>
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
                <option value="SDI">SDI / Decklink (placa)</option>
              </select>
              {outKind === 'SDI' ? (
                <select value={outTarget} onChange={(event) => setOutTarget(event.target.value)} aria-label="placa e conector DeckLink">
                  <option value="">selecione a placa/conector</option>
                  {decklinkSources.map((source) => <option key={source.reference} value={source.reference.replace(/^sdi:/i, '')}>{source.label} ({source.reference})</option>)}
                </select>
              ) : outKind === 'FILE' ? (
                <div className="file-picker-inline">
                  <input type="text" value={outTarget} readOnly placeholder="nenhum arquivo selecionado" />
                  <button className="btn small" onClick={() => void api.pickFile().then((path) => path && setOutTarget(path)).catch((failure: Error) => onMessage(failure.message))}>EXPLORAR…</button>
                </div>
              ) : (
                <input
                  type="text"
                  placeholder="rtmp://..."
                  value={outTarget}
                  onChange={(event) => setOutTarget(event.target.value)}
                />
              )}
              {outKind === 'SDI' && decklinkSources.length === 0 && <div className="sub bad">Nenhuma placa DeckLink disponível. Instale o driver Blackmagic e o plugin DeckLink do GStreamer.</div>}
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
                    onMessage('Saída criada e aplicada ao canal.')
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
                          <span className="pill">{relay.transport}{relay.transport === 'SRT' ? ` · ${relay.mode}` : ''}</span>
                          {relay.latencyMs != null && ` · latência ${relay.latencyMs} ms`}
                          {relay.rttMs != null && ` · RTT ${relay.rttMs} ms`}
                          {relay.lossPct != null && ` · perda ${relay.lossPct.toFixed(1)}%`}
                          {relay.bitrateKbps != null && ` · ${relay.bitrateKbps.toLocaleString('pt-BR')} kbps`}
                          {` · ${relay.primary ? 'primário' : `backup de ${relay.backupFor ?? '—'}`}`}
                        </div>
                      )}
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
                    let destination = destUrl.trim()
                    if (destination.toLowerCase().startsWith('srt://')) {
                      const url = new URL(destination)
                      url.searchParams.set('mode', srtMode)
                      if (srtLatency.trim() !== '') url.searchParams.set('latency', srtLatency.trim())
                      if (srtStreamId.trim() !== '') url.searchParams.set('streamid', srtStreamId.trim())
                      if (srtPassphrase.trim() !== '') url.searchParams.set('passphrase', srtPassphrase.trim())
                      destination = url.toString()
                    }
                    await api.addDestination(channelId, destName.trim(), destination)
                    setDestName('')
                    setDestUrl('')
                    setSrtStreamId('')
                    setSrtPassphrase('')
                    onMessage('Destino criado. O relay começa a entregar em alguns segundos.')
                  })
                }
              >
                adicionar
              </button>
            </div>
            {destUrl.trim().toLowerCase().startsWith('srt://') && (
              <details className="field compact" open>
                <summary>opções SRT</summary>
                <div className="inline">
                  <select value={srtMode} onChange={(event) => setSrtMode(event.target.value as typeof srtMode)} aria-label="modo SRT">
                    <option value="caller">caller</option><option value="listener">listener</option><option value="rendezvous">rendezvous</option>
                  </select>
                  <input value={srtLatency} onChange={(event) => setSrtLatency(event.target.value)} placeholder="latência ms" aria-label="latência SRT" />
                  <input value={srtStreamId} onChange={(event) => setSrtStreamId(event.target.value)} placeholder="streamid (opcional)" aria-label="streamid SRT" />
                  <input type="password" value={srtPassphrase} onChange={(event) => setSrtPassphrase(event.target.value)} placeholder="passphrase (opcional)" aria-label="passphrase SRT" />
                </div>
              </details>
            )}
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
