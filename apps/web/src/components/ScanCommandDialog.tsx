import {useEffect,useRef,useState} from 'react'
import type {ScanReview,ScanCommandResult} from '@rplayout/protocol'
import {api} from '../api.js'
import {BoundedLatestRead} from '../domain/bounded-latest-read.js'
import {captureScanOperation,scanOperationKey,validateScanResult,scanResultNotice,type ScanOperation} from '../domain/scan-operation.js'
import {ReviewedOperationConfirm} from './broadcast/ReviewedOperationConfirm.js'

interface Props{measure:boolean;root?:string;onClose:()=>void;onRegistered:(result:ScanCommandResult)=>void}
type Intent={kind:'RECOVER';operation:ScanOperation}|{kind:'REPEAT'}|{kind:'REOPEN'}|{kind:'CLOSE'}
export function ScanCommandDialog(props:Props){
  return <ScanCommandReview key={JSON.stringify([props.measure,props.root??null])} {...props}/>
}
function ScanCommandReview({measure,root,onClose,onRegistered}:Props){
  const [review,setReview]=useState<ScanReview|null>(null),[busy,setBusy]=useState<'READ'|'WRITE'|null>(null)
  const [message,setMessage]=useState<string|null>(null),[blocked,setBlocked]=useState(true),[accepted,setAccepted]=useState(false)
  const [intent,setIntent]=useState<Intent|null>(null),[sent,setSent]=useState<ScanOperation|null>(null)
  const live=useRef(false),epoch=useRef(0),pending=useRef(false),reads=useRef(new BoundedLatestRead())
  const current=(run:number)=>live.current&&epoch.current===run
  const reopen=async()=>{
    if(pending.current)return
    pending.current=true;setBusy('READ');setIntent(null);setBlocked(true);const run=++epoch.current
    try{
      const reading=await reads.current.read(signal=>api.scanReview(signal),'A conferência do scanner demorou demais. Nenhum comando foi enviado; tente conferir novamente.')
      if(!current(run)||!reading.current)return
      setReview(reading.value);setMessage(null);setBlocked(false);setAccepted(false);setSent(null)
    }catch(cause){if(current(run))setMessage(cause instanceof Error?cause.message:'Scanner não conferido; nenhum comando enviado.')}
    finally{if(current(run)){pending.current=false;setBusy(null)}}
  }
  useEffect(()=>{live.current=true;pending.current=false;void reopen();return()=>{live.current=false;++epoch.current;pending.current=false;reads.current.cancel()}},[])
  const submit=async(operation:ScanOperation,repeating=false)=>{
    if(pending.current||accepted||blocked&&!repeating)return
    // Never cancel/rebase writes; an uncertain response retains this identity.
    pending.current=true;setBusy('WRITE');setSent(operation);setIntent(null);const run=epoch.current
    try{
      const response=operation.kind==='RECOVER'?await api.recoverScan(operation.batchId,operation.review):await api.scan(operation.measure,operation.review,operation.root)
      const result=validateScanResult(operation,response)
      if(!current(run))return
      setAccepted(true);setBlocked(true)
      const receipt=`${operation.kind==='RECOVER'?'Retomada':'Pedido'} registrado: ${result.batchId} · ${result.state}.`
      setMessage(`${receipt} ${scanResultNotice(result)}`)
      try{onRegistered(result)}catch{setMessage(`${receipt} Atualização da tela indisponível; não crie outro pedido.`)}
    }catch(cause){if(current(run)){setBlocked(true);setMessage(`${cause instanceof Error?cause.message:'Resultado não confirmado.'} Identificador preservado: ${operation.review.operationId}. Não há repetição automática nem encerramento presumido do responsável.`)}}
    finally{if(current(run)){pending.current=false;setBusy(null)}}
  }
  const askRecovery=(batchId:string)=>{
    if(busy||blocked||accepted||!review)return
    try{setIntent({kind:'RECOVER',operation:captureScanOperation(review,measure,root,batchId)})}
    catch(cause){setMessage(cause instanceof Error?cause.message:'Retomada não conferida.')}
  }
  const originalKey=review?JSON.stringify([review.operationId,review.revision,review.batchRevision,measure,root??null]):null
  const confirmIntent=async()=>{
    if(!intent)return
    if(intent.kind==='RECOVER')await submit(intent.operation)
    else if(intent.kind==='REPEAT'&&sent)await submit(sent,true)
    else if(intent.kind==='REOPEN')await reopen()
    else if(intent.kind==='CLOSE'){setIntent(null);onClose()}
  }
  const confirmation=intent?.kind==='RECOVER'?'Autorizo solicitar retomada somente deste lote conferido, após encerramento local comprovado. Nenhum processo será morto.'
    :intent?.kind==='REPEAT'?'Autorizo consultar/repetir exatamente o pedido anterior, com o mesmo identificador, revisão, pastas e modo; não criar outro pedido.'
    :intent?.kind==='REOPEN'?'Já conferi a situação do pedido anterior. Autorizo abandonar esta conferência e consultar outra; isso não cancela nem repete o pedido anterior.'
    :'Autorizo fechar a tela com resultado ainda incerto. O pedido não será cancelado; devo conferir o identificador antes de criar outro.'
  const label=intent?.kind==='RECOVER'?'Confirmar retomada deste lote':intent?.kind==='REPEAT'?'Confirmar repetição do mesmo pedido':intent?.kind==='REOPEN'?'Conferir novamente sem repetir pedido':'Fechar com resultado ainda incerto'
  return <section role="dialog" aria-modal="true" aria-label="Conferir varredura" className="card p-4 max-h-[90vh] overflow-y-auto">
    <h3>Conferir varredura do servidor</h3>
    <p>{measure?'Com medição de áudio; pode demorar.':'Procura rápida sem medição de áudio.'} Não altera PGM.</p>
    {busy==='READ'&&<p role="status">Consultando pastas e estado do scanner; nenhum comando enviado.</p>}
    {!review&&<p>Pastas e estado ainda não conferidos.</p>}
    {review&&<><p>{root?`Pasta escolhida: ${root}`:`Todas as ${review.roots.length} pastas cadastradas.`}</p><ul>{review.roots.map(folder=><li key={folder.id}>{folder.label} · {folder.path}{folder.present?'':' · indisponível'}</li>)}</ul><p>{review.activeBatches.length?`${review.activeBatches.length} lote(s) ativo(s) ou pendente(s); não será criado outro.`:'Nenhum lote ativo na conferência original.'}</p>{!review.available&&<p>A sonda de mídia não está configurada; varredura indisponível.</p>}</>}
    {message&&<p role="status">{message}</p>}
    {review?.activeBatches.some(batch=>batch.canRecover)&&<p>A seleção acima vale para nova varredura. Retomar conserva as pastas e o modo originais do lote, que podem ser diferentes; nenhum processo será morto.</p>}
    {sent&&<p>Identificador do pedido: <span className="mono">{sent.review.operationId}</span>{sent.kind==='RECOVER'?` · lote ${sent.batchId}`:''}</p>}
    {review&&<ul aria-label="Diagnóstico de posse do scanner">{review.activeBatches.map(batch=><li key={batch.id}>{batch.id} · {batch.state} · {batch.message}{batch.canRecover&&<button disabled={Boolean(busy)||blocked||accepted} onClick={()=>askRecovery(batch.id)}>Solicitar retomada local conferida</button>}</li>)}</ul>}
    <ReviewedOperationConfirm reviewKey={originalKey} confirmation="Autorizo procurar arquivos somente nas pastas e no modo conferidos acima. Registro não significa conclusão nem aprovação QC."
      label="Confirmar varredura conferida" disabled={Boolean(busy)||blocked||accepted||intent!==null||!review?.canStart}
      onConfirm={async()=>{if(review)await submit(captureScanOperation(review,measure,root))}}/>
    {blocked&&!accepted&&sent&&<button disabled={Boolean(busy)} onClick={()=>setIntent({kind:'REPEAT'})}>Repetir mesmo pedido</button>}
    <button disabled={Boolean(busy)||accepted} onClick={()=>{if(sent)setIntent({kind:'REOPEN'});else void reopen()}}>Reabrir conferência</button>
    <button disabled={busy==='WRITE'} onClick={()=>{if(sent&&!accepted)setIntent({kind:'CLOSE'});else onClose()}}>Fechar</button>
    {intent&&<section aria-label="Confirmação da ação de varredura">
      <ReviewedOperationConfirm reviewKey={JSON.stringify([intent.kind,intent.kind==='RECOVER'?scanOperationKey(intent.operation):sent?scanOperationKey(sent):originalKey])}
        confirmation={confirmation} label={label} disabled={Boolean(busy)||intent.kind==='REPEAT'&&!sent} onConfirm={confirmIntent}/>
      <button disabled={Boolean(busy)} onClick={()=>setIntent(null)}>Manter conferência</button>
    </section>}
  </section>
}
