import {useEffect,useRef,useState} from 'react'
import {api,type HaReturnMediaReviewReport,type HaReturnMediaApplicationRequest,type HaReturnMediaApplicationReport} from '../../api.js'
import {newHaMonitorId} from '../../domain/ha-monitor-pending.js'
import type {HaReturnAutoDecisionReport} from '../../api.js'
import {HaReturnJobRecoveryPanel} from './HaReturnJobRecoveryPanel.js'
import {HaReturnPostGainPanel} from './HaReturnPostGainPanel.js'
import {HaReturnBusPanel} from './HaReturnBusPanel.js'
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i,hash=/^[a-f0-9]{64}$/
export function HaReturnMediaApplicationPanel({review,stale,autoDecision}:{review:HaReturnMediaReviewReport;stale:boolean;autoDecision?:HaReturnAutoDecisionReport|null}){
  const [adoptAuto,setAdoptAuto]=useState(false)
  const key='rplayout.ha.return-media-application.v1:'+review.request.mediaReviewId
  const [intent,setIntent]=useState<HaReturnMediaApplicationRequest|null>(null),[report,setReport]=useState<HaReturnMediaApplicationReport|null>(null),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null)
  const generation=useRef(0),running=useRef(false)
  const parse=(raw:unknown)=>{const value=raw as HaReturnMediaApplicationRequest;if(!value||Object.keys(value).some(k=>!['channelId','mediaApplicationId','mediaReviewId','autoDecisionId'].includes(k))||typeof value.mediaApplicationId!=='string'||!uuid.test(value.mediaApplicationId)||value.mediaReviewId!==review.request.mediaReviewId||value.channelId!==review.request.channelId||value.autoDecisionId!==undefined&&(typeof value.autoDecisionId!=='string'||!uuid.test(value.autoDecisionId)))throw new Error();return {mediaApplicationId:value.mediaApplicationId,mediaReviewId:value.mediaReviewId,channelId:value.channelId,...(value.autoDecisionId?{autoDecisionId:value.autoDecisionId}:{})}}
  useEffect(()=>{generation.current++;setBusy(false);setReady(false);try{const saved=sessionStorage.getItem(key);setIntent(saved?parse(JSON.parse(saved)):null);setReady(true)}catch{setError('Intenção guardada inválida/inacessível; preservada.')}return()=>{generation.current++}},[key,stale])
  const autoEligible=autoDecision?.ownedHere===true&&autoDecision.request.mediaReviewId===review.request.mediaReviewId&&autoDecision.request.evidenceMac===review.result?.evidenceMac&&autoDecision.reviewDatabaseHash===review.result?.applicationDatabaseHash
  const eligible=review.ownedHere&&review.phase==='REVIEWED'&&review.result?.bytesAndDecodeComplete&&(adoptAuto?autoEligible:review.result.blockedMounts===0)
  const run=async(create:boolean)=>{
    if(running.current||stale||!ready||create&&(!!intent||!eligible))return
    running.current=true;setBusy(true);setError(null);const stamp=generation.current
    try{
      let expected=intent
      if(create){if(sessionStorage.getItem(key)||adoptAuto&&!autoEligible)throw new Error();expected=parse({mediaApplicationId:newHaMonitorId(),mediaReviewId:review.request.mediaReviewId,channelId:review.request.channelId,...(adoptAuto&&autoDecision?{autoDecisionId:autoDecision.request.decisionId}:{})});sessionStorage.setItem(key,JSON.stringify(expected));setIntent(expected)}
      if(!expected)throw new Error()
      const value=create?await api.stageHaReturnMediaApplication(expected):await api.haReturnMediaApplicationQuery(expected.mediaApplicationId,expected.channelId)
      if(JSON.stringify(parse(value.request))!==JSON.stringify(expected)||value.version!==1||value.confirmationIsHistorical!==true||value.operationalReady!==false||!['ACCEPTED','APPLYING','STAGED','FAILED'].includes(value.phase)||value.phase==='STAGED'&&!value.result)throw new Error()
      const result=value.result
      if(result&&(Boolean(result.audio)!==(result.audioEvidenceApplied===true)||JSON.stringify(result.audio)!==JSON.stringify(review.result?.audio)))throw new Error()
      if(result&&(Boolean(result.graphics)!==(result.graphicRenderEvidenceApplied===true)||JSON.stringify(result.graphics)!==JSON.stringify(review.result?.graphics)))throw new Error()
      if(result&&(result.applicationId!==review.request.applicationId||result.sourceDatabaseHash!==review.result?.applicationDatabaseHash||result.evidenceMac!==review.result?.evidenceMac||!hash.test(result.databaseHash)||!hash.test(result.bindingDigest)||!hash.test(result.vaultFingerprint)||!uuid.test(result.bindingPlanId)||!Number.isSafeInteger(result.databaseBytes)||result.databaseBytes<=0||result.databaseBytes>256*1024*1024||!Number.isSafeInteger(result.selectedRevisions)||result.selectedRevisions<1||result.selectedRevisions>128||![result.checkedMounts,result.blockedMounts,result.livePending,result.mixPending,result.graphicPending].every(n=>Number.isSafeInteger(n)&&n>=0&&n<=100000)||result.blockedMounts>result.checkedMounts||result.mediaEvidenceApplied!==true||result.outputsApplied!==false||result.nativePrepared!==false||result.authorityTransferred!==false||result.publicationAuthorized!==false))throw new Error()
      if(stamp===generation.current)setReport(value)
    }catch{if(stamp===generation.current)setError('Nova cópia não confirmada; consulte sem repetir. Nenhuma saída ou engine foi habilitado.')}
    finally{running.current=false;if(stamp===generation.current)setBusy(false)}
  }
  return <section aria-label="Nova cópia com evidência de mídia aplicada" className="border border-border-subtle rounded p-2 space-y-2">
    <p>Gravar outra cópia com a mídia local revisada. Canal permanece parado; saídas, engine e autoridade não serão habilitados.</p>
    {autoEligible&&<label className="block"><input type="checkbox" disabled={busy||stale||!!intent} checked={adoptAuto} onChange={event=>setAdoptAuto(event.target.checked)}/> Adotar na nova cópia a decisão AUTO {autoDecision?.request.decisionId}. Não qualifica ganho final nem libera transmissão.</label>}
    {intent?.autoDecisionId&&<p>Cópia solicitada com decisão AUTO {intent.autoDecisionId}; consulta não repete a aplicação.</p>}
    <button className="underline" disabled={busy||stale||!ready||!!intent||!eligible} onClick={()=>void run(true)}>Criar cópia com mídia — não retomar</button>
    {intent&&<button className="underline ml-2" disabled={busy||stale||!ready} onClick={()=>void run(false)}>Consultar cópia sem repetir</button>}
    {error&&<p role="alert" className="text-armed-amber">{error}</p>}
    {report&&<p role="status">{({ACCEPTED:'Pedido registrado',APPLYING:'Criação sem confirmação final',STAGED:'Cópia com evidência de mídia criada',FAILED:'Falhou; parcial preservado'})[report.phase]}. Confirmação histórica, não autorizada para PGM.</p>}
    {report?.result&&<p>{report.result.selectedRevisions} edições · {report.result.blockedMounts} montagens bloqueadas · {report.result.livePending} lives sem sinal comprovado · {report.result.mixPending} mixes · {report.result.graphicPending} grafismos para conferir. SHA {report.result.databaseHash}</p>}
    {report&&(report.phase==='ACCEPTED'||report.phase==='APPLYING')&&<HaReturnJobRecoveryPanel key={'recover:'+report.request.mediaApplicationId} target={{kind:'MEDIA_APPLICATION',id:report.request.mediaApplicationId,channelId:report.request.channelId,phase:report.phase,updatedAt:report.updatedAt}} stale={stale||busy} onClosed={()=>void run(false)}/>}
    {report?.result?.graphics&&<p>Evidência gráfica aplicada: {report.result.graphics.rendered}/{report.result.graphics.required} quadros comprovados. Aprovação visual e composição completa ainda pendentes; não libera transmissão.</p>}
    {report?.result?.audio&&<p>Evidência de áudio aplicada: {report.result.audio.measured}/{report.result.audio.required} montagens medidas antes do ganho. {report.request.autoDecisionId?'Decisão AUTO adotada na cópia.':'Nenhuma decisão AUTO adotada.'} Ganho final, limitador e barramento continuam sem qualificação; não libera transmissão.</p>}
    {report?.phase==='STAGED'&&report.result&&<HaReturnPostGainPanel key={report.request.mediaApplicationId} media={report} stale={stale||busy}/>}
    {report?.phase==='STAGED'&&report.result&&<HaReturnBusPanel key={'bus:'+report.request.mediaApplicationId} media={report} stale={stale||busy}/>}
  </section>
}
