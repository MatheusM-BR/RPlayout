export function QcProbePolicy({required,onChange}:{required:boolean;onChange?:(value:boolean)=>void}){
  return <div className="col-span-2 text-xs" aria-label="Política de sondagem técnica">
    {onChange&&<label><input type="checkbox" checked={required} onChange={event=>onChange(event.target.checked)}/> Sondagem técnica completa obrigatória</label>}
    <p className={required?'text-outline':'text-armed-amber'}>{required
      ?'Perfil rigoroso: codec, geometria, cadência, varredura, duração e declaração de áudio precisam estar identificados. Não exige áudio se o perfil permitir silêncio.'
      :'Compatibilidade de legado: metadados ausentes podem exigir conferência manual. Aprovação humana não comprova sondagem completa. Ative a exigência no perfil para bloquear material incompleto.'}</p>
  </div>
}
