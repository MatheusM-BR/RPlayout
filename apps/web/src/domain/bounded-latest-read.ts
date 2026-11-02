/** Only one current read group. Superseded reads are aborted; their completion
 * must not replace a newer response. This never wraps mutation requests. */
export class BoundedLatestRead {
  private active:ReturnType<BoundedLatestRead['create']>|null=null
  constructor(private readonly deadlineMs=10000){}
  private create(){
    const controller=new AbortController();let timedOut=false
    const timer=setTimeout(()=>{timedOut=true;controller.abort()},this.deadlineMs)
    return {controller,timer,timedOut:()=>timedOut}
  }
  start(replace=true){
    if(this.active&&!replace)return null
    this.cancel()
    const entry=this.create();this.active=entry
    return {signal:entry.controller.signal,timedOut:entry.timedOut,isCurrent:()=>this.active===entry,
      finish:()=>{clearTimeout(entry.timer);if(this.active===entry)this.active=null}}
  }
  cancel(){if(this.active){clearTimeout(this.active.timer);this.active.controller.abort();this.active=null}}
  /** GET-only work: cancellation never targets mutations. A deadline also
   * settles the UI when a transport ignores AbortSignal; a late result cannot
   * replace a superseding read or publish an unmounted component's state. */
  async read<T>(work:(signal:AbortSignal)=>Promise<T>,timeoutMessage:string,replace=true):Promise<{current:true;value:T}|{current:false}>{
    const reading=this.start(replace)
    if(!reading)return {current:false}
    let interrupted:()=>void=()=>{}
    const cancellation=new Promise<never>((_,reject)=>{
      interrupted=()=>reject(new DOMException('Consulta cancelada.','AbortError'))
      reading.signal.addEventListener('abort',interrupted,{once:true})
    })
    try{
      const value=await Promise.race([work(reading.signal),cancellation])
      return reading.isCurrent()?{current:true,value}:{current:false}
    }catch(cause){
      if(!reading.isCurrent())return {current:false}
      const timedOut=reading.timedOut()
      this.cancel() // Drain sibling GETs if one member of a read group failed.
      if(timedOut)throw new Error(timeoutMessage)
      throw cause
    }finally{reading.signal.removeEventListener('abort',interrupted);reading.finish()}
  }
}

export function incidentHistoryWindow(anchor:string|null,cursor?:{until:string;beforeAt:string;beforeId:string}){
  return cursor??(anchor?{until:anchor}:undefined)
}
