import {useEffect,useRef,useState} from 'react'
import {api,type HaReturnReceipt,type HaReturnRekeyRequest,type HaReturnRekeyReport} from '../../api.js'
import {newHaMonitorId} from '../../domain/ha-monitor-pending.js'
import {HaReturnReviewPanel} from './HaReturnReviewPanel.js'
import {HaReturnJobRecoveryPanel} from './HaReturnJobRecoveryPanel.js'
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i
export function HaReturnRekeyPanel({receipt,stale}:{receipt:HaReturnReceipt;stale:boolean}){
  const key='rplayout.ha.return-rekey.v1:'+receipt.transferId
  const [request,setRequest]=useState<HaReturnRekeyRequest|null>(null),[report,setReport]=useState<HaReturnRekeyReport|null>(null),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null)
  const active=useRef(true),loading=useRef(false)
  const parse=(raw:unknown):HaReturnRekeyRequest=>{if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error();const value=raw as HaReturnRekeyRequest;if(Object.keys(value).sort().join(',')!=='channelId,rekeyId,transferId'||value.channelId!==receipt.channelId||value.transferId!==receipt.transferId||typeof value.rekeyId!=='string'||!uuid.test(value.rekeyId))throw new Error();return value}
  useEffect(()=>{active.current=true;try{const saved=window.sessionStorage.getItem(key);if(saved)setRequest(parse(JSON.parse(saved)));setReady(true)}catch{setError('Intenção local inválida/inacessível; preservada sem sobrescrever.')}return()=>{active.current=false}},[key])
  const accept=(expected:HaReturnRekeyRequest,value:HaReturnRekeyReport)=>{
    const actual=parse(value.request)
    if(Object.entries(expected).some(([k,v])=>actual[k as keyof HaReturnRekeyRequest]!==v)||value.version!==1||!['ACCEPTED','REKEYING','REKEYED_STAGED','FAILED'].includes(value.phase)||value.confirmationIsHistorical!==true||value.operationalApproved!==false||value.publicationAuthorized!==false||value.phase==='REKEYED_STAGED'&&!value.result)throw new Error()
    const result=value.result
    if(result&&(result.sourceDatabaseHash!==receipt.databaseHash||!/^[a-f0-9]{64}$/.test(result.databaseHash)||!/^[a-f0-9]{64}$/.test(result.vaultFingerprint)||!Number.isSafeInteger(result.databaseBytes)||result.databaseBytes<=0||result.databaseBytes>16*1024**3||!Number.isSafeInteger(result.entries)||result.entries<0||result.entries>100000||result.installationKeyCopied!==false||result.operationalApproved!==false||result.publicationAuthorized!==false))throw new Error()
    const evidence=result?.ownershipEvidence
    if(evidence&&(evidence.version!==1||evidence.validation!=='SOURCE_SIGNATURES_CHECKED'||evidence.authorityTransferred!==false||!/^[a-f0-9]{64}$/.test(evidence.inventoryHash)||!/^[a-f0-9]{64}$/.test(evidence.sourceVaultFingerprint)||[['runs',100000],['slots',100000],['asRunLinks',500000]].some(([name,max])=>{const count=evidence[name as 'runs'|'slots'|'asRunLinks'];return !Number.isSafeInteger(count)||count<0||count>Number(max)})))throw new Error()
    const lifecycle=evidence?.lifecycleEvidence
    if(lifecycle&&(!Number.isSafeInteger(lifecycle.rows)||lifecycle.rows<0||lifecycle.rows>400002||!/^[a-f0-9]{64}$/.test(lifecycle.inventoryHash)||lifecycle.coverage!=='DISTRIBUTION_SERVER_STORAGE_RESTORE_ACTIVATION'))throw new Error()
    if(active.current)setReport(value)
  }
  const run=async(create:boolean)=>{if(loading.current||stale||!ready||create&&(!!request||!!receipt.rekeyRequestId||!receipt.ownedHere||!receipt.hasProtectedBridge||receipt.phase!=='RECEIVED_QUARANTINE'))return;loading.current=true;setBusy(true);setError(null)
    try{let expected=request;if(create){if(window.sessionStorage.getItem(key))throw new Error();expected={rekeyId:newHaMonitorId(),transferId:receipt.transferId,channelId:receipt.channelId};window.sessionStorage.setItem(key,JSON.stringify(expected));if(active.current)setRequest(expected)}const id=expected?.rekeyId??receipt.rekeyRequestId;if(!id)throw new Error();const value=create?await api.haReturnRekey(expected!):await api.haReturnRekeyQuery(id,receipt.channelId);if(value.request.rekeyId!==id)throw new Error();accept(expected??parse(value.request),value)}
    catch{if(active.current)setError('Reproteção não confirmada. Pedido preservado; consulte sem repetir.')}
    finally{loading.current=false;if(active.current)setBusy(false)}
  }
  return <section aria-label="Reproteção isolada dos campos recebidos" className="border rounded p-2 space-y-2">
    <button disabled={busy||stale||!ready||!!request||!!receipt.rekeyRequestId||!receipt.ownedHere||!receipt.hasProtectedBridge||receipt.phase!=='RECEIVED_QUARANTINE'} onClick={()=>void run(true)} className="underline">Preparar cópia protegida para este principal</button>
    {(request||receipt.rekeyRequestId)&&<button disabled={busy||stale} onClick={()=>void run(false)} className="underline ml-2">Consultar reproteção sem repetir</button>}
    {error&&<p role="alert" className="text-armed-amber">{error}</p>}
    {report&&<p>{({ACCEPTED:'Pedido aceito',REKEYING:'Reproteção sem confirmação final',REKEYED_STAGED:'Cópia isolada reprotegida — ainda não aprovada',FAILED:'Falhou; parcial preservado'})[report.phase]}{report.result&&` · ${report.result.entries} campos · SHA ${report.result.databaseHash}`}</p>}
    {report?.result&&<p>{report.result.ownershipEvidence?`Assinaturas verificadas na origem e preservadas como histórico: ${report.result.ownershipEvidence.runs} execuções e ${report.result.ownershipEvidence.asRunLinks} vínculos de as-run. Isso não autoriza engine local.`:'Cópia antiga sem atestado de assinaturas de posse; não usar como autorização operacional.'}</p>}
    {report?.result?.ownershipEvidence?.lifecycleEvidence&&<p>Histórico assinado de distribuição, servidor, manutenção e restauração preservado. Não libera recursos ou encerra processos estrangeiros.</p>}
    <p className="text-outline">Chave privada da reserva não é copiada. Recebimento e banco ativo não mudam. Cópia reprotegida ainda exige revisão de registros especiais, edição, mídia, cursor e autoridade.</p>
    {report&&(report.phase==='ACCEPTED'||report.phase==='REKEYING')&&<HaReturnJobRecoveryPanel key={'recover:'+report.request.rekeyId} target={{kind:'REKEY',id:report.request.rekeyId,channelId:report.request.channelId,phase:report.phase,updatedAt:report.updatedAt}} stale={stale||busy} onClosed={()=>void run(false)}/>}
    {report?.phase==='REKEYED_STAGED'&&report.result&&<HaReturnReviewPanel key={report.request.rekeyId} receipt={receipt} rekey={report} stale={stale||busy||!!error}/>}
  </section>
}
