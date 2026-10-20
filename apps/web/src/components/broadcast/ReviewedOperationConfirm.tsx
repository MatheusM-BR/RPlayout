import {useEffect,useRef,useState} from 'react'

interface Props {reviewKey:string|null;confirmation:string;label:string;disabled:boolean;onConfirm:()=>Promise<void>}
/** Consent belongs to exactly one reviewed operation, not the browser dialog
 * or a previous selection. Server tokens/permissions remain authoritative. */
export function ReviewedOperationConfirm(props:Props){
  return <Confirmation key={props.reviewKey??'unreviewed'} {...props}/>
}
function Confirmation({reviewKey,confirmation,label,disabled,onConfirm}:Props){
  const [confirmed,setConfirmed]=useState(false),[sending,setSending]=useState(false),[failure,setFailure]=useState<string|null>(null)
  const lock=useRef(false)
  useEffect(()=>{if(disabled)setConfirmed(false)},[disabled])
  const submit=async()=>{
    if(lock.current||disabled||!reviewKey||!confirmed)return
    lock.current=true;setSending(true);setConfirmed(false);setFailure(null)
    try{await onConfirm()}
    catch(cause){setFailure(cause instanceof Error?cause.message:'Resultado não confirmado. Confira o registro antes de repetir.')}
    finally{lock.current=false;setSending(false)}
  }
  return <div className="space-y-2 rounded border border-armed-amber/40 p-2" aria-label={`Confirmação: ${label}`}>
    {reviewKey&&<label className="flex items-start gap-2"><input type="checkbox" checked={confirmed} disabled={disabled||sending} onChange={event=>setConfirmed(event.target.checked)}/><span>{confirmation}</span></label>}
    <button type="button" disabled={disabled||sending||!reviewKey||!confirmed} onClick={()=>void submit()} className="rounded border border-armed-amber p-2 disabled:opacity-40">{label}</button>
    {sending&&<p role="status">Solicitação enviada. Aguarde o resultado; não repita o comando.</p>}
    {failure&&<p role="alert">{failure}</p>}
  </div>
}
