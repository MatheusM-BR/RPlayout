import {it,expect} from 'vitest'
import {drawQcParade} from './qc-parade-draw.js'
it('retains RGB values/coordinates with only three color assignments',()=>{
  const pixels=new Uint8ClampedArray(160*90*4)
  for(let n=0;n<pixels.length;n++)pixels[n]=n%256
  let color='',assignments=0
  const points:{color:string;xy:number[]}[]=[]
  const ctx={get fillStyle(){return color},set fillStyle(value:string|CanvasGradient|CanvasPattern){color=String(value);assignments++},fillRect:(...xy:number[])=>{points.push({color,xy})}}
  drawQcParade(ctx,pixels,100,90,80,1.2)
  expect(assignments).toBe(3);expect(points).toHaveLength(10800)
  for(let channel=0;channel<3;channel++){
    const actual=points.slice(channel*3600,(channel+1)*3600)
    let index=0
    for(let sy=0;sy<90;sy+=2){for(let sx=0;sx<160;sx+=2){
      expect(actual[index++]!.xy).toEqual([channel*100+sx/160*100,90-pixels[(sy*160+sx)*4+channel]!/255*80,1.2,1.2])
    }}
  }
})
it('preserves interleaved alpha-compositing order on narrow columns',()=>{
  const pixels=new Uint8ClampedArray(160*90*4),colors:string[]=[]
  let color=''
  const ctx={get fillStyle(){return color},set fillStyle(value:string|CanvasGradient|CanvasPattern){color=String(value)},fillRect:()=>{colors.push(color)}}
  drawQcParade(ctx,pixels,260/3,140,100,1.2)
  expect(colors).toHaveLength(10800)
  for(let index=0;index<colors.length;index+=3){
    expect(colors.slice(index,index+3)).toEqual(['rgba(255, 51, 75, 0.45)','rgba(0, 230, 118, 0.45)','rgba(56, 155, 255, 0.45)'])
  }
})
