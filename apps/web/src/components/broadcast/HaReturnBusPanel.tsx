import {useEffect,useRef,useState} from 'react'
import {api,type HaReturnMediaApplicationReport,type HaReturnBusReviewReport,type HaReturnBusReviewRequest} from '../../api.js'
import {newHaMonitorId} from '../../domain/ha-monitor-pending.js'
import {parseReturnBusIntent,readReturnBusReport} from '../../domain/ha-return-bus.js'
import {HaReturnJobRecoveryPanel} from './HaReturnJobRecoveryPanel.js'
export function HaReturnBusPanel({media,stale}:{media:HaReturnMediaApplicationReport;stale:boolean}){
  const key='rplayout.ha.return-bus.v1:'+media.request.mediaApplicationId
  const [intent,setIntent]=useState<HaReturnBusReviewRequest|null>(null),[report,setReport]=useState<HaReturnBusReviewReport|null>(null),[confirmed,setConfirmed]=useState(false),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null)
  const generation=useRef(0),running=useRef(false)
  useEffect(()=>{generation.current++;setReady(false);setBusy(false);setIntent(null);setReport(null);setConfirmed(false);setError(null);try{const saved=sessionStorage.getItem(key);setIntent(saved?parseReturnBusIntent(JSON.parse(saved),media):null);setReady(true)}catch{setError('Intenção do bus completo guardada inválida/inacessível; preservada.')}return()=>{generation.current++}},[key,media.request.channelId,media.updatedAt,stale])
  const eligible=media.ownedHere&&media.phase==='STAGED'&&!!media.result
  const run=async(create:boolean)=>{
    if(running.current||stale||!ready||create&&(!!intent||!eligible||!confirmed))return
    running.current=true;setBusy(true);setError(null);const stamp=generation.current
    try{
      let expected=intent
      if(create){
        if(sessionStorage.getItem(key))throw new Error()
        expected=parseReturnBusIntent({busReviewId:newHaMonitorId(),mediaApplicationId:media.request.mediaApplicationId,channelId:media.request.channelId},media)
        sessionStorage.setItem(key,JSON.stringify(expected));setIntent(expected)
      }
      if(!expected)throw new Error()
      const response=create?await api.reviewHaReturnBus(expected):await api.haReturnBusQuery(expected.busReviewId,expected.channelId)
      const value=readReturnBusReport(response,expected,media)
      if(stamp===generation.current)setReport(value)
    }catch{if(stamp===generation.current)setError('Medição não confirmada; consulte o mesmo pedido sem repetir. A cópia e o PGM foram preservados.')}
    finally{running.current=false;if(stamp===generation.current)setBusy(false)}
  }
  return <section aria-label="Medição isolada de áudio do bus completo" className="border border-border-subtle rounded p-2 space-y-2">
    <h4>Medição do bus completo — isolada</h4>
    <p>Mede master e pares auxiliares juntos em 2, 8 ou 16 canais, com os ganhos registrados e o teto local. Exige cobertura do áudio original e inclui a cauda do limitador. Não comprova reprodução contínua, transições, sincronismo ou saída física; não aprova QC nem habilita transmissão.</p>
    {!intent&&<><label className="block"><input type="checkbox" checked={confirmed} disabled={busy||stale||!ready||!eligible} onChange={event=>setConfirmed(event.target.checked)}/> Solicito a medição desta cópia, sem retomar o canal.</label><button className="underline" disabled={busy||stale||!ready||!eligible||!confirmed} onClick={()=>void run(true)}>Medir do bus completo desta cópia</button></>}
    {intent&&<><p>Pedido preservado: {intent.busReviewId}</p><button className="underline" disabled={busy||stale||!ready} onClick={()=>void run(false)}>Consultar medição sem repetir</button></>}
    {error&&<p role="alert" className="text-armed-amber">{error}</p>}
    {report&&<p role="status">{({ACCEPTED:'Pedido registrado',MEASURING:'Medição sem confirmação final',REVIEWED:'Recibos da medição registrados',FAILED:'Tentativa falhou; histórico preservado'})[report.phase]}. Confirmação histórica, sem autorização para PGM.</p>}
    {report&&<p>Perfil utilizado: {report.capture.profile.targetLufs} LUFS · teto {report.capture.profile.ceilingDbtp} dBTP · {report.capture.profile.audioChannels} canais. {report.capture.autoDecisionId?'Decisão AUTO registrada na cópia.':'Sem adoção de nova decisão AUTO.'}</p>}
    {report?.result&&<p>{report.result.summary.measured}/{report.result.summary.required} buses de itens medidos · {report.result.summary.failed} falhas · {report.result.summary.planBlocked} bloqueios de planejamento. Mesmo sem falhas, a qualificação completa e aprovação continuam pendentes.</p>}
    {report?.result&&<p>{report.result.assessment?`${report.result.assessment.withinProfile}/${report.result.assessment.required} dentro dos limites por par · ${report.result.assessment.failed} fora do perfil ou sem medição · política na revisão ${report.result.assessment.configurationRevision}.`:'Sem avaliação por política: critérios não configurados ou recibo legado.'} Esta avaliação isolada não aprova QC nem libera PGM.</p>}
    {report&&(report.phase==='ACCEPTED'||report.phase==='MEASURING')&&<HaReturnJobRecoveryPanel target={{kind:'BUS_REVIEW',id:report.request.busReviewId,channelId:report.request.channelId,phase:report.phase,updatedAt:report.updatedAt}} stale={stale||busy} onClosed={()=>void run(false)}/>}
  </section>
}
