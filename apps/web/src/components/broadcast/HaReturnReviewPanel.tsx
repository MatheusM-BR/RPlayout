import {useEffect,useRef,useState} from 'react'
import {api,type HaReturnReceipt,type HaReturnReviewRequest,type HaReturnReviewReport,type HaReturnRekeyReport} from '../../api.js'
import {newHaMonitorId} from '../../domain/ha-monitor-pending.js'
import {HaHistoryImportPanel} from './HaHistoryImportPanel.js'
import {HaHistoryVariantPanel} from './HaHistoryVariantPanel.js'
import {HaReturnSelectionPanel} from './HaReturnSelectionPanel.js'
import {HaReturnJobRecoveryPanel} from './HaReturnJobRecoveryPanel.js'
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i
function intent(raw:unknown):HaReturnReviewRequest{if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error();const v=raw as Record<string,unknown>;if(!['channelId,reviewId,transferId','channelId,rekeyId,reviewId,transferId'].includes(Object.keys(v).sort().join(','))||typeof v.channelId!=='string'||!v.channelId||![v.reviewId,v.transferId].every(id=>typeof id==='string'&&uuid.test(id))||Object.hasOwn(v,'rekeyId')&&(typeof v.rekeyId!=='string'||!uuid.test(v.rekeyId)))throw new Error();return v as unknown as HaReturnReviewRequest}
const labels:Record<string,string>={PROTECTED_FIELDS_RECONCILIATION_REQUIRED:'Chaves e campos protegidos ainda não reconciliados.',MEDIA_BINDINGS_RECONCILIATION_REQUIRED:'Mídia e caminhos locais exigem reconciliação.',EXECUTION_CURSOR_RECONCILIATION_REQUIRED:'Cursor de retomada ainda não selecionado/revisado.',UNRESOLVED_COMMANDS_REVIEW_REQUIRED:'Comandos incertos ainda exigem revisão.',RETURN_AUTHORITY_NOT_GRANTED:'Retorno de autoridade não concedido.',ISOLATED_SCHEMA_MIGRATION_REQUIRED:'Versão exige migração isolada.',ASRUN_RECONCILIATION_REQUIRED:'Histórico exige reconciliação explícita.',PUBLISHED_EDITION_RECONCILIATION_REQUIRED:'Edições publicadas diferem.',PRIMARY_CHANGED_DURING_REVIEW:'Dados do principal mudaram durante esta revisão.',CHECKPOINT_REFERENCE_INVALID:'Cursor recebido referencia edição ou item ausente/incompatível.'}
export function HaReturnReviewPanel({receipt,stale,rekey}:{receipt:HaReturnReceipt;stale:boolean;rekey?:HaReturnRekeyReport}){
  const rekeyId=rekey?.request.rekeyId
  const key='rplayout.ha.return-reviews.v1:'+receipt.transferId+(rekeyId?':rekey:'+rekeyId:'')
  const [requests,setRequests]=useState<HaReturnReviewRequest[]>([]),[report,setReport]=useState<HaReturnReviewReport|null>(null),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null)
  const active=useRef(true),loading=useRef(false)
  const read=()=>{const saved=window.sessionStorage.getItem(key);if(!saved)return [];const raw:unknown=JSON.parse(saved);if(!Array.isArray(raw)||raw.length>128)throw new Error();const values=raw.map(intent);if(new Set(values.map(v=>v.reviewId)).size!==values.length||values.some(v=>v.channelId!==receipt.channelId||v.transferId!==receipt.transferId||v.rekeyId!==rekeyId))throw new Error();return values}
  useEffect(()=>{active.current=true;try{setRequests(read());setReady(true)}catch{setError('Intenções locais inválidas/inacessíveis; preservadas sem sobrescrever.')}return()=>{active.current=false}},[key])
  const last=requests.at(-1)
  const accept=(request:HaReturnReviewRequest,result:HaReturnReviewReport)=>{
    const actual=intent(result.request),technical=result.report
    if(Object.entries(request).some(([k,v])=>actual[k as keyof HaReturnReviewRequest]!==v)||actual.rekeyId!==rekeyId||result.version!==1||!['ACCEPTED','REVIEWING','REVIEWED','FAILED'].includes(result.phase)||result.primaryApproved!==false||result.publicationAuthorized!==false||result.phase==='REVIEWED'&&!technical)throw new Error()
    if(technical&&(technical.channelId!==receipt.channelId||technical.transferId!==receipt.transferId||technical.databaseHash!==(rekey?.result?.databaseHash??receipt.databaseHash)||technical.primaryApproved!==false||technical.publicationAuthorized!==false||technical.authorityTransferred!==false||technical.historyMerged!==false||technical.history.merged!==false||technical.confirmationIsHistorical!==true||!Array.isArray(technical.blockers)))throw new Error()
    if(technical&&rekeyId){
      const fields=technical.protectedFields,ownership=fields?.foreignOwnership
      if(technical.sourceKind!=='REKEYED_DERIVATIVE'||technical.rekeyId!==rekeyId||technical.receivedDatabaseHash!==receipt.databaseHash||!fields||fields.encodingValidated!==true||fields.contentApproved!==false||fields.localExecutionAuthorized!==false||fields.vaultFingerprint!==rekey?.result?.vaultFingerprint||fields.fields!==rekey?.result?.entries||ownership&&(ownership.inventoryMatched!==true||ownership.sourceSignaturesAttested!==true||ownership.localExecutionAuthorized!==false||ownership.authorityTransferred!==false)||!!ownership!==!!rekey?.result?.ownershipEvidence)throw new Error()
    }
    if(active.current)setReport(result)
  }
  const unresolved=!!last&&(!report||report.request.reviewId!==last.reviewId||['ACCEPTED','REVIEWING'].includes(report.phase))
  const run=async(create:boolean)=>{
    if(loading.current||stale||!ready||create&&(unresolved||!receipt.ownedHere||receipt.phase!=='RECEIVED_QUARANTINE'||rekey&&(!rekey.ownedHere||rekey.phase!=='REKEYED_STAGED'||!rekey.result)))return;loading.current=true;setBusy(true);setError(null)
    try{let request=last;if(create){const previous=read();if(JSON.stringify(previous)!==JSON.stringify(requests)||previous.length>=128)throw new Error();request={reviewId:newHaMonitorId(),transferId:receipt.transferId,channelId:receipt.channelId,...(rekeyId?{rekeyId}:{})};window.sessionStorage.setItem(key,JSON.stringify([...previous,request]));if(active.current){setRequests([...previous,request]);setReport(null)}}if(!request)throw new Error();accept(request,await (create?api.haReturnReview(request):api.haReturnReviewQuery(request.reviewId,request.channelId)))}
    catch{if(active.current)setError('Revisão não confirmada; consulte sem repetir. Nenhum dado instalado.')}
    finally{loading.current=false;if(active.current)setBusy(false)}
  }
  return <section aria-label="Revisão técnica do banco devolvido" className="space-y-2">
    <button disabled={busy||stale||!ready||unresolved||!receipt.ownedHere||receipt.phase!=='RECEIVED_QUARANTINE'||!!rekey&&(!rekey.ownedHere||rekey.phase!=='REKEYED_STAGED'||!rekey.result)} onClick={()=>void run(true)} className="underline">{rekeyId?'Revisar cópia reprotegida e leitura dos campos':'Revisar integridade, edição e histórico'}</button>
    {last&&<button disabled={busy||stale} onClick={()=>void run(false)} className="underline ml-2">Consultar revisão sem repetir</button>}
    {error&&<p role="alert" className="text-armed-amber">{error}</p>}
    {report&&<p>Revisão: {({ACCEPTED:'aceita',REVIEWING:'em processamento',REVIEWED:'registrada — ainda não aprovada',FAILED:'falhou; nenhuma alteração instalada'})[report.phase]}</p>}
    {report?.report&&<><p>SQLite: integridade/referências conferidas · versão {report.report.schema.applied}/{report.report.schema.supportedThrough} · histórico: {report.report.history.receivedOnly} novos, {report.report.history.changed} alterados, {report.report.history.primaryOnly} somente no principal, {report.report.history.receivedOpen} abertos.</p><ul className="list-disc pl-4">{report.report.blockers.map(reason=><li key={reason}>{labels[reason]??'Pré-requisito não reconciliado.'}</li>)}</ul></>}
    <p className="text-outline">Revisão histórica somente leitura. Não importa chaves, mescla histórico, seleciona cursor ou autoriza PGM.</p>
    {report?.report?.protectedFields&&<p>{report.report.protectedFields.fields} campos legíveis no cofre do principal. Conteúdo operacional ainda não aprovado; posse estrangeira não vira autorização local.</p>}
    {report?.report?.protectedFields?.contentComparison&&<p>Edições por conteúdo: {report.report.protectedFields.contentComparison.editions.matched} iguais, {report.report.protectedFields.contentComparison.editions.changed} alteradas, {report.report.protectedFields.contentComparison.editions.receivedOnly} somente na cópia e {report.report.protectedFields.contentComparison.editions.primaryOnly} somente no principal. Cursor: {report.report.protectedFields.contentComparison.checkpoint.equal?'igual':'diferente'}; referências {report.report.protectedFields.contentComparison.checkpoint.referencedEditionPresent&&report.report.protectedFields.contentComparison.checkpoint.referencedItemPresent?'presentes':'incompatíveis'}. Nenhuma edição ou retomada selecionada.</p>}
    {report?.report?.protectedFields?.contentComparison?.mediaRequirements&&<p>Pré-requisitos de mídia: {report.report.protectedFields.contentComparison.mediaRequirements.checked} montagens analisadas, {report.report.protectedFields.contentComparison.mediaRequirements.blocked} bloqueadas e {report.report.protectedFields.contentComparison.mediaRequirements.liveBindingsRequired} entradas ao vivo exigindo vínculo/sinal local. Bytes, decodificação e seleção de vínculos ainda não validados.</p>}
    {report&&(report.phase==='ACCEPTED'||report.phase==='REVIEWING')&&(report.ownerRecorded?<HaReturnJobRecoveryPanel key={'recover:'+report.request.reviewId} target={{kind:'DATABASE_REVIEW',id:report.request.reviewId,channelId:report.request.channelId,phase:report.phase,updatedAt:report.updatedAt}} stale={stale||busy} onClosed={()=>void run(false)}/>:<p>Revisão histórica sem registro do processo responsável. Consultável, mas não admite encerramento presumido.</p>)}
    {!rekeyId&&report?.phase==='REVIEWED'&&report.report&&<HaHistoryImportPanel key={report.request.reviewId} review={report} stale={stale||!!error||busy}/>}
    {!rekeyId&&report?.phase==='REVIEWED'&&report.report&&<HaHistoryVariantPanel key={'variants:'+report.request.reviewId} review={report} stale={stale||!!error||busy}/>}
    {rekeyId&&report?.phase==='REVIEWED'&&report.report?.protectedFields?.contentComparison?.selectionBasis&&<HaReturnSelectionPanel key={'selection:'+report.request.reviewId} review={report} stale={stale||!!error||busy} canCreate={!!rekey?.ownedHere&&receipt.ownedHere}/>}
  </section>
}
