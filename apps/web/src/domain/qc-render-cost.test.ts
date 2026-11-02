import {describe,it,expect} from 'vitest'
import {QcRenderCost} from './qc-render-cost.js'
describe('QC drawing cost',()=>{
  it('is unknown before valid measurements',()=>{
    const cost=new QcRenderCost();for(const value of [NaN,Infinity,-1])cost.add(value)
    expect(cost.snapshot()).toBeNull()
  })
  it('bounds retained samples and reports nearest-rank p95',()=>{
    const cost=new QcRenderCost();for(let n=0;n<200;n++)cost.add(n)
    expect(cost.snapshot()).toEqual({samples:120,p95Ms:193,maxMs:199})
  })
  it('starts unknown after changing the measured source',()=>{
    const cost=new QcRenderCost();cost.add(300);cost.reset()
    expect(cost.snapshot()).toBeNull()
    cost.add(2)
    expect(cost.snapshot()).toEqual({samples:1,p95Ms:2,maxMs:2})
  })
})
