import {useEffect,useRef,useState} from 'react'
import {fieldsUsedIn,type GraphicTemplate,type GraphicsReview} from '@rplayout/protocol'
import {api} from '../api.js'
import {BoundedLatestRead} from '../domain/bounded-latest-read.js'
import {graphicsHeaders} from '../domain/graphics-review.js'
import {ReviewedOperationConfirm} from './broadcast/ReviewedOperationConfirm.js'
type Draft=Pick<GraphicTemplate,'name'|'svg'|'fields'|'fadeMs'|'holdSeconds'>
const blank=():Draft=>({name:'',svg:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080"></svg>',fields:[],fadeMs:300,holdSeconds:null})
interface Props{channelId:string;onMutation:()=>void;onMessage:(value:string)=>void;onDirtyChange?:(value:boolean)=>void;onBusyChange?:(value:boolean)=>void;disabled?:boolean}
type Intent={kind:'LOAD'}|{kind:'CHOOSE';row:GraphicTemplate|null;review:GraphicsReview}|{kind:'SCOPE';scope:string|null}|{kind:'REMOVE';row:GraphicTemplate;review:GraphicsReview}
export function GraphicTemplatesEditor(props:Props){return <TemplatesEditor key={props.channelId} {...props}/>}
function TemplatesEditor({channelId,onMutation,onMessage,onDirtyChange,onBusyChange,disabled=false}:Props){
  const [scope,setScope]=useState<string|null>(channelId),[review,setReview]=useState<GraphicsReview|null>(null),[proof,setProof]=useState<GraphicsReview|null>(null)
  const [draft,setDraft]=useState<Draft>(blank),[editing,setEditing]=useState<string|null>(null),[dirty,setDirty]=useState(false),[busy,setBusy]=useState(false),[blocked,setBlocked]=useState(true),[error,setError]=useState('')
  const lock=useRef(false),generation=useRef(0),alive=useRef(true)
  const reads=useRef(new BoundedLatestRead()),[intent,setIntent]=useState<Intent|null>(null)
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;generation.current++;lock.current=false;reads.current.cancel();onBusyChange?.(false)}},[])
  useEffect(()=>{onDirtyChange?.(dirty)},[dirty,onDirtyChange])
  const occupied=busy||disabled||intent!==null
  const busyChange=(value:boolean)=>{setBusy(value);onBusyChange?.(value)}
  const load=async()=>{
    if(lock.current||disabled)return
    setIntent(null);lock.current=true;busyChange(true);setBlocked(true);const attempt=++generation.current
    try{const reading=await reads.current.read(signal=>api.graphicsReview(scope,signal),'A conferência das artes demorou demais. Rascunho preservado; nenhuma arte foi gravada.');if(!reading.current)return;const result=reading.value;graphicsHeaders(result,scope);if(alive.current&&generation.current===attempt){setReview(result);setProof(result);setDraft(blank());setEditing(null);setDirty(false);setBlocked(result.channelArchived);setError(result.channelArchived?'Canal arquivado: somente consulta.':'')}}
    catch(failure){if(alive.current&&generation.current===attempt)setError(failure instanceof Error?failure.message:'Não foi possível conferir as artes. A lista anterior foi preservada.')}
    finally{if(alive.current&&generation.current===attempt){lock.current=false;busyChange(false)}}
  }
  useEffect(()=>{void load();return()=>{reads.current.cancel();generation.current++;lock.current=false;busyChange(false)}},[scope])
  const chooseConfirmed=(row:GraphicTemplate|null,original:GraphicsReview)=>{
    if(review!==original){setError('A conferência mudou. Escolha a arte novamente.');return}
    setIntent(null);setEditing(row?.id??null);setDraft(row?{name:row.name,svg:row.svg,fields:row.fields,fadeMs:row.fadeMs,holdSeconds:row.holdSeconds}:blank());setProof(original);setDirty(false)
  }
  const choose=(row:GraphicTemplate|null)=>{
    if(lock.current||disabled||blocked||!review)return
    if(dirty)setIntent({kind:'CHOOSE',row,review});else chooseConfirmed(row,review)
  }
  const changeScope=(next:string|null)=>{
    setIntent(null);setBlocked(true);setReview(null);setProof(null);setDirty(false);setEditing(null);setDraft(blank());setScope(next)
  }
  const save=async(remove?:GraphicTemplate,original=review)=>{
    if(lock.current||disabled||blocked||!review||!proof||remove&&review!==original)return
    setIntent(null);lock.current=true;busyChange(true);const attempt=generation.current
    try{
      const result=remove?await api.removeGraphicTemplate(remove.id,scope,review):editing?await api.updateGraphicTemplate(editing,scope,draft,proof):await api.addGraphicTemplate(scope,draft,proof)
      if(!alive.current||attempt!==generation.current)return
      graphicsHeaders(result,scope)
      if(!result.applied)throw new Error('Gravação da arte não confirmada; confira antes de repetir.')
      setReview(result)
      if(!remove){setProof(result);setDraft(blank());setEditing(null);setDirty(false)}
      else if(!editing&&!dirty)setProof(result)
      setError(result.refreshError??'');if(result.refreshError)setBlocked(true)
      try{onMutation();onMessage(result.refreshError?'Arte gravada, mas atualização não confirmada. Reabra antes de outra ação.':'Arte gravada. Isso não coloca grafismo no ar.')}
      catch{setBlocked(true);setError('Arte gravada; atualização da tela indisponível. Não repita o comando; reabra a conferência.')}
    }catch(failure){if(alive.current&&attempt===generation.current){setBlocked(true);setError(failure instanceof Error?failure.message:'Falha; confira o estado antes de repetir.')}}
    finally{if(alive.current&&attempt===generation.current){lock.current=false;busyChange(false)}}
  }
  const stale=Boolean(review&&proof&&(review.revision!==proof.revision||review.sharedRevision!==proof.sharedRevision))
  const edit=(patch:Partial<Draft>)=>{setDraft(value=>({...value,...patch}));setDirty(true)}
  return <section aria-label="Edição conferida de artes">
    <h3>Cadastro de artes — não é disparo no ar</h3>
    <label>Escopo <select disabled={occupied} value={scope===null?'global':'channel'} onChange={event=>{const next=event.target.value==='global'?null:channelId;if(dirty)setIntent({kind:'SCOPE',scope:next});else changeScope(next)}}><option value="channel">Somente este canal</option><option value="global">Compartilhadas — edição exige acesso a todos os canais</option></select></label>
    <button className="btn" disabled={busy||disabled} onClick={()=>{if(dirty)setIntent({kind:'LOAD'});else void load()}}>Reabrir conferência das artes</button>
    {error&&<p role="alert">{error}</p>}
    {stale&&<p role="alert">A lista mudou; a revisão do rascunho foi preservada. Reabra ou inicie explicitamente outro rascunho.</p>}
    {!review&&<p>Artes ainda não conferidas. Falha de consulta não significa lista vazia.</p>}
    {review?.templates.filter(row=>row.channelId===scope).map(row=><div key={row.id}>{row.name} <button className="btn" disabled={busy||disabled||blocked} onClick={()=>choose(row)}>Editar</button> <button className="btn" disabled={busy||disabled||blocked} onClick={()=>setIntent({kind:'REMOVE',row,review})}>Excluir</button></div>)}
    <button className="btn" disabled={occupied||blocked} onClick={()=>choose(null)}>Nova arte</button>
    <fieldset disabled={occupied||blocked}>
      <label>Nome <input value={draft.name} onChange={event=>edit({name:event.target.value})}/></label>
      <label>SVG <textarea rows={10} value={draft.svg} onChange={event=>{const svg=event.target.value;edit({svg,fields:fieldsUsedIn(svg).map(key=>draft.fields.find(field=>field.key===key)??{key,label:key,defaultValue:''})})}}/></label>
      {draft.fields.map((field,index)=><div key={field.key}><span>{`{{${field.key}}}`}</span><label>Rótulo <input value={field.label} onChange={event=>edit({fields:draft.fields.map((entry,n)=>n===index?{...entry,label:event.target.value}:entry)})}/></label><label>Valor padrão <input value={field.defaultValue} onChange={event=>edit({fields:draft.fields.map((entry,n)=>n===index?{...entry,defaultValue:event.target.value}:entry)})}/></label></div>)}
      <label>Transição (ms) <input type="number" min={0} max={5000} value={draft.fadeMs} onChange={event=>edit({fadeMs:Number(event.target.value)})}/></label>
      <label>Retirada automática (segundos; vazio fica até retirar) <input type="number" min={1} max={3600} value={draft.holdSeconds??''} onChange={event=>edit({holdSeconds:event.target.value===''?null:Number(event.target.value)})}/></label>
    </fieldset>
    <p>O SVG é salvo como texto, sem executá-lo no navegador. Gravar não homologa sua renderização nem altera a playlist publicada.</p>
    <button className="btn primary" disabled={occupied||blocked||stale||!proof||!draft.name.trim()} onClick={()=>void save()}>{editing?'Salvar arte':'Criar arte'}</button>
    {intent&&<section aria-label="Confirmação da edição de artes">
      <ReviewedOperationConfirm reviewKey={JSON.stringify([scope,review?.revision,review?.sharedRevision,generation.current,intent.kind,intent.kind==='REMOVE'?intent.row.id:intent.kind==='CHOOSE'?intent.row?.id:intent.kind==='SCOPE'?intent.scope:null])}
        disabled={busy||disabled||intent.kind==='REMOVE'&&(blocked||review!==intent.review)}
        confirmation={intent.kind==='REMOVE'?`Autorizo excluir somente a arte "${intent.row.name}" conferida. Vínculos existentes impedem remoção; nada será disparado no ar.`:'Autorizo descartar somente o rascunho local de arte para iniciar a ação escolhida. Nenhuma arte será gravada.'}
        label={intent.kind==='REMOVE'?'Confirmar exclusão desta arte':intent.kind==='LOAD'?'Descartar arte local e reabrir':intent.kind==='SCOPE'?'Descartar arte local e trocar escopo':'Descartar arte local e trocar rascunho'}
        onConfirm={async()=>{if(intent.kind==='REMOVE')await save(intent.row,intent.review);else if(intent.kind==='LOAD')await load();else if(intent.kind==='SCOPE')changeScope(intent.scope);else chooseConfirmed(intent.row,intent.review)}}/>
      <button disabled={busy||disabled} onClick={()=>setIntent(null)}>Manter arte em edição</button>
    </section>}
  </section>
}
