import {useEffect,useRef,useState} from 'react'
import type {ManagedLiveSource,Rate} from '@rplayout/protocol'
import {api,type OperationalInsertionInput,type OperationalInsertionReview} from '../../api.js'
import type {LibraryAsset} from '../../types.js'
import {commandRequestId} from '../../domain/request-id.js'
import {ReviewedOperationConfirm} from './ReviewedOperationConfirm.js'

export function OperationalInsertionPanel(props:{channelId:string;rate:Rate;assets:readonly LibraryAsset[]}){
  return <InsertionContent key={props.channelId} {...props}/>
}
function InsertionContent({channelId,rate,assets}:{channelId:string;rate:Rate;assets:readonly LibraryAsset[]}){
  const [open,setOpen]=useState(false),[kind,setKind]=useState<'VIDEO'|'LIVE'>('VIDEO'),[selected,setSelected]=useState(''),[seconds,setSeconds]=useState('120')
  const [sources,setSources]=useState<ManagedLiveSource[]>([]),[review,setReview]=useState<OperationalInsertionReview|null>(null),[pending,setPending]=useState(false),[message,setMessage]=useState<string|null>(null)
  const mounted=useRef(true),busy=useRef(false)
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[])
  useEffect(()=>{if(!open)return;let active=true;void api.liveSources(channelId).then(rows=>{if(active)setSources(rows)}).catch(error=>{if(active)setMessage(error instanceof Error?error.message:String(error))});return()=>{active=false}},[channelId,open])
  const perform=async(mode:'NEXT'|'NOW'|'CONFIRM')=>{
    if(busy.current)return
    const captured=review
    if(mode==='CONFIRM'&&!captured)return
    busy.current=true;setPending(true);setMessage(null)
    try{
      if(mode==='CONFIRM'){
        const result=await api.operationalInsertion(channelId,captured!)
        if(mounted.current){setReview(null);setMessage(result.message??(result.run.mode==='NEXT'?'Inserido como próximo na revisão operacional; PGM/CUE preservados. Auto Next do item atual continua valendo.':result.run.nativeProgramConfirmed?'Inserção confirmada no PGM pelo engine. Confira o destino; não é homologação física.':'Sem confirmação nativa de PGM. Confira o registro antes de repetir.'))}
      }else{
        const duration=Math.round(Number(seconds)*rate.num/rate.den)
        if(!selected || kind==='LIVE'&&(!Number.isFinite(duration)||duration<=0))throw new Error('Escolha vídeo/entrada e uma duração válida.')
        const input:OperationalInsertionInput={requestId:commandRequestId(),mode,...(kind==='VIDEO'?{mediaId:selected}:{sourceId:selected,durationFrames:duration})}
        const result=await api.reviewOperationalInsertion(channelId,input)
        if(mounted.current)setReview(result)
      }
    }catch(error){
      if(mounted.current)setMessage(error instanceof Error?error.message:String(error))
      if(mode==='CONFIRM'&&captured){try{
        const status=await api.operationalInsertionStatus(channelId,captured.input.requestId)
        if(mounted.current){
          if(status.run.phase==='CONFIRMED'){
            setReview(null);setMessage(status.run.nativeProgramConfirmed?'O registro confirma a inserção no PGM pelo engine. Não repita TAKE; confira o destino.':'O registro confirma a inserção como próximo, sem TAKE. PGM/CUE preservados; Auto Next do item atual continua valendo.')
          }else setMessage(status.configurationOperation.state!=='IDLE'?'Inserção em andamento ou inconclusiva; não repita TAKE. Pare o PGM, limpe CUE e abra Distribuição para reconciliação por Supervisor/Administrador. '+(status.configurationOperation.reason??status.run.message??''):status.run.message??'Confira o resultado persistido antes de uma nova decisão.')
        }
      }catch{/* Original error remains; never retry mutation or fabricate success. */}}
    }
    finally{busy.current=false;if(mounted.current)setPending(false)}
  }
  const reset=()=>{setReview(null);setMessage(null)}
  return <section className="mt-2 rounded border border-border-subtle bg-surface-panel" aria-label="Inserção operacional urgente">
    <button type="button" className="w-full text-left p-2 text-xs" aria-expanded={open} onClick={()=>setOpen(value=>!value)}>INSERÇÃO OPERACIONAL · PRÓXIMO / AGORA</button>
    {open&&<div className="p-3 space-y-2 text-xs border-t border-border-subtle">
      <p>Insere na edição publicada, sem publicar outras alterações editoriais. Próximo preserva o PGM/CUE; Agora exige quadro confirmado e interrompe o item atual. Descoberta de entrada não comprova sinal.</p>
      <label className="block">Tipo <select disabled={pending} value={kind} onChange={event=>{setKind(event.target.value as 'VIDEO'|'LIVE');setSelected('');reset()}} className="bg-surface-card border rounded p-2"><option value="VIDEO">Vídeo (QC conferido ao inserir)</option><option value="LIVE">Entrada cadastrada</option></select></label>
      <label className="block">{kind==='VIDEO'?'Vídeo':'Entrada'} <select disabled={pending} value={selected} onChange={event=>{setSelected(event.target.value);reset()}} className="bg-surface-card border rounded p-2 max-w-full"><option value="">Selecione</option>{kind==='VIDEO'?assets.filter(asset=>!asset.ignored&&asset.kind==='VIDEO').map(asset=><option key={asset.id} value={asset.id}>{asset.title}</option>):sources.filter(source=>source.enabled).map(source=><option key={source.id} value={source.id}>{source.name} · {source.kind}</option>)}</select></label>
      {kind==='LIVE'&&<label className="block">Duração estimada (segundos) <input disabled={pending} type="number" min="1" value={seconds} onChange={event=>{setSeconds(event.target.value);reset()}} className="bg-surface-card border rounded p-2 w-28"/></label>}
      <div className="flex gap-2 flex-wrap">
        <button type="button" disabled={pending||!selected} onClick={()=>void perform('NEXT')} className="border rounded p-2 disabled:opacity-40">Conferir inserir próximo</button>
        <button type="button" disabled={pending||!selected} onClick={()=>void perform('NOW')} className="border rounded p-2 disabled:opacity-40">Conferir inserir agora</button>
      </div>
      {review&&<div role="status"><p>Conferido: {review.item.title} · {review.input.mode==='NOW'?'AGORA':'PRÓXIMO'} · revisão de origem {review.sourceRevisionId}.</p><p>{review.notice}</p>{review.conflicts.map((conflict,index)=><p key={index} className="text-amber-300">{conflict.message}</p>)}{!review.nativeEngine&&<p>Canal simulado: inserção Próximo é apenas planejamento; Agora exige engine real.</p>}</div>}
      <ReviewedOperationConfirm reviewKey={review?`${channelId}:${review.input.requestId}:${review.reviewToken}`:null} label={review?.input.mode==='NOW'?'Confirmar inserir agora':'Confirmar inserção'}
        confirmation={review?.input.mode==='NOW'?`Autorizo inserir “${review.item.title}” AGORA e interromper o PGM somente após quadro confirmado. Rascunhos não serão publicados.`:`Autorizo inserir “${review?.item.title??''}” como PRÓXIMO, preservando PGM/CUE e respeitando o Auto Next do item atual.`}
        disabled={pending||!review||review.input.mode==='NOW'&&!review.nativeEngine} onConfirm={()=>perform('CONFIRM')}/>
      {pending&&<p role="status">Preparando e conferindo revisão/sinal… Não repita o pedido.</p>}
      {message&&<p role="status" className="text-amber-300">{message}</p>}
    </div>}
  </section>
}
