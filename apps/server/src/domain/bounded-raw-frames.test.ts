import {expect,it} from 'vitest'
import {BoundedRawFrames} from '../../../../scripts/lib/bounded-raw-frames.js'
it('recompõe limites de quadro independentes dos chunks e ignora quadro incompleto',()=>{
  const capture=new BoundedRawFrames(4)
  capture.push(Uint8Array.of(1,2));expect(capture.snapshot()).toBeNull()
  capture.push(Uint8Array.of(3,4,5,6,7));expect([...capture.snapshot()!]).toEqual([1,2,3,4])
  capture.push(Uint8Array.of(8,9));expect([...capture.snapshot()!]).toEqual([5,6,7,8])
  expect(capture.framesDecoded).toBe(2);expect(capture.decodedBytes).toBe(8)
})
it('snapshot é isolado e armazenamento retido não cresce com volume recebido',()=>{
  const capture=new BoundedRawFrames(4);capture.push(Uint8Array.of(10,11,12,13))
  const evidence=capture.snapshot()!;evidence[0]=0
  for(let i=0;i<10000;i++)capture.push(Uint8Array.of(20,21,22,23))
  expect([...capture.snapshot()!]).toEqual([20,21,22,23]);expect([...evidence]).toEqual([0,11,12,13])
  expect(capture.retainedPixelBytes).toBe(8);expect(capture.framesDecoded).toBe(10001)
})
it('recusa tamanhos não finitos, fracionários e ilimitados',()=>{
  for(const bytes of [0,-1,0.5,NaN,Infinity,9*1024*1024])expect(()=>new BoundedRawFrames(bytes)).toThrow()
})
