import {useEffect,useRef,useState} from 'react'
import {api,type HaReturnReviewReport,type HaReturnSelectionRequest,type HaReturnSelectionReport} from '../../api.js'
import {newHaMonitorId} from '../../domain/ha-monitor-pending.js'
import {HaReturnCandidatePanel} from './HaReturnCandidatePanel.js'
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i,mac=/^[A-Za-z0-9_-]{43}$/
export function HaReturnSelectionPanel({review,stale,canCreate}:{review:HaReturnReviewReport;stale:boolean;canCreate:boolean}){
  const comparison=review.report?.protectedFields?.contentComparison,basis=comparison?.selectionBasis
  const key='rplayout.ha.return-selection.v1:'+review.request.reviewId
  const [ids,setIds]=useState<string[]>(()=>basis?.candidates.filter(row=>row.active).map(row=>row.id)??[]),[execution,setExecution]=useState(''),[policy,setPolicy]=useState<HaReturnSelectionRequest['cursorPolicy']>('STOPPED'),[reason,setReason]=useState('')
  const [pending,setPending]=useState<HaReturnSelectionRequest|null>(null),[report,setReport]=useState<HaReturnSelectionReport|null>(null),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null)
  const active=useRef(true),loading=useRef(false)
  const parse=(raw:unknown):HaReturnSelectionRequest=>{
    if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error()
    const v=raw as HaReturnSelectionRequest
    if(Object.keys(v).sort().join(',')!=='channelId,checkpointMac,cursorPolicy,editionInventoryMac,executionRevisionId,planId,reason,rekeyId,revisionIds,reviewId,transferId'||!uuid.test(v.planId)||v.reviewId!==review.request.reviewId||v.rekeyId!==review.request.rekeyId||v.transferId!==review.request.transferId||v.channelId!==review.request.channelId||!mac.test(v.editionInventoryMac)||v.editionInventoryMac!==comparison?.editions.inventoryMac||v.checkpointMac!==comparison?.checkpoint.receivedMac||!Array.isArray(v.revisionIds)||!v.revisionIds.length||v.revisionIds.length>128||new Set(v.revisionIds).size!==v.revisionIds.length||!v.revisionIds.every(id=>typeof id==='string'&&basis?.candidates.some(row=>row.id===id))||!v.revisionIds.includes(v.executionRevisionId)||!['STOPPED','RECEIVED_LAST_CONFIRMED'].includes(v.cursorPolicy)||typeof v.reason!=='string'||v.reason.trim().length<5||v.reason.length>2000)throw new Error()
    return v
  }
  useEffect(()=>{active.current=true;try{const raw=window.sessionStorage.getItem(key);if(raw)setPending(parse(JSON.parse(raw)));setReady(true)}catch{setError('Seleção local inválida/inacessível; preservada sem substituir.')}return()=>{active.current=false}},[key])
  const run=async(create:boolean)=>{
    if(loading.current||stale||!ready||create&&(!canCreate||!!pending||!basis||basis.candidatesTruncated||review.report?.baselineChanged!==false))return
    loading.current=true;setBusy(true);setError(null)
    try{
      let request=pending
      if(create){if(window.sessionStorage.getItem(key))throw new Error();request=parse({planId:newHaMonitorId(),reviewId:review.request.reviewId,rekeyId:review.request.rekeyId,transferId:review.request.transferId,channelId:review.request.channelId,editionInventoryMac:comparison!.editions.inventoryMac,checkpointMac:comparison!.checkpoint.receivedMac,revisionIds:ids,executionRevisionId:execution,cursorPolicy:policy,reason:reason.trim()});window.sessionStorage.setItem(key,JSON.stringify(request));if(active.current)setPending(request)}
      if(!request)throw new Error()
      const value=create?await api.haReturnSelection(request):await api.haReturnSelectionQuery(request.planId,request.channelId)
      if(JSON.stringify(parse(value.request))!==JSON.stringify(request)||value.version!==1||value.phase!=='SELECTION_RECORDED'||value.source!=='RETURNED_REKEYED_COPY'||value.reviewDatabaseHash!==review.report?.databaseHash||value.historyReconciled!==false||value.mediaValidated!==false||value.nativePrepared!==false||value.authorityTransferred!==false||value.publicationAuthorized!==false||value.operationalReady!==false||value.confirmationIsHistorical!==true)throw new Error()
      if(active.current)setReport(value)
    }catch{if(active.current)setError('Seleção não confirmada; consulte sem repetir. Não alterou a operação.')}
    finally{loading.current=false;if(active.current)setBusy(false)}
  }
  const unavailable=busy||stale||!ready||!!pending||!canCreate||!basis||basis.candidatesTruncated||review.report?.baselineChanged!==false
  return <section aria-label="Seleção explícita para retorno" className="border rounded p-2 space-y-2">
    <p>Registrar escolha para o retorno — não inicia engine nem muda PGM.</p>
    {basis?.candidatesTruncated&&<p role="alert">Inventário de edições incompleto na página; seleção bloqueada.</p>}
    <div className="max-h-48 overflow-auto">{basis?.candidates.map(row=><label key={row.id} className="block"><input type="checkbox" disabled={unavailable||row.active} checked={ids.includes(row.id)} onChange={event=>setIds(current=>event.target.checked?[...current,row.id]:current.filter(id=>id!==row.id))}/> {row.id}{row.active?' — futura ativa, preservada':''}</label>)}</div>
    <label className="block">Edição escolhida <select disabled={unavailable} value={execution} onChange={event=>setExecution(event.target.value)}><option value="">Selecione explicitamente</option>{ids.map(id=><option key={id} value={id}>{id}</option>)}</select></label>
    <label className="block">Cursor <select disabled={unavailable} value={policy} onChange={event=>setPolicy(event.target.value as HaReturnSelectionRequest['cursorPolicy'])}><option value="STOPPED">Permanecer parado</option><option value="RECEIVED_LAST_CONFIRMED">Solicitar último cursor recebido confirmado</option></select></label>
    <label className="block">Justificativa <textarea disabled={unavailable} maxLength={2000} value={reason} onChange={event=>setReason(event.target.value)}/></label>
    <button className="underline" disabled={unavailable||!execution||!ids.includes(execution)||ids.length>128||reason.trim().length<5} onClick={()=>void run(true)}>Registrar seleção, sem retomar</button>
    {pending&&<button className="underline ml-2" disabled={busy||stale} onClick={()=>void run(false)}>Consultar seleção sem repetir</button>}
    {error&&<p role="alert" className="text-armed-amber">{error}</p>}
    {report&&<p>Seleção registrada{report.ownedHere?'':' em outra instância'}; mídia, histórico, preparação nativa e autoridade ainda não aprovados.</p>}
    {report&&<HaReturnCandidatePanel key={report.request.planId} selection={report} stale={stale||busy||!!error}/>}
  </section>
}
