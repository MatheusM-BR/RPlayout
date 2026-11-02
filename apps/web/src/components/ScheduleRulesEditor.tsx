import {useEffect,useRef,useState} from 'react'
import type {ScheduleRuleRecord,ScheduleRuleReview} from '@rplayout/protocol'
import {api} from '../api.js'
import {BoundedLatestRead} from '../domain/bounded-latest-read.js'
import {scheduleRuleHeaders,scheduleRulesReady} from '../domain/schedule-rule-review.js'
import {ReviewedOperationConfirm} from './broadcast/ReviewedOperationConfirm.js'
const days=['dom','seg','ter','qua','qui','sex','sáb']
const hhmm=(minute:number)=>`${String(Math.floor(minute/60)).padStart(2,'0')}:${String(minute%60).padStart(2,'0')}`
function minute(value:string){const m=/^(\d{1,2}):(\d{2})$/.exec(value.trim());if(!m||Number(m[2])>=60)return null;const n=Number(m[1])*60+Number(m[2]);return n<=1440?n:null}
const empty=()=>({name:'',from:'06:00',to:'12:00',weekdays:'0123456',categories:[] as string[],avoidHours:0})
interface Props {channelId:string;categories:string[];disabled:boolean;onReview:(review:ScheduleRuleReview)=>void;onReadyChange:(ready:boolean)=>void;onBusyChange:(busy:boolean)=>void}
/** Keep this mounted when switching AutoFill tabs; no silent re-opening of a draft. */
type Intent={kind:'REOPEN'}|{kind:'BEGIN';rule?:ScheduleRuleRecord;review:ScheduleRuleReview}|{kind:'REMOVE';rule:ScheduleRuleRecord;review:ScheduleRuleReview}
export function ScheduleRulesEditor(props:Props){return <RulesEditor key={props.channelId} {...props}/>}
function RulesEditor({channelId,categories,disabled,onReview,onReadyChange,onBusyChange}:Props){
  const [review,setReview]=useState<ScheduleRuleReview|null>(null),[proof,setProof]=useState<ScheduleRuleReview|null>(null)
  const [draft,setDraft]=useState(empty),[editingId,setEditingId]=useState<string|null>(null)
  const [blocked,setBlocked]=useState(true),[message,setMessage]=useState('Conferindo faixas do canal…'),[busy,setBusy]=useState(false)
  const mounted=useRef(true),generation=useRef(0),pending=useRef(false),dirty=useRef(false)
  const reads=useRef(new BoundedLatestRead()),[intent,setIntent]=useState<Intent|null>(null)
  const ready=scheduleRulesReady(review,proof,{blocked,busy,dirty:dirty.current,intent:intent!==null})
  useEffect(()=>{onReadyChange(ready)},[ready,onReadyChange])
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;generation.current++;pending.current=false;reads.current.cancel();onBusyChange(false);onReadyChange(false)}},[])
  function accept(value:ScheduleRuleReview){setReview(value);onReview(value)}
  async function load(){
    if(pending.current)return
    pending.current=true;setBusy(true);setIntent(null);setBlocked(true);onBusyChange(true);onReadyChange(false)
    const request=++generation.current
    try{
      const reading=await reads.current.read(signal=>api.rules(channelId,signal),'A conferência das faixas demorou demais. Rascunho preservado; nenhuma faixa foi gravada.')
      if(!mounted.current||request!==generation.current||!reading.current)return
      const value=reading.value;scheduleRuleHeaders(value,channelId)
      accept(value);setProof(value);setDraft(empty());setEditingId(null);dirty.current=false
      setBlocked(false);onReadyChange(true);setMessage('Faixas conferidas. Salvar é edição da pauta, sem publicar ou alterar PGM/PVW.')
    }catch(error){if(mounted.current&&request===generation.current){setBlocked(true);onReadyChange(false);setMessage(error instanceof Error?error.message:'Não foi possível conferir as faixas. Lista anterior preservada.')}}
    finally{if(mounted.current&&request===generation.current){pending.current=false;setBusy(false);onBusyChange(false)}}
  }
  useEffect(()=>{void load()},[channelId])
  async function reopen(){
    if(pending.current||disabled)return
    if(dirty.current)setIntent({kind:'REOPEN'});else await load()
  }
  function beginConfirmed(original:ScheduleRuleReview,rule?:ScheduleRuleRecord){
    if(review!==original){setMessage('A conferência mudou. Escolha a faixa novamente.');return}
    setIntent(null);setProof(original);setEditingId(rule?.id??null);setDraft(rule?{name:rule.name,from:hhmm(rule.startMinute),to:hhmm(rule.endMinute),weekdays:rule.weekdays,categories:[...rule.categories],avoidHours:rule.avoidHours}:empty());dirty.current=false
  }
  function begin(rule?:ScheduleRuleRecord){
    if(pending.current||disabled||blocked||!review)return
    if(dirty.current)setIntent({kind:'BEGIN',rule,review});else beginConfirmed(review,rule)
  }
  async function change(removeId?:string,removalProof=review){
    if(pending.current||disabled||blocked||!review||!proof)return
    if(removeId&&review!==removalProof||!removeId&&intent)return
    const original=removeId?removalProof!:proof,submitted={...draft},target=editingId,request=generation.current
    const from=minute(submitted.from),to=minute(submitted.to)
    if(!removeId&&(!submitted.name.trim()||from===null||from>=1440||to===null||to<=from||!submitted.weekdays)){
      setMessage('Informe nome, dias e horário válido. Para cruzar meia-noite, use duas faixas em seus respectivos dias.');return
    }
    setIntent(null);pending.current=true;setBusy(true);onBusyChange(true)
    try{
      const body={name:submitted.name.trim(),weekdays:submitted.weekdays,startMinute:from!,endMinute:to!,categories:submitted.categories,avoidHours:submitted.avoidHours}
      const value=removeId?await api.removeRule(removeId,channelId,original):target?await api.updateRule(target,channelId,body,original):await api.addRule(channelId,body,original)
      if(!mounted.current||request!==generation.current)return
      scheduleRuleHeaders(value,channelId)
      if(!value.applied)throw new Error('Gravação da faixa sem confirmação; confira antes de repetir.')
      setReview(value)
      // Removing another band refreshes the LIST, not proof of a draft already
      // being edited. Own save starts a new blank draft using its own commit.
      if(!removeId||!dirty.current&&target===null){setProof(value);setEditingId(null);setDraft(empty());dirty.current=false}
      setBlocked(Boolean(value.refreshError))
      setMessage(value.refreshError??(removeId?'Faixa removida. Edições já iniciadas conservam sua conferência original.':'Faixa gravada. Confira e publique a montagem para operação.'))
      try{onReview(value);onReadyChange(!value.refreshError&&!dirty.current)}catch{setBlocked(true);try{onReadyChange(false)}catch{}setMessage('Faixa gravada; atualização da tela indisponível. Confira antes de outra gravação.')}
    }catch(error){if(mounted.current&&request===generation.current){setBlocked(true);onReadyChange(false);setMessage(error instanceof Error?error.message:'Gravação não confirmada. Reabra antes de repetir; campos preservados.')}}
    finally{if(mounted.current&&request===generation.current){pending.current=false;setBusy(false);onBusyChange(false)}}
  }
  const locked=disabled||busy||blocked||!review||intent!==null
  const staleDraft=Boolean(proof&&review&&proof.revision!==review.revision)
  const input='rounded border border-border-subtle bg-surface-base px-2 py-1 text-xs'
  function edit(patch:Partial<ReturnType<typeof empty>>){dirty.current=true;setDraft(current=>({...current,...patch}))}
  return <section className="flex flex-col gap-3 rounded border border-border-subtle p-3">
    <div className="flex items-center justify-between gap-2"><strong className="text-xs">FAIXAS PROGRAMADAS DO CANAL</strong><button type="button" disabled={disabled||busy} onClick={()=>void reopen()} className="btn text-xs">Reabrir conferência das faixas</button></div>
    <p role={blocked?'alert':'status'} className="text-xs text-outline">{message}</p>
    {review&&review.rules.length===0&&<p className="text-xs text-outline">Sem faixas configuradas neste canal.</p>}
    {review?.rules.map(rule=><div key={rule.id} className="flex items-center justify-between gap-2 border-b border-border-subtle py-2 text-xs">
      <div><strong>{hhmm(rule.startMinute)} – {hhmm(rule.endMinute)} · {rule.name}</strong><p>{[...rule.weekdays].map(day=>days[Number(day)]).join(' ')} · {rule.categories.join(', ')||'Qualquer categoria'} · evitar {rule.avoidHours}h</p></div>
      <div className="flex gap-1"><button type="button" disabled={disabled||busy||blocked} onClick={()=>begin(rule)} className="btn">Editar</button><button type="button" disabled={disabled||busy||blocked} onClick={()=>setIntent({kind:'REMOVE',rule,review})} className="btn">Remover</button></div>
    </div>)}
    <fieldset disabled={locked} className="flex flex-col gap-2">
      {staleDraft&&<p role="alert" className="text-xs text-armed-amber">A lista mudou; este rascunho conserva a conferência anterior. Reabra explicitamente ou inicie uma nova faixa antes de salvar.</p>}
      <div className="flex justify-between"><strong className="text-xs">{editingId?'EDITANDO FAIXA':'NOVA FAIXA'}</strong><button type="button" onClick={()=>begin()} className="btn text-xs">Nova faixa / descartar rascunho</button></div>
      <div className="grid grid-cols-3 gap-2"><label className="text-xs">Nome<input value={draft.name} maxLength={200} onChange={event=>edit({name:event.target.value})} className={input+' w-full'}/></label><label className="text-xs">Das (hh:mm)<input value={draft.from} onChange={event=>edit({from:event.target.value})} className={input+' w-full'}/></label><label className="text-xs">Até (hh:mm)<input value={draft.to} onChange={event=>edit({to:event.target.value})} className={input+' w-full'}/></label></div>
      <div className="flex flex-wrap gap-1">{days.map((day,index)=><button key={day} type="button" aria-pressed={draft.weekdays.includes(String(index))} onClick={()=>edit({weekdays:draft.weekdays.includes(String(index))?draft.weekdays.replace(String(index),''):[...draft.weekdays,String(index)].sort().join('')})} className={'btn text-xs '+(draft.weekdays.includes(String(index))?'text-primary':'text-outline')}>{day}</button>)}</div>
      <div className="flex flex-wrap gap-1">{[...new Set([...categories,...draft.categories])].map(category=><button type="button" key={category} aria-pressed={draft.categories.includes(category)} onClick={()=>edit({categories:draft.categories.includes(category)?draft.categories.filter(value=>value!==category):[...draft.categories,category]})} className={'btn text-xs '+(draft.categories.includes(category)?'text-primary':'text-outline')}>{category}</button>)}</div>
      <label className="text-xs">Não repetir por (horas)<input type="number" min={0} max={240} value={draft.avoidHours} onChange={event=>edit({avoidHours:Number(event.target.value)})} className={input+' ml-2 w-20'}/></label>
      <button type="button" disabled={staleDraft} onClick={()=>void change()} className="btn text-xs">{editingId?'Salvar faixa':'Salvar nova faixa'}</button>
    </fieldset>
    {intent&&<section aria-label="Confirmação da edição de faixas">
      <ReviewedOperationConfirm reviewKey={JSON.stringify([channelId,review?.revision,generation.current,intent.kind,intent.kind==='REMOVE'?intent.rule.id:intent.kind==='BEGIN'?intent.rule?.id:null])}
        disabled={disabled||busy||intent.kind==='REMOVE'&&(blocked||review!==intent.review)}
        confirmation={intent.kind==='REMOVE'?`Autorizo remover somente a faixa "${intent.rule.name}" conferida. Publicações existentes e PGM/PVW não serão alterados.`:'Autorizo descartar somente a faixa local em edição para iniciar a ação escolhida. Nenhuma faixa será gravada.'}
        label={intent.kind==='REMOVE'?'Confirmar remoção desta faixa':intent.kind==='REOPEN'?'Descartar faixa local e reabrir':'Descartar faixa local e trocar rascunho'}
        onConfirm={async()=>{if(intent.kind==='REMOVE')await change(intent.rule.id,intent.review);else if(intent.kind==='REOPEN')await load();else beginConfirmed(intent.review,intent.rule)}}/>
      <button disabled={disabled||busy} onClick={()=>setIntent(null)}>Manter faixa em edição</button>
    </section>}
  </section>
}
