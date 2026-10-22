import {useEffect,useRef,useState} from 'react'
import {api,type HaReturnSelectionReport,type HaReturnCandidateRequest,type HaReturnCandidateReport} from '../../api.js'
import {newHaMonitorId} from '../../domain/ha-monitor-pending.js'
import {HaReturnBindingsPanel} from './HaReturnBindingsPanel.js'
import {HaReturnJobRecoveryPanel} from './HaReturnJobRecoveryPanel.js'
export function HaReturnCandidatePanel({selection,stale}:{selection:HaReturnSelectionReport;stale:boolean}){
  const key='rplayout.ha.return-candidate.v1:'+selection.request.planId
  const [intent,setIntent]=useState<HaReturnCandidateRequest|null>(null),[report,setReport]=useState<HaReturnCandidateReport|null>(null),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null)
  const active=useRef(true),loading=useRef(false)
  const parse=(raw:unknown)=>{if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error();const v=raw as HaReturnCandidateRequest;if(Object.keys(v).sort().join(',')!=='candidateId,channelId,planId'||typeof v.candidateId!=='string'||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v.candidateId)||v.planId!==selection.request.planId||v.channelId!==selection.request.channelId)throw new Error();return v}
  useEffect(()=>{active.current=true;try{const saved=window.sessionStorage.getItem(key);if(saved)setIntent(parse(JSON.parse(saved)));setReady(true)}catch{setError('Intenção inválida/inacessível; preservada.')}return()=>{active.current=false}},[key])
  const run=async(create:boolean)=>{
    if(loading.current||stale||!ready||create&&(!!intent||!selection.ownedHere))return;loading.current=true;setBusy(true);setError(null)
    try{
      let expected=intent
      if(create){if(window.sessionStorage.getItem(key))throw new Error();expected=parse({candidateId:newHaMonitorId(),planId:selection.request.planId,channelId:selection.request.channelId});window.sessionStorage.setItem(key,JSON.stringify(expected));if(active.current)setIntent(expected)}
      if(!expected)throw new Error()
      const value=create?await api.haReturnCandidate(expected):await api.haReturnCandidateQuery(expected.candidateId,expected.channelId)
      if(JSON.stringify(parse(value.request))!==JSON.stringify(expected)||value.version!==1||!['ACCEPTED','MATERIALIZING','STAGED','FAILED'].includes(value.phase)||value.confirmationIsHistorical!==true||value.operationalReady!==false||value.phase==='STAGED'&&!value.result)throw new Error()
      const result=value.result
      if(result&&(result.sourceDatabaseHash!==selection.reviewDatabaseHash||!/^[a-f0-9]{64}$/.test(result.databaseHash)||!/^[a-f0-9]{64}$/.test(result.vaultFingerprint)||!Number.isSafeInteger(result.databaseBytes)||result.databaseBytes<=0||result.databaseBytes>256*1024*1024||result.selectedRevisions!==selection.request.revisionIds.length||result.channelArchived!==true||result.cursorStopped!==true||result.bindingsResolved!==false||result.nativePrepared!==false||result.publicationAuthorized!==false||result.authorityTransferred!==false))throw new Error()
      if(active.current)setReport(value)
    }catch{if(active.current)setError('Candidato não confirmado; consulte sem repetir. Parcial preservado.')}
    finally{loading.current=false;if(active.current)setBusy(false)}
  }
  return <section aria-label="Candidato isolado de retorno" className="space-y-2">
    <button className="underline" disabled={busy||stale||!ready||!!intent||!selection.ownedHere} onClick={()=>void run(true)}>Criar candidato isolado, sem retomar</button>
    {intent&&<button className="underline ml-2" disabled={busy||stale} onClick={()=>void run(false)}>Consultar candidato sem repetir</button>}
    {error&&<p role="alert" className="text-armed-amber">{error}</p>}
    {report&&<p>{({ACCEPTED:'Pedido registrado',MATERIALIZING:'Criação sem confirmação final',STAGED:'Candidato isolado criado e parado',FAILED:'Falhou; parcial preservado'})[report.phase]}{report.result&&` · SHA ${report.result.databaseHash}`}. Não autorizado para operação.</p>}
    {report&&(report.phase==='ACCEPTED'||report.phase==='MATERIALIZING')&&<HaReturnJobRecoveryPanel key={'recover:'+report.request.candidateId} target={{kind:'CANDIDATE',id:report.request.candidateId,channelId:report.request.channelId,phase:report.phase,updatedAt:report.updatedAt}} stale={stale||busy} onClosed={()=>void run(false)}/>}
    {report?.phase==='STAGED'&&report.ownedHere&&report.result&&<HaReturnBindingsPanel key={report.request.candidateId} candidate={report.request} sourceDatabaseHash={report.result.databaseHash} stale={stale}/>}
  </section>
}
