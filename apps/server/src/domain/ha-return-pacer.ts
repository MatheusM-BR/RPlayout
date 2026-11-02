/** Shared per sender. Counts conservative encrypted JSON wire bytes, not
 * just raw DB bytes. Queued reservations drain/cancel; no busy spin. */
export function returnWireCost(operation:unknown){return Math.ceil(Buffer.byteLength(JSON.stringify(operation),'utf8')*4/3)+2048}
export class HaReturnPacer{
  private serial:Promise<void>=Promise.resolve()
  private readonly abort=new AbortController()
  constructor(private readonly mbit:number){if(!Number.isFinite(mbit)||mbit<1||mbit>1000)throw new Error('Limite de rede reversa inválido.')}
  reserve(bytes:number){
    if(!Number.isSafeInteger(bytes)||bytes<=0)throw new Error('Custo de rede inválido.')
    const work=this.serial.then(async()=>{
      this.abort.signal.throwIfAborted()
      // Charge before sending: even the first block obeys the configured budget.
      const deadline=performance.now()+bytes*8/(this.mbit*1000)
      while(performance.now()<deadline){
        this.abort.signal.throwIfAborted()
        await new Promise<void>((resolve,reject)=>{
          const cancelled=()=>{clearTimeout(timer);reject(new Error('Tráfego reverso cancelado.'))}
          const timer=setTimeout(()=>{this.abort.signal.removeEventListener('abort',cancelled);resolve()},Math.min(1000,Math.max(1,deadline-performance.now())))
          this.abort.signal.addEventListener('abort',cancelled,{once:true})
          if(this.abort.signal.aborted){this.abort.signal.removeEventListener('abort',cancelled);cancelled()}
        })
      }
      this.abort.signal.throwIfAborted()
    })
    this.serial=work.catch(()=>{});return work
  }
  close(){this.abort.abort()}
}
