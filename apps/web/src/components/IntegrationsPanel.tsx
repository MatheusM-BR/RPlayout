import { useEffect, useRef, useState } from 'react'
import { api } from '../api.js'

export function IntegrationsPanel({ channelId, onMessage }: { channelId: string; onMessage: (text: string) => void }) {
  const [items, setItems] = useState<Awaited<ReturnType<typeof api.integrations>>['integrations']>([])
  const [deliveries,setDeliveries] = useState<Awaited<ReturnType<typeof api.integrationDeliveries>>['deliveries']>([])
  const [error,setError] = useState<string|null>(null)
  const [busy,setBusy] = useState(false)
  const [name, setName] = useState(''); const [url, setUrl] = useState('')
  const [events, setEvents] = useState('asrun.started,asrun.ended,operational-playlist.published,editorial-playlist.imported,engine.error,scheduler.degraded,source.lost,source.failed,host.degraded')
  const generation = useRef(0)
  const reload = async (expected: number) => {
    const [configuration,queue] = await Promise.all([api.integrations(channelId),api.integrationDeliveries(channelId)])
    if (generation.current !== expected) return
    setItems(configuration.integrations);setDeliveries(queue.deliveries);setError(null)
  }
  useEffect(() => {
    let cancelled = false
    ++generation.current
    setItems([]);setDeliveries([]);setError(null);setBusy(false);setName('');setUrl('')
    const refresh = async () => {
      try {
        const [configuration,queue] = await Promise.all([api.integrations(channelId),api.integrationDeliveries(channelId)])
        if (!cancelled) {setItems(configuration.integrations);setDeliveries(queue.deliveries);setError(null)}
      } catch (error) {if (!cancelled) setError(error instanceof Error ? error.message : 'Entregas indisponíveis.')}
    }
    void refresh()
    const timer = setInterval(() => {void refresh()},5000)
    return () => {cancelled=true;++generation.current;clearInterval(timer)}
  },[channelId])
  const perform = async (work:() => Promise<unknown>,message:string,resetForm=false) => {
    if (busy) return
    const expected = generation.current
    setBusy(true)
    try {
      await work()
      if (generation.current !== expected) return
      if (resetForm) {setName('');setUrl('')}
      await reload(expected)
      if (generation.current === expected) onMessage(message)
    }
    catch (error) {if (generation.current === expected) onMessage(error instanceof Error ? error.message : 'Operação recusada.')}
    finally {if (generation.current === expected) setBusy(false)}
  }
  const labels = {QUEUED:'AGENDADA',SENDING:'ENVIANDO',DELIVERED:'CONFIRMADA',FAILED:'FALHOU',CANCELLED:'CANCELADA'}
  return <div className="field">
    <label>Gateways e alertas externos</label>
    <p className="detalhe">Fila persistente: reenvio automático com espera progressiva, até 8 tentativas. O destinatário deve deduplicar pelo identificador de entrega. Senhas e caminhos de webhook não aparecem na tela.</p>
    <p className="detalhe">Eventos: asrun.started, asrun.ended, operational-playlist.published, editorial-playlist.imported, engine.error, output.retrying, scheduler.degraded, source.lost, source.failed, source.on_pgm, host.degraded, host.running. Importar altera somente a grade editorial; a publicação operacional tem evento separado. Assinaturas antigas de playlist.published/playlist.inserted devem ser revisadas.</p>
    {error && <p role="alert" className="text-on-air-crimson">{error}</p>}
    <ul className="canais">{items.map(item => <li key={item.id}>
      <div className="quem"><div className="nome">{item.name} <span className="pill">{item.enabled ? 'ATIVO':'DESLIGADO'}</span></div><div className="detalhe mono">{item.url} · {item.events.join(', ')}</div></div>
      <button className="btn small" disabled={busy} onClick={() => void perform(() => api.patchIntegration(item.id,{enabled:!item.enabled}),'Integração atualizada.')}>{item.enabled ? 'desativar':'ativar'}</button>
      <button className="btn small" disabled={busy} onClick={() => void perform(async () => {const result=await api.testIntegration(item.id);if (!result.ok) throw new Error(result.error ?? 'Gateway recusou o teste HTTP '+result.status)},'Gateway respondeu ao teste.')}>testar</button>
    </li>)}</ul>
    <div className="pastas-add">
      <input aria-label="Nome do gateway" placeholder="nome" value={name} onChange={event => setName(event.target.value)}/>
      <input aria-label="URL privada do gateway" placeholder="https://gateway/eventos" value={url} onChange={event => setUrl(event.target.value)}/>
      <input aria-label="Eventos do gateway" placeholder="engine.error,source.lost,host.degraded" value={events} onChange={event => setEvents(event.target.value)}/>
      <button className="btn small" disabled={busy || !name || !url} onClick={() => void perform(() => api.addIntegration({channelId,name,url,events:events.split(',').map(value=>value.trim()).filter(Boolean)}),'Gateway cadastrado desligado; ative quando estiver configurado.',true)}>ADICIONAR</button>
    </div>
    <h3 className="mt-4">Últimas 100 entregas deste canal</h3>
    {!error && deliveries.length === 0 && <p className="detalhe">Nenhuma entrega registrada. Cadastre e ative um gateway com os eventos desejados.</p>}
    <ul className="canais">{deliveries.map(delivery => <li key={delivery.id}>
      <div className="quem"><div className="nome">{delivery.event} · {labels[delivery.state]}</div>
        <div className="detalhe">{new Date(delivery.createdAt).toLocaleString()} · {delivery.attempts} tentativa(s){delivery.state==='QUEUED' ? ' · próximo envio '+new Date(delivery.nextAttemptAt).toLocaleTimeString():''}</div>
        <div className="detalhe mono">{delivery.id}</div>{delivery.lastError && <div className="detalhe text-on-air-crimson">{delivery.lastError}</div>}
      </div>
      {['FAILED','CANCELLED'].includes(delivery.state) && <button className="btn small" disabled={busy} onClick={() => void perform(() => api.retryIntegrationDelivery(delivery.id),'Reenvio agendado; confirmação depende da resposta do gateway.')}>reenviar</button>}
    </li>)}</ul>
  </div>
}
