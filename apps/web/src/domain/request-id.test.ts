import {afterEach,expect,it,vi} from 'vitest'
import {commandRequestId} from './request-id.js'
afterEach(()=>vi.unstubAllGlobals())
it('gera UUID v4 em estação HTTP sem randomUUID usando entropia do navegador',()=>{
  vi.stubGlobal('crypto',{getRandomValues:(bytes:Uint8Array)=>{bytes.fill(0xab);return bytes}})
  expect(commandRequestId()).toBe('abababab-abab-4bab-abab-abababababab')
})
