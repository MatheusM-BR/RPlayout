import {it,expect} from 'vitest'
import {readNativeProgramAdmissionCursor as read} from './native-program-admission.js'
// NOT_RUN: contract fixtures only, not native/physical evidence.
const trim={in:10,out:510,contentHash:'ab'.repeat(32)}
const expected={itemId:'vt',minimumElapsed:73,trim}
const proof={elapsed:80,firstVideoConfirmed:true,trim:{in:10,out:510}}
it('paused admission requires explicit native flag and exact file cursor; normal admission rejects HELD',()=>{
  const held={...proof,paused:true},request={...expected,minimumElapsed:80,paused:true}
  expect(read(held,request)).toEqual(held)
  expect(()=>read(held,expected)).toThrow('Modo pausado')
  expect(()=>read(proof,request)).toThrow('Modo pausado')
  expect(()=>read({...held,elapsed:81},request)).toThrow('cursor exato')
  expect(()=>read(held,{...request,trim:null})).toThrow('arquivo/corte')
})
it('accepts exact native file position/trim without attributing SHA hashing to decoder',()=>{
  expect(read(proof,expected)).toEqual(proof)
})
it.each([undefined,null,{...proof,firstVideoConfirmed:false},{...proof,elapsed:72},{...proof,elapsed:500},
  {...proof,elapsed:NaN},{...proof,elapsed:80.5},{...proof,trim:null},{...proof,trim:{in:11,out:510}},
  {...proof,trim:{in:10,out:511}},{...proof,trim:{in:10,out:10}},
  {...proof,trim:{in:10,out:510,contentHash:trim.contentHash}},{...proof,callerNativeConfirmed:true}])('refuses missing/legacy/incorrect native cursor %#',value=>{
  expect(()=>read(value,expected)).toThrow()
})
it('live requires native video and resumed offset, but no file cut',()=>{
  const live={itemId:'live',minimumElapsed:73,trim:null}
  expect(read({elapsed:80,firstVideoConfirmed:true,trim:null},live).elapsed).toBe(80)
  expect(()=>read(proof,live)).toThrow()
})
it('idle can only acknowledge an empty cursor, not unexpected video/material',()=>{
  const idle={itemId:null,minimumElapsed:0,trim:null}
  expect(read({elapsed:0,firstVideoConfirmed:false,trim:null},idle).elapsed).toBe(0)
  for(const cursor of [proof,{elapsed:1,firstVideoConfirmed:false,trim:null},{elapsed:0,firstVideoConfirmed:true,trim:null}])expect(()=>read(cursor,idle)).toThrow()
})
