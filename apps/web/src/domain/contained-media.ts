/** Match object-fit:contain. No safe geometry until actual media dimensions
 * exist; metadata guesses can describe a different proxy or live raster. */
export function containedMediaRect(width:number,height:number,mediaWidth:number,mediaHeight:number){
  if(![width,height,mediaWidth,mediaHeight].every(value=>Number.isFinite(value)&&value>0))return null
  const scale=Math.min(width/mediaWidth,height/mediaHeight)
  // Floating-point ratios must not put an edge outside the container.
  const contentWidth=Math.min(width,mediaWidth*scale),contentHeight=Math.min(height,mediaHeight*scale)
  return {left:(width-contentWidth)/2,top:(height-contentHeight)/2,width:contentWidth,height:contentHeight}
}
