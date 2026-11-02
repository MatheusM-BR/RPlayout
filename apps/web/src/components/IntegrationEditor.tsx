import {useEffect,useRef,useState} from 'react'
import type {IntegrationReview} from '@rplayout/protocol'
import {api} from '../api.js'
import {commandRequestId} from '../domain/request-id.js'
import {BoundedLatestRead} from '../domain/bounded-latest-read.js'
import {ReviewedOperationConfirm} from './broadcast/ReviewedOperationConfirm.js'
export function IntegrationEditor({id,onClose,onSaved}:{id:string;onClose:()=>void;onSaved:(message:string)=>void}){
  const [review,setReview]=useState<IntegrationReview|null>(null),[name,setName]=useState(''),[events,setEvents]=useState(''),[enabled,setEnabled]=useState(false),[url,setUrl]=useState('')
  const [busy,setBusy]=useState(false),[blocked,setBlocked]=useState(true),[error,setError]=useState(''),[message,setMessage]=useState('')
  const alive=useRef(true),generation=useRef(0),pending=useRef(false),testRequest=useRef<string|null>(null)
  const reads=useRef(new BoundedLatestRead()),[intent,setIntent]=useState<'CLOSE'|'REOPEN'|'TEST'|null>(null)
  const dirty=Boolean(review&&(name!==review.name||events!==review.events.join(',')||enabled!==review.enabled||url))
  const current=(at:number)=>alive.current&&generation.current===at
  const load=async(reopen:boolean)=>{
    if(pending.current)return
    setIntent(null)
    pending.current=true;setBusy(true);const at=generation.current
    try{const reading=await reads.current.read(signal=>api.integrationReview(id,signal),'A consulta da integração demorou demais. Campos preservados; nenhuma gravação ou teste foi enviado.');if(!current(at)||!reading.current)return;const value=reading.value;if(value.id!==id)throw new Error('Conferência de outro gateway recusada.')
      setReview(value);setName(value.name);setEvents(value.events.join(','));setEnabled(value.enabled);setUrl('');setBlocked(false);setError('');testRequest.current=null
    }catch(cause){if(current(at)){setBlocked(true);setError(cause instanceof Error?cause.message:'Conferência indisponível.')}}finally{if(current(at)){pending.current=false;setBusy(false)}}
  }
  useEffect(()=>{alive.current=true;generation.current++;pending.current=false;void load(false);return()=>{alive.current=false;generation.current++;pending.current=false;reads.current.cancel()}},[id])
  const act=async(test:boolean)=>{
    if(pending.current||blocked||!review?.canEdit||test&&dirty)return
    setIntent(null)
    pending.current=true;setBusy(true);const at=generation.current,original=review
    try{
      if(test){const requestId=testRequest.current??commandRequestId();testRequest.current=requestId;const result=await api.testIntegration(id,original,requestId);if(!current(at))return
        if(result.queued!==true||typeof result.deliveryId!=='string'||!result.deliveryId||typeof result.state!=='string'||!result.state)throw new Error('Registro de teste sem confirmação; confira a fila antes de repetir.')
        setMessage(`Teste registrado: ${result.deliveryId} · ${result.state}. Consulte a fila; registro não comprova resposta do gateway.`)
      }else{
        const body={...(name!==original.name?{name}:{}),...(events!==original.events.join(',')?{events:events.split(',').map(value=>value.trim()).filter(Boolean)}:{}),...(enabled!==original.enabled?{enabled}:{}),...(url.trim()?{url:url.trim()}: {})}
        const result=await api.patchIntegration(id,body,original);if(!current(at))return
        setReview(result);setName(result.name);setEvents(result.events.join(','));setEnabled(result.enabled);setUrl('');setBlocked(true)
        try{onSaved('Integração gravada. Nenhum teste ou TAKE foi disparado.')}catch{setMessage('Gravação confirmada; atualização da tela falhou. Não repita a operação.')}
      }
    }catch(cause){if(current(at)){setBlocked(true);setError(cause instanceof Error?cause.message:'Operação sem confirmação.')}}finally{if(current(at)){pending.current=false;setBusy(false)}}
  }
  return <div role="dialog" aria-modal="true" aria-label="Conferência da integração" className="fixed inset-0 z-[70] bg-black/70 flex items-center justify-center p-4"><section className="bg-surface-card border rounded p-5 w-full max-w-xl flex flex-col gap-3">
    <h2>Conferir integração</h2><p>Destino atual: {review?.url??'ainda não conferido'}. URL privada não é devolvida pelo servidor.</p>
    {error&&<p role="alert">{error} Campos preservados; reabra explicitamente.</p>}{message&&<p role="status">{message}</p>}
    <fieldset disabled={busy||blocked||intent!==null||!review?.canEdit} className="flex flex-col gap-2">
      <label>Nome<input value={name} onChange={event=>setName(event.target.value)} maxLength={256}/></label>
      <label>Substituir URL privada (vazio conserva)<input type="password" autoComplete="new-password" value={url} onChange={event=>setUrl(event.target.value)} maxLength={4096}/></label>
      <label>Eventos<input value={events} onChange={event=>setEvents(event.target.value)}/></label>
      <label><input type="checkbox" checked={enabled} onChange={event=>setEnabled(event.target.checked)}/>Integração ativa</label>
    </fieldset>
    <button disabled={busy} onClick={()=>{if(dirty)setIntent('CLOSE');else onClose()}}>Fechar</button>
    <button disabled={busy} onClick={()=>{if(dirty)setIntent('REOPEN');else void load(true)}}>Reabrir conferência</button>
    <button disabled={busy||intent!==null||blocked||!review?.canEdit||!dirty||!name.trim()||!events.trim()} onClick={()=>void act(false)}>Salvar integração conferida</button>
    <button disabled={busy||blocked||!review?.canEdit||dirty} onClick={()=>setIntent('TEST')}>Agendar teste conferido</button>
    {intent&&<section aria-label="Confirmação da integração">
      <ReviewedOperationConfirm reviewKey={JSON.stringify([id,review?.revision??'unread',generation.current,intent])}
        disabled={busy||intent==='TEST'&&(blocked||!review?.canEdit||dirty)}
        confirmation={intent==='TEST'?`Autorizo registrar um POST de teste para ${review?.name??'a integração conferida'} (${review?.url??'destino não conferido'}). Registro não comprova resposta do gateway.`:'Autorizo descartar os campos e a URL em edição, sem enviar gravação ou teste.'}
        label={intent==='TEST'?'Confirmar registro do teste':intent==='REOPEN'?'Descartar campos e reabrir':'Descartar campos e fechar'}
        onConfirm={async()=>{if(intent==='TEST')await act(true);else if(intent==='REOPEN')await load(true);else{setIntent(null);onClose()}}}/>
      <button disabled={busy} onClick={()=>setIntent(null)}>Manter edição / cancelar teste</button>
    </section>}
  </section></div>
}
