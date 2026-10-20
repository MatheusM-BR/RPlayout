import {useEffect,useRef,useState} from 'react'
import {api,type HaReturnMediaApplicationReport,type HaReturnPostGainReviewReport,type HaReturnPostGainReviewRequest} from '../../api.js'
import {newHaMonitorId} from '../../domain/ha-monitor-pending.js'
import {parseReturnPostGainIntent,readReturnPostGainReport} from '../../domain/ha-return-postgain.js'
import {HaReturnJobRecoveryPanel} from './HaReturnJobRecoveryPanel.js'
export function HaReturnPostGainPanel({media,stale}:{media:HaReturnMediaApplicationReport;stale:boolean}){
  const key='rplayout.ha.return-postgain.v1:'+media.request.mediaApplicationId
  const [intent,setIntent]=useState<HaReturnPostGainReviewRequest|null>(null),[report,setReport]=useState<HaReturnPostGainReviewReport|null>(null),[confirmed,setConfirmed]=useState(false),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null)
  const generation=useRef(0),running=useRef(false)
  useEffect(()=>{generation.current++;setReady(false);setBusy(false);setIntent(null);setReport(null);setConfirmed(false);setError(null);try{const saved=sessionStorage.getItem(key);setIntent(saved?parseReturnPostGainIntent(JSON.parse(saved),media):null);setReady(true)}catch{setError('Intenção pós-ganho guardada inválida/inacessível; preservada.')}return()=>{generation.current++}},[key,media.request.channelId,media.updatedAt,stale])
  const eligible=media.ownedHere&&media.phase==='STAGED'&&!!media.result
  const run=async(create:boolean)=>{
    if(running.current||stale||!ready||create&&(!!intent||!eligible||!confirmed))return
    running.current=true;setBusy(true);setError(null);const stamp=generation.current
    try{
      let expected=intent
      if(create){
        if(sessionStorage.getItem(key))throw new Error()
        expected=parseReturnPostGainIntent({postGainReviewId:newHaMonitorId(),mediaApplicationId:media.request.mediaApplicationId,channelId:media.request.channelId},media)
        sessionStorage.setItem(key,JSON.stringify(expected));setIntent(expected)
      }
      if(!expected)throw new Error()
      const response=create?await api.reviewHaReturnPostGain(expected):await api.haReturnPostGainQuery(expected.postGainReviewId,expected.channelId)
      const value=readReturnPostGainReport(response,expected,media)
      if(stamp===generation.current)setReport(value)
    }catch{if(stamp===generation.current)setError('Medição não confirmada; consulte o mesmo pedido sem repetir. A cópia e o PGM foram preservados.')}
    finally{running.current=false;if(stamp===generation.current)setBusy(false)}
  }
  return <section aria-label="Medição isolada de áudio pós-ganho" className="border border-border-subtle rounded p-2 space-y-2">
    <h4>Medição pós-ganho e limitador — isolada</h4>
    <p>Novas medições usam o ganho e o teto do perfil local e solicitam a cauda do limitador na análise isolada. Recibos antigos não comprovam esse novo modo. Não aprova QC, barramento completo, transições ou sincronismo; não habilita transmissão.</p>
    {!intent&&<><label className="block"><input type="checkbox" checked={confirmed} disabled={busy||stale||!ready||!eligible} onChange={event=>setConfirmed(event.target.checked)}/> Solicito a medição desta cópia, sem retomar o canal.</label><button className="underline" disabled={busy||stale||!ready||!eligible||!confirmed} onClick={()=>void run(true)}>Medir pós-ganho desta cópia</button></>}
    {intent&&<><p>Pedido preservado: {intent.postGainReviewId}</p><button className="underline" disabled={busy||stale||!ready} onClick={()=>void run(false)}>Consultar medição sem repetir</button></>}
    {error&&<p role="alert" className="text-armed-amber">{error}</p>}
    {report&&<p role="status">{({ACCEPTED:'Pedido registrado',MEASURING:'Medição sem confirmação final',REVIEWED:'Recibos da medição registrados',FAILED:'Tentativa falhou; histórico preservado'})[report.phase]}. Confirmação histórica, sem autorização para PGM.</p>}
    {report&&<p>Perfil utilizado: {report.capture.profile.targetLufs} LUFS · teto {report.capture.profile.ceilingDbtp} dBTP · {report.capture.profile.audioChannels} canais. {report.capture.autoDecisionId?'Decisão AUTO registrada na cópia.':'Sem adoção de nova decisão AUTO.'}</p>}
    {report?.result&&<p>{report.result.summary.measured}/{report.result.summary.required} montagens medidas · {report.result.summary.failed} falhas · {report.result.summary.planBlocked} bloqueios de planejamento. Mesmo sem falhas, a qualificação completa e aprovação continuam pendentes.</p>}
    {report&&(report.phase==='ACCEPTED'||report.phase==='MEASURING')&&<HaReturnJobRecoveryPanel target={{kind:'POSTGAIN_REVIEW',id:report.request.postGainReviewId,channelId:report.request.channelId,phase:report.phase,updatedAt:report.updatedAt}} stale={stale||busy} onClosed={()=>void run(false)}/>}
  </section>
}
