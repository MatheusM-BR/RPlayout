import {expect,it} from 'vitest'
import {liveOnlyInsertion} from './live-take-publication.js'
const base={added:['novo'],removed:[],changed:[{itemId:'a',fields:['order']},{itemId:'b',fields:['order']}]}
it('publica sozinho só quando a única mudança pendente é a entrada inserida',()=>{
  expect(liveOnlyInsertion(base,'novo')).toBe(true)
  expect(liveOnlyInsertion({...base,added:['novo','outro']},'novo')).toBe(false)
  expect(liveOnlyInsertion({...base,removed:['x']},'novo')).toBe(false)
  expect(liveOnlyInsertion({...base,changed:[{itemId:'a',fields:['order','title']}]},'novo')).toBe(false)
  expect(liveOnlyInsertion({...base,graphicsChanged:['a']},'novo')).toBe(false)
  expect(liveOnlyInsertion({...base,timingPolicyChanged:true},'novo')).toBe(false)
  expect(liveOnlyInsertion(base,'outro')).toBe(false)
})
