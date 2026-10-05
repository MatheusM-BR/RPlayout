import { useEffect, useRef, useState } from 'react'
import { api, type NextPlaylistReview, type NextPlaylistStatus } from '../../api.js'
import { PublishedContinuityPanel } from './PublishedContinuityPanel.js'

const labels={QUEUED:'Enfileirada para o fim da grade',PREPARING:'Preparando a passagem',SWITCHING:'Aguardando confirmação do PGM',CONFIRMED:'Passagem confirmada no engine',FAILED:'Passagem recusada — confira o PGM',CANCELLED:'Passagem cancelada',UNCERTAIN:'Resultado incerto — nenhum TAKE será repetido'}
export function NextPlaylistPanel({channelId,defaultOpen=false}:{channelId:string;defaultOpen?:boolean}) {
  const [open,setOpen]=useState(defaultOpen),[storedStatus,setStatus]=useState<NextPlaylistStatus|null>(null)
  const status=storedStatus?.channelId===channelId?storedStatus:null
  const [revisionId,setRevisionId]=useState(''),[review,setReview]=useState<(NextPlaylistReview&{requestId:string})|null>(null)
  const [pending,setPending]=useState(false),[failure,setFailure]=useState<string|null>(null)
  const currentChannel=useRef(channelId),busy=useRef(false);currentChannel.current=channelId
  const active=status?.current && ['QUEUED','PREPARING','SWITCHING','UNCERTAIN'].includes(status.current.state)
  useEffect(()=>{setStatus(null);setRevisionId('');setReview(null);setFailure(null);setOpen(defaultOpen);setPending(false);busy.current=false},[channelId,defaultOpen])
  useEffect(()=>{
    let current=true,inFlight=false
    const update=async()=>{
      if(inFlight)return;inFlight=true
      try{const next=await api.nextPlaylist(channelId);if(current)setStatus(next)}
      catch(error){if(current)setFailure(error instanceof Error?error.message:String(error))}
      finally{inFlight=false}
    }
    void update();const timer=open||active?window.setInterval(()=>void update(),2000):null
    return()=>{current=false;if(timer!==null)window.clearInterval(timer)}
  },[channelId,open,Boolean(active)])
  const execute=async(action:'REVIEW'|'QUEUE'|'CANCEL'|'RECONCILE')=>{
    if(busy.current)return
    const origin=channelId,captured=review,run=status?.current
    if(action==='QUEUE' && (!captured || !window.confirm(`Autorizar a passagem de “${captured.sourceName}” para “${captured.targetName}” ao terminar a grade? Só esta revisão será usada; o primeiro vídeo precisa ser confirmado no PGM. Não altera o CUE ou o PGM agora.`)))return
    if(action==='RECONCILE' && !window.confirm('Confirmar que o canal está parado, o CUE está limpo e os processos anteriores estão encerrados? O pedido será fechado sem repetir TAKE.'))return
    busy.current=true;setPending(true);setFailure(null)
    try {
      if(action==='REVIEW') {
        const result=await api.nextPlaylistReview(origin,revisionId)
        if(currentChannel.current===origin)setReview({...result.review,requestId:crypto.randomUUID()})
      } else if(action==='QUEUE'&&captured) {
        await api.setNextPlaylist(origin,{action:'QUEUE',requestId:captured.requestId,sourceRevisionId:captured.sourceRevisionId,targetRevisionId:captured.targetRevisionId,reviewToken:captured.token})
      } else if(run)await api.setNextPlaylist(origin,{action,requestId:run.id})
      const next=await api.nextPlaylist(origin)
      if(currentChannel.current===origin)setStatus(next)
    } catch(error){if(currentChannel.current===origin)setFailure(error instanceof Error?error.message:String(error))}
    finally{if(currentChannel.current===origin){busy.current=false;setPending(false)}}
  }
  const matching=review?.channelId===channelId && review.targetRevisionId===revisionId && review.sourceRevisionId===status?.sourceRevisionId
  return <div className="rounded border border-border-subtle bg-surface-panel mt-2">
    <button type="button" className="flex w-full justify-between px-3 py-2 text-[11px] font-label-caps" onClick={()=>setOpen(value=>!value)} aria-expanded={open}>
      <span>PRÓXIMA GRADE{status?.current?` · ${labels[status.current.state]}`:''}</span><span>{open?'−':'+'}</span>
    </button>
    {open&&<div className="border-t border-border-subtle p-3 space-y-3 text-[11px]">
      <p className="text-outline">Enfileire uma revisão publicada para entrar no fim natural da grade atual. A origem não pode estar em loop ou terminar em espera manual. STOP cancela a fila. Esta autorização não monta nem publica outras grades.</p>
      <label className="block">Revisão publicada de destino
        <select aria-label="Próxima revisão publicada" className="block w-full rounded border border-border-subtle bg-surface-card p-2 mt-1" value={revisionId} disabled={pending||Boolean(active)||!status?.canConfigure} onChange={event=>{setRevisionId(event.target.value);setReview(null);setFailure(null)}}>
          <option value="">Selecione outra grade publicada</option>
          {status?.options.map(option=><option key={option.revisionId} value={option.revisionId}>{option.name} · {option.date} · revisão {option.revision}</option>)}
        </select>
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="rounded border border-border-subtle p-2 disabled:opacity-40" disabled={pending||!revisionId||Boolean(active)||!status?.canConfigure} onClick={()=>void execute('REVIEW')}>CONFERIR PASSAGEM</button>
        <button type="button" className="rounded border border-status-ok p-2 text-status-ok disabled:opacity-40" disabled={pending||!matching||Boolean(active)||!status?.nativeEngine||!status.canConfigure} onClick={()=>void execute('QUEUE')}>ENFILEIRAR AO FIM DA GRADE</button>
        <button type="button" className="rounded border border-armed-amber p-2 disabled:opacity-40" disabled={pending||!status?.canConfigure||!status.current||!['QUEUED','PREPARING','FAILED'].includes(status.current.state)} onClick={()=>void execute('CANCEL')}>CANCELAR PASSAGEM</button>
        {status?.current&&['PREPARING','SWITCHING','UNCERTAIN'].includes(status.current.state)&&<button type="button" className="rounded border border-armed-amber p-2 disabled:opacity-40" disabled={pending||!status.canReconcile} onClick={()=>void execute('RECONCILE')}>RECONHECER INCERTEZA COM CANAL PARADO</button>}
      </div>
      {review&&<p>Conferido: {review.sourceName} → {review.targetName} ({review.targetDate}); primeiro vídeo: {review.firstItemTitle}. Não entra antes de {new Date(review.notBeforeMs).toLocaleString('pt-BR')}.</p>}
      {review&&!matching&&<p className="text-armed-amber">A seleção/origem mudou. Confira novamente; a conferência anterior não será reaproveitada.</p>}
      {status&&!status.nativeEngine&&<p className="text-armed-amber">Canal simulado: consulta disponível, mas passagem automática real não pode ser autorizada.</p>}
      {status?.current&&<p>{labels[status.current.state]} · {status.current.plan.targetName}{status.current.message?` · ${status.current.message}`:''}</p>}
      {failure&&<p role="alert" className="text-armed-amber">{failure}</p>}
      {pending&&<p role="status">Conferindo revisão, permissão e cópia do vídeo…</p>}
      <PublishedContinuityPanel channelId={channelId}/>
    </div>}
  </div>
}
