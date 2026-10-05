import type {api} from '../api.js'
type Session=Awaited<ReturnType<typeof api.session>>
type State=Awaited<ReturnType<typeof api.state>>
type Snapshot=Awaited<ReturnType<typeof api.rundown>>

/** Session replacement cancels initialization. A late response must never
 * reinstall the previous user's operational view after login/revocation. */
export async function loadSessionOperation(options:{
  service:Pick<typeof api,'session'|'state'|'rundown'>
  refreshLibrary:()=>Promise<unknown>
  active:()=>boolean
  onSession:(session:Session)=>void
  onState:(state:State)=>void
  onSnapshot:(snapshot:Snapshot)=>void
  onEmpty:()=>void
  onError:(error:unknown)=>void
  onDone:()=>void
}) {
  try {
    const session=await options.service.session()
    if(!options.active())return
    options.onSession(session)
    if(session.required && !session.authenticated)return
    const [state]=await Promise.all([options.service.state(),options.refreshLibrary()])
    if(!options.active())return
    options.onState(state)
    const start=state.rundowns[0]
    if(start){
      const snapshot=await options.service.rundown(start.id)
      if(options.active())options.onSnapshot(snapshot)
    }else options.onEmpty()
  }catch(error){if(options.active())options.onError(error)}
  finally{if(options.active())options.onDone()}
}
