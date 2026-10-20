import { useEffect, useRef, useState } from 'react'
import { api } from '../api.js'
import type {IntegrationCatalogReview,IntegrationDeliveryReview} from '@rplayout/protocol'
import {IntegrationEditor} from './IntegrationEditor.js'
import {IntegrationDeliveryStatus} from './IntegrationDeliveryStatus.js'
import {BoundedLatestRead} from '../domain/bounded-latest-read.js'
import {ReviewedOperationConfirm} from './broadcast/ReviewedOperationConfirm.js'

export function IntegrationsPanel({ channelId, onMessage }: { channelId: string; onMessage: (text: string) => void }) {
  const [items, setItems] = useState<Awaited<ReturnType<typeof api.integrations>>['integrations']>([])
  const [deliveries,setDeliveries] = useState<Awaited<ReturnType<typeof api.integrationDeliveries>>['deliveries']>([])
  const [error,setError] = useState<string|null>(null)
  const [busy,setBusy] = useState(false)
  const busyRef = useRef(false)
  const [name, setName] = useState(''); const [url, setUrl] = useState('')
  const [events, setEvents] = useState('asrun.started,asrun.ended,operational-playlist.published,editorial-playlist.imported,engine.error,scheduler.degraded,source.lost,source.failed,host.degraded')
  const generation = useRef(0)
  const listReads=useRef(new BoundedLatestRead()),reviewReads=useRef(new BoundedLatestRead())
  const [editing,setEditing]=useState<string|null>(null),[catalog,setCatalog]=useState<IntegrationCatalogReview|null>(null),[deliveryReview,setDeliveryReview]=useState<IntegrationDeliveryReview|null>(null),[loaded,setLoaded]=useState(false)
  const reload = async (expected: number,replace=true) => {
    const reading=await listReads.current.read(signal=>Promise.all([api.integrations(channelId,signal),api.integrationDeliveries(channelId,signal)]),'A consulta de gateways/fila demorou demais. A lista anterior foi preservada; resposta do gateway não confirmada.',replace)
    if (!reading.current||generation.current !== expected) return
    const [configuration,queue]=reading.value
    setItems(configuration.integrations);setDeliveries(queue.deliveries);setError(null);setLoaded(true)
  }
  useEffect(() => {
    let cancelled = false
    ++generation.current
    const expected=generation.current
    setItems([]);setDeliveries([]);setError(null);setBusy(false);busyRef.current=false;setName('');setUrl('')
    setCatalog(null);setEditing(null);setDeliveryReview(null);setLoaded(false)
    const refresh = async () => {
      try {
        if(busyRef.current)return
        await reload(expected,false)
      } catch (error) {if (!cancelled) setError(error instanceof Error ? error.message : 'Entregas indisponíveis.')}
    }
    void refresh()
    const timer = setInterval(() => {void refresh()},5000)
    return () => {cancelled=true;++generation.current;clearInterval(timer);listReads.current.cancel();reviewReads.current.cancel()}
  },[channelId])
  const perform = async (work:(expected:number) => Promise<unknown>,message:string,resetForm=false,mutation=false) => {
    if (busyRef.current) return
    const expected = generation.current
    busyRef.current=true
    setBusy(true)
    try {
      await work(expected)
      if (generation.current !== expected) return
      if (resetForm) {setName('');setUrl('')}
      onMessage(message)
      try {await reload(expected)}
      catch (error) {if (generation.current === expected) setError((mutation?'Operação confirmada, mas a lista não pôde ser atualizada. Não repita o comando. ':'Conferência obtida, mas a lista não pôde ser atualizada. Nenhuma gravação foi enviada. ')+(error instanceof Error ? error.message : 'Consulta indisponível.'))}
    }
    catch (error) {if (generation.current === expected){setCatalog(null);setDeliveryReview(null);onMessage(error instanceof Error ? error.message : 'Operação recusada.')}}
    finally {if (generation.current === expected) {busyRef.current=false;setBusy(false)}}
  }
  const inspectCatalog=async(expected:number)=>{
    const reading=await reviewReads.current.read(signal=>api.integrationCatalogReview(channelId,signal),'A conferência do catálogo demorou demais. Nenhum gateway foi cadastrado; confira novamente.')
    if(!reading.current||generation.current!==expected)return
    if(reading.value.channelId!==channelId)throw new Error('Conferência de outro canal.')
    setCatalog(reading.value)
  }
  const inspectDelivery=async(id:string,expected:number)=>{
    const reading=await reviewReads.current.read(signal=>api.integrationDeliveryReview(id,signal),'A conferência da entrega demorou demais. Nenhum reenvio foi registrado; confira novamente.')
    if(!reading.current||generation.current!==expected)return
    if(reading.value.id!==id||reading.value.channelId!==channelId)throw new Error('Conferência de outra entrega ou canal recusada.')
    setDeliveryReview(reading.value)
  }
  return <div className="field">
    <label>Gateways e alertas externos</label>
    <p className="detalhe">Fila persistente: reenvio automático com espera progressiva, até 8 tentativas. O destinatário deve deduplicar pelo identificador de entrega. Senhas e caminhos de webhook não aparecem na tela.</p>
    <p className="detalhe">Eventos: asrun.started, asrun.ended, operational-playlist.published, editorial-playlist.imported, engine.error, output.retrying, scheduler.degraded, source.lost, source.failed, source.on_pgm, host.degraded, host.running. Alarmes do PGM: signal.black, signal.freeze, signal.silence; recuperação medida: signal.black_recovered, signal.freeze_recovered, signal.silence_recovered. Fim da observação, sem confirmar recuperação: signal.black_unobserved, signal.freeze_unobserved, signal.silence_unobserved. A assinatura signal.recovered mantém a recuperação de silêncio anterior. Importar altera somente a grade editorial; a publicação operacional tem evento separado. Assinaturas antigas de playlist.published/playlist.inserted devem ser revisadas.</p>
    {error && <p role="alert" className="text-on-air-crimson">{error}</p>}
    <ul className="canais">{items.map(item => <li key={item.id}>
      <div className="quem"><div className="nome">{item.name} <span className="pill">{item.enabled ? 'ATIVO':'DESLIGADO'}</span></div><div className="detalhe mono">{item.url} · {item.events.join(', ')}</div></div>
      <button className="btn small" disabled={busy} onClick={() => setEditing(item.id)}>Conferir / editar / testar</button>
    </li>)}</ul>
    <div className="pastas-add">
      <input aria-label="Nome do gateway" placeholder="nome" value={name} onChange={event => setName(event.target.value)}/>
      <input aria-label="URL privada do gateway" placeholder="https://gateway/eventos" value={url} onChange={event => setUrl(event.target.value)}/>
      <input aria-label="Eventos do gateway" placeholder="engine.error,source.lost,host.degraded" value={events} onChange={event => setEvents(event.target.value)}/>
      <button className="btn small" disabled={busy} onClick={()=>void perform(inspectCatalog,'Catálogo conferido. Cadastre para este canal; mudanças posteriores serão recusadas.')}>CONFERIR CADASTRO</button>
      <button className="btn small" disabled={busy || !name || !url||!catalog?.canEdit} onClick={() => void perform(async expected=>{await api.addIntegration({channelId,name,url,events:events.split(',').map(value=>value.trim()).filter(Boolean)},catalog!);if(generation.current===expected)setCatalog(null)},'Gateway cadastrado desligado; ative após conferir.',true,true)}>ADICIONAR CONFERIDO</button>
    </div>
    <h3 className="mt-4">Últimas 100 entregas deste canal</h3>
    {!loaded&&<p role="status">Fila ainda não consultada; não é confirmação de fila vazia.</p>}
    {loaded&&!error && deliveries.length === 0 && <p className="detalhe">Nenhuma entrega registrada. Cadastre e ative um gateway com os eventos desejados.</p>}
    <ul className="canais">{deliveries.map(delivery => <li key={delivery.id}>
      <div className="quem"><div className="nome">{delivery.event} · <IntegrationDeliveryStatus delivery={delivery}/></div>
        <div className="detalhe">{new Date(delivery.createdAt).toLocaleString()} · {delivery.attempts} tentativa(s){delivery.state==='QUEUED' ? ' · próximo envio '+new Date(delivery.nextAttemptAt).toLocaleTimeString():''}</div>
        <div className="detalhe mono">{delivery.id}</div>{delivery.lastError && <div className="detalhe text-on-air-crimson">{delivery.lastError}</div>}
      </div>
      <button className="btn small" disabled={busy} onClick={() => void perform(expected=>inspectDelivery(delivery.id,expected),'Estado conferido; consulte diagnóstico e autorização abaixo.')}>conferir estado / reenvio</button>
    </li>)}</ul>
    {deliveryReview&&<section aria-label="Conferência do reenvio"><p>{deliveryReview.id} · {deliveryReview.state} · {deliveryReview.attempts} tentativa(s). Destino original preservado.</p>
      <p role="status">{deliveryReview.diagnostic.message}</p>
      <ReviewedOperationConfirm reviewKey={JSON.stringify([deliveryReview.id,deliveryReview.revision,deliveryReview.configurationRevision,deliveryReview.state,deliveryReview.requiresOwnerConfirmation])}
        disabled={busy||!deliveryReview.canRetry}
        confirmation={deliveryReview.requiresOwnerConfirmation?'Verifiquei que a instância anterior encerrou e autorizo o reenvio desta entrega. Pode repetir um POST; o gateway deve deduplicar pelo ID.':'Autorizo o reenvio desta entrega conferida. O gateway deve deduplicar pelo ID; registro não comprova resposta.'}
        label="Confirmar reenvio conferido" onConfirm={async()=>{const review=deliveryReview;await perform(async expected=>{await api.retryIntegrationDelivery(review.id,review,review.requiresOwnerConfirmation);if(generation.current===expected)setDeliveryReview(null)},'Reenvio registrado, ainda não confirmado pelo gateway.',false,true)}}/>
      <button disabled={busy} onClick={()=>setDeliveryReview(null)}>Fechar conferência do reenvio</button></section>}
    {editing&&<IntegrationEditor key={editing} id={editing} onClose={()=>setEditing(null)} onSaved={message=>{const expected=generation.current;setEditing(null);onMessage(message);void reload(expected).catch(cause=>{if(generation.current===expected)setError('Operação confirmada, mas a lista não pôde ser atualizada. Não repita o comando. '+String(cause))})}}/>}
  </div>
}
