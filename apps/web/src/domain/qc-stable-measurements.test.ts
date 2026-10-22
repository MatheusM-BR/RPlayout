import {describe,it,expect} from 'vitest'
import {qcStableMeasurements} from './qc-scope-sample.js'

describe('QC does not rerender unchanged displayed scope measurements',()=>{
  it('retains state identity across repeated equal samples',()=>{
    const original={minIre:0,maxIre:100,avgIre:50,clipping:false}
    let state=original
    for(let i=0;i<100;i++)state=qcStableMeasurements(state,{...original})
    expect(state).toBe(original)
  })
  it('never suppresses a new reading or changed alarm',()=>{
    const previous={maxSat:99,legalGamut:true}
    for(const next of [{maxSat:100,legalGamut:true},{maxSat:99,legalGamut:false}]){
      expect(qcStableMeasurements(previous,next)).toBe(next)
    }
  })
  it('initializes after clear and does not hide added measurements',()=>{
    const next={maxSat:0,legalGamut:true}
    expect(qcStableMeasurements(null,next)).toBe(next)
    const expanded={...next,clipping:false}
    expect(qcStableMeasurements<object>(next,expanded)).toBe(expanded)
  })
})
