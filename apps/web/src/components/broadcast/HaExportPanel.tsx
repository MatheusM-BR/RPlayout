import {useEffect,useRef,useState} from 'react'
import {api,type HaExportRequest,type HaExportReport,type HaReturnPlan} from '../../api.js'
import {exportIntent,exportReport} from '../../domain/ha-export-intent.js'
import {newHaMonitorId} from '../../domain/ha-monitor-pending.js'
import {HaReturnSendPanel} from './HaReturnSendPanel.js'

export function HaExportPanel({plan,stale}:{plan:HaReturnPlan;stale:boolean}){
  const key='rplayout.ha.export.v1:'+plan.promotionId
  const [request,setRequest]=useState<HaExportRequest|null>(null),[report,setReport]=useState<HaExportReport|null>(null),[error,setError]=useState<string|null>(null),[storageReady,setStorageReady]=useState(false),[busy,setBusy]=useState(false)
  const active=useRef(true),loading=useRef(false)
  useEffect(()=>{active.current=true;try{const raw=window.sessionStorage.getItem(key);if(raw){const saved=exportIntent(JSON.parse(raw));if(saved.channelId!==plan.channelId||saved.promotionId!==plan.promotionId)throw new Error();setRequest(saved)}setStorageReady(true)}catch{setError('Pedido local inválido/inacessível; preservado para revisão. Não será sobrescrito.')}return()=>{active.current=false}},[key,plan.channelId,plan.promotionId])
  const accept=(intent:HaExportRequest,result:HaExportReport)=>{const value=exportReport(intent,result);if(active.current)setReport(value)}
  const create=async()=>{
    if(loading.current||!storageReady||request||!plan.canExport||!plan.stopRequestId||plan.exportRequestId||stale)return
    loading.current=true;setBusy(true);setError(null)
    try{if(window.sessionStorage.getItem(key))throw new Error();const next:HaExportRequest={requestId:newHaMonitorId(),channelId:plan.channelId,promotionId:plan.promotionId,stopRequestId:plan.stopRequestId};window.sessionStorage.setItem(key,JSON.stringify(next));if(active.current)setRequest(next);accept(next,await api.haExport(next))}
    catch{if(active.current)setError('Exportação não confirmada. Pedido preservado; consulte, não repita.')}
    finally{loading.current=false;if(active.current)setBusy(false)}
  }
  const query=async()=>{
    if(loading.current||stale)return
    const id=request?.requestId??plan.exportRequestId;if(!id)return
    loading.current=true;setBusy(true);setError(null)
    try{const value=await api.haExportQuery(id,plan.channelId),intent=request??exportIntent(value.request);if(intent.promotionId!==plan.promotionId||intent.channelId!==plan.channelId||intent.requestId!==id)throw new Error();accept(intent,value)}
    catch{if(active.current)setError('Consulta indisponível; exportação não foi repetida.')}
    finally{loading.current=false;if(active.current)setBusy(false)}
  }
  return <section aria-label="Exportação da execução encerrada" className="space-y-2">
    <button disabled={busy||stale||!storageReady||!!request||!!plan.exportRequestId||!plan.canExport} onClick={()=>void create()} className="underline">Selar cópia dos dados executados</button>
    {(request||plan.exportRequestId)&&<button disabled={busy||stale} onClick={()=>void query()} className="underline ml-2">Consultar exportação sem repetir</button>}
    {error&&<p role="alert" className="text-armed-amber">{error}</p>}
    {report&&<p>Exportação: {({ACCEPTED:'aceita',COPYING:'copiando',SEALED:'selada',FAILED:'falhou; evidência parcial preservada'})[report.phase]}{report.phase==='SEALED'&&<> · SHA: {report.databaseHash} · {report.databaseBytes} bytes</>}</p>}
    <p className="text-outline">Cópia privada local. Não transfere dados ao principal, não aprova mídia nem devolve autoridade. Uma falha não autoriza nova cópia automática.</p>
    {report?.phase==='SEALED'&&<HaReturnSendPanel exported={report} stale={stale||!!error}/>}
  </section>
}
