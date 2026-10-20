import {it,expect} from 'vitest'
import {QcVectorColor} from './qc-vector-color.js'
it('keeps colors/order while skipping consecutive equivalent styles',()=>{
  const applied:string[]=[]
  const ctx={get fillStyle(){return applied.at(-1)??''},set fillStyle(value:string|CanvasGradient|CanvasPattern){applied.push(String(value))}}
  const color=new QcVectorColor(ctx)
  color.select(0,0,0);color.select(1,1,1);color.select(255,0,0);color.select(0,0,0)
  expect(applied).toEqual(['rgba(60, 100, 120, 0.65)','rgba(255, 100, 120, 0.65)','rgba(60, 100, 120, 0.65)'])
  new QcVectorColor(ctx).select(0,0,0)
  expect(applied).toHaveLength(4)
})
