import {it,expect} from 'vitest'
import {matchesAutomationOwner} from './item-automation-state.js'
import type {ItemAutomationState} from '../api.js'
it('estado editorial aceito mantém proprietário e versão válidos',()=>{
  const origin={itemId:'item',rundownId:'rd',channelId:'ch'},state={...origin,editorialRevision:43} as ItemAutomationState
  expect(matchesAutomationOwner(state,origin)).toBe(true)
  for(const change of [{itemId:'other'},{rundownId:'other'},{channelId:'other'},{editorialRevision:0},{editorialRevision:NaN},{editorialRevision:undefined}])expect(matchesAutomationOwner({...state,...change} as ItemAutomationState,origin)).toBe(false)
})
