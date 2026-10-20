import {describe,it,expect} from 'vitest'
import {readPreviewFrame} from './preview-frame.js'
describe('PVW frame identity',()=>{
 const sample={itemId:'vt',decoderId:7,delivered:true,ageMs:10,pausedFile:true}
 it('accepts actual delivery for the acknowledged decoder',()=>expect(readPreviewFrame(sample,{itemId:'vt',decoderId:7})).toEqual(sample))
 it('rejects previous generation, other item and missing ACK identity',()=>{
  for(const binding of [{itemId:'vt',decoderId:6},{itemId:'other',decoderId:7},{itemId:'vt'},null])expect(readPreviewFrame(sample,binding)).toBeNull()
 })
 it('requires a valid age for delivered frames and explicit booleans',()=>{
  for(const change of [{ageMs:null},{ageMs:-1},{ageMs:NaN},{delivered:1},{pausedFile:undefined}])expect(readPreviewFrame({...sample,...change},{itemId:'vt',decoderId:7})).toBeNull()
 })
})
