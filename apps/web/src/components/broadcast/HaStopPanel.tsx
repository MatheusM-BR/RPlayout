import {useEffect,useRef,useState} from 'react'
import {api,type HaStopRequest,type HaStopReport,type HaStopReview,type HaExecutionObservation} from '../../api.js'
import {newHaMonitorId} from '../../domain/ha-monitor-pending.js'
const uuid=(value:unknown)=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)
function intent(value:unknown):HaStopRequest{
  const row=value as HaStopRequest
  if(!row||!uuid(row.requestId)||!uuid(row.promotionId)||typeof row.channelId!=='string'||!row.channelId||row.channelId.length>128||typeof row.reviewToken!=='string'||!row.reviewToken||row.reviewToken.length>256||row.confirmStop!==true)throw new Error('Pedido de encerramento inválido.')
  return {requestId:row.requestId,channelId:row.channelId,promotionId:row.promotionId,reviewToken:row.reviewToken,confirmStop:true}
}
export function HaStopPanel({row,stale}:{row:HaExecutionObservation;stale:boolean}){
  const [review,setReview]=useState<HaStopReview|null>(null),[request,setRequest]=useState<HaStopRequest|null>(null),[report,setReport]=useState<HaStopReport|null>(null),[confirm,setConfirm]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[storage,setStorage]=useState(false)
  const active=useRef(true),running=useRef(false),key='rplayout:ha-stop:v1:'+row.requestId
  useEffect(()=>{active.current=true;try{const raw=window.sessionStorage.getItem(key);if(raw){if(raw.length>4096)throw new Error();const parsed=intent(JSON.parse(raw));if(parsed.channelId!==row.channelId||parsed.promotionId!==row.requestId)throw new Error();setRequest(parsed)}setStorage(true)}catch{setError('Diário local indisponível; encerramento bloqueado.')}return()=>{active.current=false}},[key,row.channelId,row.requestId])
  const accept=(expected:HaStopRequest,result:HaStopReport)=>{
    if(JSON.stringify(intent(result.request))!==JSON.stringify(intent(expected))||result.version!==1||!['ACCEPTED','STOPPING','CONFIRMED','UNCERTAIN'].includes(result.phase)||result.authorityReturnedToPrimary!==false||result.automaticRestart!==false||result.originalControlOutcomesUnchanged!==true||result.physicalOutputValidated!==false||result.phase==='CONFIRMED'&&(!result.ownedResourcesStopped||!result.storageReleased))throw new Error('Encerramento sem confirmação atribuível.')
    if(active.current)setReport(result)
  }
  const inspect=async()=>{
    if(running.current)return;running.current=true;setBusy(true);setError(null);setConfirm(false)
    try{const value=await api.haStopReview(row.requestId,row.channelId);if(value.promotionId!==row.requestId||value.channelId!==row.channelId)throw new Error();if(active.current)setReview(value);if(value.prior){const prior=intent(value.prior.request);if(storage)window.sessionStorage.setItem(key,JSON.stringify(prior));if(active.current)setRequest(prior);accept(prior,value.prior)}}catch{if(active.current)setError('Conferência indisponível. Nenhum processo foi alterado.')}
    finally{running.current=false;if(active.current)setBusy(false)}
  }
  const stop=async()=>{
    if(running.current||stale||!storage||request||!confirm||!review?.canStop||!review.reviewToken)return
    running.current=true;setBusy(true);setError(null)
    try{const next:HaStopRequest={requestId:newHaMonitorId(),channelId:row.channelId,promotionId:row.requestId,reviewToken:review.reviewToken,confirmStop:true};window.sessionStorage.setItem(key,JSON.stringify(next));if(active.current)setRequest(next);accept(next,await api.haStop(next))}
    catch{if(active.current)setError('Encerramento não confirmado. Consulte o pedido salvo; não repita.')}
    finally{running.current=false;if(active.current)setBusy(false)}
  }
  const query=async()=>{
    if(running.current||!request)return;running.current=true;setBusy(true);setError(null)
    try{accept(request,await api.haStopQuery(request.requestId,request.channelId))}catch{if(active.current)setError('Consulta indisponível. Pedido preservado; nenhum encerramento foi repetido.')}
    finally{running.current=false;if(active.current)setBusy(false)}
  }
  return <section aria-label="Encerramento da execução da reserva" className="border rounded p-2 space-y-2">
    <p>Encerrar recursos próprios desta execução</p>
    <button disabled={busy||stale} onClick={()=>void inspect()} className="underline">Conferir encerramento</button>
    {review&&!request&&<><p>Esta ação interrompe PGM/PVW da reserva. Não devolve autoridade ao principal nem reinicia outro engine.</p><label><input type="checkbox" checked={confirm} disabled={busy||!review.canStop} onChange={event=>setConfirm(event.target.checked)}/> Confirmo o encerramento desta execução</label><button disabled={busy||stale||!storage||!review.canStop||!confirm} onClick={()=>void stop()} className="border rounded px-2 py-1 ml-2">Encerrar execução</button>{!review.canStop&&<p>Encerramento indisponível: operação em andamento ou recursos não rastreados nesta instância. Nenhum PID externo será adotado.</p>}</>}
    {request&&<p>Pedido {request.requestId} · {report?.phase==='CONFIRMED'?'recursos próprios parados e reserva liberada':report?.phase==='UNCERTAIN'?'parada/liberação incertas':report?.phase==='STOPPING'?'encerrando':'resultado não confirmado'} <button disabled={busy} onClick={()=>void query()} className="underline">Consultar pedido</button></p>}
    {error&&<p role="alert" className="text-armed-amber">{error}</p>}
  </section>
}
