import {BoundedLatestRead} from './bounded-latest-read.js'
import {SupersededContextError} from './client-context.js'

/** Readers of the same context share one GET group and one publication.
 * Changing the key cancels that group, never a mutation. Commit runs only
 * after the bounded reader accepted the result, not inside a late loader. */
export class JoinedRead<R>{
  private active:{key:string;promise:Promise<R>}|null=null
  private readonly reads:BoundedLatestRead
  constructor(deadlineMs=10000){this.reads=new BoundedLatestRead(deadlineMs)}
  run<T>(key:string,load:(signal:AbortSignal)=>Promise<T>,commit:(value:T)=>R,timeoutMessage:string):Promise<R>{
    if(this.active?.key===key)return this.active.promise
    let entry:{key:string;promise:Promise<R>}
    const promise=this.reads.read(load,timeoutMessage).then(result=>{
      if(!result.current||this.active!==entry)throw new SupersededContextError()
      return commit(result.value)
    }).finally(()=>{if(this.active===entry)this.active=null})
    entry={key,promise};this.active=entry
    return promise
  }
  cancel(){this.reads.cancel();this.active=null}
}
