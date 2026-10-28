import {useEffect,useRef,useState} from 'react'
import type {MultiviewLayout,MultiviewReview} from '@rplayout/protocol'
import {api} from '../../api.js'
import {OperationalMultiview,type MultiviewSourceItem} from './OperationalMultiview.js'

/** Mounted by channel. Monitoring refresh NEVER renews an opened edit proof. */
export function SharedMultiview({channelId,sources,loading=false,onWatchingBus}:{channelId:string;sources:MultiviewSourceItem[];loading?:boolean;onWatchingBus:(bus:'pvw'|'mon')=>void}){
  const [review,setReview]=useState<MultiviewReview|null>(null),[layout,setLayout]=useState<MultiviewLayout>('GRID_2X2')
  const [message,setMessage]=useState('Conferindo layout salvo…'),[blocked,setBlocked]=useState(false),[busy,setBusy]=useState(false)
  const pending=useRef(false),mounted=useRef(true),generation=useRef(0),dirty=useRef(false)
  useEffect(()=>{
    mounted.current=true
    return()=>{mounted.current=false;generation.current++}
  },[])
  async function load(){
    const request=++generation.current
    try{
      const value=await api.multiviewReview(channelId)
      if(!mounted.current||request!==generation.current)return
      setReview(value);setLayout(value.layout);setBlocked(false);dirty.current=false
      setMessage('Layout conferido. Trocar a visualização é local; Salvar compartilha neste canal, sem CUE ou TAKE.')
    }catch(error){
      if(!mounted.current||request!==generation.current)return
      setBlocked(true);setMessage(error instanceof Error?error.message:'Não foi possível conferir o multiview.')
      throw error
    }
  }
  useEffect(()=>{
    void load().catch(()=>undefined)
  },[channelId])
  async function reopen(){
    if(pending.current||dirty.current&&!window.confirm('Reabrir descarta o layout local em edição. Continuar?'))return
    pending.current=true;setBusy(true);setBlocked(true)
    try{await load()}catch{/* Only the current request sets its own error. */}
    finally{pending.current=false;if(mounted.current)setBusy(false)}
  }
  async function save(){
    if(pending.current||blocked||!review)return
    pending.current=true;setBusy(true)
    const original=review,draft=layout
    try{
      const saved=await api.saveMultiview(channelId,draft,original)
      if(!mounted.current)return
      setReview(saved);setLayout(saved.layout);dirty.current=false
      setBlocked(Boolean(saved.refreshError));setMessage(saved.refreshError??'Layout compartilhado gravado. PGM e PVW não foram alterados.')
    }catch(error){if(mounted.current){setBlocked(true);setMessage(error instanceof Error?error.message:'Gravação não confirmada; reabra antes de repetir.')}}
    finally{pending.current=false;if(mounted.current)setBusy(false)}
  }
  return <div className="flex h-full min-h-0 flex-col gap-2">
    <div className="shrink-0 rounded border border-border-subtle bg-surface-panel px-3 py-2">
      <div className="flex items-center gap-2"><button type="button" disabled={busy||blocked||!review} onClick={()=>void save()} className="btn">Salvar layout no canal</button><button type="button" disabled={busy} onClick={()=>void reopen()} className="btn">Reabrir conferência</button><span className="text-[11px] text-outline">Tally e sinal vêm do engine, não da configuração salva.</span></div>
      <p role={blocked?'alert':'status'} className="mt-1 text-[11px] text-outline">{message}</p>
    </div>
    <div className="min-h-0 flex-1"><OperationalMultiview sources={sources} loading={loading} selectedLayout={layout} layoutDisabled={busy||!review} onLayoutChange={value=>{if(!pending.current&&review){dirty.current=true;setLayout(value)}}} onWatchingBus={onWatchingBus}/></div>
  </div>
}
