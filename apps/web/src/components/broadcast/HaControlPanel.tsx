import {useEffect,useRef,useState} from 'react'
import {api,type HaControlRequest,type HaControlReport,type HaExecutionObservation} from '../../api.js'
import {haControlStorageKey,readPendingHaControls,confirmedHaControlResponse,type PendingHaControl} from '../../domain/ha-control-pending.js'
import {newHaMonitorId} from '../../domain/ha-monitor-pending.js'

export function HaControlPanel({row,stale}:{row:HaExecutionObservation;stale:boolean}){
  const [selected,setSelected]=useState(''),[entry,setEntry]=useState<PendingHaControl|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[ready,setReady]=useState(false)
  const [localCue,setLocalCue]=useState<{itemId:string|null;observation:string}|null>(null)
  const [review,setReview]=useState<HaControlReport|null>(null)
  const active=useRef(true),sending=useRef(false),saved=useRef<Record<string,PendingHaControl>>({})
  useEffect(()=>{
    active.current=true
    try{saved.current=readPendingHaControls(window.sessionStorage.getItem(haControlStorageKey));setEntry(saved.current[row.channelId]??null);setReady(true)}catch{setError('Diário local indisponível. CUE/TAKE bloqueados para preservar pedidos incertos.')}
    return()=>{active.current=false}
  },[row.channelId])
  const remember=(next:PendingHaControl)=>{
    const all={...readPendingHaControls(window.sessionStorage.getItem(haControlStorageKey)),[row.channelId]:next};window.sessionStorage.setItem(haControlStorageKey,JSON.stringify(all));saved.current=all
    if(active.current)setEntry(next)
  }
  const available=ready&&!stale&&row.phase==='CONFIRMED'&&row.localObservation==='RUNNING_LOCAL'&&row.matchesHistoricalGeneration&&row.programOutputsHeld===false&&!!row.controls
  const unresolved=!!entry&&!['CONFIRMED','REFUSED'].includes(entry.phase)
  const cuedItemId=localCue&&Date.parse(row.observedAt)<=Date.parse(localCue.observation)?localCue.itemId:row.controls?.cuedItemId??null
  const control=async(action:'CUE'|'TAKE')=>{
    if(sending.current||!available||!row.controls)return
    // Reload/cross-tab requests cannot hide a locally pending operation.
    try{saved.current=readPendingHaControls(window.sessionStorage.getItem(haControlStorageKey))}catch{setReady(false);setError('Diário inválido; nenhum comando enviado.');return}
    const prior=saved.current[row.channelId]
    if(prior&&!['CONFIRMED','REFUSED'].includes(prior.phase)){setEntry(prior);return}
    const itemId=action==='TAKE'?cuedItemId:selected
    if(!itemId||!row.controls.items.some(item=>item.id===itemId))return
    sending.current=true;setBusy(true);setError(null);setReview(null)
    try{
      const request:HaControlRequest={requestId:newHaMonitorId(),channelId:row.channelId,promotionId:row.requestId,revisionId:row.controls.revisionId,action,itemId}
      remember({request,phase:'UNKNOWN'})
      const report=await api.haControl(request)
      remember(confirmedHaControlResponse(request,report))
      if(active.current&&report.phase==='CONFIRMED')setLocalCue({itemId:action==='CUE'?itemId:null,observation:report.updatedAt})
    }catch{if(active.current)setError('Resultado não confirmado. Consulte o pedido salvo; não repita TAKE.')}
    finally{sending.current=false;if(active.current)setBusy(false)}
  }
  const query=async()=>{
    if(!entry||sending.current)return;sending.current=true;setBusy(true);setError(null)
    try{const result=await api.haControlQuery(entry.request.requestId,entry.request.channelId);remember(confirmedHaControlResponse(entry.request,result));if(active.current)setReview(result)}
    catch{if(active.current)setError('Consulta indisponível. Pedido preservado; nenhum comando foi reenviado.')}
    finally{sending.current=false;if(active.current)setBusy(false)}
  }
  const reconcile=async()=>{
    if(!entry||!review?.canReconcile||!review.reviewToken||review.request.requestId!==entry.request.requestId||sending.current)return
    sending.current=true;setBusy(true);setError(null)
    try{
      const result=await api.haControlReview({reviewId:newHaMonitorId(),requestId:entry.request.requestId,channelId:entry.request.channelId,reviewToken:review.reviewToken})
      remember(confirmedHaControlResponse(entry.request,result));if(active.current)setReview(result)
      // A reconciled historical CUE is NOT the current PVW selection.
    }catch{if(active.current)setError('Revisão não confirmada; consulte novamente. Nenhum CUE/TAKE foi repetido.')}
    finally{sending.current=false;if(active.current)setBusy(false)}
  }
  return <section aria-label="CUE e TAKE da reserva" className="border rounded p-2 space-y-2">
    <p>Operação da edição publicada · CUE atual: {row.controls?.items.find(item=>item.id===cuedItemId)?.title??'nenhum'}</p>
    <label>Item <select aria-label="Item publicado da reserva" value={selected} disabled={!available||busy||unresolved} onChange={event=>setSelected(event.target.value)} className="bg-surface-panel border rounded p-1"><option value="">Selecione</option>{row.controls?.items.map(item=><option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
    <button disabled={!available||!selected||busy||unresolved} onClick={()=>void control('CUE')} className="border rounded px-2 py-1 ml-2">CUE</button>
    <button disabled={!available||!cuedItemId||busy||unresolved} onClick={()=>void control('TAKE')} className="border rounded px-2 py-1 ml-2">TAKE do CUE</button>
    {entry&&<p>{entry.request.action} · {entry.phase==='UNKNOWN'?'resposta desconhecida':entry.phase==='CONFIRMED'?'confirmado no histórico':entry.phase==='REFUSED'?'recusado':entry.phase==='UNCERTAIN'?'resultado incerto':'aguardando confirmação'} · {entry.request.requestId} <button disabled={busy} onClick={()=>void query()} className="underline">Consultar pedido</button></p>}
    {unresolved&&review?.request.requestId===entry?.request.requestId&&review.canReconcile&&review.reviewToken&&<button disabled={busy||stale} onClick={()=>void reconcile()} className="border rounded px-2 py-1">Reconciliar com recibo nativo — sem repetir</button>}
    {review?.reconciledFrom&&<p>Revisão registrada a partir de {review.reconciledFrom}; não é um novo TAKE nem prova de sinal atual.</p>}
    {error&&<p role="alert" className="text-armed-amber">{error}</p>}
    <p className="text-outline">CUE prepara PVW; TAKE envia o CUE exato para PGM. Confirmação histórica não prova sinal atual. Pedido incerto exige reconciliação; consulta e reload não repetem o comando.</p>
  </section>
}
