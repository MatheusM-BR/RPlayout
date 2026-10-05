import { useEffect, useRef, useState } from 'react'
import { api, type PublishedContinuityStatus, type PublishedContinuityReview } from '../../api.js'

export function PublishedContinuityPanel({channelId}:{channelId:string}){
  const [stored,setStored]=useState<PublishedContinuityStatus|null>(null),[review,setReview]=useState<PublishedContinuityReview|null>(null)
  const [late,setLate]=useState(5),[pending,setPending]=useState(false),[error,setError]=useState<string|null>(null)
  const ticket=useRef({channelId,generation:0}),busy=useRef(false)
  if(ticket.current.channelId!==channelId)ticket.current={channelId,generation:ticket.current.generation+1}
  const status=stored?.channelId===channelId?stored:null
  useEffect(()=>{
    const captured=ticket.current;let disposed=false,inFlight=false
    setStored(null);setReview(null);setPending(false);setLate(5);setError(null);busy.current=false
    const update=async()=>{if(inFlight)return;inFlight=true
      try{const next=await api.publishedContinuity(channelId);if(!disposed&&ticket.current===captured)setStored(next)}
      catch(failure){if(!disposed&&ticket.current===captured)setError(failure instanceof Error?failure.message:String(failure))}
      finally{inFlight=false}}
    void update();const timer=window.setInterval(()=>void update(),3000)
    return()=>{disposed=true;window.clearInterval(timer);if(ticket.current===captured)ticket.current={channelId,generation:captured.generation+1}}
  },[channelId])
  const matching=review?.channelId===channelId&&review.version===status?.version&&review.sourceRevisionId===status.sourceRevisionId&&review.maxLateMinutes===late
  const execute=async(action:'REVIEW'|'ENABLE'|'DISABLE')=>{
    if(busy.current||!status)return
    const captured=ticket.current,capturedReview=review,capturedStatus=status
    if(action==='ENABLE'&&(!matching||!window.confirm('Habilitar passagens recorrentes entre grades já publicadas, sem perguntar a cada passagem? Rascunhos não serão montados/publicados. STOP, falha ou perda de autorização suspendem a política. CUE/PGM não mudam agora.')))return
    busy.current=true;setPending(true);setError(null)
    try{
      if(action==='REVIEW'){const result=await api.publishedContinuityReview(channelId,late);if(ticket.current===captured)setReview(result.review)}
      else{await api.setPublishedContinuity(channelId,action==='ENABLE'?{action,version:capturedStatus.version,maxLateMinutes:capturedReview!.maxLateMinutes,reviewToken:capturedReview!.token}:{action,version:capturedStatus.version})
        const next=await api.publishedContinuity(channelId);if(ticket.current===captured){setStored(next);setReview(null)}}
    }catch(failure){if(ticket.current===captured)setError(failure instanceof Error?failure.message:String(failure))}
    finally{if(ticket.current===captured){busy.current=false;setPending(false)}}
  }
  return <section className="border-t border-border-subtle pt-3 space-y-2" aria-label="Continuidade recorrente de grades publicadas">
    <h3>CONTINUIDADE RECORRENTE · SOMENTE PUBLICADAS</h3>
    <p>Desligada por padrão. Depois de habilitada, confere e enfileira as próximas grades publicadas por ordem de início. Não monta ou publica rascunhos, não pula uma grade com erro e não garante 48h de cobertura. STOP suspende a política.</p>
    <label>Atraso máximo autorizado (minutos) <input type="number" min={0} max={180} step={1} value={late} disabled={pending||status?.state==='ENABLED'} onChange={event=>{setLate(Number(event.target.value));setReview(null)}} className="w-20 rounded border border-border-subtle bg-surface-card p-1"/></label>
    <div className="flex flex-wrap gap-2">
      <button type="button" disabled={pending||!status?.canConfigure||status.state==='ENABLED'||!Number.isInteger(late)||late<0||late>180} onClick={()=>void execute('REVIEW')} className="rounded border border-border-subtle p-2 disabled:opacity-40">CONFERIR CONTINUIDADE</button>
      <button type="button" disabled={pending||!matching||!status?.canConfigure||!status.nativeEngine||status.state==='ENABLED'} onClick={()=>void execute('ENABLE')} className="rounded border border-status-ok p-2 disabled:opacity-40">HABILITAR PASSAGENS RECORRENTES</button>
      <button type="button" disabled={pending||!status?.canConfigure||status.state!=='ENABLED'} onClick={()=>void execute('DISABLE')} className="rounded border border-armed-amber p-2 disabled:opacity-40">DESLIGAR CONTINUIDADE</button>
    </div>
    {matching&&<p>Primeira passagem conferida: {review.nextName}. Próximas edições publicadas serão revalidadas; atraso máximo {review.maxLateMinutes} min.</p>}
    {status&&<p>{status.state==='ENABLED'?'Habilitada':status.state==='SUSPENDED'?'Suspensa — exige nova conferência':'Desligada'} · {status.message}</p>}
    {status?.state==='ENABLED'&&status.workerState!=='CURRENT_SERVER'&&<p role="status">{status.workerState==='WAITING_RECOVERY'?'Aguardando recuperação local do dono; nenhuma passagem é presumida.':'Outro servidor ou dono desconhecido detém a política. Este host não pode anunciar continuidade nem assumir fencing remoto.'}</p>}
    {status&&!status.nativeEngine&&<p>Canal simulado: habilitação de passagem real indisponível.</p>}
    {error&&<p role="alert">{error}</p>}
  </section>
}
