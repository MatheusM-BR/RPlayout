import {useEffect,useMemo,useRef,useState,type ReactNode} from 'react'
import {MULTIVIEW_LAYOUTS,MULTIVIEW_QUALITIES,WATCHDOG_STATE_LABELS,multiviewCellLabel,multiviewLayoutUnits,type MultiviewCellSource,type MultiviewCompositeLayout,type MultiviewEngineState,type MultiviewQuality,type WatchdogInputStatus} from '@rplayout/protocol'
import {api,type MultiviewCompositeView} from '../../api.js'
import type {Live,MeterReading,Monitors} from '../../types.js'
import {Whep} from '../Whep.js'

/**
 * Multiview composto: UMA imagem composta e codificada uma vez no engine.
 *
 * O vídeo não traz nada queimado. Rótulo, tally, VU, estado do sinal, estado
 * do watchdog e relógio são HTML sobre a imagem, posicionados pela mesma
 * grade de 12 unidades que o engine usa: nítidos em qualquer tamanho,
 * clicáveis e sem custo de codificação.
 */
type Mode='composite'|'individual'
const MODE_KEY='rplayout.multiview.mode'
function readMode():Mode{try{return localStorage.getItem(MODE_KEY)==='individual'?'individual':'composite'}catch{return 'composite'}}
function writeMode(mode:Mode){try{localStorage.setItem(MODE_KEY,mode)}catch{/* preferência local apenas */}}

type CellState=MultiviewEngineState['cells'][number]
type Tally='pgm'|'pvw'|null

export interface CompositeMultiviewProps {
  channelId:string
  live:Live|null
  monitors:Monitors|null
  /** O multiview por fonte (WHEP por entrada), mantido como alternativa. */
  individual:ReactNode
  /** Mantém o monitor individual aberto acordado. */
  onWatchingBus:(bus:'pvw'|'mon')=>void
}

