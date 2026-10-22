import {useEffect,useRef,useState} from 'react'
import {api,type HaReturnMediaReviewReport,type HaReturnAutoDecisionRequest,type HaReturnAutoOptions,type HaReturnAutoDecisionReport} from '../../api.js'
import {newHaMonitorId} from '../../domain/ha-monitor-pending.js'
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i,hash=/^[a-f0-9]{64}$/
export function HaReturnAutoDecisionPanel({review,stale,onRecorded}:{review:HaReturnMediaReviewReport;stale:boolean;onRecorded:(value:HaReturnAutoDecisionReport)=>void}){
  const key='rplayout.ha.return-auto-decision.v1:'+review.request.mediaReviewId
  const [intent,setIntent]=useState<HaReturnAutoDecisionRequest|null>(null),[report,setReport]=useState<HaReturnAutoDecisionReport|null>(null),[options,setOptions]=useState<HaReturnAutoOptions|null>(null)
  const [selected,setSelected]=useState<string[]>([]),[reason,setReason]=useState(''),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null)
  const generation=useRef(0),running=useRef(false)
  const parse=(raw:unknown)=>{
    const value=raw as HaReturnAutoDecisionRequest
    if(!value||Object.keys(value).sort().join(',')!=='channelId,decisionId,evidenceMac,mediaReviewId,mountKeys,reason'||typeof value.decisionId!=='string'||!uuid.test(value.decisionId)||value.mediaReviewId!==review.request.mediaReviewId||value.channelId!==review.request.channelId||value.evidenceMac!==review.result?.evidenceMac||!Array.isArray(value.mountKeys)||value.mountKeys.length<1||value.mountKeys.length>1000||value.mountKeys.some(k=>typeof k!=='string'||!hash.test(k))||new Set(value.mountKeys).size!==value.mountKeys.length||typeof value.reason!=='string'||value.reason!==value.reason.trim()||value.reason.length<5||value.reason.length>2000)throw new Error()
    return {decisionId:value.decisionId,mediaReviewId:value.mediaReviewId,channelId:value.channelId,evidenceMac:value.evidenceMac,mountKeys:[...value.mountKeys],reason:value.reason}
  }
  useEffect(()=>{generation.current++;setReady(false);setBusy(false);setReport(null);setOptions(null);setSelected([]);setReason('');setError(null);setIntent(null);try{const saved=sessionStorage.getItem(key);setIntent(saved?parse(JSON.parse(saved)):null);setReady(true)}catch{setError('Pedido guardado inválido/inacessível; preservado.')}return()=>{generation.current++}},[key,stale,review.result?.evidenceMac])
  const eligible=review.ownedHere&&review.phase==='REVIEWED'&&review.result?.bytesAndDecodeComplete===true
  const load=async()=>{
    if(running.current||stale||!ready||intent||!eligible)return
    running.current=true;setBusy(true);setError(null);setOptions(null);setSelected([]);const stamp=generation.current
    try{
      const value=await api.haReturnAutoOptions(review.request.mediaReviewId,review.request.channelId)
      if(value.version!==1||value.mediaReviewId!==review.request.mediaReviewId||value.channelId!==review.request.channelId||value.evidenceMac!==review.result?.evidenceMac||value.contingencySupported!==false||value.qcApproved!==false||value.publicationAuthorized!==false||!Array.isArray(value.options)||value.options.length>1000||new Set(value.options.map(row=>row.mountKey)).size!==value.options.length||value.options.some(row=>!row||typeof row.mountKey!=='string'||!hash.test(row.mountKey)||typeof row.revisionId!=='string'||!row.revisionId||typeof row.itemId!=='string'||!row.itemId||![row.integratedLufs,row.lra,row.truePeakDbtp].every(Number.isFinite)||row.lra<0))throw new Error()
      if(stamp===generation.current)setOptions(value)
    }catch{if(stamp===generation.current)setError('Montagens AUTO indisponíveis; nenhuma medição foi adotada.')}
    finally{running.current=false;if(stamp===generation.current)setBusy(false)}
  }
  const run=async(create:boolean)=>{
    if(running.current||stale||!ready||create&&(!!intent||!eligible||!options||!selected.length||reason.trim().length<5||reason.trim().length>2000))return
    running.current=true;setBusy(true);setError(null);const stamp=generation.current
    try{
      let expected=intent
      if(create){if(sessionStorage.getItem(key)||!options||selected.some(k=>!options.options.some(row=>row.mountKey===k)))throw new Error();expected=parse({decisionId:newHaMonitorId(),mediaReviewId:review.request.mediaReviewId,channelId:review.request.channelId,evidenceMac:options.evidenceMac,mountKeys:selected,reason:reason.trim()});sessionStorage.setItem(key,JSON.stringify(expected));setIntent(expected)}
      if(!expected)throw new Error()
      const value=create?await api.saveHaReturnAutoDecision(expected):await api.haReturnAutoDecisionQuery(expected.decisionId,expected.channelId)
      if(JSON.stringify(parse(value.request))!==JSON.stringify(expected)||value.version!==1||value.phase!=='AUTO_DECISION_RECORDED'||value.confirmationIsHistorical!==true||value.operationalReady!==false||value.publicationAuthorized!==false||value.qcApproved!==false||value.postGainQualified!==false||value.busQualified!==false||typeof value.ownedHere!=='boolean'||value.reviewDatabaseHash!==review.result?.applicationDatabaseHash||!Number.isSafeInteger(value.selectedMounts)||value.selectedMounts!==expected.mountKeys.length||typeof value.actor!=='string'||!value.actor||value.actor.length>256||typeof value.recordedAt!=='string'||!Number.isFinite(Date.parse(value.recordedAt)))throw new Error()
      if(stamp===generation.current){setReport(value);onRecorded(value)}
    }catch{if(stamp===generation.current)setError('Decisão não confirmada; consulte o mesmo pedido sem repetir. PGM e mídia preservados.')}
    finally{running.current=false;if(stamp===generation.current)setBusy(false)}
  }
  return <section aria-label="Decisão AUTO do retorno" className="border border-border-subtle rounded p-2 space-y-2">
    <p>Registrar quais medições locais poderão ser adotadas em uma futura cópia. Somente master já em AUTO; não converte MANUAL/OFF, não inclui live ou contingência e não aplica ganho.</p>
    <button className="underline" disabled={busy||stale||!ready||!!intent||!eligible} onClick={()=>void load()}>Consultar montagens AUTO medidas</button>
    {options&&<fieldset disabled={busy||stale||!!intent}><legend>Selecione as montagens — nenhuma selecionada automaticamente</legend>{!options.options.length&&<p>Nenhuma montagem master AUTO elegível nesta revisão.</p>}{options.options.map(row=><label className="block" key={row.mountKey}><input type="checkbox" checked={selected.includes(row.mountKey)} onChange={event=>setSelected(old=>event.target.checked?[...old,row.mountKey]:old.filter(k=>k!==row.mountKey))}/> {row.itemId} · edição {row.revisionId} · {row.integratedLufs.toFixed(2)} LUFS · LRA {row.lra.toFixed(2)} · pico {row.truePeakDbtp.toFixed(2)} dBTP</label>)}<label className="block">Justificativa da decisão<textarea className="block w-full bg-surface-base" maxLength={2000} value={reason} onChange={event=>setReason(event.target.value)}/></label></fieldset>}
    <button className="underline" disabled={busy||stale||!ready||!!intent||!eligible||!options||!selected.length||reason.trim().length<5||reason.trim().length>2000} onClick={()=>void run(true)}>Registrar decisão — não aplicar</button>
    {intent&&<><p>Pedido preservado: {intent.decisionId} · {intent.mountKeys.length} montagens · {intent.reason}</p><button className="underline" disabled={busy||stale||!ready} onClick={()=>void run(false)}>Consultar decisão sem repetir</button></>}
    {error&&<p role="alert" className="text-armed-amber">{error}</p>}
    {report&&<p role="status">Decisão registrada para {report.selectedMounts} montagens. Confirmação histórica; não aplicada à cópia. QC, ganho final, limitador, barramento e autorização de transmissão continuam pendentes.</p>}
  </section>
}
