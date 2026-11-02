import {ClientContext,clientContext,SupersededContextError} from './client-context.js'

function reason(detail: unknown, path: string, status: number): string {
  if(detail && typeof detail==='object'){
    const body=detail as {error?:unknown;message?:unknown},value=body.message ?? body.error
    if(typeof value==='string' && value.trim())return value
    if(value!==undefined)return JSON.stringify(value)
  }
  return `Falha em ${path} (HTTP ${status})`
}

export async function requestResult<T>(path:string,init?:RequestInit,options:{
  context?:ClientContext; fetcher?:typeof fetch; acceptedStatuses?:readonly number[]; unauthorized?:()=>void
}={}):Promise<{status:number;body:T}> {
  const context=options.context ?? clientContext,ticket=context.capture()
  const mutation=!['GET','HEAD','OPTIONS'].includes((init?.method ?? 'GET').toUpperCase())
  const headers=new Headers(init?.headers)
  if(init?.body && !headers.has('content-type'))headers.set('content-type','application/json')
  let dispatched=false
  try {
    context.assert(ticket)
    dispatched=true
    const response=await (options.fetcher ?? fetch)(path,{...init,headers})
    const body:unknown=response.status===204 ? null : await response.json().catch(error=>{
      if(response.ok)throw error
      return null
    })
    // Check after decoding too: reading the body can outlive a session change.
    if(!context.sessionCurrent(ticket))throw new SupersededContextError(mutation)
    if(response.status===401){
      if(options.unauthorized)options.unauthorized()
      else if(typeof window!=='undefined')window.dispatchEvent(new Event('rplayout-session-ended'))
    }
    context.assert(ticket,mutation)
    if(!response.ok && !options.acceptedStatuses?.includes(response.status))throw new Error(reason(body,path,response.status))
    context.mark(body,ticket)
    return {status:response.status,body:body as T}
  }catch(error){
    if(!context.current(ticket))throw new SupersededContextError(dispatched && mutation)
    throw error
  }
}
