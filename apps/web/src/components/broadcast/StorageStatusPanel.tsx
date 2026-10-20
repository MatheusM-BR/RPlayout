import {useEffect,useState} from 'react'
import {api} from '../../api.js'

export function StorageStatusPanel(){
  const [status,setStatus]=useState<Awaited<ReturnType<typeof api.storageStatus>>|null>(null)
  const [error,setError]=useState<string|null>(null)
  useEffect(()=>{
    let active=true,pending=false
    const refresh=async()=>{
      if(pending)return;pending=true
      try{const value=await api.storageStatus();if(active){setStatus(value);setError(null)}}
      catch(failure){if(active)setError(failure instanceof Error?failure.message:'Diagnóstico do banco indisponível.')}
      finally{pending=false}
    }
    void refresh();const timer=window.setInterval(()=>void refresh(),15_000)
    return ()=>{active=false;window.clearInterval(timer)}
  },[])
  return <section aria-label="Saúde do banco operacional" className="rounded border border-border-subtle bg-surface-base p-3 mb-3 text-sm">
    <h3 className="font-semibold">Banco operacional</h3>
    {error?<p role="alert" className="text-armed-amber">{error} Dados anteriores não representam o estado atual.</p>:status?<>
      <p>{status.connected?'Conectado':'Indisponível — novas operações de banco bloqueadas'} · {status.mode==='PROCESS'?'Processo separado':'Banco no processo do servidor'}</p>
      {status.latency&&<p className="text-xs text-outline">Resposta média {status.latency.meanMs.toFixed(2)} ms · última {status.latency.lastMs.toFixed(2)} ms · maior {status.latency.maxMs.toFixed(2)} ms · {status.latency.calls} operações</p>}
      <p className="text-xs text-outline">Gravações sem resposta não são repetidas automaticamente. Recuperação exige conferência; integração ainda aguarda revisão consolidada.</p>
    </>:<p className="text-xs text-outline">Consultando conexão do banco…</p>}
  </section>
}
