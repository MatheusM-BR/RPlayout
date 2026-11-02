import {useEffect,useRef,useState} from 'react'
import type {CategoryReview} from '@rplayout/protocol'
import {api} from '../api.js'
import {BoundedLatestRead} from '../domain/bounded-latest-read.js'
import {ReviewedOperationConfirm} from './broadcast/ReviewedOperationConfirm.js'
export function CategoryEditor({id,initialColor,onSaved,onCancel}:{id:string;initialColor?:string;onSaved:(message:string)=>void;onCancel:()=>void}){
  const [review,setReview]=useState<CategoryReview|null>(null),[color,setColor]=useState(initialColor??'#5570ab'),[busy,setBusy]=useState(false),[blocked,setBlocked]=useState(true),[error,setError]=useState('')
  const alive=useRef(true),epoch=useRef(0),pending=useRef(false)
  const reads=useRef(new BoundedLatestRead())
  const [intent,setIntent]=useState<'CLOSE'|'REOPEN'|'REMOVE'|null>(null)
  const dirty=Boolean(review&&color!==review.color)
  const current=(at:number)=>alive.current&&epoch.current===at
  const load=async(reopen:boolean)=>{
    if(pending.current)return
    setIntent(null)
    pending.current=true;setBusy(true);const at=epoch.current
    try{const reading=await reads.current.read(signal=>api.categoryReview(id,signal),'A consulta da categoria demorou demais. Nenhuma alteração foi enviada; reabra a conferência.');if(!current(at)||!reading.current)return;const result=reading.value;if(result.id!==id)throw new Error('Conferência de outra categoria recusada.')
      setReview(result);setColor(!reopen&&initialColor?initialColor:result.color);setBlocked(false);setError('')
    }catch(cause){if(current(at)){setBlocked(true);setError(cause instanceof Error?cause.message:'Conferência indisponível.')}}
    finally{if(current(at)){pending.current=false;setBusy(false)}}
  }
  useEffect(()=>{alive.current=true;epoch.current++;pending.current=false;void load(false);return()=>{alive.current=false;epoch.current++;pending.current=false;reads.current.cancel()}},[id])
  const apply=async(remove:boolean)=>{
    if(pending.current||blocked||!review?.canEdit)return
    setIntent(null)
    const original=review,at=epoch.current;pending.current=true;setBusy(true)
    try{const result=remove?await api.removeCategory(id,original):await api.setCategoryColor(id,color,original);if(!current(at))return
      if(result.id!==id||!result.applied)throw new Error('Gravação sem confirmação; confira antes de repetir.')
      setReview(result);setColor(result.color);setBlocked(true)
      try{onSaved(result.refreshError??(remove?'Categoria removida; arquivos preservados.':'Cor gravada; PGM e publicação preservados.'))}catch{setError('Gravação confirmada; atualização da tela falhou. Não repita a operação.')}
    }catch(cause){if(current(at)){setBlocked(true);setError(cause instanceof Error?cause.message:'Categoria não alterada.')}}
    finally{if(current(at)){pending.current=false;setBusy(false)}}
  }
  return <div role="dialog" aria-modal="true" aria-label="Conferência de categoria" className="fixed inset-0 z-[70] bg-black/70 flex items-center justify-center p-4">
    <section className="bg-surface-card border rounded p-5 w-full max-w-lg flex flex-col gap-3">
      <h2 className="font-bold">Categoria · {id}</h2><p>Categorias e cores são compartilhadas entre canais. Gravar não executa TAKE.</p>
      {!review&&<p role="status">Categoria ainda não conferida.</p>}
      {review&&<p>{review.stored?'Categoria com cor cadastrada.':review.items?'Categoria usada no acervo, sem cor cadastrada.':'Categoria nova, ainda não criada.'} {review.items} arquivo(s) vinculados.</p>}
      {review&&!review.canEdit&&<p>Sua conta pode conferir, mas não alterar categorias compartilhadas.</p>}
      {error&&<p role="alert">{error} Campos preservados; reabra explicitamente.</p>}
      <label>Cor<input type="color" value={color} disabled={busy||blocked||intent!==null||!review?.canEdit} onChange={event=>setColor(event.target.value)}/></label>
      <div className="flex flex-wrap gap-2">
        <button disabled={busy} onClick={()=>{if(dirty)setIntent('CLOSE');else onCancel()}}>Fechar</button>
        <button disabled={busy} onClick={()=>{if(dirty)setIntent('REOPEN');else void load(true)}}>Reabrir conferência</button>
        <button disabled={busy||intent!==null||blocked||!review?.canEdit||!/^#[a-f0-9]{6}$/i.test(color)||review.stored&&!dirty} onClick={()=>void apply(false)}>Salvar cor conferida</button>
        <button disabled={busy||blocked||!review?.canEdit||!review.stored&&!review.items} onClick={()=>setIntent('REMOVE')}>Remover categoria conferida</button>
      </div>
      {intent&&<section aria-label="Confirmação de categoria">
        <ReviewedOperationConfirm reviewKey={JSON.stringify([id,review?.revision??'unread',epoch.current,intent])} disabled={busy||intent==='REMOVE'&&(blocked||!review?.canEdit)}
          confirmation={intent==='REMOVE'?`Autorizo remover "${id}" e retirar a marca de ${review?.items??0} arquivo(s), sem apagar os arquivos.`:'Autorizo descartar somente a cor em edição. Nenhuma gravação será enviada.'}
          label={intent==='REMOVE'?'Confirmar remoção da categoria':intent==='REOPEN'?'Descartar cor e reabrir':'Descartar cor e fechar'}
          onConfirm={async()=>{if(intent==='REMOVE')await apply(true);else if(intent==='REOPEN')await load(true);else{setIntent(null);onCancel()}}}/>
        <button disabled={busy} onClick={()=>setIntent(null)}>Manter edição</button>
      </section>}
    </section>
  </div>
}
