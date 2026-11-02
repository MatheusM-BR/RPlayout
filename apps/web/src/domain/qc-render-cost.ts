/** Bounded local drawing timer. Not host CPU, decoder or network telemetry. */
export class QcRenderCost {
  private values:number[]=[]
  reset(){this.values.length=0}
  add(milliseconds:number){
    if(!Number.isFinite(milliseconds)||milliseconds<0)return
    if(this.values.length===120)this.values.shift()
    this.values.push(milliseconds)
  }
  snapshot(){
    if(!this.values.length)return null
    const sorted=[...this.values].sort((a,b)=>a-b)
    return {samples:sorted.length,p95Ms:Math.round(sorted[Math.ceil(sorted.length*0.95)-1]!*10)/10,maxMs:Math.round(sorted.at(-1)!*10)/10}
  }
}
