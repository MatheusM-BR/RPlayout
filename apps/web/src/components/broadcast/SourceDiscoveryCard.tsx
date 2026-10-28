import type {SourceFamily} from '../../types.js'
import {sourceSelectionKey} from '../../domain/source-selection.js'
import {NdiAttribution} from './NdiAttribution.js'

/** Discovery is not signal readiness. Unknown/legacy provenance is never
 * promoted to hardware detection merely because an endpoint was saved. */
export function SourceDiscoveryCard({title,description,family,loading=false,ndi=false}:{title:string;description:string;family:SourceFamily|undefined;loading?:boolean;ndi?:boolean}){
  const discovered=family?.sources.filter(source=>source.discovery==='DISCOVERED')??[]
  const configured=family?.sources.filter(source=>source.discovery==='CONFIGURED')??[]
  const status=loading?'CONSULTANDO':!family?'DESCOBERTA NÃO CONSULTADA':discovered.length?`${discovered.length} DESCOBERTA(S)`:'NENHUMA DESCOBERTA CONFIRMADA'
  return <section aria-label={title} className="bg-surface-panel p-4 rounded-xl border border-border-subtle">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h4 className="font-headline-md text-[14px] text-on-surface font-bold">{title}</h4>
      <span className="font-label-caps text-[10px] px-2 py-0.5 rounded bg-surface-container text-outline border border-border-subtle">{status}</span>
    </div>
    <p className="font-body-sm text-[11.5px] text-outline mt-2">{description} A descoberta não confirma vídeo ou áudio; o sinal só é confirmado após CUE no PVW.</p>
    {family?.reason && <p role="status" className="mt-2 text-[11px] text-armed-amber">{family.reason}</p>}
    {family && <p className="mt-2 font-label-mono text-[10px] text-outline">Runtime de descoberta: {family.available?'disponível':'indisponível ou não confirmado'} · {configured.length} cadastrada(s)</p>}
    <ul className="mt-2 space-y-2">
      {family?.sources.map(source=><li key={sourceSelectionKey(source)} className="rounded border border-border-subtle bg-surface-base p-2 text-[11px]">
        <strong className="text-on-surface">{source.label||source.reference}</strong>
        <span className="block break-all font-label-mono text-outline">{source.reference}</span>
        <span className="block text-armed-amber">{source.discovery==='DISCOVERED'?'Descoberta; sinal ainda não medido':source.discovery==='CONFIGURED'?'Cadastrada; descoberta não confirmada':'Origem não confirmada; atualize a descoberta'}</span>
      </li>)}
    </ul>
    {ndi && <NdiAttribution/>}
  </section>
}
