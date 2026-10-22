/** Per-draw-pass cache. Never reorder points or retain another canvas' state. */
export class QcVectorColor {
  private key=-1
  constructor(private ctx:Pick<CanvasRenderingContext2D,'fillStyle'>){}
  select(r:number,g:number,b:number){
    const red=Math.max(60,r),green=Math.max(100,g),blue=Math.max(120,b)
    const key=(red<<16)|(green<<8)|blue
    if(key===this.key)return
    this.key=key
    this.ctx.fillStyle=`rgba(${red}, ${green}, ${blue}, 0.65)`
  }
}
