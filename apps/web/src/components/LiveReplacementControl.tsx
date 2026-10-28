import {useEffect,useRef,useState} from 'react'
import type {ManagedLiveSource} from '@rplayout/protocol'
import {api,type LiveReplacementView} from '../api.js'
import type {Live} from '../types.js'

interface Props {
  channelId:string
  info:NonNullable<Live['liveReplacement']>|null
  sources:readonly ManagedLiveSource[]
}

const newKey=()=>typeof crypto!=='undefined'&&'randomUUID' in crypto?crypto.randomUUID():`${Date.now()}-${Math.random().toString(36).slice(2)}`

/**
 * Troca da fonte da MESMA live no PGM pelo par cadastrado (principal/reserva).
 * PREPARE abre a alternativa sem tocar o PGM; COMMIT corta preservando relógio,
 * CUE e as-run. Nunca vira LOAD/TAKE nem metadado. Resultado desconhecido só
 * se consulta (STATUS), nunca se repete o corte.
 */
export function LiveReplacementControl({channelId,info,sources}:Props){
  const [view,setView]=useState<LiveReplacementView|null>(null)
  const [busy,setBusy]=useState(false)
  const [message,setMessage]=useState<string|null>(null)
  // Stable per attempt: a lost response is retried with the SAME key (replay).
  const attemptKey=useRef<{target:string;key:string}|null>(null)
  useEffect(()=>{setView(null);setMessage(null);attemptKey.current=null},[channelId])
  // Native opening is asynchronous (PREPARING -> READY). Poll STATUS, a lookup
  // that never reopens or cuts, for a bounded time while it is preparing.
  const polls=useRef(0)
  useEffect(()=>{
    if(view?.receipt?.phase!=='PREPARING'||view.closed){polls.current=0;return}
    if(polls.current>=20){setMessage('A reserva não ficou pronta em 20 s. Consulte ou cancele.');return}
    const transactionId=view.transactionId
    const timer=setTimeout(()=>{polls.current++;void api.liveReplacementCommand(channelId,transactionId,'status').then(({body})=>{if(body?.transactionId===transactionId)setView(body)}).catch(()=>{})},1000)
    return ()=>clearTimeout(timer)
  },[view,channelId])

  const current=sources.find(source=>source.id===info?.pgmSourceId)
  const target=current?.pairedSourceId?sources.find(source=>source.id===current.pairedSourceId&&source.enabled):undefined
  const openTransactionId=view&&!view.closed?view.transactionId:info?.openTransactionId??null
  if(!info||!info.supported&&!openTransactionId)return null

  const run=async(work:()=>Promise<{status:number;body:LiveReplacementView}>)=>{
    if(busy)return
    setBusy(true);setMessage(null)
    try{
      const {status,body}=await work()
      if(body?.transactionId)setView(body)
      if(status>=400){
        setMessage(body?.outcomeUnknown?'Resultado desconhecido: consulte a transação. Não repita o corte.':body?.error??'Troca não confirmada.')
      }else if(body?.closed&&body.nativeProgramConfirmed){setMessage('Corte confirmado pelo engine. Confira o sinal no monitor de PGM: saída física não é validada aqui.');attemptKey.current=null}
      else if(body?.closed){setMessage('Transação encerrada sem corte.');attemptKey.current=null}
      else if(body?.receipt?.phase==='READY')setMessage('Fonte alternativa pronta. O PGM ainda está na fonte atual.')
      else if(body?.receipt?.phase==='PREPARING')setMessage('Abrindo a fonte alternativa; o PGM não muda.')
    }catch(error){setMessage(error instanceof Error?error.message:'Falha de comunicação; consulte antes de repetir.')}
    finally{setBusy(false)}
  }
  const prepare=()=>{
    if(!target)return
    if(attemptKey.current?.target!==target.id)attemptKey.current={target:target.id,key:newKey()}
    const key=attemptKey.current.key
    void run(()=>api.liveReplacementPrepare(channelId,target.id,key))
  }
  const command=(operation:'commit'|'cancel'|'status')=>{
    if(!openTransactionId)return
    if(operation==='commit'&&!window.confirm(`Cortar o PGM para ${target?.name??'a fonte alternativa'}? A live continua a mesma ocorrência; o relógio e o CUE são preservados.`))return
    if(operation==='cancel'&&!window.confirm('Cancelar a fonte alternativa preparada? O PGM atual não muda.'))return
    void run(()=>api.liveReplacementCommand(channelId,openTransactionId,operation))
  }
  const ready=view?.receipt?.phase==='READY'&&!view.closed

  return <div aria-label="Troca de fonte da live no PGM" className="mt-2 rounded border border-border-subtle p-2 text-[11px] text-left space-y-1">
    <div className="font-semibold">Fonte da live no PGM: {current?.name??info.pgmSourceId??'não catalogada'}</div>
    {info.selectionUncertain&&<div role="alert" className="text-armed-amber">Seleção nativa inconclusiva: consulte a transação ou confirme STOP antes de outro corte.</div>}
    <div className="flex flex-wrap gap-1">
      {!openTransactionId&&<button type="button" disabled={busy||!target||!info.supported||info.selectionUncertain} onClick={prepare}
        className="px-2 py-1 rounded border border-border-subtle hover:border-primary disabled:opacity-40">
        {target?`Preparar ${target.name}`:'Sem par reserva habilitado'}
      </button>}
      {openTransactionId&&<>
        <button type="button" disabled={busy||!ready} onClick={()=>command('commit')} className="px-2 py-1 rounded border border-on-air-crimson text-on-air-crimson disabled:opacity-40">Cortar fonte</button>
        <button type="button" disabled={busy} onClick={()=>command('cancel')} className="px-2 py-1 rounded border border-border-subtle disabled:opacity-40">Cancelar</button>
        <button type="button" disabled={busy} onClick={()=>command('status')} className="px-2 py-1 rounded border border-border-subtle disabled:opacity-40">Consultar</button>
      </>}
    </div>
    {message&&<div role="status" className="text-primary">{message}</div>}
  </div>
}
