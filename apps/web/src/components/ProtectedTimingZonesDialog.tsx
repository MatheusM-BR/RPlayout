import { useState } from 'react'
import { formatTimecode, parseTimecode, type ProtectedTimingZone, type Rundown, type Rate, type Priority } from '@rplayout/protocol'
import { api } from '../api.js'
import type { Snapshot } from '../types.js'

type Row = { id: string; label: string; from: string; to: string; priority: Priority }
export function ProtectedTimingZonesDialog({ rundown:openedRundown, rate:openedRate, editorialRevision:openedRevision,onClose, onSaved }: { rundown: Rundown; rate: Rate;editorialRevision:number|undefined; onClose: () => void; onSaved: (snapshot: Snapshot) => void }) {
  const [{rundown,rate,editorialRevision}]=useState(()=>({rundown:openedRundown,rate:openedRate,editorialRevision:openedRevision}))
  const [rows, setRows] = useState<Row[]>(() => (rundown.protectedZones ?? []).map(zone => ({ ...zone, from:formatTimecode(zone.from,rate),to:formatTimecode(zone.to,rate) })))
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState<string|null>(null)
  const update=(id:string,change:Partial<Row>)=>setRows(current=>current.map(row=>row.id===id?{...row,...change}:row))
  const save=async()=>{
    const zones:ProtectedTimingZone[]=[]
    for (const row of rows) {
      const from=parseTimecode(row.from,rate),to=parseTimecode(row.to,rate)
      if (!row.label.trim() || from===null || to===null || from<0 || to<=from) {setError('Cada zona precisa de nome e horário de fim posterior ao início. Use HH:MM:SS:FF.');return}
      zones.push({id:row.id,label:row.label.trim(),from,to,priority:row.priority})
    }
    setBusy(true);setError(null)
    try {onSaved(await api.saveProtectedZones(rundown.id,zones,rundown.protectedZones ?? [],editorialRevision))}
    catch(failure){setError(failure instanceof Error?failure.message:'Não consegui salvar as zonas.')}
    finally{setBusy(false)}
  }
  const field='w-full min-w-0 rounded border border-border-subtle bg-surface-base p-2 text-sm text-on-surface'
  return <div role="dialog" aria-modal="true" aria-labelledby="timing-zones-title" className="fixed inset-0 z-[110] bg-black/70 flex items-center justify-center p-4">
    <section className="w-full max-w-3xl max-h-[90vh] overflow-auto rounded-xl border border-border-subtle bg-surface-panel text-on-surface p-5 space-y-4">
      <h2 id="timing-zones-title" className="text-lg font-bold">Zonas protegidas — {rundown.date}</h2>
      <p className="text-sm text-outline">Estas regras são da grade editorial. Salvar não altera o PGM/CUE: confira a simulação e publique para usar na execução.</p>
      <p className="text-sm">Prioridade 5 protege mais. Compromissos de prioridade igual ou menor preservam a duração. FIXED/HARD_TIME são mandatórios; um corte na zona fica registrado como conflito. Para atravessar meia-noite, use 24:00 ou mais (limite 48h).</p>
      <div className="space-y-3">
        {!rows.length&&<p className="text-outline text-sm">Nenhuma zona protegida nesta data.</p>}
        {rows.map((row,index)=><div key={row.id} className="rounded border border-border-subtle p-3 grid grid-cols-1 sm:grid-cols-[2fr_1fr_1fr_1fr_auto] gap-2 items-end">
          <label className="text-xs">Nome da zona<input aria-label={`Nome da zona ${index+1}`} className={field} value={row.label} disabled={busy} maxLength={120} onChange={event=>update(row.id,{label:event.target.value})}/></label>
          <label className="text-xs">Início<input aria-label={`Início da zona ${index+1}`} className={field} value={row.from} disabled={busy} onChange={event=>update(row.id,{from:event.target.value})}/></label>
          <label className="text-xs">Fim<input aria-label={`Fim da zona ${index+1}`} className={field} value={row.to} disabled={busy} onChange={event=>update(row.id,{to:event.target.value})}/></label>
          <label className="text-xs">Prioridade<select aria-label={`Prioridade da zona ${index+1}`} className={field} value={row.priority} disabled={busy} onChange={event=>update(row.id,{priority:Number(event.target.value) as Priority})}>{[1,2,3,4,5].map(value=><option key={value} value={value}>{value}</option>)}</select></label>
          <button className="btn small" type="button" disabled={busy} aria-label={`Remover zona ${index+1} do rascunho`} onClick={()=>setRows(current=>current.filter(candidate=>candidate.id!==row.id))}>×</button>
        </div>)}
      </div>
      <button type="button" className="btn small" disabled={busy||rows.length>=100} onClick={()=>setRows(current=>[...current,{id:crypto.randomUUID(),label:'',from:'19:00:00:00',to:'20:00:00:00',priority:5}])}>+ ADICIONAR ZONA</button>
      {error&&<p role="alert" className="text-error text-sm">{error}</p>}
      <div className="flex justify-end gap-2"><button type="button" className="btn small" disabled={busy} onClick={onClose}>CANCELAR</button><button type="button" className="btn primary small" disabled={busy} onClick={()=>void save()}>{busy?'SALVANDO…':'SALVAR NA EDIÇÃO'}</button></div>
    </section>
  </div>
}
