import { confirmAction } from '../domain/confirm.js'
import {useEffect,useRef,useState} from 'react'
import {PROJECT_SECTIONS,type ProjectRestoreReview} from '@rplayout/protocol'
import {api} from '../api.js'
const names={rundowns:'Grades',items:'Itens',outputs:'Saídas',presets:'Perfis de transmissão',sources:'Fontes ao vivo',rules:'Regras',multiview:'Multiview',destinations:'Destinos',guests:'Chaves de convidados',graphics:'Modelos de grafismo',cues:'Deixas',secondaryEvents:'Eventos secundários'}
export function ProjectRestoreImpact({review}:{review:ProjectRestoreReview}){
  const describe=(v:ProjectRestoreReview['formatBefore'])=>`${v.width} × ${v.height} · ${v.rateNum}/${v.rateDen} fps · ${v.audioChannels} canais de áudio`
  return <section aria-label="Impacto da restauração" className="mt-4 border border-armed-amber rounded p-3 text-sm">
    <h4 className="font-bold">Conferência: {review.label}</h4><p>Formato atual: {describe(review.formatBefore)}</p><p>Formato a restaurar: {describe(review.formatAfter)}</p>
    <table className="w-full my-3"><caption className="sr-only">Registros atuais e registros a restaurar</caption><thead><tr><th className="text-left">Área</th><th>Atual</th><th>A restaurar</th></tr></thead><tbody>{PROJECT_SECTIONS.map(key=><tr key={key}><td>{names[key]}</td><td className="text-center">{review.replacing[key]}</td><td className="text-center">{review.restoring[key]}</td></tr>)}</tbody></table>
    <p>{review.removedRundowns} grades removidas; {review.preservedPublications} publicações preservadas.</p>
    <p>Habilitados no projeto: {review.enabledOutputs} saídas, {review.enabledDestinations} destinos e {review.enabledGuests} chaves de convidados. Confira antes de operar.</p>
    <p className="mt-2">Exige PGM parado e CUE limpo. Reinicia o engine, sem TAKE automático. Esta conferência não valida sinal físico. Revise e publique a grade restaurada antes de operar.</p>
  </section>
}
/** Parent must key this component by channelId to isolate late responses. */
export function ProjectRestorePanel({channelId,canRestore,externalBusy,onMessage,onChanged}:{channelId:string;canRestore:boolean;externalBusy:boolean;onMessage:(message:string)=>void;onChanged:()=>void}){
  const [projects,setProjects]=useState<Array<{id:string;label:string;createdAt:string}>>([])
  const [label,setLabel]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('')
  const [review,setReview]=useState<ProjectRestoreReview|null>(null),[blocked,setBlocked]=useState(false)
  const alive=useRef(false),pending=useRef(false),query=useRef(0)
  const callbacks=useRef({onMessage,onChanged});callbacks.current={onMessage,onChanged}
  useEffect(()=>{
    alive.current=true;const version=++query.current
    void api.channelProjects(channelId).then(result=>{if(alive.current&&query.current===version)setProjects(result.projects)}).catch(e=>{if(alive.current&&query.current===version)setError(e instanceof Error?e.message:'Falha ao consultar projetos.')})
    return()=>{alive.current=false;query.current++}
  },[channelId])
  const start=()=>{if(pending.current||externalBusy)return false;pending.current=true;setBusy(true);setError('');query.current++;return true}
  const end=()=>{pending.current=false;if(alive.current)setBusy(false)}
  const fail=(e:unknown)=>{if(alive.current){const message=e instanceof Error?e.message:'Falha na operação de projeto.';setError(message);callbacks.current.onMessage(message)}}
  const save=async()=>{
    if(!start())return
    try{const result=await api.saveChannelProject(channelId,label.trim()||`Ponto manual ${new Date().toLocaleString('pt-BR')}`)
      if(alive.current){setProjects(result.projects);setLabel('');setBlocked(true);callbacks.current.onMessage(`Projeto salvo: ${result.project.label}.`)}
    }catch(e){fail(e)}finally{end()}
  }
  const inspect=async(id:string)=>{
    if(!canRestore||!start())return
    setBlocked(true)
    try{const result=await api.reviewChannelProject(channelId,id);if(alive.current){setReview(result.review);setBlocked(false)}}catch(e){fail(e)}finally{end()}
  }
  const restore=async()=>{
    if(!review||blocked||!canRestore||externalBusy||pending.current)return
    const displayed=review
    if(!(await confirmAction(`Restaurar “${displayed.label}” com o impacto conferido? Exige PGM parado e CUE limpo e reinicia o engine, sem TAKE automático.`))||!start())return
    setBlocked(true)
    try{
      const result=await api.restoreChannelProject(channelId,displayed.projectId,displayed)
      callbacks.current.onChanged()
      if(alive.current){setReview(null);callbacks.current.onMessage(result.engineError?`Projeto gravado; aplicação no engine não confirmada: ${result.engineError}. Confira a configuração pendente; não repita automaticamente.`:`Projeto restaurado: ${result.restored.label}. Revise e publique a grade antes do CUE/TAKE; confira as saídas físicas.`)}
    }catch(e){fail(e)}finally{end()}
  }
  const disabled=busy||externalBusy
  return <div>
    <div className="flex flex-wrap gap-2 mb-4"><input aria-label="Nome do ponto de restauração" disabled={disabled} maxLength={120} value={label} onChange={e=>setLabel(e.target.value)} placeholder="Nome do ponto de restauração" className="min-w-64 flex-1 bg-surface-base border border-border-subtle rounded px-3 py-2 text-sm"/><button disabled={disabled} onClick={()=>void save()} className="px-3 py-2 rounded bg-primary text-surface-base font-bold text-sm disabled:opacity-50">SALVAR PONTO</button></div>
    {error&&<p role="alert" className="text-armed-amber mb-3">{error}</p>}
    {!projects.length&&!error?<p className="text-sm">Nenhum ponto salvo para este canal.</p>:projects.map(project=><div key={project.id} className="flex justify-between gap-3 p-3 border-b border-border-subtle"><div>{project.label}<div className="text-xs text-outline">{new Date(project.createdAt).toLocaleString('pt-BR')}</div></div><button disabled={disabled||!canRestore} onClick={()=>void inspect(project.id)} className="text-armed-amber text-xs disabled:opacity-50">CONFERIR RESTAURAÇÃO</button></div>)}
    {review&&<><ProjectRestoreImpact review={review}/>{blocked&&<p className="text-armed-amber mt-2">Reabra a conferência antes de confirmar novamente.</p>}<div className="flex gap-3 mt-3"><button disabled={disabled||!canRestore} onClick={()=>void inspect(review.projectId)}>REABRIR CONFERÊNCIA</button><button disabled={disabled||blocked||!canRestore} onClick={()=>void restore()} className="text-armed-amber disabled:opacity-50">CONFIRMAR RESTAURAÇÃO</button></div></>}
  </div>
}
