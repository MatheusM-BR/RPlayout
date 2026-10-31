import assert from 'node:assert/strict'
import {test} from 'node:test'
import {graySequenceStatistics,assertMovingPublishedGray} from './lib/held-picture-evidence.js'

const frame=Buffer.from([0,0,255,255,0,0,255,255])
test('moving consecutive pictures qualify, not merely a nonzero cursor',()=>{
  const bytes=Buffer.concat(Array.from({length:26},(_,i)=>i%2?Buffer.from(frame).reverse():frame))
  const result=assertMovingPublishedGray(bytes,4,2)
  assert.equal(result.frames,26);assert.equal(result.movingTransitions,25)
})
test('unchanged nonuniform pictures fail moving proof',()=>{
  const bytes=Buffer.concat(Array(26).fill(frame))
  assert.equal(graySequenceStatistics(bytes,4,2).movingTransitions,0)
  assert.throws(()=>assertMovingPublishedGray(bytes,4,2),/motion/)
})
test('uniform flashing placeholders cannot qualify as moving program',()=>{
  assert.throws(()=>assertMovingPublishedGray(Buffer.concat(Array.from({length:26},(_,i)=>Buffer.alloc(8,i%2?255:0))),4,2),/placeholder/)
})
test('fewer than 25 frames cannot qualify',()=>{
  assert.throws(()=>assertMovingPublishedGray(Buffer.concat([frame,Buffer.from(frame).reverse()]),4,2),/one second/)
})
test('one changed picture cannot stand in for sustained motion',()=>{
  const bytes=Buffer.concat([...Array(25).fill(frame),Buffer.from(frame).reverse()])
  assert.throws(()=>assertMovingPublishedGray(bytes,4,2),/motion/)
})
test('partial frames, empty data and noninteger dimensions are rejected',()=>{
  for(const bytes of [Buffer.alloc(0),Buffer.alloc(8),Buffer.alloc(17)])assert.throws(()=>graySequenceStatistics(bytes,4,2),/Complete/)
  assert.throws(()=>graySequenceStatistics(Buffer.alloc(16),4,0))
  assert.throws(()=>graySequenceStatistics(Buffer.alloc(16),4,1.5))
})
test('unaligned widths are not silently treated as tightly packed pixels',()=>{
  assert.throws(()=>graySequenceStatistics(Buffer.alloc(48),3,2),/Aligned/)
})
