import type {AuxiliaryAudioPair} from '@rplayout/protocol'

export function AuxiliaryAudioPairsEditor({channels,pairs,inputChannels,onChange}:{channels:2|8|16;pairs:readonly AuxiliaryAudioPair[];inputChannels?:number;onChange:(pairs:readonly AuxiliaryAudioPair[])=>void}){
  const setPair=(outputPair:number,inputPair:number)=>onChange([...pairs.filter(p=>p.outputPair!==outputPair),...(inputPair?[{outputPair,inputPair,gainDb:pairs.find(p=>p.outputPair===outputPair)?.gainDb??0}]:[])].sort((a,b)=>a.outputPair-b.outputPair))
  return <fieldset className="flex flex-col gap-2 border border-border-subtle rounded p-3">
    <legend className="text-[11px] text-outline">Pares auxiliares do PGM / SDI</legend>
    <p className="text-[11px] text-outline">1–2: master. Cada auxiliar usa um par da trilha selecionada, com ganho independente. Sem atribuição = silêncio. Preview e saídas de rede usam somente o master.</p>
    {channels===2?<p className="text-[11px] text-outline">Canal estéreo. Para usar auxiliares, configure 8 ou 16 canais no formato do canal, com PGM parado e CUE limpo.</p>:Array.from({length:channels/2-1},(_,i)=>i+2).map(outputPair=>{
      const pair=pairs.find(p=>p.outputPair===outputPair),label=`Saída ${outputPair*2-1}–${outputPair*2}`
      return <div key={outputPair} className="flex flex-wrap items-center gap-2">
        <label className="text-[11px] min-w-[74px]" htmlFor={`aux-pair-${outputPair}`}>{label}</label>
        <select id={`aux-pair-${outputPair}`} aria-label={`${label}: par de entrada`} value={pair?.inputPair??0} onChange={event=>setPair(outputPair,Number(event.target.value))} className="bg-surface-panel p-2 rounded border border-border-subtle text-xs">
          <option value={0}>Sem atribuição (silêncio)</option>
          {Array.from({length:32},(_,i)=>i+1).map(inputPair=><option key={inputPair} value={inputPair} disabled={inputChannels!==undefined&&inputPair*2>inputChannels}>{inputPair*2-1}–{inputPair*2}{inputChannels!==undefined&&inputPair*2>inputChannels?' · indisponível':''}</option>)}
        </select>
        <label className="text-[11px]">Ganho (dB) <input aria-label={`${label}: ganho independente em dB`} type="number" min={-60} max={12} step={0.5} disabled={!pair} value={Number.isFinite(pair?.gainDb??0)?pair?.gainDb??0:''} onChange={event=>{if(pair)onChange(pairs.map(p=>p.outputPair===outputPair?{...p,gainDb:event.target.valueAsNumber}:p))}} className="w-20 bg-surface-panel p-2 border border-border-subtle rounded disabled:opacity-40"/></label>
      </div>
    })}
    {inputChannels===undefined&&channels>2&&<p className="text-[11px] text-outline">Número de canais de entrada ainda desconhecido; o engine exigirá o par real antes do TAKE. Atribuir não comprova sinal físico.</p>}
  </fieldset>
}
