import {useState} from 'react'
export function QcMediaRetryControl({pending,requiresConfirmation,onRetry}:{pending:boolean;requiresConfirmation:boolean;onRetry:(confirmed:boolean)=>void}){
  const [confirmed,setConfirmed]=useState(false)
  return <div className="flex flex-col gap-1 shrink-0" aria-label="Recuperação dos trabalhos de mídia">
    {requiresConfirmation&&<label className="flex items-start gap-1 max-w-sm"><input type="checkbox" disabled={pending} checked={confirmed} onChange={event=>setConfirmed(event.target.checked)}/><span>Verifiquei que o servidor anterior e seus trabalhos de mídia estão encerrados. Esta confirmação não encerra processos.</span></label>}
    <button disabled={pending||requiresConfirmation&&!confirmed} className="text-primary disabled:opacity-40" onClick={()=>{
      if(pending||requiresConfirmation&&!confirmed)return
      onRetry(requiresConfirmation&&confirmed)
      setConfirmed(false)
    }}>{pending?'Aguardando confirmação da fila…':'Tentar novamente'}</button>
  </div>
}
