import {it,expect} from 'vitest'
import {compensationSelectionState} from './compensation-selection.js'
it('removed optional cannot be reviewed and stale selection is cleared',()=>{
  expect(compensationSelectionState('optional',false,false,false)).toEqual({value:'',canReview:false,showReview:false,clearSelection:true})
})
it('pending or uncertain commands retain their identity despite row removal',()=>{
  for(const [pending,operation] of [[true,false],[false,true],[true,true]] as const){
    const state=compensationSelectionState('optional',false,pending,operation)
    expect(state.clearSelection).toBe(false)
    expect(state.canReview).toBe(false)
    expect(state.showReview).toBe(false)
  }
})
it('only existing idle selections allow review',()=>{
  expect(compensationSelectionState('vt',true,false,false).canReview).toBe(true)
  expect(compensationSelectionState('',false,false,false).clearSelection).toBe(false)
  expect(compensationSelectionState('vt',true,true,false).canReview).toBe(false)
  expect(compensationSelectionState('vt',true,false,true).canReview).toBe(false)
})
