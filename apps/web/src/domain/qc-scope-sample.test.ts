import {describe,expect,it} from 'vitest'
import {qcFrameProgress,qcLiveFrameRecent,qcScopePixels,qcStableMeasurements} from './qc-scope-sample.js'

describe('audio scope state identity',()=>{
  it('does not rerender unchanged inactive readings',()=>{
    const previous={peakL:-100,peakR:-100,phase:null,active:false}
    expect(qcStableMeasurements(previous,{...previous})).toBe(previous)
  })
  it('preserves changes in peaks, phase and activity',()=>{
    const previous={peakL:-20,peakR:-21,phase:0.8,active:true}
    for(const next of [{...previous,peakL:-3},{...previous,peakR:-4},{...previous,phase:0.2},{...previous,active:false}]){
      expect(qcStableMeasurements(previous,next)).toBe(next)
    }
  })
})

describe('QC live scope presentation freshness',()=>{
  it('reading retained pixels repeatedly cannot refresh a stalled frame',()=>{
    const first=qcFrameProgress(null,1,100)
    const retained=qcFrameProgress(first,1,2101)
    expect(retained).toBe(first)
    expect(qcLiveFrameRecent(retained,2101)).toBe(false)
  })
  it('tolerates short gaps and recovers on actual presentation progress',()=>{
    const first=qcFrameProgress(null,1,100)
    expect(qcLiveFrameRecent(first,2100)).toBe(true)
    const returned=qcFrameProgress(first,1.04,2200)
    expect(qcLiveFrameRecent(returned,2200)).toBe(true)
  })
  it('seeking or replacing a stream can restart its presentation clock',()=>{
    expect(qcFrameProgress({position:20,advancedAt:100},0,200)).toEqual({position:0,advancedAt:200})
  })
  it.each([NaN,Infinity,-1])('invalid positions cannot certify a frame (%s)',position=>{
    expect(qcFrameProgress(null,position,100)).toBeNull()
  })
  it('rejects invalid, reversed clocks and absent samples',()=>{
    expect(qcFrameProgress(null,1,NaN)).toBeNull()
    expect(qcLiveFrameRecent(null,100)).toBe(false)
    expect(qcLiveFrameRecent({position:1,advancedAt:200},100)).toBe(false)
    expect(qcLiveFrameRecent({position:1,advancedAt:200},NaN)).toBe(false)
  })
})

describe('QC scope sample identity',()=>{
  const previous=new Uint8ClampedArray([1,2,3,255]),current=new Uint8ClampedArray([4,5,6,255])
  it('does not carry an old file frame into a loading or failed JPEG',()=>{
    expect(qcScopePixels(false,true,null,previous)).toBeNull()
    expect(qcScopePixels(false,false,current,previous)).toBeNull()
  })
  it('keeps a successfully decoded paused file inspectable',()=>{
    expect(qcScopePixels(false,true,current,previous)).toBe(current)
  })
  it('bridges only valid live gaps and never a stale live signal',()=>{
    expect(qcScopePixels(true,true,null,previous)).toBe(previous)
    expect(qcScopePixels(true,false,null,previous)).toBeNull()
    expect(qcScopePixels(true,true,current,previous)).toBe(current)
  })
})
