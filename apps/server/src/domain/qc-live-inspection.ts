/** Per-viewer, source-bound leases. Closing one QC must not stop another QC. */
export class QcLiveInspection {
  private readonly viewers = new Map<string, {source:string;expires:number}>()
  private activeSource:string|null = null
  private queue:Promise<void> = Promise.resolve()
  private ticking:Promise<void>|null = null
  constructor(private readonly currentSource:()=>string|null,
    private readonly setMonitor:(source:string,on:boolean,authorize?:()=>void)=>Promise<void>,
    private readonly now:()=>number=Date.now, private readonly ttl=15_000) {}

  private serial<T>(operation:()=>Promise<T>):Promise<T> {
    const result=this.queue.then(operation)
    this.queue=result.then(()=>{},()=>{})
    return result
  }
  private prune():void {
    const current=this.currentSource(),now=this.now()
    for(const [id,viewer] of this.viewers) if(viewer.expires<=now || viewer.source!==current)this.viewers.delete(id)
    // A CUE change closes the native branch itself. Do not disable or open
    // the new preview in response to old HTTP requests.
    if(this.activeSource!==current)this.activeSource=null
  }
  watch(viewerId:string,source:string,watching:boolean,authorize:()=>void=()=>{}):Promise<void> {
    return this.serial(async()=>{
      authorize()
      this.prune()
      if(!watching){
        if(this.viewers.get(viewerId)?.source===source)this.viewers.delete(viewerId)
        if(this.activeSource && !this.viewers.size){
          const previous=this.activeSource;this.activeSource=null
          await this.setMonitor(previous,false)
        }
        return
      }
      if(!source || source!==this.currentSource())throw new Error('Selecione novamente a fonte: ela não é mais o preview ativo do QC.')
      if(!this.viewers.has(viewerId) && this.viewers.size>=16)throw new Error('Limite de inspeções em qualidade simultâneas atingido neste canal.')
      // Native ACK confirms only monitor activation, not decoded browser
      // playback. Every heartbeat renews the native, finite lease too.
      await this.setMonitor(source,true,authorize)
      if(source!==this.currentSource())throw new Error('O preview mudou durante a ativação da inspeção.')
      this.viewers.set(viewerId,{source,expires:this.now()+this.ttl})
      this.activeSource=source
    })
  }
  tick():Promise<void> {
    if(this.ticking)return this.ticking
    const task=this.serial(async()=>{
      this.prune()
      if(this.activeSource && !this.viewers.size){
        const previous=this.activeSource;this.activeSource=null
        await this.setMonitor(previous,false)
      }
    })
    this.ticking=task.finally(()=>{this.ticking=null})
    return this.ticking
  }
}
