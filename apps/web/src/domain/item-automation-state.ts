import type {ItemAutomationState} from '../api.js'
export function matchesAutomationOwner(state:ItemAutomationState,origin:{itemId:string;rundownId:string;channelId:string}):boolean {
  return state.itemId===origin.itemId&&state.rundownId===origin.rundownId&&state.channelId===origin.channelId&&Number.isSafeInteger(state.editorialRevision)&&state.editorialRevision>0
}
