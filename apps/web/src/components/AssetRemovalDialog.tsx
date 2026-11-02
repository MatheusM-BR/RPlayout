import {useEffect,useRef,useState} from 'react'
import type {AssetRemovalReview} from '@rplayout/protocol'
import {api} from '../api.js'
import {assetRemovalHeaders,removalSelection} from '../domain/asset-removal-review.js'
import {BoundedLatestRead} from '../domain/bounded-latest-read.js'
import {ReviewedOperationConfirm} from './broadcast/ReviewedOperationConfirm.js'
interface Props {assetId:string|null;onApplied:(message:string)=>void;onCancel:()=>void}
/** The proof and selected subset belong to one explicit review. Polling and
 * errors never silently replace that proof or resubmit an uncertain removal. */
export function AssetRemovalDialog(props:Props){return <RemovalDialog key={props.assetId??'@prune'} {...props}/>}
function RemovalDialog({assetId,onApplied,onCancel}:Props){
  const [review,setReview]=useState<AssetRemovalReview|null>(null),[selected,setSelected]=useState<string[]>([]),[ack,setAck]=useState(false)
  const [busy,setBusy]=useState(false),[blocked,setBlocked]=useState(true),[error,setError]=useState(''),[complete,setComplete]=useState(false)
  const alive=useRef(true),generation=useRef(0),pending=useRef(false)
  const reads=useRef(new BoundedLatestRead())
  const [reopening,setReopening]=useState(false)
  const current=(id:number)=>alive.current&&generation.current===id
  const start=()=>{if(pending.current)return null;pending.current=true;setBusy(true);return generation.current}
  const finish=(id:number)=>{if(current(id)){pending.current=false;setBusy(false)}}
  const failed=(id:number,cause:unknown)=>{if(current(id)){setBlocked(true);setError(cause instanceof Error?cause.message:'Falha de conferência.')}}
  const load=async()=>{
    if(pending.current||complete)return
    setReopening(false);setBlocked(true);setAck(false)
    const id=start();if(id===null)return
    try{const reading=await reads.current.read(signal=>api.assetRemovalReview(assetId,signal),'A conferência de impacto demorou demais. Nenhuma remoção foi enviada; confira novamente.');if(!current(id)||!reading.current)return
      const next=reading.value
      assetRemovalHeaders(assetId,next)
      setReview(next);setSelected(next.assets.filter(asset=>!asset.blockers.length).map(asset=>asset.assetId));setAck(false);setBlocked(false);setError('')
    }catch(cause){failed(id,cause)}finally{finish(id)}
  }
  useEffect(()=>{alive.current=true;generation.current++;pending.current=false;void load();return()=>{alive.current=false;generation.current++;pending.current=false;reads.current.cancel()}},[assetId])
  let valid=false;try{if(review){removalSelection(review,selected,ack);valid=true}}catch{}
  const save=async()=>{
    if(!review||!valid||blocked||complete||reopening)return
    const original=review,id=start();if(id===null)return
    try{const result=await api.removeAssets(assetId,original,selected,ack);if(!current(id))return
      if(!result.applied||result.filesPreserved!==true||result.historyPreserved!==true||result.automaticTake!==false)throw new Error('Resposta sem confirmação completa. Confira o acervo antes de continuar.')
      setComplete(true);setBlocked(true);setError('')
      try{onApplied(result.refreshError??`${result.removed} registro(s) ${assetId===null?'limpos':'ocultados'}; ${result.removedItems} item(ns) removidos e ${result.clearedFallbacks} fallback(s) desvinculados. Arquivos em disco e histórico preservados.`)}
      catch{if(current(id))setError('Remoção gravada; atualização da tela indisponível. Não repita o comando. Arquivos e histórico preservados.')}
    }catch(cause){failed(id,cause)}finally{finish(id)}
  }
  return <div role="dialog" aria-modal="true" aria-label="Conferência de remoção do acervo" className="fixed inset-0 z-[70] bg-black/70 flex items-center justify-center p-4" onClick={event=>event.stopPropagation()}>
    <section className="bg-surface-card text-on-surface border border-border-subtle rounded p-5 w-full max-w-3xl max-h-[90vh] flex flex-col gap-3">
      <h2 className="font-bold">{assetId===null?'Conferir limpeza de vídeos que não abriram':'Conferir remoção do acervo'}</h2>
      <p className="text-sm text-outline">{assetId===null?'Remove somente os registros selecionados desta conferência.':'Oculta o arquivo do acervo, sem apagar seu registro.'} Não apaga arquivos no servidor nem histórico; não executa CUE ou TAKE. Publicações protegidas não são alteradas.</p>
      {!review&&<p role="status">{busy?'Conferindo impacto…':'Impacto não conferido. Não significa acervo vazio.'}</p>}
      {error&&<p role="alert" className="text-armed-amber">{error} Seleção preservada. Reabra explicitamente; não haverá repetição automática.</p>}
      {complete&&<p role="status">Remoção gravada. Feche a conferência para continuar.</p>}
      <fieldset disabled={busy||blocked||complete||reopening} className="overflow-auto min-h-0 flex flex-col gap-3">
        {review?.assets.length===0&&<p>Nenhum vídeo elegível para limpeza nesta conferência.</p>}
        {review?.assets.map(asset=><article key={asset.assetId} className="border border-border-subtle rounded p-3">
          <label className="flex gap-2"><input type="checkbox" disabled={Boolean(asset.blockers.length)} checked={selected.includes(asset.assetId)} onChange={event=>{setAck(false);setSelected(previous=>event.target.checked?[...previous,asset.assetId]:previous.filter(id=>id!==asset.assetId))}}/><span>{asset.title}</span></label>
          <p className="text-xs text-outline">{asset.publishedReferences} publicação(ões), {asset.historicalReferences} execução(ões) encerradas — preservadas.</p>
          {asset.uses.map(use=><p key={use.itemId} className="text-sm">{use.channelName} / {use.rundownName} / {use.itemTitle}: {use.action==='REMOVE_ITEM'?'remover item da grade':'desvincular apenas o fallback; manter entrada ao vivo'}.</p>)}
          {asset.blockers.map(reason=><p key={reason} className="text-armed-amber text-sm">Protegido: {reason}</p>)}
        </article>)}
        {review?.assets.some(asset=>selected.includes(asset.assetId)&&asset.uses.length>0)&&<label className="flex gap-2"><input type="checkbox" checked={ack} onChange={event=>setAck(event.target.checked)}/>Confirmo remover os itens e desvincular os fallbacks selecionados acima. Será necessário conferir e publicar a grade alterada.</label>}
      </fieldset>
      <div className="flex flex-wrap gap-2 shrink-0">
        <button className="px-3 py-2 border rounded disabled:opacity-50" disabled={busy} onClick={onCancel}>Fechar conferência</button>
        <button className="px-3 py-2 border rounded disabled:opacity-50" disabled={busy||complete} onClick={()=>{if(review)setReopening(true);else void load()}}>Reabrir impacto</button>
      </div>
      <ReviewedOperationConfirm reviewKey={review?JSON.stringify([assetId,review.token,[...selected].sort(),ack]):null}
        confirmation="Autorizo remover somente os registros e vínculos selecionados nesta conferência, preservando os arquivos em disco e o histórico."
        label="Confirmar remoção conferida" disabled={busy||blocked||complete||reopening||!valid} onConfirm={save}/>
      {reopening&&<section aria-label="Reabertura do impacto de remoção">
        <ReviewedOperationConfirm reviewKey={JSON.stringify([assetId,review?.token,generation.current,'REOPEN'])} disabled={busy}
          confirmation="Autorizo descartar a seleção e os consentimentos anteriores para consultar novamente o impacto. Nenhuma remoção será enviada."
          label="Descartar seleção e reconferir impacto" onConfirm={load}/>
        <button disabled={busy} onClick={()=>setReopening(false)}>Manter seleção</button>
      </section>}
    </section>
  </div>
}
