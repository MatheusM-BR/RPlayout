/** Batch disjoint columns; preserve draw order if subpixel dots overlap. */
export function drawQcParade(ctx:Pick<CanvasRenderingContext2D,'fillStyle'|'fillRect'>,pixels:Uint8ClampedArray,colW:number,y0:number,hRange:number,dotSize:number){
  const colors=['rgba(255, 51, 75, 0.45)','rgba(0, 230, 118, 0.45)','rgba(56, 155, 255, 0.45)']
  // The last sampled x is158/160. Narrow canvases can make its dot cross
  // into the next column; alpha compositing then depends on original order.
  if(dotSize>colW/80){
    for(let sy=0;sy<90;sy+=2){for(let sx=0;sx<160;sx+=2){for(let channel=0;channel<3;channel++){
      ctx.fillStyle=colors[channel]!
      ctx.fillRect(channel*colW+(sx/160)*colW,y0-((pixels[(sy*160+sx)*4+channel]??0)/255)*hRange,dotSize,dotSize)
    }}}
    return
  }
  for(let channel=0;channel<3;channel++){
    ctx.fillStyle=colors[channel]!
    for(let sy=0;sy<90;sy+=2){for(let sx=0;sx<160;sx+=2){
      const value=pixels[(sy*160+sx)*4+channel]??0
      ctx.fillRect(channel*colW+(sx/160)*colW,y0-(value/255)*hRange,dotSize,dotSize)
    }}
  }
}
