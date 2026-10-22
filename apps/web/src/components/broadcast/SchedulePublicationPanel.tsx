import {useEffect,useRef,useState} from 'react'
import {api,type SchedulePublicationReview,type SchedulePublicationStatus} from '../../api.js'

export function SchedulePublicationPanel({channelId,defaultOpen=false}:{channelId:string;defaultOpen?:boolean}){
  const [open,setOpen]=useState(defaultOpen),[stored,setStored]=useState<SchedulePublicationStatus|null>(null),[review,setReview]=useState<SchedulePublicationReview|null>(null)
  const [days,setDays]=useState(2),[limit,setLimit]=useState(2000),[pending,setPending]=useState(false),[error,setError]=useState<string|null>(null)
  const ticket=useRef({channelId}),busy=useRef(false)
  if(ticket.current.channelId!==channelId)ticket.current={channelId}
  const status=stored?.channelId===channelId?stored:null
  useEffect(()=>{
    const captured=ticket.current;let disposed=false,inFlight=false
    setStored(null);setReview(null);setPending(false);setError(null);busy.current=false
    const update=async()=>{if(inFlight)return;inFlight=true
      try{const result=await api.schedulePublication(channelId);if(!disposed&&ticket.current===captured)setStored(result)}
      catch(failure){if(!disposed&&ticket.current===captured)setError(failure instanceof Error?failure.message:String(failure))}
      finally{inFlight=false}}
    void update();const timer=open?window.setInterval(()=>void update(),3000):null
    return()=>{disposed=true;if(timer!==null)window.clearInterval(timer);if(ticket.current===captured)ticket.current={channelId}}
  },[channelId,open])
  const valid=Number.isInteger(days)&&days>=1&&days<=7&&Number.isInteger(limit)&&limit>=1&&limit<=5000
  const matching=review?.channelId===channelId&&review.version===status?.version&&review.daysAhead===days&&review.maxItems===limit
  const execute=async(action:'REVIEW'|'ENABLE'|'DISABLE')=>{
    if(busy.current||!status)return
    const captured=ticket.current,version=status.version,checked=review
    if(action==='ENABLE'&&(!matching||!window.confirm(`Autorizar montagem e publicação recorrentes de até ${days} dias futuros vazios pela pauta? Só arquivos aprovados serão usados. Dias existentes não serão substituídos. PGM/CUE não mudam agora; passagem para o ar exige autorização separada. STOP/falha suspende a política.`)))return
    busy.current=true;setPending(true);setError(null)
    try{
      if(action==='REVIEW'){const result=await api.schedulePublicationReview(channelId,days,limit);if(ticket.current===captured)setReview(result.review)}
      else{await api.setSchedulePublication(channelId,action==='ENABLE'?{action,version,daysAhead:checked!.daysAhead,maxItems:checked!.maxItems,reviewToken:checked!.token}:{action,version})
        const result=await api.schedulePublication(channelId);if(ticket.current===captured){setStored(result);setReview(null)}}
    }catch(failure){if(ticket.current===captured)setError(failure instanceof Error?failure.message:String(failure))}
    finally{if(ticket.current===captured){busy.current=false;setPending(false)}}
  }
  return <section className="rounded border border-border-subtle bg-surface-panel text-[11px]" aria-label="Montagem e publicação automática pela pauta">
    <button type="button" className="w-full flex justify-between p-3 font-label-caps" aria-expanded={open} onClick={()=>setOpen(value=>!value)}>
      <span>MONTAGEM E PUBLICAÇÃO AUTOMÁTICA · {!status?'CONSULTANDO ESTADO':status.state==='ENABLED'?'HABILITADA':status.state==='SUSPENDED'?'SUSPENSA':'DESLIGADA'}</span><span>{open?'−':'+'}</span>
    </button>
    {open&&<div className="border-t border-border-subtle p-3 space-y-2">
      <p>Cria e publica dias futuros próprios. Pauta deve cobrir 24h nos sete dias, sem intervalo/sobreposição. Só arquivos aprovados, sem corte ou filler implícito. Grades existentes nunca são substituídas. Publicar não muda PGM/CUE; habilite a continuidade de publicadas separadamente no Master.</p>
      <div className="flex flex-wrap gap-3">
        <label>Dias à frente <input aria-label="Dias futuros para montagem" type="number" min={1} max={7} value={days} disabled={pending||status?.state==='ENABLED'} onChange={event=>{setDays(Number(event.target.value));setReview(null)}} className="w-16 border border-border-subtle rounded bg-surface-card p-1"/></label>
        <label>Limite por dia <input aria-label="Limite de itens por dia" type="number" min={1} max={5000} value={limit} disabled={pending||status?.state==='ENABLED'} onChange={event=>{setLimit(Number(event.target.value));setReview(null)}} className="w-24 border border-border-subtle rounded bg-surface-card p-1"/></label>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={pending||!valid||!status?.canConfigure||!status.workerAvailable||status.state==='ENABLED'} onClick={()=>void execute('REVIEW')} className="rounded border border-border-subtle p-2 disabled:opacity-40">CONFERIR PAUTA E POLÍTICA</button>
        <button type="button" disabled={pending||!matching||!status?.canConfigure||!status.workerAvailable||status.state==='ENABLED'||review?.occupied.some(row=>!row.owned)} onClick={()=>void execute('ENABLE')} className="rounded border border-status-ok p-2 disabled:opacity-40">HABILITAR MONTAGEM E PUBLICAÇÃO</button>
        <button type="button" disabled={pending||!status?.canConfigure||status.state!=='ENABLED'} onClick={()=>void execute('DISABLE')} className="rounded border border-armed-amber p-2 disabled:opacity-40">DESLIGAR AUTOMAÇÃO EDITORIAL</button>
      </div>
      {matching&&<p>Dias conferidos: {review.dates.join(', ')}. Acervo aprovado pode evoluir; pauta/formato alterados exigem nova autorização. Montagem deve encaixar exatamente e respeitar repetição; falha suspende, sem publicação parcial do dia.</p>}
      {matching&&review.occupied.map(row=><p key={row.id}>{row.date}: {row.name} · {row.owned?'publicação automática existente será preservada':'grade existente impede automação deste dia'}</p>)}
      {status&&<p role="status">{status.message}</p>}
      {status&&!status.workerAvailable&&<p>Auxiliar de montagem ausente. A política não pode ser habilitada nesta instalação.</p>}
      {status?.jobs.slice(0,7).map(job=><p key={job.id}>{job.date} · {job.state==='READY'?`Publicado (${job.itemCount} itens)`:job.state==='RUNNING'?'Montagem em andamento':'Recusado'} · {job.message}{job.state==='RUNNING'&&job.workerState!=='CURRENT_SERVER'?' — outro dono/interrompido; nenhum processo será presumido encerrado.':''}</p>)}
      {error&&<p role="alert">{error}</p>}
    </div>}
  </section>
}
