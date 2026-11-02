/** Per-viewer, source-bound leases on the QC's OWN live decoder. The Master's
 * PVW is never touched: a CUE there no longer ends a QC inspection, and a QC
 * selection no longer replaces what the Master armed. One QC source per
 * channel; closing one QC window must not stop another QC on the same source. */
export class QcLiveInspection {
  private readonly viewers = new Map<string, {source:string;expires:number}>()
  private activeSource:string|null = null
  private queue:Promise<void> = Promise.resolve()
  private ticking:Promise<void>|null = null
  constructor(
    private readonly openSource:(source:string|null,authorize?:()=>void)=>Promise<void>,
    private readonly setMonitor:(source:string,on:boolean,authorize?:()=>void)=>Promise<void>,
    private readonly now:()=>number=Date.now, private readonly ttl=15_000) {}

  private serial<T>(operation:()=>Promise<T>):Promise<T> {
    const result=this.queue.then(operation)
    this.queue=result.then(()=>{},()=>{})
    return result
  }
  private prune():void {
    const now=this.now()
    for(const [id,viewer] of this.viewers) if(viewer.expires<=now || viewer.source!==this.activeSource)this.viewers.delete(id)
  }
  private async closeIfUnwatched():Promise<void> {
    if(!this.activeSource || this.viewers.size)return
    const previous=this.activeSource;this.activeSource=null
    try{await this.setMonitor(previous,false)}catch{/* decoder closes below */}
    await this.openSource(null)
  }
  watch(viewerId:string,source:string,watching:boolean,authorize:()=>void=()=>{}):Promise<void> {
    return this.serial(async()=>{
      authorize()
      this.prune()
      if(!watching){
        if(this.viewers.get(viewerId)?.source===source)this.viewers.delete(viewerId)
        await this.closeIfUnwatched()
        return
      }
      if(!source)throw new Error('Selecione uma entrada para inspecionar.')
      if(this.activeSource && this.activeSource!==source){
        // A window switching its own selection may move the decoder; another
        // operator's open inspection is not silently replaced.
        const others=[...this.viewers.entries()].filter(([id])=>id!==viewerId)
        if(others.length)throw new Error('Outro QC está inspecionando outra entrada deste canal. Aguarde ou use a mesma entrada.')
        this.viewers.delete(viewerId)
      }
      if(!this.viewers.has(viewerId) && this.viewers.size>=16)throw new Error('Limite de inspeções em qualidade simultâneas atingido neste canal.')
      if(this.activeSource!==source){
        this.activeSource=null
        await this.openSource(source,authorize)
        this.activeSource=source
      }
      // The lease exists while the decoder waits for its first frame, so a
      // slow source is not closed and reopened by every heartbeat.
      this.viewers.set(viewerId,{source,expires:this.now()+this.ttl})
      // Native ACK confirms only monitor activation, not decoded browser
      // playback. Every heartbeat renews the native, finite lease too.
      await this.setMonitor(source,true,authorize)
    })
  }
  /** Read-only: a QC is inspecting this channel's live source. */
  inspecting():{source:string;viewers:number}|null {
    const now=this.now()
    const viewers=[...this.viewers.values()].filter(viewer=>viewer.expires>now&&viewer.source===this.activeSource).length
    return this.activeSource&&viewers?{source:this.activeSource,viewers}:null
  }
  tick():Promise<void> {
    if(this.ticking)return this.ticking
    const task=this.serial(async()=>{
      this.prune()
      await this.closeIfUnwatched()
    })
    this.ticking=task.finally(()=>{this.ticking=null})
    return this.ticking
  }
}
