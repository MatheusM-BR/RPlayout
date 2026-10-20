import {useEffect,useState} from 'react'
import {api,type OperationalMetricHistory} from '../../api.js'
type ChannelChoice={id:string;name:string}
const metric=(value:number|null|undefined,suffix='')=>value==null?'N/D':`${value}${suffix}`
const short=(id:string|null)=>id?`${id.slice(0,12)}${id.length>12?'…':''}`:'N/D'
function HistoricalName({name,ambiguous=false}:{name?:string|null;ambiguous?:boolean}){return <span className="block text-outline">{ambiguous?'Cadastros compartilham o endereço; nome não atribuído':name??'Nome histórico não registrado'}</span>}
export function OperationalHistoryTable({history}:{history:OperationalMetricHistory}){
  return <>
    <p className="text-xs text-outline mb-2">{history.totalSamples} amostras na janela · {history.samples.length} recebidas{history.truncated?' · consulta limitada; não cobre toda a janela':''}. CPU do engine é tempo acumulado, não percentual. RAM é do processo, não da GPU.</p>
    <div className="overflow-x-auto"><table className="w-full text-xs text-left"><caption className="sr-only">Histórico operacional do canal</caption>
      <thead><tr>{['Coleta','PGM / execução','Engine','Fontes / saídas'].map(label=><th key={label} className="p-2 border-b border-border-subtle">{label}</th>)}</tr></thead>
      <tbody>{history.samples.map((sample,index)=>{
        const frame=sample.operations,channel=frame?.channels.find(row=>row.channelId===history.channelId)
        return <tr key={`${sample.sampledAt}:${index}`} className="border-b border-border-subtle/30 align-top">
          <td className="p-2 whitespace-nowrap">{new Date(sample.sampledAt).toLocaleString('pt-BR')}</td>
          {!frame||!frame.available||!channel?<td colSpan={3} className="p-2 text-outline">{!frame?'Sem correlação nesta versão da coleta.':!frame.available?'Coleta operacional indisponível.':frame.channelsTruncated?'Canal não incluído na coleta limitada.':'Sem runtime registrado nesta coleta; não comprova falha ou ausência de sinal.'}</td>:<>
            <td className="p-2"><div>{channel.itemId?'PGM '+short(channel.itemId):'PGM sem item'}</div>{channel.itemId&&<HistoricalName name={channel.itemName}/>}<div title={channel.revisionId??undefined}>Edição: {short(channel.revisionId)}</div><div title={channel.executionId??undefined}>Execução: {short(channel.executionId)}</div><div>{metric(channel.elapsedFrames,' quadros')} · {channel.mode??'N/D'}</div></td>
            <td className="p-2"><div>{channel.engine.ready?'Engine pronto':'Engine não pronto'} · PID {metric(channel.engine.pid)}</div><div>CPU acumulada: {metric(channel.engine.cpuTimeMs==null?null:Math.round(channel.engine.cpuTimeMs/1000),' s')}</div><div>RAM: {metric(channel.engine.memoryBytes==null?null:Math.round(channel.engine.memoryBytes/1024**2),' MB')}</div><div>Reinícios {channel.engine.restarts} · quedas {channel.engine.deaths} · travamentos {channel.engine.stalls}</div>{channel.engine.hasError&&<div className="text-armed-amber">Erro registrado; consulte incidentes.</div>}</td>
            <td className="p-2">
              {channel.sources.length===0&&<div>Nenhuma fonte monitorada nesta coleta.</div>}
              {channel.sources.map((source,i)=><div key={`${source.sourceId}:${i}`} title={source.sourceId}>Fonte {short(source.sourceId)}: {source.state}<HistoricalName name={source.sourceName} ambiguous={source.nameAmbiguous}/>PGM {source.busSignals?.pgm?.status??'N/D'} · PVW {source.busSignals?.pvw?.status??'N/D'}{(['pgm','pvw'] as const).map(bus=>{const binding=source.busCatalog?.[bus];return binding?<div key={bus} title={binding.configuredSourceId}>{bus.toUpperCase()} · cadastro selecionado <HistoricalName name={binding.sourceName}/><span className="block text-outline">{binding.identityBasis==='NATIVE_DECODER'?'Cadastro recebido pelo decoder atual; sinal avaliado separadamente':'Vínculo pelo item publicado; não confirma sinal'}</span></div>:null})}</div>)}
              {channel.outputs.length===0&&<div>Nenhuma saída reportada nesta coleta.</div>}
              {channel.outputs.map((output,i)=><div key={`${output.outputId}:${i}`} title={output.outputId}>Saída {short(output.outputId)}: {output.state}<HistoricalName name={output.outputName} ambiguous={output.nameAmbiguous}/>{output.identityType==='ENDPOINT'&&<span className="block text-outline">Identidade por endereço; perfil não confirmado</span>}Tentativas {output.attempts} · entregas {output.delivered}{output.hasError?' · erro registrado':''}</div>)}
              {(channel.sourcesTruncated||channel.outputsTruncated)&&<div className="text-armed-amber">Lista limitada nesta coleta.</div>}
            </td>
          </>}
        </tr>
      })}</tbody>
    </table></div>
    {history.samples.length===0&&<p className="text-sm p-2">Nenhuma amostra registrada nesta janela. Valores anteriores não são estimados.</p>}
  </>
}
function OperationalHistoryQuery({channelId,hours}:{channelId:string;hours:number}){
  const [history,setHistory]=useState<OperationalMetricHistory|null>(null),[error,setError]=useState<string|null>(null)
  const [navigation,setNavigation]=useState<{until:string;before:string}[]>([])
  const [retry,setRetry]=useState(0),[loading,setLoading]=useState(true)
  const page=navigation.at(-1)
  useEffect(()=>{
    let active=true,pending=false,controller:AbortController|null=null
    setHistory(null);setError(null)
    const refresh=async()=>{
      if(pending||!active)return
      pending=true;setLoading(true);controller=new AbortController()
      const current=controller;let timedOut=false
      const timeout=window.setTimeout(()=>{timedOut=true;current.abort()},10000)
      try{const result=await api.operationalMetricHistory(channelId,hours,120,page,current.signal);if(active){if(result.channelId!==channelId)throw new Error('Resposta pertence a outro canal; histórico recusado.');setHistory(result);setError(null)}}
      catch(failure){if(active)setError(timedOut?'A consulta excedeu 10 segundos. Tente novamente.':failure instanceof Error?failure.message:'Histórico indisponível.')}
      finally{window.clearTimeout(timeout);pending=false;if(active)setLoading(false)}
    }
    void refresh();const timer=page?null:window.setInterval(()=>void refresh(),15000)
    return()=>{active=false;controller?.abort();if(timer!==null)window.clearInterval(timer)}
  },[channelId,hours,page,retry])
  return <>
    <div className="flex flex-wrap gap-2 items-center text-xs mb-2">
      <button disabled={!navigation.length} onClick={()=>setNavigation([])}>Mais recentes</button>
      <button disabled={!navigation.length} onClick={()=>setNavigation(value=>value.slice(0,-1))}>Página anterior</button>
      <span>Página {navigation.length+1}{page?' · janela fixa; atualização automática pausada':''}</span>
      <button disabled={loading||!history?.nextBefore||!history.until} onClick={()=>{if(history?.nextBefore&&history.until){setHistory(null);setNavigation(value=>[...value,{until:history.until!,before:history.nextBefore!}])}}}>Registros anteriores</button>
      <button disabled={loading} onClick={()=>setRetry(value=>value+1)}>{loading?'Consultando…':error?'Tentar novamente':'Atualizar esta página'}</button>
      {page&&history&&<span>Até {new Date(history.until??page.until).toLocaleString('pt-BR')}; registros expirados pela retenção não são recuperáveis.</span>}
    </div>
    {error&&<p role="alert" className="text-armed-amber text-sm mb-2">{error}{history?' Os registros abaixo podem estar desatualizados.':''}</p>}{history?<OperationalHistoryTable history={history}/>:<p className="text-sm">{error?'Não foi possível conferir o histórico.':'Carregando histórico do canal…'}</p>}
  </>
}
export function OperationalHistoryPanel({channels,initialChannelId}:{channels:readonly ChannelChoice[];initialChannelId?:string}){
  const [selection,setSelection]=useState(initialChannelId??''),[hours,setHours]=useState(1)
  const selected=channels.find(row=>row.id===selection)??channels.find(row=>row.id===initialChannelId)??channels[0]
  return <section aria-label="Histórico operacional por canal" className="rounded border border-border-subtle p-3 mb-4">
    <div className="flex flex-wrap items-center justify-between gap-2 mb-3"><h3 className="font-semibold">Histórico operacional por canal</h3><div className="flex gap-3 text-xs"><label>Canal <select aria-label="Canal do histórico operacional" className="bg-surface-base p-1 rounded" value={selected?.id??''} disabled={!channels.length} onChange={event=>setSelection(event.target.value)}>{channels.map(row=><option key={row.id} value={row.id}>{row.name}</option>)}</select></label><label>Período <select aria-label="Período operacional" className="bg-surface-base p-1 rounded" value={hours} onChange={event=>setHours(Number(event.target.value))}><option value={1}>1 hora</option><option value={6}>6 horas</option><option value={24}>24 horas</option><option value={336}>14 dias</option></select></label></div></div>
    <p className="text-xs text-outline mb-2">Consulta somente registros; não sintoniza fontes nem abre engines. Prontidão não homologa vídeo, áudio ou saída física.</p>
    {selected?<OperationalHistoryQuery key={`${selected.id}:${hours}`} channelId={selected.id} hours={hours}/>:<p className="text-sm">Selecione um canal autorizado para consultar o histórico.</p>}
  </section>
}
