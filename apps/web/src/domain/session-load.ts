import type {api} from '../api.js'
import {BoundedLatestRead} from './bounded-latest-read.js'
type Session=Awaited<ReturnType<typeof api.session>>
type State=Awaited<ReturnType<typeof api.state>>
type Snapshot=Awaited<ReturnType<typeof api.rundown>>

/** Session replacement cancels initialization. A late response must never
 * reinstall the previous user's operational view after login/revocation. */
export async function loadSessionOperation(options:{
  service:Pick<typeof api,'session'|'state'|'rundown'>
  refreshLibrary:()=>Promise<unknown>
  signal?:AbortSignal
  active:()=>boolean
  onSession:(session:Session)=>void
  onState:(state:State)=>void
  onSnapshot:(snapshot:Snapshot)=>void
  onEmpty:()=>void
  onError:(error:unknown)=>void
  onLibraryError?:(error:unknown)=>void
  onDone:()=>void
}) {
  const reads=new BoundedLatestRead(),cancel=()=>reads.cancel()
  const active=()=>options.active()&&!options.signal?.aborted
  if(!active())return
  options.signal?.addEventListener('abort',cancel,{once:true})
  let operationalReady=false
  try {
    await reads.read(async signal=>{
      const current=()=>active()&&!signal.aborted
      const session=await options.service.session(signal)
      if(!current())return
      options.onSession(session)
      if(session.required&&!session.authenticated)return
      const state=await options.service.state(signal)
      if(!current())return
      options.onState(state)
      const start=state.rundowns[0]
      if(start){
        const snapshot=await options.service.rundown(start.id,signal)
        if(!current())return
        options.onSnapshot(snapshot)
      }else options.onEmpty()
      operationalReady=true
    },'A consulta inicial demorou demais. Nenhum comando de playout foi enviado; tente carregar novamente.')
  }catch(error){if(active())options.onError(error)}
  finally{options.signal?.removeEventListener('abort',cancel);reads.cancel();if(active())options.onDone()}
  // Library metadata is not the operational snapshot. A slow folder/category
  // must not hold PGM/PVW controls hostage or erase the loaded channel.
  if(operationalReady&&active()){
    try{await options.refreshLibrary()}
    catch(error){if(active())options.onLibraryError?.(error)}
  }
}
