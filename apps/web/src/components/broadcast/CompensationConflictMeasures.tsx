import type {CompensationConflictMeasure} from '../../domain/compensation-conflicts.js'
import type {Rate} from '@rplayout/protocol'
import {dur} from '../../format.js'

export function CompensationConflictMeasures({measures,rate,disabled,onCopy}:{measures:readonly CompensationConflictMeasure[];rate:Rate;disabled:boolean;onCopy:(measure:CompensationConflictMeasure)=>void}){
 if(!measures.length)return null
 return <div role="group" aria-label="Usar medida de conflito calculado" className="space-y-1">
  <p>Copiar o tempo de um conflito para o ajuste selecionado:</p>
  <div className="max-h-28 overflow-y-auto space-y-1">{measures.map(measure=><button type="button" key={measure.key} disabled={disabled} className="block rounded border border-border-subtle px-2 py-1 text-left" onClick={()=>onCopy(measure)}>
   {measure.deltaFrames>0?'+':'−'}{dur(measure.conflictFrames,rate)} · {measure.anchorTitle}
  </button>)}</div>
  <p>Somente preenche o valor. Não garante resolver o conflito; confira o efeito executável antes de confirmar.</p>
 </div>
}
