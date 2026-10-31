import {useEffect,useRef,useState} from 'react'
import {api,type HaReturnApplicationReport,type HaReturnMediaReviewRequest,type HaReturnMediaReviewReport,type HaReturnMediaOptions} from '../../api.js'
import {newHaMonitorId} from '../../domain/ha-monitor-pending.js'
import {HaReturnMediaApplicationPanel} from './HaReturnMediaApplicationPanel.js'
import {HaReturnAutoDecisionPanel} from './HaReturnAutoDecisionPanel.js'
import {HaReturnJobRecoveryPanel} from './HaReturnJobRecoveryPanel.js'
import type {HaReturnAutoDecisionReport} from '../../api.js'
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i,hash=/^[a-f0-9]{64}$/
const qcNames:Record<string,string>={APPROVED:'aprovado',APPROVED_WITH_NOTES:'aprovado com ressalvas',REJECTED:'reprovado',BLOCKED:'bloqueado',FAILED:'falhou',PENDING:'pendente',ANALYSIS:'em análise'}
export function HaReturnMediaReviewPanel({application,stale}:{application:HaReturnApplicationReport;stale:boolean}){
  const [autoDecision,setAutoDecision]=useState<HaReturnAutoDecisionReport|null>(null)
  const key='rplayout.ha.return-media-review.v1:'+application.request.applicationId
  const [intent,setIntent]=useState<HaReturnMediaReviewRequest|null>(null),[report,setReport]=useState<HaReturnMediaReviewReport|null>(null),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null)
  const [options,setOptions]=useState<HaReturnMediaOptions|null>(null),[choices,setChoices]=useState<Record<string,string>>({})
  const generation=useRef(0),running=useRef(false)
  const parse=(raw:unknown)=>{
    const value=raw as HaReturnMediaReviewRequest
    if(!value||Object.keys(value).some(key=>!['mediaReviewId','applicationId','channelId','inventoryMac','mediaChoices'].includes(key))||typeof value.mediaReviewId!=='string'||!uuid.test(value.mediaReviewId)||value.applicationId!==application.request.applicationId||value.channelId!==application.request.channelId||value.inventoryMac!==undefined&&(typeof value.inventoryMac!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(value.inventoryMac)))throw new Error()
    if(value.mediaChoices!==undefined&&(!Array.isArray(value.mediaChoices)||value.mediaChoices.length>1000||value.mediaChoices.some(row=>!row||Object.keys(row).sort().join(',')!=='contentHash,localAssetId'||typeof row.contentHash!=='string'||!hash.test(row.contentHash)||typeof row.localAssetId!=='string'||!row.localAssetId||row.localAssetId.length>128)||new Set(value.mediaChoices.map(row=>row.contentHash)).size!==value.mediaChoices.length||value.mediaChoices.length&&!value.inventoryMac))throw new Error()
    return {mediaReviewId:value.mediaReviewId,applicationId:value.applicationId,channelId:value.channelId,...(value.inventoryMac===undefined?{}:{inventoryMac:value.inventoryMac}),...(value.mediaChoices===undefined?{}:{mediaChoices:value.mediaChoices.map(row=>({contentHash:row.contentHash,localAssetId:row.localAssetId}))})}
  }
  useEffect(()=>{generation.current++;setBusy(false);setReady(false);setOptions(null);setChoices({});try{const saved=sessionStorage.getItem(key);setIntent(saved?parse(JSON.parse(saved)):null);setReady(true)}catch{setError('Pedido guardado inválido/inacessível; preservado.')}return()=>{generation.current++}},[key,stale])
  const loadOptions=async()=>{
    if(running.current||stale||!ready||intent)return;running.current=true;setBusy(true);setError(null);setOptions(null);const stamp=generation.current
    try{
      const value=await api.haReturnMediaOptions(application.request.applicationId,application.request.channelId)
      if(value.version!==1||value.applicationId!==application.request.applicationId||value.channelId!==application.request.channelId||value.applicationDatabaseHash!==application.result?.databaseHash||value.physicalBytesValidated!==false||value.operationalReady!==false||!/^[A-Za-z0-9_-]{43}$/.test(value.inventoryMac)||!Array.isArray(value.media)||value.media.length>1000||new Set(value.media.map(row=>row.contentHash)).size!==value.media.length||value.media.some(row=>!hash.test(row.contentHash)||!Array.isArray(row.titles)||!Array.isArray(row.candidates)||row.candidates.some(local=>typeof local.id!=='string'||!local.id||local.id.length>128||typeof local.title!=='string'||local.kind!==row.kind||typeof local.ignored!=='boolean'))||value.media.reduce((n,row)=>n+row.candidates.length,0)>10000)throw new Error()
      if(stamp===generation.current){setOptions(value);setChoices(Object.fromEntries(value.media.map(row=>[row.contentHash,row.candidates.length===1?row.candidates[0]!.id:''])))}
    }catch{if(stamp===generation.current)setError('Conferência local indisponível; nenhum caminho da reserva será reutilizado.')}
    finally{running.current=false;if(stamp===generation.current)setBusy(false)}
  }
  const selectionComplete=options&&options.media.every(row=>row.candidates.length<=1||row.candidates.some(local=>local.id===choices[row.contentHash]))
  const run=async(create:boolean)=>{
    if(running.current||stale||!ready||create&&(!!intent||!application.ownedHere||!selectionComplete))return
    running.current=true;setBusy(true);setError(null);const stamp=generation.current
    try{
      let expected=intent
      if(create){if(sessionStorage.getItem(key)||!options)throw new Error();expected=parse({mediaReviewId:newHaMonitorId(),applicationId:application.request.applicationId,channelId:application.request.channelId,inventoryMac:options.inventoryMac,mediaChoices:options.media.filter(row=>!!choices[row.contentHash]).map(row=>({contentHash:row.contentHash,localAssetId:choices[row.contentHash]!}))});sessionStorage.setItem(key,JSON.stringify(expected));setIntent(expected)}
      if(!expected)throw new Error()
      const value=create?await api.reviewHaReturnMedia(expected):await api.haReturnMediaReviewQuery(expected.mediaReviewId,expected.channelId)
      if(JSON.stringify(parse(value.request))!==JSON.stringify(expected)||value.version!==1||value.operationalReady!==false||value.confirmationIsHistorical!==true||!['ACCEPTED','CHECKING','REVIEWED','FAILED'].includes(value.phase)||value.phase==='REVIEWED'&&!value.result)throw new Error()
      const result=value.result
      const graphics=result?.graphics
      const audio=result?.audio
      if(audio&&(![audio.required,audio.measured,audio.failed,audio.unavailable,audio.planBlocked,audio.shortCuts].every(n=>Number.isSafeInteger(n)&&n>=0&&n<=100000)||audio.required!==audio.measured+audio.failed+audio.unavailable||audio.postGainQualified!==false||audio.busQualified!==false||audio.publicationAuthorized!==false))throw new Error()
      if(graphics&&(![graphics.required,graphics.rendered,graphics.failed,graphics.unavailable,graphics.blocked,graphics.visualApprovalPending].every(n=>Number.isSafeInteger(n)&&n>=0&&n<=100000)||graphics.required!==graphics.rendered+graphics.failed+graphics.unavailable+graphics.blocked||graphics.visualApprovalPending!==graphics.required||graphics.publicationAuthorized!==false))throw new Error()
      if(result&&(result.applicationDatabaseHash!==application.result?.databaseHash||!hash.test(result.runtimeHash)||!/^[A-Za-z0-9_-]{43}$/.test(result.evidenceMac)||result.operationalReady!==false||result.publicationAuthorized!==false||typeof result.bytesAndDecodeComplete!=='boolean'||![result.requiredHashes,result.verifiedHashes,result.checkedMounts,result.blockedMounts,result.livePending,result.mixPending].every(n=>Number.isSafeInteger(n)&&n>=0&&n<=100000)||result.verifiedHashes>result.requiredHashes||result.blockedMounts>result.checkedMounts||result.bytesAndDecodeComplete!==(result.verifiedHashes===result.requiredHashes)||!Array.isArray(result.issues)||result.issues.length>200||typeof result.issuesTruncated!=='boolean'))throw new Error()
      if(stamp===generation.current)setReport(value)
    }catch{if(stamp===generation.current)setError('Análise não confirmada; consulte sem repetir. Nenhuma mídia ou saída foi habilitada.')}
    finally{running.current=false;if(stamp===generation.current)setBusy(false)}
  }
  return <section aria-label="Revisão local de mídia do retorno" className="border border-border-subtle rounded p-2 space-y-2">
    <p>Revisar arquivos desta máquina por conteúdo, QC e decodificação. Pode levar tempo conforme a quantidade e duração dos vídeos. Não libera PGM.</p>
    <button className="underline" disabled={busy||stale||!ready||!!intent||!application.ownedHere} onClick={()=>void loadOptions()}>Conferir arquivos locais</button>
    {options&&<details open><summary>Arquivos do principal — escolha quando houver duplicidade</summary>{options.media.map(row=><label className="block" key={row.contentHash}>{row.titles.join(' / ')} · {row.kind}{!row.candidates.length?' — sem arquivo local correspondente':''}
      {!!row.candidates.length&&<select className="block w-full bg-surface-base" disabled={busy||stale||!!intent} value={choices[row.contentHash]??''} onChange={event=>setChoices(old=>({...old,[row.contentHash]:event.target.value}))}><option value="">Selecione o arquivo local</option>{row.candidates.map(local=><option key={local.id} value={local.id}>{local.title} · QC: {local.qcStatus?qcNames[local.qcStatus]??'não reconhecido':'sem decisão explícita'}{local.ignored?' · ignorado':''}</option>)}</select>}
    </label>)}</details>}
    <button className="underline ml-2" disabled={busy||stale||!ready||!!intent||!application.ownedHere||!selectionComplete} onClick={()=>void run(true)}>Iniciar revisão local de mídia</button>
    {intent&&<button className="underline ml-2" disabled={busy||stale||!ready} onClick={()=>void run(false)}>Consultar revisão sem repetir</button>}
    {error&&<p role="alert" className="text-armed-amber">{error}</p>}
    {report&&<p role="status">{({ACCEPTED:'Pedido registrado',CHECKING:'Análise ainda sem confirmação final',REVIEWED:'Revisão registrada',FAILED:'Falhou; evidências anteriores preservadas'})[report.phase]}. Confirmação histórica, não autorização para operação.</p>}
    {report?.result&&<>
      <p>{report.result.verifiedHashes}/{report.result.requiredHashes} conteúdos conferidos e decodificados · {report.result.blockedMounts}/{report.result.checkedMounts} montagens bloqueadas · {report.result.livePending} lives sem sinal comprovado · {report.result.mixPending} mixes para conferir.</p>
      {report.result.audio?<p>Áudio selecionado: {report.result.audio.measured}/{report.result.audio.required} montagens medidas antes do ganho · {report.result.audio.failed} falhas · {report.result.audio.unavailable} sem medidor · {report.result.audio.planBlocked} bloqueios de planejamento · {report.result.audio.shortCuts} cortes curtos sem qualificação. Ganho final, limitador e barramento ainda pendentes; não aplica AUTO.</p>:<p>Revisão histórica sem evidência de áudio por montagem; não significa mix aprovado.</p>}
      {report.result.graphics?<p>Grafismos: {report.result.graphics.rendered}/{report.result.graphics.required} quadros renderizados · {report.result.graphics.blocked} bloqueados · {report.result.graphics.unavailable} sem runtime · {report.result.graphics.failed} com falha. {report.result.graphics.visualApprovalPending} ainda exigem aprovação visual; não libera operação.</p>:<p>Revisão histórica sem evidência de renderização gráfica. Não significa grafismos aprovados.</p>}
      {!!report.result.issues.length&&<details><summary>Ver pendências por item</summary><ul>{report.result.issues.map((issue,index)=><li key={issue.revisionId+':'+issue.itemId+':'+index}>{issue.title??issue.itemId}: {[...issue.errors,...issue.warnings].join('; ')}</li>)}</ul>{report.result.issuesTruncated&&<p>Lista limitada a 200 itens; totais incluem todos.</p>}</details>}
    </>}
    {intent&&report&&['REVIEWED','FAILED'].includes(report.phase)&&<button className="underline" disabled={busy||stale} onClick={()=>{try{sessionStorage.removeItem(key);setIntent(null);setReport(null);setError(null)}catch{setError('Não foi possível encerrar consulta; pedido preservado.')}}}>Encerrar consulta — nova análise exige novo pedido</button>}
    {report&&(report.phase==='ACCEPTED'||report.phase==='CHECKING')&&<HaReturnJobRecoveryPanel key={'recover:'+report.request.mediaReviewId} target={{kind:'MEDIA_REVIEW',id:report.request.mediaReviewId,channelId:report.request.channelId,phase:report.phase,updatedAt:report.updatedAt}} stale={stale||busy} onClosed={()=>void run(false)}/>}
    {report?.phase==='REVIEWED'&&report.result&&<HaReturnAutoDecisionPanel key={'auto:'+report.request.mediaReviewId} review={report} stale={stale} onRecorded={setAutoDecision}/>}
    {report?.phase==='REVIEWED'&&report.result&&<HaReturnMediaApplicationPanel key={report.request.mediaReviewId} review={report} stale={stale} autoDecision={autoDecision?.request.mediaReviewId===report.request.mediaReviewId?autoDecision:null}/>}
  </section>
}
