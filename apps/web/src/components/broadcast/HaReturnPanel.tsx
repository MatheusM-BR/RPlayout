import {useEffect,useRef,useState} from 'react'
import {api,type HaReturnPlan,type HaExecutionObservation} from '../../api.js'
import {HaExportPanel} from './HaExportPanel.js'
const labels:Record<string,string>={LOCAL_OWNER_CHANGED:'Instância original não é mais a atual; recursos perdidos exigem revisão.',STOP_NOT_CONFIRMED:'Parada de todos os recursos e liberação da reserva ainda não confirmadas.',ASSIGNMENT_CHANGED:'A autoridade da testemunha mudou em relação a esta execução.',LEASE_STILL_ACTIVE:'Ainda há concessão ativa ou aguardando expiração.',CONTROL_OUTCOMES_UNRESOLVED:'Há CUE/TAKE com resultado ainda não reconciliado.',EXECUTION_EXPORT_NOT_SEALED:'Falta exportação selada dos dados executados na reserva.',REVERSE_SYNC_NOT_CONFIRMED:'Falta sincronização reversa confirmada no principal.',PRIMARY_RECONCILIATION_NOT_CONFIRMED:'Falta revisão de playlist, mídia, histórico e retomada no principal.'}
export function HaReturnPanel({row,stale}:{row:HaExecutionObservation;stale:boolean}){
  const [plan,setPlan]=useState<HaReturnPlan|null>(null),[error,setError]=useState<string|null>(null),[busy,setBusy]=useState(false)
  const active=useRef(true),loading=useRef(false)
  useEffect(()=>{active.current=true;return()=>{active.current=false}},[])
  const inspect=async()=>{
    if(loading.current)return;loading.current=true;setBusy(true);setError(null)
    try{const value=await api.haReturnPlanReview(row.requestId,row.channelId);if(value.promotionId!==row.requestId||value.channelId!==row.channelId||value.transferReady!==false||value.automaticRestart!==false)throw new Error();if(active.current)setPlan(value)}
    catch{if(active.current)setError('Conferência indisponível. Dados anteriores podem estar desatualizados; nenhuma transferência foi feita.')}
    finally{loading.current=false;if(active.current)setBusy(false)}
  }
  return <section aria-label="Retorno ao servidor principal" className="border rounded p-2 space-y-2">
    <button disabled={busy||stale} onClick={()=>void inspect()} className="underline">Conferir retorno ao principal</button>
    {error&&<p role="alert" className="text-armed-amber">{error}</p>}
    {plan&&<HaExportPanel plan={plan} stale={stale||!!error}/>}
    {plan&&<><p>Retorno ainda bloqueado · conferido em {new Date(plan.checkedAt).toLocaleString('pt-BR')}</p><ul className="list-disc pl-4">{plan.blockers.map(reason=><li key={reason}>{labels[reason]??'Pré-requisito operacional não confirmado.'}</li>)}</ul><p className="text-outline">Consulta não devolve autoridade nem inicia engine. Parada da reserva não equivale a dados sincronizados ou principal pronto.</p></>}
  </section>
}
