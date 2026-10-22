import {useCallback,useEffect,useRef,useState} from 'react'
import type {GraphicTemplate,SecondaryEvent} from '@rplayout/protocol'
import {api,type ItemAutomationState} from '../api.js'

export function SecondaryEventsPanel({itemId,channelId,templates,snapshot,busy,onApply}:{itemId:string;channelId:string;templates:GraphicTemplate[];snapshot:ItemAutomationState|null;busy:boolean;onApply:(work:()=>Promise<ItemAutomationState>)=>Promise<boolean>}) {
  const [runs,setRuns]=useState<Awaited<ReturnType<typeof api.secondaryEventRuns>>['runs']>([])
  const [error,setError]=useState<string|null>(null)
  const [name,setName]=useState(''),[offset,setOffset]=useState(5),[duration,setDuration]=useState(8)
  const [type,setType]=useState<'GRAPHICS_OVERLAY'|'SCTE_TRIGGER'|'DEVICE_AUTOMATION'>('GRAPHICS_OVERLAY')
  const [devices,setDevices]=useState<Awaited<ReturnType<typeof api.externalDevices>>['devices']>([])
  const [deviceId,setDeviceId]=useState(''),[deviceAction,setDeviceAction]=useState<'PING'|'ROUTE_CROSSPOINT'>('PING')
  const [destination,setDestination]=useState(0),[source,setSource]=useState(0)
  const [mode,setMode]=useState<SecondaryEvent['triggerMode']>('OFFSET_FROM_START')
  const [layer,setLayer]=useState<SecondaryEvent['targetLayer']>('LOWER_THIRD')
  const [templateId,setTemplateId]=useState(''),[values,setValues]=useState<Record<string,string>>({})
  const generation=useRef(0)
  const refresh=useCallback(async(expected:number)=>{
    const history=await api.secondaryEventRuns(channelId)
    if (generation.current===expected) {setRuns(history.runs.filter(row=>row.itemId===itemId));setError(null)}
  },[itemId,channelId])
  useEffect(()=>{
    const expected=++generation.current
    setRuns([]);setError(null)
    void refresh(expected).catch(error=>{if (generation.current===expected) setError(String(error))})
    return ()=>{++generation.current}
  },[refresh])
  useEffect(()=>{
    if(type!=='DEVICE_AUTOMATION') return
    let active=true
    setDevices([]);setDeviceId('')
    void api.externalDevices().then(result=>{if(active){setDevices(result.devices.filter(device=>device.enabled && device.kind==='VIDEOHUB_ROUTER'));setError(null)}}).catch(error=>{if(active)setError(error instanceof Error?error.message:'Não foi possível consultar equipamentos.')})
    return ()=>{active=false}
  },[type,channelId,itemId])
  const perform=async(work:()=>Promise<ItemAutomationState>)=>{
    if (busy) return
    const expected=generation.current
    if(await onApply(work) && generation.current===expected)setName('')
  }
  const template=templates.find(value=>value.id===templateId)
  return <section className="mt-4 border-t border-border-subtle pt-3">
    <h3>Eventos secundários da edição</h3>
    <p className="note">Alterações só entram na execução após publicação. Disparos têm registro durável; um comando incerto após queda não é repetido automaticamente. SCTE requer gateway/encoder.</p>
    {error && <p role="alert" className="text-on-air-crimson">{error}</p>}
    <ul className="flex flex-col gap-2 my-3">{snapshot?.events.map(event=><li key={event.id} className="flex flex-wrap items-center justify-between gap-2 p-3 rounded border border-border-subtle bg-surface-panel">
      <span className="flex-1 min-w-[180px] text-[12px]">{event.name} · {event.type==='SCTE_TRIGGER'?'SCTE':event.type==='DEVICE_AUTOMATION'?`Equipamento · ${event.deviceConfig?.action??'não configurado'}`:'GC'} · {event.triggerMode==='MANUAL'?'manual':`${event.triggerMode==='OFFSET_BEFORE_END'?'antes do fim':'após início'}: ${(event.offsetFrames*snapshot.rate.den/snapshot.rate.num).toFixed(2)}s`}</span>
      <button className="btn small" disabled={busy} onClick={()=>void perform(()=>api.removeSecondaryEvent(itemId,event.id,snapshot.editorialRevision))}>remover da edição</button>
    </li>)}</ul>
    <div className="row"><div className="field"><label htmlFor="secondary-name">Nome do evento</label><input type="text" id="secondary-name" value={name} onChange={e=>setName(e.target.value)}/></div>
      <div className="field"><label htmlFor="secondary-type">Tipo</label><select id="secondary-type" value={type} onChange={e=>{setType(e.target.value as typeof type);if(e.target.value==='DEVICE_AUTOMATION')setMode('MANUAL')}}><option value="GRAPHICS_OVERLAY">Grafismo</option><option value="SCTE_TRIGGER">SCTE · Cue Out 30s</option><option value="DEVICE_AUTOMATION">Equipamento · Videohub</option></select></div>
    </div>
    <div className="row"><div className="field"><label htmlFor="secondary-mode">Disparo</label><select id="secondary-mode" value={mode} onChange={e=>setMode(e.target.value as typeof mode)}><option value="OFFSET_FROM_START">Após o início</option><option value="OFFSET_BEFORE_END">Antes do fim</option><option value="MANUAL">Manual no Master</option></select></div>
      <div className="field"><label htmlFor="secondary-offset">Offset (segundos)</label><input id="secondary-offset" type="number" min="0" max="86400" step="0.01" value={offset} onChange={e=>setOffset(Number(e.target.value))}/></div></div>
    {type==='GRAPHICS_OVERLAY' && <>
      <div className="row"><div className="field"><label htmlFor="secondary-layer">Camada</label><select id="secondary-layer" value={layer} onChange={e=>setLayer(e.target.value as typeof layer)}><option value="LOWER_THIRD">Tarja</option><option value="STATION_LOGO">Logo</option><option value="CRAWL_TICKER">Ticker</option><option value="ONAIR_CLOCK">Relógio</option></select></div>
        <div className="field"><label htmlFor="secondary-template">Arte</label><select id="secondary-template" value={templateId} onChange={e=>{setTemplateId(e.target.value);setValues({})}}><option value="">Selecione a arte</option>{templates.map(template=><option key={template.id} value={template.id}>{template.name}</option>)}</select></div>
        <div className="field"><label htmlFor="secondary-hold">Permanência (segundos)</label><input id="secondary-hold" type="number" min="0.1" max="86400" step="0.1" value={duration} onChange={e=>setDuration(Number(e.target.value))}/></div></div>
      {template?.fields.map(field=><div key={field.key} className="field"><label htmlFor={`secondary-field-${field.key}`}>{field.label}</label><input type="text" id={`secondary-field-${field.key}`} value={values[field.key]??field.defaultValue} onChange={e=>setValues({...values,[field.key]:e.target.value})}/></div>)}
    </>}
    {type==='DEVICE_AUTOMATION' && <>
      <div className="row"><div className="field"><label htmlFor="secondary-device">Equipamento cadastrado</label><select id="secondary-device" value={deviceId} onChange={e=>setDeviceId(e.target.value)}><option value="">Selecione um Videohub ativo</option>{devices.map(device=><option key={device.id} value={device.id}>{device.name} · {device.host}:{device.port}</option>)}</select></div>
        <div className="field"><label htmlFor="secondary-action">Ação</label><select id="secondary-action" value={deviceAction} onChange={e=>setDeviceAction(e.target.value as typeof deviceAction)}><option value="PING">Consultar · não altera roteamento</option><option value="ROUTE_CROSSPOINT">Rotear entrada para saída</option></select></div></div>
      {deviceAction==='ROUTE_CROSSPOINT' && <div className="row"><div className="field"><label htmlFor="secondary-source">Entrada (a partir de 0)</label><input id="secondary-source" type="number" min="0" max="65535" step="1" value={source} onChange={e=>setSource(Number(e.target.value))}/></div><div className="field"><label htmlFor="secondary-destination">Saída (a partir de 0)</label><input id="secondary-destination" type="number" min="0" max="65535" step="1" value={destination} onChange={e=>setDestination(Number(e.target.value))}/></div></div>}
      <p className="note">Programar não envia comando. Após publicar, o disparo exige este item no PGM nativo. Roteamento altera o equipamento; se ficar incerto, confira e reconheça o pedido em Monitor → Automação & Estúdio. ATEM/GPIO ainda não disponíveis.</p>
    </>}
    <button className="btn small" disabled={busy || !snapshot || !name.trim() || !Number.isFinite(offset) || offset<0 || type==='GRAPHICS_OVERLAY' && (!template || !Number.isFinite(duration) || duration<=0) || type==='DEVICE_AUTOMATION' && (!devices.some(device=>device.id===deviceId) || deviceAction==='ROUTE_CROSSPOINT' && (!Number.isSafeInteger(source) || !Number.isSafeInteger(destination) || source<0 || source>65535 || destination<0 || destination>65535))} onClick={()=>void perform(()=>api.addSecondaryEvent(itemId,{
      name,targetLayer:layer,triggerMode:mode,offsetFrames:Math.round(offset*snapshot!.rate.num/snapshot!.rate.den),enabled:true,type,templateId,
      ...(type==='GRAPHICS_OVERLAY'?{durationFrames:Math.round(duration*snapshot!.rate.num/snapshot!.rate.den),payload:Object.fromEntries((template?.fields??[]).map(field=>[field.key,values[field.key]??field.defaultValue]))}:type==='DEVICE_AUTOMATION'?{payload:{},deviceConfig:{deviceId,targetDevice:'VIDEOHUB_ROUTER',action:deviceAction,params:deviceAction==='PING'?{}:{source,destination}}}:{payload:{spliceEventId:Math.floor(Date.now()%0xffffffff),durationSeconds:30,prerollMs:4000,autoReturn:true}}),
    },snapshot!.editorialRevision))}>ADICIONAR À EDIÇÃO</button>
    <h4 className="mt-3">Registro de execução deste item</h4>
    {!runs.length && <p className="detalhe">Nenhum disparo registrado nas últimas 100 ocorrências do canal.</p>}
    <ul>{runs.map(run=><li key={run.id} className="detalhe">{new Date(run.createdAt).toLocaleString()} · {run.mode} · {run.state} · quadro {run.frames}{run.error ? ' · '+run.error:''}</li>)}</ul>
  </section>
}
