import {useEffect,useState} from 'react'
import type {EditScope,EditScopeReview} from '@rplayout/protocol'
import {api} from '../api.js'
import {reviewedScopeReady,wideEditScope} from '../domain/edit-scope-review.js'

interface State {key:string;loading:boolean;review:EditScopeReview|null;error:string|null;acknowledged:boolean}
/** Old scope/session responses never arm the new selection. Refresh reviews
 * only the targets; it keeps the source form's original If-Match unchanged. */
export function useEditScopeReview(itemId:string,revision:number|undefined,scope:EditScope){
  const key=JSON.stringify([itemId,revision,scope])
  const [retry,setRetry]=useState(0)
  const [state,setState]=useState<State>({key:'',loading:false,review:null,error:null,acknowledged:false})
  useEffect(()=>{
    let active=true
    if(!wideEditScope(scope)){setState({key,loading:false,review:null,error:null,acknowledged:false});return}
    setState({key,loading:true,review:null,error:null,acknowledged:false})
    void Promise.resolve().then(()=>api.editScope(itemId,scope,revision)).then(({review})=>{
      if(active)setState({key,loading:false,review,error:null,acknowledged:false})
    }).catch(error=>{if(active)setState({key,loading:false,review:null,error:error instanceof Error?error.message:'Não foi possível revisar os alvos.',acknowledged:false})})
    return()=>{active=false}
  },[key,itemId,scope,revision,retry])
  const current=state.key===key?state:{key,loading:wideEditScope(scope),review:null,error:null,acknowledged:false}
  return {...current,wide:wideEditScope(scope),ready:reviewedScopeReady(current.review,itemId,revision,scope,current.acknowledged),
    refresh:()=>{setState({key,loading:true,review:null,error:null,acknowledged:false});setRetry(value=>value+1)},acknowledge:(acknowledged:boolean)=>setState(value=>value.key===key?{...value,acknowledged}:value)}
}
export function EditScopeReviewPanel({state}:{state:ReturnType<typeof useEditScopeReview>}){
  if(!state.wide)return null
  return <div className="note warn">
    <strong>Revisão dos canais e dias afetados</strong>
    {state.loading && <p role="status">Conferindo os alvos…</p>}
    {state.error && <p role="alert">{state.error} Se a origem mudou, reabra a edição pela grade atual. Seus valores não foram gravados.</p>}
    {state.review && <>
      <p>{state.review.assetUpdated?`O padrão da mídia será alterado e este item voltará a herdar. ${state.review.references} ocorrência(s) usam essa mídia; overrides das outras linhas permanecem.`:`${state.review.itemsAffected} item(ns) terão o valor substituído.`}</p>
      <ul>{state.review.owners.map(owner=><li key={owner.rundownId}>{owner.channelName} · {owner.date.split('-').reverse().join('/')} · {owner.rundownName} · {owner.count} ocorrência(s)</li>)}</ul>
      <label className="check"><input type="checkbox" checked={state.acknowledged} onChange={event=>state.acknowledge(event.target.checked)}/> Conferi os canais e dias acima</label>
    </>}
    <button type="button" className="btn small" disabled={state.loading} onClick={state.refresh}>Conferir alvos novamente</button>
    <p>Se algum alvo mudar, a confirmação será recusada. A revisão não publica a grade nem altera o PGM.</p>
  </div>
}
