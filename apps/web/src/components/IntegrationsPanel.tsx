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
  // Padrão: o recomendado para Telegram (alertas críticos e lembretes sem ciente).
  const [selected, setSelected] = useState<string[]>(TELEGRAM_EVENTS)
  const [extraEvents, setExtraEvents] = useState('')
  const events = [...selected, ...extraEvents.split(',').map(value => value.trim()).filter(Boolean)].join(',')
  const isTelegram = /api\.telegram\.org\/bot/i.test(url)
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
    <label>Alertas externos (Telegram ou webhook)</label>
    <p className="detalhe">Cada evento escolhido vira uma mensagem. Fila persistente com até 8 tentativas; a URL privada não volta para a tela depois de salva.</p>
    {error && <p role="alert" className="text-on-air-crimson">{error}</p>}
    <ul className="canais">{items.map(item => <li key={item.id}>
      <div className="quem"><div className="nome">{item.name} <span className="pill">{item.enabled ? 'ATIVO':'DESLIGADO'}</span></div><div className="detalhe mono">{item.url} · {item.events.join(', ')}</div></div>
      <button className="btn small" disabled={busy} onClick={() => setEditing(item.id)}>Conferir / editar / testar</button>
    </li>)}</ul>
    <section className="mt-3 grid gap-3 rounded-lg border border-border-subtle bg-surface-panel p-3" aria-label="Novo destino de alertas">
      <h3 className="font-label-caps text-[12px] font-bold">NOVO DESTINO</h3>
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <label className="grid gap-1 text-[12px] text-outline">Nome
          <input className="w-full rounded border border-border-subtle bg-surface-container px-2 py-1.5 text-[13px] text-on-surface" aria-label="Nome do gateway" placeholder="ex.: Telegram MCR" value={name} onChange={event => setName(event.target.value)}/>
        </label>
        <label className="grid gap-1 text-[12px] text-outline">URL privada
          <input className="w-full rounded border border-border-subtle bg-surface-container px-2 py-1.5 text-[13px] text-on-surface" aria-label="URL privada do gateway" placeholder="https://api.telegram.org/bot<TOKEN>/sendMessage?chat_id=<ID>" value={url} onChange={event => setUrl(event.target.value)}/>
          <span className="text-[11px]">{isTelegram ? 'Telegram reconhecido: a mensagem sai em texto legível.' : 'Telegram: https://api.telegram.org/bot<TOKEN>/sendMessage?chat_id=<ID>. Outros: webhook que aceite POST JSON.'}</span>
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[12px]">
        <span className="text-outline">Atalhos:</span>
        <button type="button" className="btn small" onClick={() => setSelected(TELEGRAM_EVENTS)}>Só alertas (recomendado)</button>
        <button type="button" className="btn small" onClick={() => setSelected(EVENT_GROUPS.flatMap(group => group.events.filter(entry => entry.common).map(entry => entry.id)))}>Alertas + operação</button>
        <button type="button" className="btn small" onClick={() => setSelected([])}>Limpar</button>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {EVENT_GROUPS.map(group => <fieldset key={group.title} className="rounded border border-border-subtle p-2">
          <legend className="px-1 font-label-caps text-[11px] font-bold text-outline">{group.title}</legend>
          {group.events.map(entry => <label key={entry.id} className="flex items-start gap-2 py-0.5 text-[12px]" title={entry.id}>
            <input type="checkbox" checked={selected.includes(entry.id)} onChange={event => setSelected(current => event.target.checked ? [...current, entry.id] : current.filter(value => value !== entry.id))}/>
            <span>{entry.label}</span>
          </label>)}
        </fieldset>)}
      </div>
      <label className="grid gap-1 text-[12px] text-outline">Outros eventos (separados por vírgula, opcional)
        <input className="w-full rounded border border-border-subtle bg-surface-container px-2 py-1.5 text-[13px] text-on-surface" aria-label="Eventos do gateway" placeholder="ex.: signal.black_unobserved" value={extraEvents} onChange={event => setExtraEvents(event.target.value)}/>
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn small" disabled={busy} onClick={()=>void perform(inspectCatalog,'Catálogo conferido. Cadastre para este canal; mudanças posteriores serão recusadas.')}>1. CONFERIR</button>
        <button className="btn small primary" disabled={busy || !name || !url||!catalog?.canEdit||!events} onClick={() => void perform(async expected=>{await api.addIntegration({channelId,name,url,events:events.split(',').map(value=>value.trim()).filter(Boolean)},catalog!);if(generation.current===expected)setCatalog(null)},'Destino cadastrado desligado: use "Conferir / editar / testar" para enviar um teste e ativar.',true,true)}>2. CADASTRAR</button>
        <span className="text-[11px] text-outline">{selected.length + extraEvents.split(',').filter(value => value.trim()).length} evento(s). Entra desligado; teste e ative na lista acima.</span>
      </div>
    </section>
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

const TELEGRAM_EVENTS = ['alert.critical', 'alert.reminder']
const EVENT_GROUPS: Array<{ title: string; events: Array<{ id: string; label: string; common?: boolean }> }> = [
  { title: 'Alertas', events: [
    { id: 'alert.critical', label: 'Incidente crítico novo', common: true },
    { id: 'alert.reminder', label: 'Lembrete: crítico sem ciente (2 em 2 min)', common: true },
    { id: 'alert.escalated', label: 'Escalado: PGM sem ciente sobe para supervisor/gestor', common: true },
    { id: 'alert.warning', label: 'Aviso (inclui CPU alta em builds; ruidoso)' },
  ] },
  { title: 'Sinal do PGM', events: [
    { id: 'signal.black', label: 'Tela preta', common: true },
    { id: 'signal.freeze', label: 'Imagem congelada', common: true },
    { id: 'signal.silence', label: 'Silêncio', common: true },
    { id: 'signal.black_recovered', label: 'Tela preta recuperada' },
    { id: 'signal.freeze_recovered', label: 'Congelamento recuperado' },
    { id: 'signal.silence_recovered', label: 'Silêncio recuperado' },
  ] },
  { title: 'Engine, saídas e servidor', events: [
    { id: 'engine.error', label: 'Erro do engine', common: true },
    { id: 'output.retrying', label: 'Saída reconectando', common: true },
    { id: 'host.degraded', label: 'Servidor degradado' },
    { id: 'host.running', label: 'Servidor voltou' },
    { id: 'clock.drift', label: 'Relógio do servidor fora do NTP / não verificado / saltou', common: true },
    { id: 'clock.recovered', label: 'Relógio do servidor normalizado' },
  ] },
  { title: 'Fontes ao vivo', events: [
    { id: 'source.lost', label: 'Fonte perdida', common: true },
    { id: 'source.failed', label: 'Fonte falhou' },
    { id: 'source.on_pgm', label: 'Fonte entrou no PGM' },
  ] },
  { title: 'Grade e veiculação', events: [
    { id: 'scheduler.degraded', label: 'Agendador degradado', common: true },
    { id: 'operational-playlist.published', label: 'Grade publicada' },
    { id: 'editorial-playlist.imported', label: 'Grade importada (editorial)' },
    { id: 'asrun.started', label: 'Item entrou no ar' },
    { id: 'asrun.ended', label: 'Item saiu do ar' },
  ] },
]
