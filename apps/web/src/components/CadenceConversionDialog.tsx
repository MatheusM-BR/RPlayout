import {useEffect,useState} from 'react'
import type {CadenceConversionReport,Channel,Rate} from '@rplayout/protocol'
import {api} from '../api.js'

export interface CadenceConversionRequest {
  channel:Channel
  rate:Rate
  format:Partial<Pick<Channel,'name'|'width'|'height'|'scan'|'fieldOrder'|'targetLufs'|'ceilingDbtp'>>
}
const formatLabels:Record<string,string>={name:'nome',width:'largura',height:'altura',scan:'varredura',fieldOrder:'ordem de campos',targetLufs:'alvo de loudness',ceilingDbtp:'limite de pico'}
export function CadenceConversionDialog({request,onCancel,onApplied}:{request:CadenceConversionRequest;onCancel:()=>void;onApplied:(message:string)=>void}){
  const [report,setReport]=useState<CadenceConversionReport|null>(null)
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[confirmed,setConfirmed]=useState(false)
  const [refresh,setRefresh]=useState(0)
  useEffect(()=>{
    let current=true
    setReport(null);setError('');setConfirmed(false)
    void api.cadencePreview(request.channel.id,request.rate,request.format,request.channel.configurationRevision).then(result=>{if(current)setReport(result.report)}).catch(failure=>{if(current)setError(failure instanceof Error?failure.message:'Não foi possível simular.')})
    return()=>{current=false}
  },[request,refresh])
  const apply=async()=>{
    if(!report || !confirmed || busy || report.pendingInterruptions)return
    setBusy(true);setError('')
    try{
      const result=await api.cadenceConvert(request.channel.id,request.rate,report.fingerprint,request.format,request.channel.configurationRevision)
      onApplied(`Cadência convertida. Revise e publique as grades antes de operar. Sem TAKE automático.${result.engineError ? ` Atenção: o engine não foi reconstruído: ${result.engineError}` : ''}`)
    }catch(failure){setError(failure instanceof Error?failure.message:'Conversão não confirmada. Confira o canal antes de tentar novamente.');setConfirmed(false)}
    finally{setBusy(false)}
  }
  return <div className="fixed inset-0 z-[60] bg-black/80 p-4 flex items-center justify-center" role="dialog" aria-modal="true" aria-labelledby="cadence-title">
    <section className="max-w-xl w-full max-h-[85vh] overflow-auto rounded-xl bg-surface-card border border-border-subtle p-6 text-on-surface">
      <h2 id="cadence-title" className="text-lg font-bold">Revisar conversão de cadência — {request.channel.name}</h2>
      <p className="my-3">{request.channel.rate.num}/{request.channel.rate.den} → {request.rate.num}/{request.rate.den} FPS</p>
      {!!Object.keys(request.format).length&&<p className="text-sm">Configurações incluídas nesta confirmação: {Object.entries(request.format).map(([field,value])=>`${formatLabels[field]??field}: ${value}`).join(' · ')}.</p>}
      {!report && !error && <p role="status">Calculando impacto nas grades…</p>}
      {report && <>
        <p>{report.rundowns} grades · {report.items} itens · {report.events} eventos secundários</p>
        <p className="my-2 text-sm">{report.roundedValues} valores arredondados; erro máximo de {report.maxRoundingErrorMs.toFixed(3)} ms. {report.inheritedTrims} cortes herdados serão fixados neste canal.</p>
        <ul className="list-disc pl-5 my-3 space-y-2 text-sm">{report.warnings.map(warning=><li key={warning}>{warning}</li>)}</ul>
        {!!report.pendingInterruptions && <p role="alert" className="text-amber-400">Resolva os {report.pendingInterruptions} VTs interrompidos antes de converter.</p>}
        <label className="flex gap-2 my-4 text-sm"><input type="checkbox" disabled={busy || !!report.pendingInterruptions} checked={confirmed} onChange={event=>setConfirmed(event.target.checked)}/>Entendi: devo parar o PGM, limpar o CUE e republicar as grades. O histórico não será convertido.</label>
      </>}
      {error && <p role="alert" className="my-3 text-amber-400">{error}</p>}
      <footer className="flex gap-3 justify-end mt-4">
        <button disabled={busy} onClick={onCancel}>VOLTAR</button>
        <button disabled={busy} onClick={()=>setRefresh(value=>value+1)}>RECALCULAR</button>
        <button className="bg-primary px-3 py-2 rounded text-on-primary disabled:opacity-40" disabled={!report || !confirmed || busy || !!report.pendingInterruptions} onClick={()=>void apply()}>{busy?'CONVERTENDO…':'CONVERTER E EXIGIR PUBLICAÇÃO'}</button>
      </footer>
    </section>
  </div>
}
