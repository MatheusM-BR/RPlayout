import {useEffect,useState} from 'react'
import {api,type HostMetricHistory} from '../../api.js'

const pct=(value:number|null|undefined)=>value==null?'N/D':`${value.toFixed(1)}%`
const traffic=(value:number|null|undefined)=>value==null?'N/D':`${(value*8/1_000_000).toFixed(2)} Mbps`
export function HostMetricHistoryTable({history}:{history:HostMetricHistory}){
  return <>
    <p className="text-xs text-outline mb-2">{history.totalSamples} amostras na janela · {history.samples.length} nesta página{history.truncated?' · página parcial, não cobre toda a janela':''}. GPU é do host; rede soma adaptadores, não apenas este canal.</p>
    <div className="overflow-x-auto"><table className="w-full text-xs text-left"><caption className="sr-only">Amostras reais de utilização do servidor</caption>
      <thead><tr className="border-b border-border-subtle">{['Coleta','CPU','RAM','GPU','Disco usado','Recepção','Envio'].map(label=><th key={label} className="py-2 pr-3">{label}</th>)}</tr></thead>
      <tbody>{history.samples.map(sample=><tr key={sample.generatedAt} className="border-b border-border-subtle/30">
        <td className="py-2 pr-3">{new Date(sample.generatedAt).toLocaleString('pt-BR')}</td><td>{pct(sample.cpu.percent)}</td><td>{pct(sample.memory.percent)}</td><td>{pct(sample.gpu.utilizationPercent)}</td><td>{pct(sample.disk.percentUsed)}</td><td>{traffic(sample.network.receivedBytesPerSecond)}</td><td>{traffic(sample.network.sentBytesPerSecond)}</td>
      </tr>)}</tbody>
    </table></div>
    {history.samples.length===0&&<p className="text-sm py-3">Nenhuma amostra disponível nesta página. A retenção pode expirar registros; valores ausentes não são estimados.</p>}
  </>
}

function HostMetricHistoryQuery({hours}:{hours:number}){
  const [history,setHistory]=useState<HostMetricHistory|null>(null),[error,setError]=useState<string|null>(null)
  const [navigation,setNavigation]=useState<{until:string;before:string}[]>([])
  const [retry,setRetry]=useState(0),[loading,setLoading]=useState(true),page=navigation.at(-1)
  useEffect(()=>{
    let active=true,pending=false,controller:AbortController|null=null
    setHistory(null);setError(null)
    const refresh=async()=>{
      if(pending||!active)return
      pending=true;setLoading(true);controller=new AbortController()
      const current=controller;let timedOut=false
      const timeout=window.setTimeout(()=>{timedOut=true;current.abort()},10000)
      try{const result=await api.hostMetricHistory(hours,120,page,current.signal);if(active){setHistory(result);setError(null)}}
      catch(failure){if(active)setError(timedOut?'A consulta excedeu 10 segundos. Tente novamente.':failure instanceof Error?failure.message:'Histórico global indisponível.')}
      finally{window.clearTimeout(timeout);pending=false;if(active)setLoading(false)}
    }
    void refresh();const timer=page?null:window.setInterval(()=>void refresh(),15000)
    return()=>{active=false;controller?.abort();if(timer!==null)window.clearInterval(timer)}
  },[hours,page,retry])
  return <>
    <div className="flex flex-wrap gap-2 items-center text-xs mb-2">
      <button disabled={!navigation.length} onClick={()=>setNavigation([])}>Mais recentes do servidor</button>
      <button disabled={!navigation.length} onClick={()=>setNavigation(value=>value.slice(0,-1))}>Página anterior do servidor</button>
      <span>Página {navigation.length+1}{page?' · janela fixa; atualização automática pausada':''}</span>
      <button disabled={loading||!history?.nextBefore||!history.until} onClick={()=>{if(history?.nextBefore&&history.until){setHistory(null);setNavigation(value=>[...value,{until:history.until!,before:history.nextBefore!}])}}}>Registros anteriores do servidor</button>
      <button disabled={loading} onClick={()=>setRetry(value=>value+1)}>{loading?'Consultando…':error?'Tentar novamente':'Atualizar esta página'}</button>
      {page&&<span>Até {new Date(page.until).toLocaleString('pt-BR')}; retenção de 14 dias, sem recuperação de registros expirados.</span>}
    </div>
    {error&&<p role="alert" className="text-armed-amber text-sm mb-2">{error}{history?' Os registros abaixo podem estar desatualizados.':''}</p>}
    {history?<HostMetricHistoryTable history={history}/>:<p className="text-sm">{error?'Não foi possível conferir o histórico global.':'Carregando histórico do servidor…'}</p>}
  </>
}

export function HostMetricHistoryPanel(){
  const [hours,setHours]=useState(1)
  return <section aria-label="Histórico global do servidor" className="rounded border border-border-subtle p-3 mt-4">
    <div className="flex flex-wrap items-center justify-between gap-3 mb-3"><h3 className="font-semibold">Histórico global do servidor</h3><label className="text-xs">Período <select aria-label="Período do histórico" value={hours} onChange={event=>setHours(Number(event.target.value))} className="ml-2 bg-surface-base border border-border-subtle rounded px-2 py-1"><option value={1}>Última hora</option><option value={6}>Últimas 6 horas</option><option value={24}>Últimas 24 horas</option><option value={336}>Últimos 14 dias</option></select></label></div>
    <p className="text-xs text-outline mb-2">Consulta registros persistidos; não dispara coleta, sintonização ou reprodução. O acesso global requer permissão própria, independente do histórico por canal.</p>
    <HostMetricHistoryQuery key={hours} hours={hours}/>
  </section>
}