export function CompositeMultiview({channelId,live,monitors,individual,onWatchingBus}:CompositeMultiviewProps){
  const [mode,setModeState]=useState<Mode>(readMode)
  const setMode=(value:Mode)=>{setModeState(value);writeMode(value)}
  const [view,setView]=useState<MultiviewCompositeView|null>(null)
  const [error,setError]=useState<string|null>(null)
  const [draft,setDraft]=useState<{layout:MultiviewCompositeLayout;quality:MultiviewQuality}|null>(null)
  const [busy,setBusy]=useState(false)
  const [watchdog,setWatchdog]=useState<WatchdogInputStatus[]>([])
  const [opened,setOpened]=useState<number|null>(null)
  const generation=useRef(0)

  async function load(){
    const request=++generation.current
    try{
      const value=await api.multiviewComposite(channelId)
      if(request!==generation.current)return
      setView(value);setError(null)
    }catch(failure){if(request===generation.current)setError(failure instanceof Error?failure.message:'Multiview indisponível.')}
  }
  useEffect(()=>{
    setView(null);setDraft(null);void load()
    const timer=window.setInterval(()=>void load(),10_000)
    return()=>{generation.current++;window.clearInterval(timer)}
  },[channelId])
  // Watchdog das entradas (docs/WATCHDOG-AO-VIVO.md): estado por entrada no ar.
  useEffect(()=>{
    if(mode!=='composite')return
    let active=true
    const tick=()=>void api.liveWatchdog(channelId).then(value=>{if(active)setWatchdog(value.inputs)}).catch(()=>{if(active)setWatchdog([])})
    tick();const timer=window.setInterval(tick,2000)
    return()=>{active=false;window.clearInterval(timer)}
  },[channelId,mode])

  const names=useMemo(()=>new Map((view?.sources??[]).map(source=>[source.id,source.name])),[view?.sources])
  // A composição do live() é a que o engine está usando agora; a da rota é a salva.
  const composition=live?.multiview?.composition??view?.composition??null
  const engine=live?.multiview?.state??view?.engine??null
  const layout=draft?.layout??view?.saved.layout??composition?.layout??'MV_PGM_PVW'
  const quality=draft?.quality??view?.saved.quality??'PADRAO'
  const dirty=Boolean(view&&draft&&(draft.layout!==view.saved.layout||draft.quality!==view.saved.quality))
  // Prévia da troca: as células seguem a composição em uso até salvar.
  const units=multiviewLayoutUnits(dirty?layout:composition?.layout??layout)
  const cells:MultiviewCellSource[]=composition&&!dirty?composition.cells:units.map(()=>({kind:'empty'}))

  async function save(){
    if(!view||!draft||busy)return
    setBusy(true)
    try{
      await api.saveMultiviewComposite(channelId,view.eTag,{layout:draft.layout,...(draft.quality!==view.saved.quality?{quality:draft.quality}:{}),cells:view.saved.cells&&draft.layout===view.saved.layout?view.saved.cells:null})
      setDraft(null);await load()
    }catch(failure){setError(failure instanceof Error?failure.message:'Layout não salvo.')}
    finally{setBusy(false)}
  }

  const header=<header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border-subtle bg-surface-panel px-3 py-2">
    <div className="flex items-center gap-2">
      <span className="material-symbols-outlined text-[18px] text-primary">grid_view</span>
      <h3 className="font-headline-md text-[14px] font-bold tracking-wide text-on-surface">MULTIVIEW</h3>
    </div>
    <div role="tablist" aria-label="Modo do multiview" className="flex rounded-lg border border-border-subtle bg-surface-base p-0.5">
      {([['composite','COMPOSTO'],['individual','FONTES INDIVIDUAIS']] as const).map(([value,label])=>
        <button key={value} role="tab" aria-selected={mode===value} type="button" onClick={()=>setMode(value)} className={`rounded px-2.5 py-1 font-label-caps text-[11px] ${mode===value?'bg-primary-container font-bold text-on-primary-container':'text-outline hover:text-on-surface'}`}>{label}</button>)}
    </div>
    {mode==='composite'&&<>
      <div className="-mx-1 flex max-w-full gap-1 overflow-x-auto px-1" aria-label="Layout">
        {MULTIVIEW_LAYOUTS.map(entry=><button key={entry.id} type="button" title={entry.description} aria-pressed={layout===entry.id} disabled={!view?.canSave||busy}
          onClick={()=>setDraft({layout:entry.id,quality})} className={`shrink-0 rounded border px-2 py-1 font-label-mono text-[12px] ${layout===entry.id?'border-primary bg-primary/15 font-bold text-on-surface':'border-border-subtle text-outline hover:text-on-surface'} disabled:opacity-60`}>{entry.label}</button>)}
      </div>
      <label className="flex items-center gap-1 font-label-mono text-[12px] text-outline">Nível
        <select aria-label="Nível do multiview" value={quality} disabled={!view?.canChangeQuality||busy} onChange={event=>setDraft({layout,quality:event.target.value as MultiviewQuality})}
          title={view?.canChangeQuality?'Custo de codificação no engine':'Trocar o nível exige Supervisor ou acima'} className="rounded border border-border-subtle bg-surface-base px-1.5 py-1 text-on-surface disabled:opacity-60">
          {MULTIVIEW_QUALITIES.map(entry=><option key={entry.id} value={entry.id}>{entry.label}</option>)}
        </select>
      </label>
      {dirty&&<button type="button" className="btn small" disabled={busy} onClick={()=>void save()}>{busy?'Salvando…':'Salvar no canal'}</button>}
      {dirty&&<button type="button" className="btn small" disabled={busy} onClick={()=>setDraft(null)}>Descartar</button>}
    </>}
  </header>

  if(mode==='individual')return <section className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-xl border border-border-subtle bg-surface-card">{header}<div className="min-h-0 flex-1">{individual}</div></section>

  return <section className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-xl border border-border-subtle bg-surface-card" data-testid="composite-multiview">
    {header}
    {(error||view&&!view.available)&&<p role="status" className="shrink-0 border-b border-armed-amber/30 bg-armed-amber/10 px-3 py-1.5 font-label-mono text-[12px] text-armed-amber">{error??view?.reason}</p>}
    {dirty&&<p role="status" className="shrink-0 border-b border-border-subtle px-3 py-1 font-label-mono text-[12px] text-outline">Prévia do layout. O mosaico é um só por canal: salvar troca para todos que estão olhando, sem tocar no PGM.</p>}
    <Stage>
      {view?.whep&&!dirty?<Whep path={view.whep.path} port={view.whep.port} hideControls muted onWatching={()=>{void api.watching(channelId,'mv').catch(()=>undefined)}}/>:<div className="absolute inset-0 bg-[#05070b]"/>}
      <div className="absolute inset-0">
        {units.map((unit,index)=>{
          const cell=cells[index]??{kind:'empty'}
          const state=engine&&engine.layout===(composition?.layout)&&!dirty?engine.cells[index]:undefined
          return <Cell key={index} unit={unit} cell={cell} state={state} label={multiviewCellLabel(cell,names)} tally={tallyOf(cell,state,live)}
            meter={meterOf(cell,state,live)} watchdog={watchdogOf(cell,state,watchdog)} onOpen={()=>setOpened(index)}/>
        })}
        <Clock/>
      </div>
    </Stage>
    {opened!==null&&<IndividualMonitor cell={cells[opened]??{kind:'empty'}} state={engine?.cells[opened]} label={multiviewCellLabel(cells[opened]??{kind:'empty'},names)} monitors={monitors} onWatchingBus={onWatchingBus} onClose={()=>setOpened(null)}/>}
  </section>
}

