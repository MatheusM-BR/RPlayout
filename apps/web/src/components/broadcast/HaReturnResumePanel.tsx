import {useEffect,useRef,useState} from 'react'
import {api,type HaReturnSendReport,type HaReturnResumeRequest,type HaReturnResumeReport} from '../../api.js'
import {newHaMonitorId} from '../../domain/ha-monitor-pending.js'
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i
function parse(raw:unknown):HaReturnResumeRequest{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error();const v=raw as Record<string,unknown>
  if(Object.keys(v).sort().join(',')!=='channelId,expectedOffset,requestId,resumeId,reviewToken'||typeof v.channelId!=='string'||!v.channelId||v.channelId.length>128||typeof v.reviewToken!=='string'||!v.reviewToken||v.reviewToken.length>256||typeof v.expectedOffset!=='number'||!Number.isSafeInteger(v.expectedOffset)||v.expectedOffset<0||v.expectedOffset>16*1024**3||![v.requestId,v.resumeId].every(id=>typeof id==='string'&&uuid.test(id)))throw new Error()
  return v as unknown as HaReturnResumeRequest
}
export function HaReturnResumePanel({transfer,stale,onTransfer}:{transfer:HaReturnSendReport;stale:boolean;onTransfer:(report:HaReturnSendReport)=>void}){
  const key='rplayout.ha.return-resumes.v1:'+transfer.request.requestId
  const [intents,setIntents]=useState<HaReturnResumeRequest[]>([]),[known,setKnown]=useState<HaReturnResumeReport|null>(null),[ready,setReady]=useState(false),[error,setError]=useState<string|null>(null),[busy,setBusy]=useState(false)
  const active=useRef(true),loading=useRef(false)
  const read=()=>{const saved=window.sessionStorage.getItem(key);if(!saved)return [];const raw:unknown=JSON.parse(saved);if(!Array.isArray(raw)||raw.length>128)throw new Error();const values=raw.map(parse);if(new Set(values.map(v=>v.resumeId)).size!==values.length||values.some(v=>v.requestId!==transfer.request.requestId||v.channelId!==transfer.request.channelId))throw new Error();return values}
  useEffect(()=>{active.current=true;try{setIntents(read());setReady(true)}catch{setError('Diário local de retomadas inválido; preservado, sem sobrescrever.')}return()=>{active.current=false}},[key])
  const accept=(request:HaReturnResumeRequest,result:HaReturnResumeReport)=>{const actual=parse(result.resume.request);if(Object.entries(request).some(([k,v])=>actual[k as keyof HaReturnResumeRequest]!==v)||result.resume.version!==1||!['ACCEPTED','SENDING','RECEIVED_QUARANTINE','UNCERTAIN'].includes(result.resume.phase)||result.resume.restartsFromZero!==false)throw new Error();onTransfer(result.transfer);if(active.current)setKnown(result)}
  const last=intents.at(-1)
  const unresolved=!!last&&(!known||known.resume.request.resumeId!==last.resumeId||['ACCEPTED','SENDING'].includes(known.resume.phase))
  const resume=async()=>{
    if(loading.current||stale||!ready||unresolved||!transfer.canResume||!transfer.reviewToken||!transfer.receipt)return;loading.current=true;setBusy(true);setError(null)
    try{const previous=read();if(JSON.stringify(previous)!==JSON.stringify(intents)||previous.length>=128)throw new Error();const next:HaReturnResumeRequest={resumeId:newHaMonitorId(),requestId:transfer.request.requestId,channelId:transfer.request.channelId,reviewToken:transfer.reviewToken,expectedOffset:transfer.receipt.offset};window.sessionStorage.setItem(key,JSON.stringify([...previous,next]));if(active.current){setIntents([...previous,next]);setKnown(null)}accept(next,await api.haReturnResume(next))}
    catch{if(active.current)setError('Retomada não confirmada; pedido preservado. Consulte sem reenviar.')}
    finally{loading.current=false;if(active.current)setBusy(false)}
  }
  const query=async()=>{if(loading.current||stale||!last)return;loading.current=true;setBusy(true);setError(null);try{accept(last,await api.haReturnResumeQuery(last.resumeId,last.channelId))}catch{if(active.current)setError('Consulta indisponível; retomada não foi repetida.')}finally{loading.current=false;if(active.current)setBusy(false)}}
  return <section aria-label="Retomada explícita da cópia parcial" className="space-y-2">
    <button disabled={busy||stale||!ready||unresolved||!transfer.canResume} onClick={()=>void resume()} className="underline">Retomar cópia a partir do offset conferido</button>
    {last&&<button disabled={busy||stale} onClick={()=>void query()} className="underline ml-2">Consultar pedido de retomada</button>}
    {error&&<p role="alert" className="text-armed-amber">{error}</p>}
    {known&&<p>Retomada: {({ACCEPTED:'aceita',SENDING:'sem confirmação final',RECEIVED_QUARANTINE:'recebida em quarentena',UNCERTAIN:'incerta; confira o principal'})[known.resume.phase]}</p>}
    <p className="text-outline">Conferência remota obrigatória antes dos bytes. Não reinicia do zero nem adota parcial de instância perdida.</p>
  </section>
}
