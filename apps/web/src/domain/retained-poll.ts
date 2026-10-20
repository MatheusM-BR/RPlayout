import {JoinedRead} from './joined-read.js'
import {SupersededContextError} from './client-context.js'

export interface RetainedPollState<T>{value:T|null;pending:boolean;error:string|null}
/** One context, GET only. Retain the last good value on failure, never turn an
 * unknown/failed read into an authoritative empty collection. Closing fences
 * late transports too; instances must not be shared across channel/session. */
export class RetainedPoll<T>{
  private readonly reads:JoinedRead<void>
  private current:RetainedPollState<T>={value:null,pending:false,error:null}
  private flight:Promise<void>|null=null
  private closed=false
  constructor(private readonly publish:(state:RetainedPollState<T>)=>void,private readonly failureMessage:string,deadlineMs=10000){this.reads=new JoinedRead(deadlineMs)}
  refresh(load:(signal:AbortSignal)=>Promise<T>):Promise<void>{
    if(this.closed)return Promise.resolve()
    if(this.flight)return this.flight
    this.current={...this.current,pending:true};this.publish(this.current)
    const flight=this.reads.run('poll',load,value=>{
      if(this.closed)return
      this.current={value,pending:false,error:null};this.publish(this.current)
    },this.failureMessage).catch(error=>{
      if(this.closed||error instanceof SupersededContextError)return
      this.current={...this.current,pending:false,error:this.failureMessage};this.publish(this.current)
    }).finally(()=>{if(this.flight===flight)this.flight=null})
    this.flight=flight;return flight
  }
  close(){this.closed=true;this.reads.cancel()}
}
