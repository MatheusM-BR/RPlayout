import {useEffect,useRef,useState} from 'react'
import {api,type HaReturnCandidateRequest,type HaReturnBindingReport,type HaReturnBindingRequest} from '../../api.js'
import {newHaMonitorId} from '../../domain/ha-monitor-pending.js'
import {HaReturnApplicationPanel} from './HaReturnApplicationPanel.js'
type Choice={disposition:'LOCAL'|'DISABLED';localTarget:string;reason:string}
type Intent={candidate:HaReturnCandidateRequest;requestId:string}
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i
export function HaReturnBindingsPanel({candidate,sourceDatabaseHash,stale}:{candidate:HaReturnCandidateRequest;sourceDatabaseHash:string;stale:boolean}){
  const key='rplayout.ha.return-bindings.v1:'+candidate.candidateId
  const [report,setReport]=useState<HaReturnBindingReport|null>(null),[intent,setIntent]=useState<Intent|null>(null),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null)
  const [inputs,setInputs]=useState<Record<string,string>>({}),[outputs,setOutputs]=useState<Record<string,Choice>>({})
  const generation=useRef(0),running=useRef(false)
  const sameCandidate=(value:HaReturnCandidateRequest)=>value&&Object.keys(value).sort().join(',')==='candidateId,channelId,planId'&&value.candidateId===candidate.candidateId&&value.planId===candidate.planId&&value.channelId===candidate.channelId
  const parseIntent=(raw:unknown)=>{const value=raw as Intent;if(!value||Object.keys(value).sort().join(',')!=='candidate,requestId'||!sameCandidate(value.candidate)||typeof value.requestId!=='string'||!uuid.test(value.requestId))throw new Error();return value}
  useEffect(()=>{generation.current++;setBusy(false);setReady(false);try{const raw=sessionStorage.getItem(key);setIntent(raw?parseIntent(JSON.parse(raw)):null);setReady(true)}catch{setError('Pedido guardado inválido/inacessível; preservado para conferência.')}return()=>{generation.current++}},[key,stale])
  const validate=(value:HaReturnBindingReport)=>{
    const review=value.review
    if(!sameCandidate(value.candidate)||value.bindingsResolved!==false||value.publicationAuthorized!==false||value.operationalReady!==false||review?.channelId!==candidate.channelId||review.sequence!==1||typeof review.reviewToken!=='string'||!review.reviewToken||review.automaticTake!==false||review.promotionReady!==false||review.physicalSignalValidated!==false||review.mediaAndQcRequired!==true||review.trimMixReviewRequired!==true||!Array.isArray(review.inputs)||!Array.isArray(review.outputs)||!Array.isArray(review.localInputs)||!Array.isArray(review.localSdiOutputs)||review.inputs.length>1000||review.outputs.length>256||review.saved&&(!uuid.test(review.saved.id)||typeof review.saved.stale!=='boolean'||!Array.isArray(review.saved.inputs)))throw new Error()
    const plan=value.requestPlan
    if(plan!==null&&(!plan||typeof plan.id!=='string'||!uuid.test(plan.id)||plan.channelId!==candidate.channelId||plan.confirmationIsHistorical!==true||plan.operationalReady!==false||typeof plan.current!=='boolean'||typeof plan.stale!=='boolean'||!Number.isSafeInteger(plan.sequence)||plan.sequence<1||!Array.isArray(plan.inputs)||!Array.isArray(plan.outputs)||plan.inputs.length>1000||plan.outputs.length>256))throw new Error()
    return value
  }
  const run=async(save:boolean)=>{
    if(running.current||stale||!ready||save&&(!report||intent))return
    running.current=true;setBusy(true);setError(null);const stamp=generation.current
    try{
      let expected=intent,value:HaReturnBindingReport
      if(save){
        const review=report!.review
        if(sessionStorage.getItem(key))throw new Error()
        expected=parseIntent({candidate,requestId:newHaMonitorId()})
        // Only IDs persist in the browser; destinations may contain credentials.
        sessionStorage.setItem(key,JSON.stringify(expected));setIntent(expected)
        const body:HaReturnBindingRequest={channelId:candidate.channelId,candidate,binding:{requestId:expected.requestId,channelId:candidate.channelId,sequence:review.sequence,basePlanId:review.basePlanId,reviewToken:review.reviewToken,inputs:review.inputs.map(row=>({sourceKey:row.sourceKey,localKey:inputs[row.sourceKey]??''})),outputs:review.outputs.map(row=>{const choice=outputs[row.outputId];if(!choice)throw new Error();return {outputId:row.outputId,disposition:choice.disposition,...(choice.disposition==='LOCAL'?{localTarget:choice.localTarget}:{reason:choice.reason})}})}}
        value=validate(await api.saveHaReturnBindings(body))
        if(value.requestPlan?.id!==expected.requestId)throw new Error()
      }else value=validate(await api.haReturnBindingReview(candidate,expected?.requestId))
      if(expected&&value.requestPlan&&value.requestPlan.id!==expected.requestId)throw new Error()
      if(stamp!==generation.current)return
      setReport(value)
      setInputs(Object.fromEntries(value.review.saved&&!value.review.saved.stale?value.review.saved.inputs.map(row=>[row.sourceKey,row.localKey]):[]))
      // Never repopulate a credential-bearing target from a redacted response.
      setOutputs(Object.fromEntries(value.review.outputs.map(row=>[row.outputId,{disposition:'DISABLED',localTarget:'',reason:''}])))
      if(expected&&!value.requestPlan)setError('Pedido não consta no diário. Preserve o UUID; ausência de registro não autoriza reenvio automático.')
    }catch{if(stamp===generation.current)setError('Resultado não confirmado. Consulte sem repetir; candidato e PGM preservados.')}
    finally{running.current=false;if(stamp===generation.current)setBusy(false)}
  }
  const review=report?.review
  const complete=review&&review.inputs.every(row=>!!inputs[row.sourceKey])&&review.outputs.every(row=>{const choice=outputs[row.outputId];return choice&&(choice.disposition==='LOCAL'?!!choice.localTarget.trim():!!choice.reason.trim())})
  return <section aria-label="Vínculos locais do candidato de retorno" className="border border-border-subtle rounded p-3 space-y-2">
    <h4>Entradas e saídas no principal</h4>
    <p>Escolha as entradas desta máquina e confirme cada saída atual do principal. Descoberta não comprova sinal. Este passo não retoma o canal.</p>
    <button className="underline" disabled={busy||stale||!ready} onClick={()=>void run(false)}>{intent?'Consultar decisão sem repetir':'Conferir vínculos locais'}</button>
    {error&&<p role="alert" className="text-armed-amber">{error}</p>}
    {intent&&<p className="text-xs break-all">Pedido {intent.requestId}</p>}
    {intent&&report?.requestPlan?.id===intent.requestId&&<p role="status">Decisão confirmada no histórico: {report.requestPlan.current?'plano atual':'substituída por decisão posterior'}{report.requestPlan.stale?' · configuração desatualizada':''}. Não autoriza operação.</p>}
    {review&&<>
      {review.saved&&<p>Plano {review.saved.id}: {review.saved.stale?'desatualizado; nova conferência necessária':'registrado, ainda sem homologação'}. Não autorizado para PGM.</p>}
      {review.inputs.map(row=><label className="block" key={row.sourceKey}>{row.items.map(item=>item.title).join(' / ')} · {row.family}
        <select className="block w-full bg-surface-base" disabled={busy||stale||!!intent} value={inputs[row.sourceKey]??''} onChange={event=>setInputs(old=>({...old,[row.sourceKey]:event.target.value}))}>
          <option value="">Selecione a entrada local</option>{review.localInputs.filter(local=>local.family===row.family||(row.family==='RTMP'&&local.family==='RTMPS')||(row.family==='RTSP'&&local.family==='RTSPS')).map(local=><option key={local.key} value={local.key}>{local.label}</option>)}
        </select>
      </label>)}
      {review.outputs.map(row=>{const choice=outputs[row.outputId];if(!choice)return null;const change=(patch:Partial<Choice>)=>setOutputs(old=>({...old,[row.outputId]:{...old[row.outputId]!,...patch}}));return <fieldset key={row.outputId} className="border border-border-subtle p-2">
        <legend>{row.name} · {row.kind}</legend>
        <select disabled={busy||stale||!!intent} value={choice.disposition} onChange={event=>change({disposition:event.target.value as Choice['disposition'],localTarget:'',reason:''})}><option value="DISABLED">Desativar com motivo</option><option value="LOCAL">Destino local explícito</option></select>
        {choice.disposition==='DISABLED'?<input aria-label={`Motivo para ${row.name}`} disabled={busy||stale||!!intent} value={choice.reason} onChange={event=>change({reason:event.target.value})} placeholder="Motivo obrigatório"/>:row.kind==='SDI'?<select aria-label={`Saída SDI para ${row.name}`} disabled={busy||stale||!!intent} value={choice.localTarget} onChange={event=>change({localTarget:event.target.value})}><option value="">Selecione porta de saída</option>{review.localSdiOutputs.map(local=><option key={local.key} value={local.key}>{local.label}</option>)}</select>:<input aria-label={`Destino para ${row.name}`} disabled={busy||stale||!!intent} autoComplete="off" value={choice.localTarget} onChange={event=>change({localTarget:event.target.value})} placeholder="Destino local completo"/>}
      </fieldset>})}
      <button className="underline" disabled={busy||stale||!ready||!!intent||!complete} onClick={()=>void run(true)}>Registrar decisão — nenhuma saída é aberta</button>
      {intent&&report?.requestPlan?.id===intent.requestId&&<button className="underline ml-2" disabled={busy||stale} onClick={()=>{try{sessionStorage.removeItem(key);setIntent(null);setReport(null);setInputs({});setOutputs({});setError(null)}catch{setError('Não foi possível encerrar consulta; pedido preservado.')}}}>Encerrar consulta confirmada e iniciar nova conferência</button>}
      {review.saved&&<HaReturnApplicationPanel key={candidate.candidateId} candidate={candidate} bindingPlanId={review.saved.id} sourceDatabaseHash={sourceDatabaseHash} stale={stale} creationBlocked={review.saved.stale}/>}
    </>}
  </section>
}
