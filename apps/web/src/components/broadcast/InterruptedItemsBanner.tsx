import { confirmAction } from '../../domain/confirm.js'
import { useEffect, useState,useRef } from 'react'
import { api } from '../../api'
import { formatTimecode, type Rate } from '@rplayout/protocol'
import {commandRequestId} from '../../domain/request-id.js'
import {interruptionResultMessage,interruptionFailureMessage} from '../../domain/interruption-feedback.js'

export function InterruptedItemsBanner({ channelId, rate }: { channelId: string; rate: Rate }) {
  return <InterruptedItemsContent key={channelId} channelId={channelId} rate={rate}/>
}
function InterruptedItemsContent({channelId,rate}:{channelId:string;rate:Rate}){
  const [items, setItems] = useState<Awaited<ReturnType<typeof api.interruptions>>['items']>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const mounted=useRef(true),busyRef=useRef(false),generation=useRef(0)
  const refresh=async()=>{const current=++generation.current;try{const result=await api.interruptions(channelId);if(mounted.current&&current===generation.current)setItems(result.items)}catch(error){if(mounted.current&&current===generation.current)setMessage(error instanceof Error?error.message:'Falha ao consultar retornos; a lista anterior foi preservada.')}}
  useEffect(() => {
    mounted.current=true
    void refresh()
    const timer = setInterval(() => void refresh(), 2000)
    return () => { mounted.current=false;generation.current++;clearInterval(timer) }
  }, [channelId])
  const resolve = async (item:typeof items[number], action: 'RESUME' | 'DISCARD'|'ACKNOWLEDGE') => {
    if(busyRef.current)return
    if (action === 'RESUME' && !(await confirmAction('Retomar este VT troca o PGM atual pela última posição informada pelo engine. Confirmar?'))) return
    if(action==='ACKNOWLEDGE' && !(await confirmAction('Encerrar esta pendência sem confirmar sucesso nem repetir o retorno? PGM deve estar parado e CUE limpo.')))return
    if(action==='DISCARD' && !(await confirmAction('Descartar apenas o retorno deste VT, preservando o histórico e o PGM atual?')))return
    busyRef.current=true;setBusy(true); setMessage(null)
    let sent=false
    try {
      if(action==='ACKNOWLEDGE'){
        if(!item.operation)return
        sent=true
        await api.acknowledgeInterruption(channelId,item.id,item.operation.requestId,item.reviewToken)
        if(mounted.current)setMessage('Pendência encerrada sem novo TAKE ou confirmação física. Cursor não foi reaberto para repetição.')
      }else{
        const requestId=commandRequestId();sent=true
        const result=await api.resolveInterruption(channelId,item.id,action,requestId,item.reviewToken)
        if(mounted.current)setMessage(interruptionResultMessage(action,result.run))
      }
      if(mounted.current)await refresh()
    } catch (error) {if(mounted.current){setMessage(interruptionFailureMessage(error,sent));await refresh()}}
    finally {busyRef.current=false;if(mounted.current)setBusy(false)}
  }
  if (!items.length && !message) return null
  return <section className="mt-2 p-3 rounded border border-armed-amber/40 bg-armed-amber/20 text-xs" aria-label="VTs interrompidos">
    {items.length > 0 && <p className="mb-2 text-armed-amber">VT interrompido pelo ao vivo — escolha retomar ou descartar. Posição: último registro do engine.</p>}
    {items.map(item => <div key={item.id} className="flex flex-wrap items-center gap-2 mb-1">
      <span className="flex-1">{item.title} · {formatTimecode(item.frames, rate)}</span>
      <button disabled={busy || item.state !== 'PENDING'} className="px-3 py-1 rounded border border-primary text-primary disabled:opacity-40" onClick={() => void resolve(item, 'RESUME')}>Retomar no PGM</button>
      <button disabled={busy || item.state !== 'PENDING'} className="px-3 py-1 rounded border border-outline disabled:opacity-40" onClick={() => void resolve(item, 'DISCARD')}>Descartar retorno</button>
      {item.state!=='PENDING' && <span role="status" className="text-armed-amber">{item.operation?.message??'Retorno em andamento ou inconclusivo. Não será repetido automaticamente.'}</span>}
      {item.canReconcile && <button disabled={busy} className="px-3 py-1 border rounded border-armed-amber text-armed-amber disabled:opacity-40" onClick={()=>void resolve(item,'ACKNOWLEDGE')}>Encerrar pendência com PGM parado</button>}
    </div>)}
    {message && <p role="status">{message}</p>}
  </section>
}
