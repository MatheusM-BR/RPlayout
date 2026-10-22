import {describe,expect,it,vi} from 'vitest'
import type {MultiviewReview} from '@rplayout/protocol'
import {multiviewHeaders} from './multiview-review.js'
const review:MultiviewReview={id:null,channelId:'default',layout:'GRID_2X2',cells:[],updatedAt:null,revision:42,storedTelemetryIsHistorical:true,automaticTake:false,physicalSignalValidated:false}
describe('multiview confirma prova original sem renovação',()=>{
  it('distingue global/default e preserva exatamente a revisão',()=>{
    expect(multiviewHeaders(review,'default')).toEqual({'If-Match':'"multiview:C%3Adefault:42"'})
    expect(multiviewHeaders({...review,channelId:null},null)).toEqual({'If-Match':'"multiview:G:42"'})
  })
  it.each([null,{...review,channelId:'other'},{...review,revision:0},{...review,revision:NaN},{...review,revision:Number.MAX_SAFE_INTEGER+1}])('recusa prova não conferida sem GET implícito',value=>{
    const fetch=vi.spyOn(globalThis,'fetch')
    expect(()=>multiviewHeaders(value,'default')).toThrow();expect(fetch).not.toHaveBeenCalled();fetch.mockRestore()
  })
})
