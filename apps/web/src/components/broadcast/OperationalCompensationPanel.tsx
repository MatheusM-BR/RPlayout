import {useEffect,useMemo,useRef,useState} from 'react'
import type {OperationalCompensationInput,OperationalCompensationReview,Rate} from '@rplayout/protocol'
import type {ItemView} from '../../types.js'
import {api} from '../../api.js'
import {commandRequestId} from '../../domain/request-id.js'
import {dur} from '../../format.js'
import {compensationPresets,compensationActionHint,compensationSecondsForAction} from '../../domain/compensation-input.js'
import {compensationConflictMeasures,compensationMeasuredDelta,type CompensationConflict,type CompensationConflictMeasure} from '../../domain/compensation-conflicts.js'
import {CompensationConflictMeasures} from './CompensationConflictMeasures.js'
import {compensationReceiptMessage,compensationFailureMessage} from '../../domain/compensation-feedback.js'
import {CompensationAnchorReview} from './CompensationAnchorReview.js'
import {compensationSelectionState} from '../../domain/compensation-selection.js'

export function OperationalCompensationPanel(props:{channelId:string;items:readonly ItemView[];rate:Rate;conflicts?:readonly CompensationConflict[]}){
  return <CompensationContent key={props.channelId} {...props}/>
}
function CompensationContent({channelId,items,rate,conflicts=[]}:{channelId:string;items:readonly ItemView[];rate:Rate;conflicts?:readonly CompensationConflict[]}){
  const [itemId,setItemId]=useState(''),[action,setAction]=useState<OperationalCompensationInput['action']>('FILLER'),[seconds,setSeconds]=useState('30')
  const [copiedMeasure,setCopiedMeasure]=useState<CompensationConflictMeasure|null>(null)
  const [review,setReview]=useState<OperationalCompensationReview|null>(null),[operation,setOperation]=useState<Parameters<typeof api.applyOperationalCompensation>[1]|null>(null)
  const [pending,setPending]=useState(false),[message,setMessage]=useState<string|null>(null),lock=useRef(false)
  const clear=()=>{setReview(null);setMessage(null)}
  const selectedItem=items.find(row=>row.item.id===itemId)?.item
  const selection=compensationSelectionState(itemId,Boolean(selectedItem),pending,Boolean(operation))
  useEffect(()=>{
    if(selection.clearSelection){setItemId('');setReview(null);setCopiedMeasure(null)}
    // Preserve receipt feedback and uncertain requests: removal is not rollback.
  },[selection.clearSelection])
  const actionHint=selectedItem?compensationActionHint(selectedItem,action):null
  const measures=useMemo(()=>compensationConflictMeasures(items,itemId,action,conflicts,rate),[items,itemId,action,conflicts,rate.num,rate.den])
  const perform=async(confirm:boolean,retry=false)=>{
    if(lock.current)return
    lock.current=true;setPending(true)
    let sent=false
    try{
      if(confirm){
        if(!operation&&(!review||!selection.showReview))return
        if(operation&&!retry){
          const receipt=await api.operationalCompensationReceipt(channelId,operation.requestId)
          if(receipt.state==='RECORDED'){
            setOperation(null);setReview(null)
            setMessage(`Compensação registrada na revisão ${receipt.revision}. Consulta histórica; não comprova sincronismo atual do PGM.`)
          }else setMessage('Solicitação não encontrada para esta sessão/canal no momento da consulta. Isso não é confirmação de rejeição. Confira antes de reenviar o mesmo identificador.')
          return
        }
        const request=operation??{input:review!.input,reviewToken:review!.reviewToken,requestId:commandRequestId()}
        setOperation(request)
        sent=true
        const result=await api.applyOperationalCompensation(channelId,request)
        setOperation(null);setReview(null)
        setMessage(compensationReceiptMessage(result))
      }else{
        const selected=items.find(row=>row.item.id===itemId)
        if(!selected)throw new Error('Selecione o item futuro.')
        const item=selected.item,expectedFrames=item.liveConfig?.estimatedDuration??item.liveEstimatedDuration??item.durationOverride??Math.max(0,selected.trim.out-selected.trim.in)
        const deltaFrames=compensationMeasuredDelta(itemId,action,seconds,rate,copiedMeasure)
        setReview(await api.reviewOperationalCompensation(channelId,{itemId,expectedFrames,action,deltaFrames}));setMessage(null)
      }
    }catch(error){setMessage(compensationFailureMessage(error,sent))}
    finally{lock.current=false;setPending(false)}
  }
  return <section aria-label="Compensação rápida da playlist publicada" className="border rounded p-2 space-y-2 text-xs">
    <p>COMPENSAÇÃO OPERACIONAL · não publica o rascunho nem executa TAKE</p>
    <label className="block">Item futuro <select disabled={pending||Boolean(operation)} value={selection.value} onChange={event=>{setItemId(event.target.value);setCopiedMeasure(null);clear()}} className="bg-surface-card w-full"><option value="">Selecione</option>{items.map(row=><option key={row.item.id} value={row.item.id}>{row.item.title}</option>)}</select></label>
    <label className="block">Ação <select disabled={pending||Boolean(operation)} value={action} onChange={event=>{const next=event.target.value as OperationalCompensationInput['action'];setAction(next);setSeconds(compensationSecondsForAction(next,seconds));setCopiedMeasure(null);clear()}} className="bg-surface-card w-full"><option value="FILLER">Estender/reduzir filler</option><option value="TRIM">Reduzir VT com corte permitido</option><option value="DROP_OPTIONAL">Remover opcional</option><option value="ACCEPT_DELAY">Aceitar atraso em horário flexível</option></select></label>
    {action!=='DROP_OPTIONAL'&&<label className="block">Ajuste em segundos (negativo reduz; até 600 s) <input type="text" inputMode="decimal" disabled={pending||Boolean(operation)} value={seconds} onChange={event=>{setSeconds(event.target.value);setCopiedMeasure(null);clear()}} className="bg-surface-card w-full"/></label>}
    {action!=='DROP_OPTIONAL'&&<div role="group" aria-label="Ajustes rápidos de tempo" className="flex flex-wrap gap-2">{compensationPresets(action).map(value=><button type="button" key={value} disabled={pending||Boolean(operation)} onClick={()=>{setSeconds(String(value));setCopiedMeasure(null);clear()}} className="rounded border border-border-subtle px-2 py-1">{value>0?'+':''}{value}s</button>)}</div>}
    <CompensationConflictMeasures measures={measures} rate={rate} disabled={pending||Boolean(operation)} onCopy={measure=>{if(lock.current||operation)return;setCopiedMeasure(measure);setSeconds(measure.secondsText);clear()}}/>
    {copiedMeasure&&<p role="status">Medida copiada: {copiedMeasure.conflictFrames} quadros de {copiedMeasure.anchorTitle}. O valor fica fixo enquanto você confere; o timing continua mudando.</p>}
    <p>Somente itens futuros da playlist no ar. PGM, CUE, zonas protegidas e limites da mídia são conferidos pelo servidor.</p>
    {actionHint&&<p role="status">Indicação da grade exibida: {actionHint} A conferência usa a revisão publicada, que pode ser diferente.</p>}
    <div className="flex flex-wrap gap-2"><button disabled={!selection.canReview} onClick={()=>void perform(false)}>Conferir ajuste</button><button disabled={pending||!operation&&(!review||!selection.showReview)} onClick={()=>void perform(true)}>{operation?'Consultar solicitação':'Confirmar compensação'}</button></div>
    {review&&selection.showReview&&<div role="status"><CompensationAnchorReview review={review} rate={rate}/><p>{review.title} — nominal: {dur(review.beforeFrames,rate)} → {dur(review.afterFrames,rate)}</p><p>Executável pelo timing: {dur(review.beforeEffectiveFrames,rate)} → {dur(review.afterEffectiveFrames,rate)}</p><p>{review.notice}</p>{review.conflicts.map((conflict,index)=><p key={index}>{conflict.message}</p>)}</div>}
    {operation&&<div><p>Consultar não reenvia comandos. Reenvio explícito usa o mesmo identificador e não duplica o ajuste.</p><button disabled={pending} onClick={()=>void perform(true,true)}>Reenviar mesma solicitação</button><button disabled={pending} onClick={()=>{setOperation(null);setReview(null);setMessage('Aviso dispensado na tela; não desfaz compensação já gravada. Confira a revisão/duração antes de outro ajuste.')}}>Dispensar aviso e conferir novamente</button></div>}
    {message&&<p role="status">{message}</p>}
  </section>
}
