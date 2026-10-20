import type {QcProfile} from '@rplayout/protocol'
/** Explicit operator setup; never install defaults just by opening QC. */
export function QcRenderedBusPolicyFields({profile,channels,onChange}:{profile:QcProfile;channels:number;onChange:(profile:QcProfile)=>void}){
  const pairs=profile.renderedBusPairs,supported=[2,8,16].includes(channels)
  const change=(index:number,patch:Partial<NonNullable<QcProfile['renderedBusPairs']>[number]>)=>onChange({...profile,renderedBusPairs:pairs?.map((pair,position)=>position===index?{...pair,...patch}:pair)})
  return <fieldset className="col-span-2 border border-outline/30 p-2 space-y-2">
    <legend>Critérios do áudio renderizado · {channels} canais</legend>
    <p>Separados do QC do arquivo original. Não aprovam transmissão, transições ou sincronismo. Auxiliares não herdam a faixa de loudness do master.</p>
    {!pairs&&<><p>Não configurado: avaliação do bus permanece pendente.</p><button type="button" disabled={!supported} className="underline" onClick={()=>onChange({...profile,renderedBusPairs:Array.from({length:channels/2},(_,index)=>({outputPair:index+1,loudness:null,maxTruePeakDbtp:Math.min(0,profile.maxTruePeakDbtp)}))})}>Configurar todos os pares com limite de peak (revise antes de salvar)</button></>}
    {pairs&&<>
      {pairs.length!==channels/2&&<p role="alert">Quantidade de pares não corresponde ao bus atual. Reconfigure antes de medir.</p>}
      {pairs.map((pair,index)=><div key={pair.outputPair} className="flex flex-wrap gap-2 items-center">
        <span>Par {pair.outputPair}: canais {pair.outputPair*2-1}–{pair.outputPair*2}</span>
        <label>Peak máximo (dBTP)<input type="number" min={-100} max={0} step="0.1" value={pair.maxTruePeakDbtp} onChange={event=>change(index,{maxTruePeakDbtp:Number(event.target.value)})} className="block bg-surface-base p-1"/></label>
        <label><input type="checkbox" checked={pair.loudness!==null} onChange={event=>change(index,{loudness:event.target.checked?{minLufs:profile.minLufs,maxLufs:profile.maxLufs}:null})}/> Exigir faixa LUFS neste par</label>
        {pair.loudness&&(['minLufs','maxLufs']as const).map(field=><label key={field}>{field==='minLufs'?'LUFS mínimo':'LUFS máximo'}<input type="number" min={-100} max={0} step="0.1" value={pair.loudness![field]} onChange={event=>change(index,{loudness:{...pair.loudness!,[field]:Number(event.target.value)}})} className="block bg-surface-base p-1"/></label>)}
      </div>)}
      <button type="button" className="underline" onClick={()=>{const {renderedBusPairs,...rest}=profile;onChange(rest)}}>Remover configuração (avaliação ficará pendente)</button>
    </>}
  </fieldset>
}