/** Palco 16:9 que cabe no espaço disponível, sem rolagem horizontal. */
function Stage({children}:{children:ReactNode}){
  const box=useRef<HTMLDivElement>(null)
  const [size,setSize]=useState<{width:number;height:number}|null>(null)
  useEffect(()=>{
    const element=box.current
    if(!element)return
    const fit=()=>{
      const width=element.clientWidth,height=element.clientHeight
      // Altura livre pequena (celular, rolagem): manda a largura.
      const byWidth={width,height:width*9/16}
      setSize(height<120||byWidth.height<=height?byWidth:{width:height*16/9,height})
    }
    fit()
    const observer=new ResizeObserver(fit);observer.observe(element)
    return()=>observer.disconnect()
  },[])
  return <div ref={box} className="relative min-h-0 flex-1 bg-black p-0">
    <div className="relative mx-auto overflow-hidden bg-black" style={size?{width:size.width,height:size.height}:{width:'100%',aspectRatio:'16 / 9'}} data-testid="multiview-stage">{children}</div>
  </div>
}

function tallyOf(cell:MultiviewCellSource,state:CellState|undefined,live:Live|null):Tally{
  if(cell.kind==='pgm')return 'pgm'
  if(cell.kind==='pvw')return 'pvw'
  if(state?.bus==='pgm')return 'pgm'
  if(state?.bus==='pvw')return 'pvw'
  if(cell.kind==='source'){
    const row=live?.transport.liveSources.find(entry=>entry.source===cell.id||entry.nativeCatalogBindings?.pgm===cell.id||entry.nativeCatalogBindings?.pvw===cell.id)
    if(row?.busStates?.pgm==='ON_PGM')return 'pgm'
    if(row?.busStates?.pvw&&row.busStates.pvw!=='IDLE')return 'pvw'
  }
  return null
}

function meterOf(cell:MultiviewCellSource,state:CellState|undefined,live:Live|null):MeterReading|null{
  if(!live)return null
  const bus=cell.kind==='pgm'?'pgm':cell.kind==='pvw'?'pvw':state?.bus??null
  return bus==='pgm'?live.meters.program:bus==='pvw'?live.meters.preview:null
}

function watchdogOf(cell:MultiviewCellSource,state:CellState|undefined,inputs:WatchdogInputStatus[]):WatchdogInputStatus|null{
  const bus=cell.kind==='pgm'?'pgm':cell.kind==='pvw'?'pvw':state?.bus
  const found=cell.kind==='source'?inputs.find(input=>input.sourceId===cell.id):bus==='pgm'||bus==='pvw'?inputs.find(input=>input.bus===bus):undefined
  return found&&found.state!=='OK'?found:null
}

const signalBadge=(state:CellState|undefined):{text:string;tone:string}|null=>{
  if(!state)return null
  switch(state.signal){
    case 'noSignal':return {text:'SEM SINAL',tone:'border-on-air-crimson bg-on-air-crimson/80 text-white'}
    case 'held':return {text:`SEM QUADRO NOVO ${state.ageMs!==null?(state.ageMs/1000).toFixed(1)+' s':''}`.trim(),tone:'border-armed-amber bg-black/70 text-armed-amber'}
    case 'unavailable':return {text:'FORA DOS BARRAMENTOS',tone:'border-border-subtle bg-black/70 text-outline'}
    default:return null
  }
}

