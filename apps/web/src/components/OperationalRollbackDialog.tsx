import {useState} from 'react'
import type {OperationalSimulation} from '../api.js'

export function OperationalRollbackDialog({inspection,onClose,onApply}:{inspection:OperationalSimulation & {sourceRevision:number};onClose:()=>void;onApply:()=>Promise<void>}) {
  const [busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null)
  const changes=inspection.differences
  const apply=async()=>{setBusy(true);setError(null);try{await onApply()}catch(reason){setError(reason instanceof Error?reason.message:'Restauração recusada.')}finally{setBusy(false)}}
  return <div className="fixed inset-0 z-[60] bg-black/80 flex items-center justify-center p-4">
    <section role="dialog" aria-modal="true" aria-labelledby="rollback-title" className="bg-surface-card border border-border-subtle rounded-lg max-w-3xl w-full max-h-[85vh] overflow-auto p-5 text-on-surface">
      <h2 id="rollback-title" className="text-lg font-bold">Conferir restauração da revisão {inspection.sourceRevision}</h2>
      <p className="my-3">{inspection.simulated.rundown.name} — {inspection.simulated.rundown.date}. Será criada uma nova revisão operacional. A grade editorial não será reescrita e o item no ar continuará protegido.</p>
      <p>Comparação com a revisão ativa {inspection.activeRevision??'inexistente'}:</p>
      <ul className="my-3 space-y-2">
        {changes.added.map(id=><li key={`add-${id}`}>Incluir: {id}</li>)}
        {changes.removed.map(id=><li key={`remove-${id}`}>Remover: {id}</li>)}
        {changes.changed.map(change=><li key={`change-${change.itemId}`}>Alterar {change.itemId}: {change.fields.join(', ')}</li>)}
        {changes.graphicsChanged?.map(id=><li key={`graphic-${id}`}>Grafismos ou eventos alterados: {id}</li>)}
        {changes.timingPolicyChanged&&<li>As regras de timing serão alteradas.</li>}
      </ul>
      {!changes.added.length&&!changes.removed.length&&!changes.changed.length&&!changes.graphicsChanged?.length&&!changes.timingPolicyChanged&&<p>Nenhuma diferença nos itens ou grafismos.</p>}
      <h3 className="mt-4 font-bold">Alertas de timing: {inspection.simulated.schedule.conflicts.length}</h3>
      <ul className="my-2 space-y-2">{inspection.simulated.schedule.conflicts.map((conflict,index)=><li key={index}>{conflict.message}</li>)}</ul>
      <p className="my-3 text-outline">Se a grade, o acervo ou a publicação mudar após esta conferência, a restauração será recusada. Feche e confira novamente.</p>
      {error&&<p role="alert" className="my-3 text-error">{error}</p>}
      <div className="flex justify-end gap-3 mt-4"><button disabled={busy} onClick={onClose} className="px-3 py-2 border rounded disabled:opacity-40">Cancelar</button><button disabled={busy} onClick={()=>void apply()} className="px-3 py-2 bg-primary text-surface-base rounded disabled:opacity-40">{busy?'Restaurando…':'Confirmar restauração conferida'}</button></div>
    </section>
  </div>
}
