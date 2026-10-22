import {it,expect} from 'vitest'
import {assertProgramTrim} from './program-trim.js'
import type {ItemView} from './plan.js'
const rate={num:25,den:1},hash='a'.repeat(64)
const entry=()=>({item:{},asset:{contentHash:hash,durationFrames:500,durationNs:null},trim:{in:25,out:150}} as ItemView)
const cut={in:25,out:100,contentHash:hash}
it('saved automatic crop is restored independently of nominal duration',()=>{
  expect(assertProgramTrim(entry(),cut,50,rate)).toEqual(cut)
})
it('rejects another media version and another mark-in',()=>{
  expect(()=>assertProgramTrim(entry(),{...cut,contentHash:'b'.repeat(64)},0,rate)).toThrow('versão da mídia')
  expect(()=>assertProgramTrim(entry(),{...cut,in:0},0,rate)).toThrow('início do corte')
})
it('rejects cursor at/past EOS without clamping back into the file',()=>{
  for(const frame of [75,76,-1,0.5])expect(()=>assertProgramTrim(entry(),cut,frame,rate)).toThrow('Cursor fora')
})
it('rejects bounds beyond file capacity or invalid hash',()=>{
  expect(()=>assertProgramTrim(entry(),{...cut,out:501},0,rate)).toThrow('quadros comprovados')
  expect(()=>assertProgramTrim(entry(),{...cut,contentHash:'invalid'},0,rate)).toThrow()
})
it('never reinterprets a file checkpoint as a live source',()=>{
  expect(()=>assertProgramTrim({...entry(),item:{...entry().item,sourceRef:'ndi:CAM'}},cut,0,rate)).toThrow('entrada ao vivo')
})
