import {describe,it,expect} from 'vitest'
import {matchesProgramHoldReceipt,programHoldExpected} from './program-hold-receipt.js'
import {matchesProgramHoldRestoreReceipt,programHoldRestoreExpected} from './program-hold-receipt.js'
describe('native program hold receipt',()=>{
  it('restore requires explicit file trim and cursor, never defaulting missing cursor to zero',()=>{
    const item={itemId:'vt',path:'fixture.mkv',trimIn:25,trimOut:200,startOffsetFrames:61}
    expect(programHoldRestoreExpected({item})).toEqual({itemId:'vt',frames:61})
    for(const patch of [{source:'ndi:live'},{path:''},{startOffsetFrames:undefined},{startOffsetFrames:-1},{startOffsetFrames:175},{trimIn:200}])expect(()=>programHoldRestoreExpected({item:{...item,...patch}})).toThrow()
  })
  it('restore binds a positive new decoder receipt to exact request and cursor',()=>{
    const expected={itemId:'vt',frames:61},receipt={event:'programHold',id:25,itemId:'vt',decoderId:8,held:true,frames:61}
    expect(matchesProgramHoldRestoreReceipt(receipt,25,expected)).toBe(true)
    for(const patch of [{id:24},{frames:60},{held:false},{decoderId:0},{decoderId:8.5},{itemId:'next'}])expect(matchesProgramHoldRestoreReceipt({...receipt,...patch},25,expected)).toBe(false)
  })
  const expected={itemId:'vt',decoderId:7,on:true}
  const receipt={event:'programHold',id:24,itemId:'vt',decoderId:7,held:true,frames:36}
  it('requires explicit native binding',()=>{
    expect(programHoldExpected(expected)).toEqual(expected)
    for(const value of [{...expected,decoderId:undefined},{...expected,decoderId:0},{...expected,on:undefined},{...expected,itemId:''}])expect(()=>programHoldExpected(value)).toThrow()
  })
  it('only accepts the exact pending request',()=>{
    expect(matchesProgramHoldReceipt(receipt,24,expected)).toBe(true)
    for(const patch of [{id:25},{itemId:'next'},{decoderId:8},{held:false},{frames:-1},{frames:0.5},{frames:NaN},{frames:'36'}])expect(matchesProgramHoldReceipt({...receipt,...patch},24,expected)).toBe(false)
    expect(matchesProgramHoldReceipt(null,24,expected)).toBe(false)
  })
})
