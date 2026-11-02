import {useEffect,useRef,useState} from 'react'
import {api,type HaReturnCandidateRequest,type HaReturnApplicationRequest,type HaReturnApplicationReport} from '../../api.js'
import {newHaMonitorId} from '../../domain/ha-monitor-pending.js'
import {HaReturnMediaReviewPanel} from './HaReturnMediaReviewPanel.js'
import {HaReturnJobRecoveryPanel} from './HaReturnJobRecoveryPanel.js'
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i,hash=/^[a-f0-9]{64}$/
export function HaReturnApplicationPanel({candidate,bindingPlanId,sourceDatabaseHash,stale,creationBlocked}:{candidate:HaReturnCandidateRequest;bindingPlanId:string;sourceDatabaseHash:string;stale:boolean;creationBlocked:boolean}){
  const key='rplayout.ha.return-application.v1:'+candidate.candidateId
  const [intent,setIntent]=useState<HaReturnApplicationRequest|null>(null),[report,setReport]=useState<HaReturnApplicationReport|null>(null),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null)
  const generation=useRef(0),running=useRef(false)
  const parse=(raw:unknown)=>{const value=raw as HaReturnApplicationRequest,c=value?.candidate;if(!value||Object.keys(value).sort().join(',')!=='applicationId,bindingPlanId,candidate,channelId'||typeof value.applicationId!=='string'||!uuid.test(value.applicationId)||typeof value.bindingPlanId!=='string'||!uuid.test(value.bindingPlanId)||value.channelId!==candidate.channelId||!c||Object.keys(c).sort().join(',')!=='candidateId,channelId,planId'||c.candidateId!==candidate.candidateId||c.planId!==candidate.planId||c.channelId!==candidate.channelId)throw new Error();return {applicationId:value.applicationId,channelId:value.channelId,candidate:{candidateId:c.candidateId,planId:c.planId,channelId:c.channelId},bindingPlanId:value.bindingPlanId}}
  useEffect(()=>{generation.current++;setBusy(false);setReady(false);try{const saved=sessionStorage.getItem(key);setIntent(saved?parse(JSON.parse(saved)):null);setReady(true)}catch{setError('Intenção guardada inválida/inacessível; preservada.')}return()=>{generation.current++}},[key,stale])
  const run=async(create:boolean)=>{
    if(running.current||stale||!ready||create&&(!!intent||creationBlocked))return
    running.current=true;setBusy(true);setError(null);const stamp=generation.current
    try{
      let expected=intent
      if(create){if(sessionStorage.getItem(key))throw new Error();expected=parse({applicationId:newHaMonitorId(),candidate,channelId:candidate.channelId,bindingPlanId});sessionStorage.setItem(key,JSON.stringify(expected));setIntent(expected)}
      if(!expected)throw new Error()
      const value=create?await api.applyHaReturnBindings(expected):await api.haReturnApplicationQuery(expected.applicationId,expected.channelId)
      if(JSON.stringify(parse(value.request))!==JSON.stringify(expected)||value.version!==1||value.confirmationIsHistorical!==true||value.operationalReady!==false||!['ACCEPTED','APPLYING','STAGED','FAILED'].includes(value.phase)||value.phase==='STAGED'&&!value.result)throw new Error()
      const result=value.result
      if(result&&(result.sourceDatabaseHash!==sourceDatabaseHash||!hash.test(result.databaseHash)||!hash.test(result.bindingDigest)||!hash.test(result.vaultFingerprint)||!Number.isSafeInteger(result.databaseBytes)||result.databaseBytes<=0||result.databaseBytes>256*1024*1024||!Number.isSafeInteger(result.selectedRevisions)||result.selectedRevisions<1||result.selectedRevisions>128||result.inputBindingsApplied!==true||result.outputsApplied!==false||result.mediaValidated!==false||result.nativePrepared!==false||result.authorityTransferred!==false||result.publicationAuthorized!==false))throw new Error()
      if(stamp===generation.current)setReport(value)
    }catch{if(stamp===generation.current)setError('Aplicação não confirmada; consulte sem repetir. Parcial e originais preservados.')}
    finally{running.current=false;if(stamp===generation.current)setBusy(false)}
  }
  return <section aria-label="Aplicação isolada de entradas locais" className="border border-border-subtle rounded p-2 space-y-2">
    <p>Aplicar entradas a uma nova cópia parada. Mídia/QC, saídas e engine ainda não serão habilitados.</p>
    <button className="underline" disabled={busy||stale||creationBlocked||!ready||!!intent} onClick={()=>void run(true)}>Criar cópia com entradas locais — não retomar</button>
    {intent&&<button className="underline ml-2" disabled={busy||stale||!ready} onClick={()=>void run(false)}>Consultar aplicação sem repetir</button>}
    {intent&&<p className="text-xs break-all">Pedido {intent.applicationId} · plano {intent.bindingPlanId}{intent.bindingPlanId!==bindingPlanId?' (plano anterior)':''}</p>}
    {error&&<p role="alert" className="text-armed-amber">{error}</p>}
    {report&&<p role="status">{({ACCEPTED:'Intenção registrada',APPLYING:'Aplicação ainda sem confirmação final',STAGED:'Nova cópia criada com entradas locais',FAILED:'Falhou; parcial preservado'})[report.phase]}. Confirmação histórica, não autorizada para operação.{report.result&&` SHA ${report.result.databaseHash}`}</p>}
    {report&&(report.phase==='ACCEPTED'||report.phase==='APPLYING')&&<HaReturnJobRecoveryPanel key={'recover:'+report.request.applicationId} target={{kind:'BINDING_APPLICATION',id:report.request.applicationId,channelId:report.request.channelId,phase:report.phase,updatedAt:report.updatedAt}} stale={stale||busy} onClosed={()=>void run(false)}/>}
    {report?.phase==='STAGED'&&report.result&&<HaReturnMediaReviewPanel key={report.request.applicationId} application={report} stale={stale}/>}
    {intent&&report&&['STAGED','FAILED'].includes(report.phase)&&intent.bindingPlanId!==bindingPlanId&&<button className="underline" disabled={busy||stale} onClick={()=>{try{sessionStorage.removeItem(key);setIntent(null);setReport(null);setError(null)}catch{setError('Pedido preservado; consulta não pôde ser encerrada.')}}}>Encerrar consulta antiga e usar o novo plano</button>}
  </section>
}
