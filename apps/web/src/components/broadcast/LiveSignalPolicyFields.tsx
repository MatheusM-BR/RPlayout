import {DEFAULT_LIVE_SIGNAL_POLICY,type LiveSignalPolicy} from '@rplayout/protocol'

export function LiveSignalPolicyFields({value,onChange}:{value?:LiveSignalPolicy;onChange:(value:LiveSignalPolicy)=>void}){
  const policy=value??DEFAULT_LIVE_SIGNAL_POLICY
  return <fieldset className="col-span-2 rounded border border-border-subtle p-2 space-y-2">
    <legend>Avisos de entrada ao vivo deste canal</legend>
    <label className="block"><input type="checkbox" checked={policy.arrivalWarningEnabled} onChange={event=>onChange({...policy,arrivalWarningEnabled:event.target.checked})}/> Avisar variação de chegada no decoder</label>
    <label className="block">Limite em intervalos de quadro (0,5–20)<input type="number" min="0.5" max="20" step="0.5" value={policy.warningFrameIntervals} onChange={event=>onChange({...policy,warningFrameIntervals:event.target.valueAsNumber})} className="block w-full p-1 bg-surface-base"/></label>
    <label className="block">Quadros de aquecimento (1–10.000)<input type="number" min="1" max="10000" step="1" value={policy.minimumReceivedFrames} onChange={event=>onChange({...policy,minimumReceivedFrames:event.target.valueAsNumber})} className="block w-full p-1 bg-surface-base"/></label>
    <p className="text-outline">Somente aviso operacional. Não é jitter de rede ou freeze por conteúdo; não altera TAKE, presença de sinal ou aprovação de arquivos. Valores padrão: 3 intervalos e 50 quadros.</p>
  </fieldset>
}
