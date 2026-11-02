import {useEffect,useRef,useState} from 'react'
import {api,type HaExecutionObservation,type HaMonitorRequest,type HaMonitorReport} from '../../api.js'
import {haMonitorStorageKey,monitorKey,newHaMonitorId,readPendingHaMonitors,type PendingHaMonitor} from '../../domain/ha-monitor-pending.js'
import {Whep} from '../Whep.js'
import {HaControlPanel} from './HaControlPanel.js'
import {HaStopPanel} from './HaStopPanel.js'
import {HaReturnPanel} from './HaReturnPanel.js'

export function HaExecutionPanel(){
  const [channels,setChannels]=useState<Array<{id:string;name:string}>>([]),[channelId,setChannelId]=useState(''),[rows,setRows]=useState<HaExecutionObservation[]>([]),[error,setError]=useState<string|null>(null)
  const [monitorError,setMonitorError]=useState<string|null>(null),[pending,setPending]=useState<Record<string,PendingHaMonitor>>({}),[monitorBusy,setMonitorBusy]=useState(false)
  const [reviews,setReviews]=useState<Record<string,HaMonitorReport>>({})
  const [viewing,setViewing]=useState<{promotionId:string;bus:'pvw'|'mon'}|null>(null)
  const pendingRef=useRef<Record<string,PendingHaMonitor>>({}),busyRef=useRef(false),storageReady=useRef(false),mounted=useRef(true)
  useEffect(()=>{mounted.current=true;try{const restored=readPendingHaMonitors(window.sessionStorage.getItem(haMonitorStorageKey));pendingRef.current=restored;setPending(restored);storageReady.current=true}catch{setMonitorError('Diário local indisponível. Comandos bloqueados para não perder pedidos incertos.')}return()=>{mounted.current=false}},[])
  const remember=(entry:PendingHaMonitor)=>{
    const next={...pendingRef.current,[monitorKey(entry.request)]:entry}
    window.sessionStorage.setItem(haMonitorStorageKey,JSON.stringify(next));pendingRef.current=next;if(mounted.current)setPending(next)
  }
  const accept=(request:HaMonitorRequest,report:HaMonitorReport)=>{
    if(JSON.stringify(report.request)!==JSON.stringify(request)||!['ACCEPTED','SENDING','CONFIRMED','REFUSED','UNCERTAIN'].includes(report.phase))throw new Error('Resposta de outro pedido de monitor.')
    remember({request,phase:report.phase,...(report.resolvedBy?{resolvedBy:report.resolvedBy}:{})})
    if(mounted.current)setReviews(current=>({...current,[monitorKey(request)]:report}))
  }
  const monitor=async(row:HaExecutionObservation,bus:'pvw'|'mon',on:boolean,review?:HaMonitorReport)=>{
    if(busyRef.current||!storageReady.current)return
    const key=monitorKey({channelId:row.channelId,promotionId:row.requestId,bus}),saved=pendingRef.current[key]
    if(review&&(!saved||review.request.requestId!==saved.request.requestId||!review.canReconcile||!review.reviewToken||review.resolvedBy))return
    if(!review&&saved&&!saved.resolvedBy&&!['CONFIRMED','REFUSED'].includes(saved.phase))return
    busyRef.current=true;setMonitorBusy(true);setMonitorError(null)
    try{
      const request:HaMonitorRequest={requestId:newHaMonitorId(),channelId:row.channelId,promotionId:row.requestId,bus,on,...(review?{supersedesRequestId:review.request.requestId,reviewToken:review.reviewToken!}:{})}
      remember({request,phase:'UNKNOWN'})
      accept(request,await api.haMonitor(request))
    }catch{if(mounted.current)setMonitorError('Monitor não confirmado. Consulte o pedido salvo; não foi criada uma repetição automática.')}
    finally{busyRef.current=false;if(mounted.current)setMonitorBusy(false)}
  }
  const queryMonitor=async(entry:PendingHaMonitor)=>{
    if(busyRef.current)return;busyRef.current=true;setMonitorBusy(true);setMonitorError(null)
    try{accept(entry.request,await api.haMonitorQuery(entry.request.requestId,entry.request.channelId))}
    catch{if(mounted.current)setMonitorError('Consulta indisponível. Pedido preservado; nenhum comando foi reenviado.')}
    finally{busyRef.current=false;if(mounted.current)setMonitorBusy(false)}
  }
  useEffect(()=>{let active=true;void api.haBindingChannels().then(result=>{if(active){setChannels(result.channels);setChannelId(result.channels[0]?.id??'')}}).catch(()=>{if(active)setError('Consulta disponível somente para administrador autorizado.')});return()=>{active=false}},[])
  useEffect(()=>{
    let active=true,busy=false;setRows([])
    if(!channelId)return
    const refresh=async()=>{
      if(busy)return;busy=true
      try{const result=await api.haExecutionObservations(channelId);if(active){setRows(result.executions);setError(null)}}catch{if(active)setError('Não foi possível atualizar a execução. Os dados exibidos podem estar desatualizados.')}finally{busy=false}
    }
    void refresh();const timer=window.setInterval(()=>void refresh(),5000)
    return()=>{active=false;window.clearInterval(timer)}
  },[channelId])
  const labels={CHECKING:'Conferindo',PREPARING:'Preparando',TRANSFERRING:'Transferindo autoridade',ACTIVATING:'Ativando',CONFIRMED:'Confirmada no histórico',REFUSED:'Recusada',UNCERTAIN:'Resultado incerto'}
  return <section aria-label="Execuções da reserva" className="border border-border-subtle rounded p-3 space-y-2">
    <h3 className="font-semibold text-sm">Execuções da reserva</h3>
    <label className="text-xs block">Canal <select aria-label="Canal da execução HA" value={channelId} onChange={event=>setChannelId(event.target.value)} className="bg-surface-panel border border-border-subtle rounded p-1 ml-2"><option value="">Selecione</option>{channels.map(channel=><option key={channel.id} value={channel.id}>{channel.name}</option>)}</select></label>
    {error&&<p role="alert" className="text-xs text-armed-amber">{error}</p>}
    {monitorError&&<p role="alert" className="text-xs text-armed-amber">{monitorError}</p>}
    {channelId&&!rows.length&&!error&&<p className="text-xs">Nenhuma promoção registrada neste canal.</p>}
    {rows.map(row=><div key={row.requestId} className="text-xs border-t border-border-subtle pt-2 space-y-1">
      <p>{labels[row.phase]} · {row.localObservation==='RUNNING_LOCAL'?'engine local marcado como pronto':row.localObservation==='NOT_READY_LOCAL'?'engine local não está pronto':row.localObservation==='NOT_OWNED_HERE'?'execução não pertence a este servidor':'sem engine rastreado'}</p>
      {row.localObservation==='RUNNING_LOCAL'&&<p>{row.programOutputsHeld?'Saídas ainda retidas':'Saídas liberadas no engine'} · {row.currentItemId?`item ${row.currentItemId}`:'sem item em PGM'} · posição nativa {row.currentFrames??'não disponível'}{!row.matchesHistoricalGeneration?' · geração diferente da confirmação histórica':''}</p>}
      <p className="text-outline">Observado em {new Date(row.observedAt).toLocaleString('pt-BR')} · pedido {row.requestId}</p>
      {row.mediaState&&<p>Servidor de vídeo: {row.mediaState==='RUNNING'?'processo próprio com readiness local':row.mediaState==='FAILED'?'falha de readiness; sem reinício automático':row.mediaState==='NOT_READY'?'ainda sem readiness':row.mediaState==='STOPPED'?'encerrado':row.mediaState==='NOT_OWNED_HERE'?'não pertence a este servidor':'não configurado para os destinos selecionados'}</p>}
      {row.controls&&<HaControlPanel row={row} stale={!!error}/>}
      {(row.phase==='CONFIRMED'||row.phase==='UNCERTAIN')&&<HaStopPanel row={row} stale={!!error}/>}
      {(row.phase==='CONFIRMED'||row.phase==='UNCERTAIN')&&<HaReturnPanel row={row} stale={!!error}/>}
      {(['pvw','mon'] as const).map(bus=>{
        const key=monitorKey({channelId:row.channelId,promotionId:row.requestId,bus}),entry=pending[key],review=reviews[key],unresolved=!!entry&&!entry.resolvedBy&&!['CONFIRMED','REFUSED'].includes(entry.phase)
        const available=!error&&row.phase==='CONFIRMED'&&row.localObservation==='RUNNING_LOCAL'&&row.matchesHistoricalGeneration&&row.programOutputsHeld===false
        return <div key={bus} className="flex flex-wrap items-center gap-2">
          <span>Monitor {bus.toUpperCase()}</span>
          <button disabled={!available||monitorBusy||unresolved||!storageReady.current} onClick={()=>void monitor(row,bus,true)} className="border rounded px-2 py-1 disabled:opacity-40">Ligar</button>
          <button disabled={!available||monitorBusy||unresolved||!storageReady.current} onClick={()=>{setViewing(current=>current?.promotionId===row.requestId&&current.bus===bus?null:current);void monitor(row,bus,false)}} className="border rounded px-2 py-1 disabled:opacity-40">Desligar</button>
          {row.browserMonitor?.[bus==='pvw'?'preview':'monitor']&&<button disabled={!available||unresolved} onClick={()=>setViewing({promotionId:row.requestId,bus})} className="underline">Ver {bus.toUpperCase()}</button>}
          {entry&&<><span>{entry.phase==='CONFIRMED'?'Comando confirmado no histórico':entry.phase==='REFUSED'?'Recusado':entry.phase==='UNKNOWN'?'Resposta desconhecida':entry.phase==='UNCERTAIN'?'Resultado incerto':'Aguardando confirmação'} · {entry.request.requestId}</span><button disabled={monitorBusy} onClick={()=>void queryMonitor(entry)} className="underline">Consultar pedido</button></>}
          {entry?.resolvedBy&&<span>Substituído pelo pedido {entry.resolvedBy}; entrega antiga não comprovada.</span>}
          {unresolved&&review?.request.requestId===entry?.request.requestId&&review.canReconcile&&review.reviewToken&&<><span>Revisar definindo um novo estado:</span><button disabled={!available||monitorBusy} onClick={()=>void monitor(row,bus,true,review)} className="border rounded px-2 py-1">Redefinir ligado</button><button disabled={!available||monitorBusy} onClick={()=>void monitor(row,bus,false,review)} className="border rounded px-2 py-1">Redefinir desligado</button></>}
        </div>
      })}
      {viewing?.promotionId===row.requestId&&row.channelId===channelId&&row.browserMonitor&&!error&&<div className="aspect-video max-w-2xl bg-black relative">
        <Whep path={row.browserMonitor[viewing.bus==='pvw'?'preview':'monitor']} port={row.browserMonitor.port} muted hideControls/>
        <button className="absolute right-2 top-2 bg-black/80 rounded px-2 py-1" onClick={()=>setViewing(null)}>Fechar visualização</button>
      </div>}
    </div>)}
    <p className="text-xs text-outline">Ligue o monitor antes de abrir sua visualização. Fechar a visualização não desliga a codificação; use Desligar quando não precisar mais dela. Consulta local não confirma entrega de sinal nem autoridade atual. Monitor não faz CUE ou TAKE e não muda PGM. Revisão cria um novo comando explícito; não confirma retroativamente a entrega antiga.</p>
  </section>
}
