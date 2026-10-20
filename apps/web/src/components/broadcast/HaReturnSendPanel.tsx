import {useEffect,useRef,useState} from 'react'
import {api,type HaExportReport,type HaReturnSendRequest,type HaReturnSendReport} from '../../api.js'
import {newHaMonitorId} from '../../domain/ha-monitor-pending.js'
import {HaReturnResumePanel} from './HaReturnResumePanel.js'
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i
function intent(raw:unknown):HaReturnSendRequest{if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error();const v=raw as Record<string,unknown>;if(Object.keys(v).sort().join(',')!=='channelId,exportId,promotionId,requestId'||typeof v.channelId!=='string'||!v.channelId||v.channelId.length>128||![v.requestId,v.exportId,v.promotionId].every(id=>typeof id==='string'&&uuid.test(id)))throw new Error();return v as unknown as HaReturnSendRequest}
export function HaReturnSendPanel({exported,stale}:{exported:HaExportReport;stale:boolean}){
  const key='rplayout.ha.return-send.v1:'+exported.request.requestId
  const [request,setRequest]=useState<HaReturnSendRequest|null>(null),[report,setReport]=useState<HaReturnSendReport|null>(null),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null)
  const active=useRef(true),loading=useRef(false)
  useEffect(()=>{active.current=true;try{const saved=window.sessionStorage.getItem(key);if(saved){const v=intent(JSON.parse(saved));if(v.exportId!==exported.request.requestId||v.channelId!==exported.request.channelId||v.promotionId!==exported.request.promotionId)throw new Error();setRequest(v)}setReady(true)}catch{setError('Intenção local inválida/inacessível; preservada sem sobrescrever.')}return()=>{active.current=false}},[key,exported.request.channelId,exported.request.promotionId,exported.request.requestId])
  const accept=(sent:HaReturnSendRequest,result:HaReturnSendReport)=>{
    const actual=intent(result.request),receipt=result.receipt
    if(typeof result.canResume!=='boolean'||result.canResume&&(result.phase!=='UNCERTAIN'||receipt?.phase!=='RECEIVING'||typeof result.reviewToken!=='string'||!result.reviewToken||result.reviewToken.length>256))throw new Error()
    if(Object.entries(sent).some(([k,v])=>actual[k as keyof HaReturnSendRequest]!==v)||result.version!==1||!['ACCEPTED','SENDING','RECEIVED_QUARANTINE','FAILED','UNCERTAIN'].includes(result.phase)||result.primaryApproved!==false||result.publicationAuthorized!==false||result.authorityTransferred!==false||result.automaticRestart!==false||result.phase==='RECEIVED_QUARANTINE'&&receipt?.phase!=='RECEIVED_QUARANTINE')throw new Error()
    if(receipt&&(receipt.transferId!==sent.requestId||receipt.exportId!==sent.exportId||receipt.promotionId!==sent.promotionId||receipt.channelId!==sent.channelId||receipt.stopRequestId!==exported.request.stopRequestId||receipt.databaseHash!==exported.databaseHash||receipt.manifestHash!==exported.manifestHash||receipt.databaseBytes!==exported.databaseBytes||receipt.primaryApproved!==false||receipt.publicationAuthorized!==false||receipt.authorityTransferred!==false||receipt.physicalOutputValidated!==false||!Number.isSafeInteger(receipt.offset)||receipt.offset<0||receipt.offset>receipt.databaseBytes||receipt.phase==='RECEIVED_QUARANTINE'&&receipt.offset!==receipt.databaseBytes))throw new Error()
    if(active.current)setReport(result)
  }
  const run=async(remote:boolean,create=false)=>{
    if(loading.current||stale||!ready||exported.phase!=='SEALED'||create&&!!request)return;loading.current=true;setBusy(true);setError(null)
    try{let sent=request
      if(create){if(window.sessionStorage.getItem(key))throw new Error();sent={requestId:newHaMonitorId(),exportId:exported.request.requestId,channelId:exported.request.channelId,promotionId:exported.request.promotionId};window.sessionStorage.setItem(key,JSON.stringify(sent));if(active.current)setRequest(sent)}
      if(!sent)throw new Error()
      accept(sent,await (create?api.haReturnSend(sent):remote?api.haReturnSendInspect(sent.requestId,sent.channelId):api.haReturnSendQuery(sent.requestId,sent.channelId)))
    }catch{if(active.current)setError('Operação não confirmada. Pedido preservado; não repita envio. Consulta remota não reenvia bytes.')}
    finally{loading.current=false;if(active.current)setBusy(false)}
  }
  return <section aria-label="Envio da execução ao principal" className="border rounded p-2 space-y-2">
    <button disabled={busy||stale||!ready||!!request} onClick={()=>void run(false,true)} className="underline">Enviar cópia selada ao principal</button>
    {request&&<><button disabled={busy||stale} onClick={()=>void run(false)} className="underline ml-2">Consultar diário local</button><button disabled={busy||stale} onClick={()=>void run(true)} className="underline ml-2">Consultar recibo no principal</button></>}
    {error&&<p role="alert" className="text-armed-amber">{error}</p>}
    {report&&<p>{({ACCEPTED:'Pedido aceito',SENDING:'Envio sem confirmação final',RECEIVED_QUARANTINE:'Recebido em quarentena no principal',FAILED:'Falhou antes de transmitir',UNCERTAIN:'Resultado incerto; consulte o recibo'})[report.phase]}{report.receipt&&` · ${report.receipt.offset} / ${report.receipt.databaseBytes} bytes confirmados`}</p>}
    {report&&request&&<HaReturnResumePanel transfer={report} stale={stale||!!error||busy} onTransfer={value=>accept(request,value)}/>}
    <p className="text-outline">Enviar não instala o banco, não aprova dados e não devolve autoridade. Falha ou cópia parcial exige revisão, sem retomada automática.</p>
  </section>
}
