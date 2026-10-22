import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../../api.js'
import type { GraphicLayerState, GraphicsLayer } from '@rplayout/protocol'

interface Props { className?: string; onMessage?: (message: string) => void; compact?: boolean; channelId?: string }
const layers: Array<{ key: GraphicsLayer; label: string }> = [
  {key:'STATION_LOGO',label:'L0: LOGO'}, {key:'ONAIR_CLOCK',label:'L1: RELÓGIO'},
  {key:'CRAWL_TICKER',label:'L2: TICKER'}, {key:'LOWER_THIRD',label:'L3: TARJA'},
]

/** Logical server state does not claim optical/output confirmation or actual
 * SCTE insertion. No optimistic browser timers or fabricated layer status. */
export function DynamicCgSecondaryBar({className='',onMessage,channelId}: Props) {
  const [open,setOpen] = useState(false)
  const [snapshot,setSnapshot] = useState<Awaited<ReturnType<typeof api.graphicLayers>>|null>(null)
  const [busy,setBusy] = useState(false)
  const [error,setError] = useState<string|null>(null)
  const [ticker,setTicker] = useState('')
  const [title,setTitle] = useState('')
  const [subtitle,setSubtitle] = useState('')
  const [cueStatus,setCueStatus] = useState<string|null>(null)
  const generation = useRef(0)
  const refresh = useCallback(async (expected:number) => {
    if (!channelId) return
    const result = await api.graphicLayers(channelId)
    if (generation.current !== expected) return
    setSnapshot(result);setError(null)
  },[channelId])
  useEffect(() => {
    const expected = ++generation.current
    setSnapshot(null);setBusy(false);setError(null);setCueStatus(null)
    const poll = () => {void refresh(expected).catch(error => {
      if (generation.current === expected) {setSnapshot(null);setError(error instanceof Error ? error.message : 'Grafismos indisponíveis.')}
    })}
    poll();const timer=setInterval(poll,1000)
    return () => {++generation.current;clearInterval(timer)}
  },[refresh])
  const perform = async (work:()=>Promise<unknown>,message:string) => {
    if (busy || !channelId) return
    const expected=generation.current
    setBusy(true);setError(null)
    try {await work();await refresh(expected);if (generation.current===expected) onMessage?.(message)}
    catch (error) {if (generation.current===expected) {const text=error instanceof Error ? error.message:'Comando recusado.';setError(text);onMessage?.(text)}}
    finally {if (generation.current===expected) setBusy(false)}
  }
  const trigger = (key:GraphicsLayer,forceShow=false,breaking=false) => {
    const active=snapshot?.layers[key]?.active ?? false
    const payload = key==='LOWER_THIRD' ? {title,subtitle}
      : key==='CRAWL_TICKER' ? {text:ticker,badge:breaking?'URGENTE':'',isBreaking:breaking}
      : key==='STATION_LOGO' ? {title:snapshot?.channelName ?? ''} : {}
    void perform(()=>api.triggerGraphicLayer(channelId!,key,{
      action:forceShow || !active ? 'SHOW':'HIDE',payload,
      ...(key==='LOWER_THIRD' && snapshot ? {durationFrames:Math.round(8*snapshot.rate.num/snapshot.rate.den)} : {}),
    }),'Comando de grafismo aceito pelo servidor; confira a imagem no PGM.')
  }
  const remaining = (state?:GraphicLayerState) => state?.active && state.expiresAtFrames && snapshot
    ? Math.max(0,Math.ceil((state.expiresAtFrames-snapshot.nowFrames)*snapshot.rate.den/snapshot.rate.num)) : null
  return <div id="cg-secondary-events-bar" className={`bg-surface-panel border border-border-subtle rounded-xl p-3 ${className}`}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="font-headline-md font-bold">GRAFISMOS & EVENTOS</span>
      <span className="text-[10px] text-outline">{snapshot?.simulated ? 'SIMULADO · sem saída física' : snapshot ? 'ESTADO DO SERVIDOR · confira PGM' : 'SEM CONFIRMAÇÃO'}</span>
      <div className="flex flex-wrap gap-2">{layers.map(layer => {
        const state=snapshot?.layers[layer.key],seconds=remaining(state)
        return <button key={layer.key} disabled={busy || !snapshot} onClick={()=>trigger(layer.key)}
          className={`btn small ${state?.active ? 'text-status-ok-bright':'text-outline'}`}>
          {layer.label} · {state?.active ? 'ATIVO':'DESLIGADO'}{seconds!==null ? ` · ${seconds}s`:''}
        </button>
      })}
      <button className="btn small" disabled={busy || !channelId} onClick={()=>{
        const expected=generation.current
        void perform(async ()=>{
          const result=await api.requestScte(channelId!)
          if (generation.current===expected) setCueStatus(`Evento ${result.spliceEventId}: ${result.status}. Inserção física não confirmada.`)
        },'Sinalização SCTE registrada; confira o gateway/encoder. Não há confirmação de inserção física.')
      }}>SCTE · SOLICITAR CUE OUT 30s</button>
      <button className="btn small" onClick={()=>setOpen(!open)}>{open?'RECOLHER':'AJUSTAR CG'}</button></div>
    </div>
    {error && <p role="alert" className="text-on-air-crimson text-[12px] mt-2">{error}</p>}
    {cueStatus && <p role="status" className="text-armed-amber text-[12px] mt-2">{cueStatus}</p>}
    {!!snapshot?.secondaryEvents.length && <div className="flex flex-wrap gap-2 mt-2">
      <span className="text-outline text-[11px]">Eventos manuais da revisão no PGM:</span>
      {snapshot.secondaryEvents.map(event=><button key={event.id} disabled={busy || snapshot.simulated && event.type!=='GRAPHICS_OVERLAY'} className="btn small"
        onClick={()=>void perform(()=>api.fireSecondaryEvent(channelId!,event.id),'Pedido registrado; confira a execução do evento e o PGM. Um comando já registrado nesta passagem não é repetido.')}>{event.name ?? event.id}</button>)}
    </div>}
    {open && <div className="grid md:grid-cols-2 gap-3 mt-3 border-t border-border-subtle pt-3">
      <div className="field"><label htmlFor="cg-ticker">Texto do ticker</label><input type="text" id="cg-ticker" value={ticker} onChange={e=>setTicker(e.target.value)} placeholder="Digite o texto a publicar"/>
        <button className="btn small" disabled={busy || !snapshot || !ticker.trim()} onClick={()=>trigger('CRAWL_TICKER',true,true)}>PUBLICAR PLANTÃO</button></div>
      <div className="field"><label htmlFor="cg-title">Título da tarja</label><input type="text" id="cg-title" value={title} onChange={e=>setTitle(e.target.value)}/>
        <label htmlFor="cg-subtitle">Subtítulo da tarja</label><input type="text" id="cg-subtitle" value={subtitle} onChange={e=>setSubtitle(e.target.value)}/>
        <button className="btn small" disabled={busy || !snapshot || !title.trim()} onClick={()=>trigger('LOWER_THIRD',true)}>EXIBIR POR 8s</button></div>
      <p className="text-outline text-[11px] md:col-span-2">Duração calculada na taxa do canal e encerrada no servidor. Estado lógico de camada não comprova pixels na saída. SCTE requer gateway/encoder compatível; não é confirmado por cronômetro no navegador.</p>
    </div>}
  </div>
}
