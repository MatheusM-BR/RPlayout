import {useEffect,useRef,useState} from 'react'
import {api,type HaReturnJobRecoveryRequest,type HaReturnJobRecoveryReport} from '../../api.js'
import {newHaMonitorId} from '../../domain/ha-monitor-pending.js'
import {returnJobActivePhase} from '../../domain/ha-return-job-kind.js'
type Target={kind:HaReturnJobRecoveryRequest['kind'];id:string;channelId:string;phase:HaReturnJobRecoveryRequest['expectedPhase'];updatedAt:string}
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i
export function HaReturnJobRecoveryPanel({target,stale,onClosed}:{target:Target;stale:boolean;onClosed:()=>void}){
  const key='rplayout.ha.return-job-recovery.v1:'+target.kind+':'+target.id
  const [intent,setIntent]=useState<HaReturnJobRecoveryRequest|null>(null),[report,setReport]=useState<HaReturnJobRecoveryReport|null>(null),[reason,setReason]=useState(''),[confirmed,setConfirmed]=useState(false),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null)
  const generation=useRef(0),running=useRef(false)
  const parse=(raw:unknown)=>{
    const value=raw as HaReturnJobRecoveryRequest
    if(!value||Object.keys(value).sort().join(',')!=='channelId,expectedPhase,expectedUpdatedAt,kind,reason,recoveryId,targetId'||typeof value.recoveryId!=='string'||!uuid.test(value.recoveryId)||value.kind!==target.kind||value.targetId!==target.id||value.channelId!==target.channelId||!['ACCEPTED',returnJobActivePhase(target.kind)].includes(value.expectedPhase)||typeof value.expectedUpdatedAt!=='string'||!Number.isFinite(Date.parse(value.expectedUpdatedAt))||typeof value.reason!=='string'||value.reason!==value.reason.trim()||value.reason.length<5||value.reason.length>2000)throw new Error()
    return {recoveryId:value.recoveryId,kind:value.kind,targetId:value.targetId,channelId:value.channelId,expectedUpdatedAt:value.expectedUpdatedAt,expectedPhase:value.expectedPhase,reason:value.reason}
  }
  useEffect(()=>{generation.current++;setReady(false);setBusy(false);setIntent(null);setReport(null);setReason('');setConfirmed(false);setError(null);try{const saved=sessionStorage.getItem(key);setIntent(saved?parse(JSON.parse(saved)):null);setReady(true)}catch{setError('Intenção de encerramento inválida/inacessível; preservada.')}return()=>{generation.current++}},[key,target.channelId,target.updatedAt,target.phase,stale])
  const run=async(create:boolean)=>{
    if(running.current||stale||!ready||create&&(!!intent||!confirmed||reason.trim().length<5||reason.trim().length>2000))return
    running.current=true;setBusy(true);setError(null);const stamp=generation.current
    try{
      let expected=intent
      if(create){
        if(sessionStorage.getItem(key))throw new Error()
        const fresh=target.kind==='HISTORY_IMPORT'||target.kind==='HISTORY_VARIANT'?await api.haReturnHistoryJobObservation(target.id,target.channelId,target.kind):target.kind==='DATABASE_REVIEW'?await api.haReturnReviewQuery(target.id,target.channelId).then(value=>({...value,result:value.report})):target.kind==='REKEY'?await api.haReturnRekeyQuery(target.id,target.channelId):target.kind==='CANDIDATE'?await api.haReturnCandidateQuery(target.id,target.channelId):target.kind==='BINDING_APPLICATION'?await api.haReturnApplicationQuery(target.id,target.channelId):target.kind==='MEDIA_REVIEW'?await api.haReturnMediaReviewQuery(target.id,target.channelId):target.kind==='POSTGAIN_REVIEW'?await api.haReturnPostGainQuery(target.id,target.channelId):target.kind==='BUS_REVIEW'?await api.haReturnBusQuery(target.id,target.channelId):await api.haReturnMediaApplicationQuery(target.id,target.channelId)
        const freshId=target.kind==='HISTORY_IMPORT'&&'importId' in fresh.request?fresh.request.importId:target.kind==='HISTORY_VARIANT'&&'decisionId' in fresh.request?fresh.request.decisionId:target.kind==='DATABASE_REVIEW'&&'reviewId' in fresh.request?fresh.request.reviewId:target.kind==='REKEY'&&'rekeyId' in fresh.request?fresh.request.rekeyId:target.kind==='CANDIDATE'&&'candidateId' in fresh.request?fresh.request.candidateId:target.kind==='BINDING_APPLICATION'&&'applicationId' in fresh.request?fresh.request.applicationId:target.kind==='MEDIA_REVIEW'&&'mediaReviewId' in fresh.request?fresh.request.mediaReviewId:target.kind==='POSTGAIN_REVIEW'&&'postGainReviewId' in fresh.request?fresh.request.postGainReviewId:target.kind==='BUS_REVIEW'&&'busReviewId' in fresh.request?fresh.request.busReviewId:target.kind==='MEDIA_APPLICATION'&&'mediaApplicationId' in fresh.request?fresh.request.mediaApplicationId:undefined
        if(stamp!==generation.current)return
        if(fresh.version!==1||freshId!==target.id||fresh.request.channelId!==target.channelId||fresh.phase!==target.phase||fresh.updatedAt!==target.updatedAt||fresh.result!==null||fresh.operationalReady!==false||fresh.confirmationIsHistorical!==true)throw new Error()
        expected=parse({recoveryId:newHaMonitorId(),kind:target.kind,targetId:target.id,channelId:target.channelId,expectedPhase:target.phase,expectedUpdatedAt:target.updatedAt,reason:reason.trim()})
        sessionStorage.setItem(key,JSON.stringify(expected));setIntent(expected)
      }
      if(!expected)throw new Error()
      const value=create?await api.closeHaReturnInterruptedJob(expected):await api.haReturnJobRecoveryQuery(expected.recoveryId,expected.channelId)
      if(JSON.stringify(parse(value.request))!==JSON.stringify(expected)||value.version!==1||value.phase!=='INTERRUPTED_JOB_CLOSED'||value.previousResultPreserved!==true||value.partialFilesPreserved!==true||value.quotaRetained!==true||value.operationReplayed!==false||value.publicationAuthorized!==false||value.confirmationIsHistorical!==true||value.operationalReady!==false||typeof value.ownedHere!=='boolean'||typeof value.actor!=='string'||!value.actor||value.actor.length>256||typeof value.recordedAt!=='string'||!Number.isFinite(Date.parse(value.recordedAt)))throw new Error()
      if(stamp===generation.current)setReport(value)
    }catch{if(stamp===generation.current)setError('Encerramento não confirmado. Pode haver trabalho ativo ou estado alterado; consulte sem repetir. Nenhum parcial foi apagado.')}
    finally{running.current=false;if(stamp===generation.current)setBusy(false)}
  }
  return <details className="border border-border-subtle rounded p-2"><summary>Conferir tentativa possivelmente interrompida</summary>
    <p>Estado registrado: {target.phase}. Isso não prova que o processo parou. O servidor recusará encerramento enquanto houver trabalho ativo ou se não puder comprovar o fim da execução anterior.</p>
    <p>Encerrar marca a tentativa como falha, preserva histórico, arquivos parciais e quota. Não retoma, não repete e não libera transmissão. Uma nova tentativa exige nova preparação explícita; não substitui este pedido.</p>
    {!intent&&<><label className="block">Justificativa<textarea className="block w-full bg-surface-base" disabled={busy||stale||!ready} maxLength={2000} value={reason} onChange={event=>setReason(event.target.value)}/></label><label className="block"><input type="checkbox" disabled={busy||stale||!ready} checked={confirmed} onChange={event=>setConfirmed(event.target.checked)}/> Solicito encerrar esta tentativa, mantendo os parciais e sem repetir a operação.</label><button className="underline" disabled={busy||stale||!ready||!confirmed||reason.trim().length<5||reason.trim().length>2000} onClick={()=>void run(true)}>Conferir e encerrar tentativa</button></>}
    {intent&&<><p>Pedido preservado: {intent.recoveryId} · {intent.reason}</p><button className="underline" disabled={busy||stale||!ready} onClick={()=>void run(false)}>Consultar encerramento sem repetir</button></>}
    {error&&<p role="alert" className="text-armed-amber">{error}</p>}
    {report&&<><p role="status">Encerramento registrado. Parciais e quota preservados; confirmação histórica, sem autorização para PGM.</p><button className="underline" disabled={busy||stale} onClick={onClosed}>Atualizar estado da tentativa — somente consulta</button></>}
  </details>
}