function Cell({unit,cell,state,label,tally,meter,watchdog,onOpen}:{unit:readonly [number,number,number,number];cell:MultiviewCellSource;state:CellState|undefined;label:string;tally:Tally;meter:MeterReading|null;watchdog:WatchdogInputStatus|null;onOpen:()=>void}){
  const [x,y,w,h]=unit
  const empty=cell.kind==='empty'
  const badge=signalBadge(state)
  const small=w<=3
  const border=tally==='pgm'?'border-on-air-crimson':tally==='pvw'?'border-status-ok':'border-white/15'
  return <button type="button" disabled={empty} onClick={onOpen} aria-label={empty?'Célula vazia':`${label}: abrir monitor individual`}
    data-testid="multiview-cell" data-tally={tally??'none'} data-signal={state?.signal??'unknown'}
    className={`absolute border-2 ${border} text-left outline-none focus-visible:ring-2 focus-visible:ring-primary enabled:cursor-pointer enabled:hover:bg-white/5`}
    style={{left:`${x/12*100}%`,top:`${y/12*100}%`,width:`${w/12*100}%`,height:`${h/12*100}%`}}>
    {!empty&&<>
      <span className={`absolute bottom-0 left-0 right-0 truncate bg-black/65 px-1.5 py-0.5 text-center font-label-mono font-bold text-white ${small?'text-[10px]':'text-[12px]'} ${tally==='pgm'?'bg-on-air-crimson/85':tally==='pvw'?'bg-status-ok/80':''}`}>{label}{tally==='pgm'?' · NO AR':''}</span>
      {badge&&<span className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded border px-1.5 py-0.5 font-label-mono font-bold ${small?'text-[9px]':'text-[12px]'} ${badge.tone}`}>{badge.text}</span>}
      {watchdog&&<span title={watchdog.conditions.map(condition=>condition.detection).join(', ')} className={`absolute left-1 top-1 rounded bg-black/75 px-1 font-label-mono font-bold text-armed-amber ${small?'text-[9px]':'text-[11px]'}`}>WD {WATCHDOG_STATE_LABELS[watchdog.state]}{watchdog.waitRemainingMs!==null?` ${Math.ceil(watchdog.waitRemainingMs/1000)} s`:''}</span>}
      {!small&&state&&state.width&&state.height&&state.signal==='live'&&<span className="absolute right-6 top-1 rounded bg-black/55 px-1 font-label-mono text-[10px] text-white/80">{state.width}×{state.height} · {state.fps.toFixed(0)} q/s</span>}
      {meter&&<Vu meter={meter}/>}
    </>}
  </button>
}

/** VU vertical por canal (pico dBFS, -60..0), a partir da medição do barramento. */
function Vu({meter}:{meter:MeterReading}){
  const peaks=meter.peakDbfs.slice(0,2)
  return <span aria-hidden className="absolute bottom-6 right-1 top-1 flex w-3.5 gap-px">
    {peaks.map((db,index)=>{
      const level=Math.max(0,Math.min(1,(db+60)/60))
      const color=db>-6?'bg-on-air-crimson':db>-18?'bg-armed-amber':'bg-status-ok'
      return <span key={index} className="relative h-full flex-1 bg-black/60"><span className={`absolute bottom-0 left-0 right-0 ${color}`} style={{height:`${level*100}%`}}/></span>
    })}
  </span>
}

function Clock(){
  const [now,setNow]=useState(()=>new Date())
  useEffect(()=>{const timer=window.setInterval(()=>setNow(new Date()),250);return()=>window.clearInterval(timer)},[])
  return <span data-testid="multiview-clock" className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded bg-black/70 px-2 py-0.5 font-label-mono text-[13px] font-bold tabular-nums text-white">{now.toLocaleTimeString('pt-BR',{hour12:false})}</span>
}

/** Monitor individual da célula: o fluxo por barramento que já existia. */
function IndividualMonitor({cell,state,label,monitors,onWatchingBus,onClose}:{cell:MultiviewCellSource;state:CellState|undefined;label:string;monitors:Monitors|null;onWatchingBus:(bus:'pvw'|'mon')=>void;onClose:()=>void}){
  const bus=cell.kind==='pgm'?'pgm':cell.kind==='pvw'?'pvw':state?.bus==='pgm'||state?.bus==='pvw'?state.bus:null
  const path=bus==='pgm'?monitors?.program:bus==='pvw'?monitors?.preview:null
  useEffect(()=>{const close=(event:KeyboardEvent)=>{if(event.key==='Escape')onClose()};window.addEventListener('keydown',close);return()=>window.removeEventListener('keydown',close)},[onClose])
  return <div role="dialog" aria-modal="true" aria-label={`Monitor individual: ${label}`} className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3" onClick={onClose}>
    <div className="w-full max-w-4xl overflow-hidden rounded-xl border border-border-subtle bg-surface-card" onClick={event=>event.stopPropagation()}>
      <header className="flex items-center justify-between gap-2 border-b border-border-subtle px-3 py-2">
        <strong className="truncate font-headline-md text-[14px] text-on-surface">{label}{bus?` · ${bus==='pgm'?'PGM':'PVW'}`:''}</strong>
        <button type="button" className="btn small" onClick={onClose}>Fechar</button>
      </header>
      <div className="relative aspect-video bg-black">
        {path&&monitors?<Whep path={path} port={monitors.port} muted onWatching={()=>onWatchingBus(bus==='pgm'?'mon':'pvw')}/>
          :<div className="flex h-full items-center justify-center p-4 text-center font-label-mono text-[12px] text-outline">{bus?'Este canal não tem monitor individual deste barramento.':'Esta célula mostra uma fonte fora do PGM/PVW (NEXT, QC, contingência ou entrada fora dos barramentos). O monitor individual só existe para PGM e PVW; a imagem dela está no mosaico.'}</div>}
      </div>
    </div>
  </div>
}
