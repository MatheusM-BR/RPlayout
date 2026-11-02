import {describe,expect,it} from 'vitest'
import type {LiveSourceReview} from '@rplayout/protocol'
import {liveSourceHeaders} from './live-source-review.js'
const review={channelId:'a',revision:17,sources:[{id:'src',channelId:'a'}],automaticTake:false,physicalSignalValidated:false} as LiveSourceReview
describe('envio da revisão original de cadastro live',()=>{
  it('criação/edição usam a mesma revisão mostrada, sem fetch ou renovação',()=>{
    expect(liveSourceHeaders(review,'a')).toEqual({'If-Match':'"sources:a:17"'})
    expect(liveSourceHeaders(review,'a','src')).toEqual({'If-Match':'"sources:a:17"'})
    expect(review.revision).toBe(17)
  })
  it.each([null,{...review,revision:0},{...review,revision:NaN},{...review,channelId:'b'},{...review,revision:Number.MAX_SAFE_INTEGER+1}])('recusa conferência inválida: %s',value=>{
    expect(()=>liveSourceHeaders(value,'a','src')).toThrow()
  })
  it('entrada de outra lista ou dono divergente não recebe header de confirmação',()=>{
    expect(()=>liveSourceHeaders(review,'a','other')).toThrow()
    expect(()=>liveSourceHeaders({...review,sources:[{id:'src',channelId:'b'}] as LiveSourceReview['sources']},'a','src')).toThrow()
  })
})
