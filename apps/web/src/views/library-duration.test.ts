import {expect,it} from 'vitest'
import {libraryFrames} from './MasterControlView.js'

it('MAM mostra a duração sondada (ns) na cadência do canal, não o campo legado zerado',()=>{
  // 12.012 s probed file, legacy durationFrames 0 (as every scanned file has).
  expect(libraryFrames({durationNs:12_012_000_000,durationFrames:0},{num:30000,den:1001})).toBe(360)
  expect(libraryFrames({durationNs:12_000_000_000,durationFrames:0},{num:25,den:1})).toBe(300)
  // Live/pseudo rows without a probe keep their own frame count.
  expect(libraryFrames({durationNs:null,durationFrames:26973},{num:30000,den:1001})).toBe(26973)
  expect(libraryFrames({durationFrames:42},{num:25,den:1})).toBe(42)
})
