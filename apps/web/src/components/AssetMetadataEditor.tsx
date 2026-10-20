import {useEffect,useRef,useState} from 'react'
import type {AssetMetadataReview} from '@rplayout/protocol'
import {api} from '../api.js'
import {assetMetadataHeaders} from '../domain/asset-metadata-review.js'
import {BoundedLatestRead} from '../domain/bounded-latest-read.js'
import {ReviewedOperationConfirm} from './broadcast/ReviewedOperationConfirm.js'

interface Props {assetId:string;categories:string[];onSaved:(review:AssetMetadataReview,message:string)=>void;onCancel:()=>void}
/** Mount with key=assetId. Polling/catalog updates never replace a draft proof. */
export function AssetMetadataEditor(props:Props){return <MetadataEditor key={props.assetId} {...props}/>}
function MetadataEditor({assetId,categories,onSaved,onCancel}:Props){
  const [review,setReview]=useState<AssetMetadataReview|null>(null),[title,setTitle]=useState(''),[category,setCategory]=useState('')
  const [busy,setBusy]=useState(false),[blocked,setBlocked]=useState(true),[error,setError]=useState('')
  const alive=useRef(true),generation=useRef(0),busyRef=useRef(false)
  const reads=useRef(new BoundedLatestRead())
  const [intent,setIntent]=useState<'CLOSE'|'REOPEN'|null>(null)
  const dirty=Boolean(review&&(title!==review.title||category!==(review.categoryId??'')))
  const current=(id:number)=>alive.current&&generation.current===id
  const start=()=>{if(busyRef.current)return null;busyRef.current=true;setBusy(true);return generation.current}
  const finish=(id:number)=>{if(current(id)){busyRef.current=false;setBusy(false)}}
  const failure=(id:number,cause:unknown)=>{if(current(id)){setBlocked(true);setError(cause instanceof Error?cause.message:'Não foi possível conferir o acervo.')}}
  const load=async()=>{
    if(busyRef.current)return
    setIntent(null);setBlocked(true)
    const id=start();if(id===null)return
    try{const reading=await reads.current.read(signal=>api.assetMetadataReview(assetId,signal),'A conferência do arquivo demorou demais. Campos preservados; nenhum metadado foi enviado.');if(!current(id)||!reading.current)return
      const value=reading.value;assetMetadataHeaders(assetId,value)
      setReview(value);setTitle(value.title);setCategory(value.categoryId??'');setError('');setBlocked(false)
    }catch(cause){failure(id,cause)}finally{finish(id)}
  }
  useEffect(()=>{alive.current=true;generation.current++;busyRef.current=false;void load()
    return()=>{alive.current=false;generation.current++;busyRef.current=false;reads.current.cancel()}
  },[assetId])
  const save=async()=>{
    if(blocked||intent||!review?.canEdit)return
    const original=review,id=start();if(id===null)return
    try{
      const body={...(title!==original.title?{title}:{}),...(category!==(original.categoryId??'')?{categoryId:category.trim()||null}:{})}
      const result=await api.patchAssetMetadata(assetId,body,original);if(!current(id))return
      if(result.assetId!==assetId||!result.applied)throw new Error('Gravação sem confirmação do arquivo; confira antes de continuar.')
      setReview(result);setTitle(result.title);setCategory(result.categoryId??'');setError('')
      try{onSaved(result,result.refreshError??'Título e categoria gravados. Grade publicada, PGM e PVW preservados.')}
      catch{if(current(id)){setBlocked(true);setError('Metadados gravados; atualização da tela indisponível. Confira o arquivo antes de outra gravação.')}}
    }catch(cause){failure(id,cause)}finally{finish(id)}
  }
  const cancel=()=>{if(busyRef.current)return;if(dirty)setIntent('CLOSE');else onCancel()}
  return <div role="dialog" aria-modal="true" aria-label="Título e categoria do acervo" className="fixed inset-0 z-[70] bg-black/70 flex items-center justify-center p-4" onClick={event=>event.stopPropagation()}>
    <section className="bg-surface-card text-on-surface border border-border-subtle rounded p-5 w-full max-w-lg flex flex-col gap-3">
      <h2 className="font-bold">Título e categoria do acervo</h2>
      <p className="text-sm text-outline">Dados compartilhados entre canais. Editar não grava nem aprova no QC. Salvar exige a conferência original.</p>
      {!review&&<p role="status">{busy?'Conferindo arquivo…':'Arquivo não conferido. Não é confirmação de acervo vazio.'}</p>}
      {error&&<p role="alert" className="text-armed-amber">{error} Campos preservados. Reabra explicitamente antes de salvar.</p>}
      {review&&!review.canEdit&&<p role="status">Sua conta pode conferir, mas não editar metadados compartilhados.</p>}
      <fieldset disabled={busy||blocked||intent!==null||!review?.canEdit} className="flex flex-col gap-3">
        <label className="flex flex-col">Título<input value={title} onChange={event=>setTitle(event.target.value)} maxLength={512} className="p-2 bg-surface-panel border border-border-subtle rounded"/></label>
        <label className="flex flex-col">Categoria (vazia remove)<input value={category} onChange={event=>setCategory(event.target.value)} list={`asset-categories-${assetId}`} maxLength={128} className="p-2 bg-surface-panel border border-border-subtle rounded"/></label>
        <datalist id={`asset-categories-${assetId}`}>{categories.map(value=><option key={value} value={value}/>)}</datalist>
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <button className="px-3 py-2 border rounded disabled:opacity-50" disabled={busy} onClick={cancel}>Fechar edição</button>
        <button className="px-3 py-2 border rounded disabled:opacity-50" disabled={busy} onClick={()=>{if(dirty)setIntent('REOPEN');else void load()}}>Reabrir conferência do arquivo</button>
        <button className="px-3 py-2 border rounded disabled:opacity-50" disabled={busy||blocked||intent!==null||!review?.canEdit||!dirty||!title.trim()} onClick={()=>void save()}>Salvar metadados conferidos</button>
      </div>
      {intent&&<section aria-label="Descarte de edição de metadados">
        <ReviewedOperationConfirm reviewKey={JSON.stringify([assetId,review?.revision,generation.current,intent])} disabled={busy}
          confirmation="Autorizo descartar somente os campos locais de título e categoria. Nenhum metadado será gravado."
          label={intent==='REOPEN'?'Descartar metadados locais e reabrir':'Descartar metadados locais e fechar'}
          onConfirm={async()=>{if(intent==='REOPEN')await load();else{setIntent(null);onCancel()}}}/>
        <button disabled={busy} onClick={()=>setIntent(null)}>Manter edição</button>
      </section>}
    </section>
  </div>
}
