import {it,expect} from 'vitest'
import {executionFromSnapshot} from './execution-snapshot.js'
it('explicit null keeps converted/unpublished editorial grade off execution',()=>{
  expect(executionFromSnapshot({view:{name:'editorial'},executionView:null})).toBeNull()
})
it('old server lacking execution field remains compatible',()=>{
  const view={name:'legacy'};expect(executionFromSnapshot({view})).toBe(view)
})
it('frozen publication wins over editorial edits',()=>{
  const executionView={name:'published'};expect(executionFromSnapshot({view:{name:'editorial'},executionView})).toBe(executionView)
})
