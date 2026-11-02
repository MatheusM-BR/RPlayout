import {describe,it,expect} from 'vitest'
import {containedMediaRect} from './contained-media.js'
import {usePlayoutStore} from '../stores/usePlayoutStore.js'

describe('safe areas occupy actual contained picture, never matte',()=>{
  it.each([[927.2,521.55],[823.2,463.05],[704.8,396.45]])('fractional %s×%s never rounds safe area beyond picture',(w,h)=>{
    for(const [mw,mh] of [[640,480],[360,640],[426,240]] as const){
      const rect=containedMediaRect(w,h,mw,mh)!
      expect(rect.left).toBeGreaterThanOrEqual(0);expect(rect.top).toBeGreaterThanOrEqual(0)
      expect(rect.left+rect.width).toBeLessThanOrEqual(w)
      expect(rect.top+rect.height).toBeLessThanOrEqual(h)
      expect(rect.width/rect.height).toBeCloseTo(mw/mh,10)
    }
  })
  it.each([
    [1600,900,1920,1080,{left:0,top:0,width:1600,height:900}],
    [1600,900,1440,1080,{left:200,top:0,width:1200,height:900}],
    [1000,1000,1920,1080,{left:0,top:218.75,width:1000,height:562.5}],
    [1600,900,1080,1920,{left:546.875,top:0,width:506.25,height:900}],
    [800,450,320,180,{left:0,top:0,width:800,height:450}],
  ])('container %ix%i, raster %ix%i',(w,h,mw,mh,expected)=>{
    expect(containedMediaRect(w,h,mw,mh)).toEqual(expected)
  })
  it.each([0,-1,NaN,Infinity])('invalid or absent raster %s does not invent safe geometry',invalid=>{
    expect(containedMediaRect(1600,900,invalid,1080)).toBeNull()
    expect(containedMediaRect(invalid,900,1920,1080)).toBeNull()
  })
  it('shared safe areas default off and toggle only explicitly',()=>{
    expect(usePlayoutStore.getState().safeAreasVisible).toBe(false)
    usePlayoutStore.getState().toggleSafeAreas()
    expect(usePlayoutStore.getState().safeAreasVisible).toBe(true)
    usePlayoutStore.getState().toggleSafeAreas()
    expect(usePlayoutStore.getState().safeAreasVisible).toBe(false)
  })
})
