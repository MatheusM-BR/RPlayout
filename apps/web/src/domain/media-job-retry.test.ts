import {it,expect} from 'vitest'
import {retryMediaJobs} from './media-job-retry.js'
const jobs=[{id:'a',retryRequiresConfirmation:false},{id:'b',retryRequiresConfirmation:true}]
it('waits for every request, preserves confirmation and distinguishes partial results',async()=>{
  let finish!:(value:{ok:boolean})=>void
  const calls:unknown[]=[]
  let settled=false
  const result=retryMediaJobs(jobs,async(id,confirmed)=>{
    calls.push([id,confirmed])
    if(id==='a')throw new Error('Lost reply')
    return new Promise(resolve=>{finish=resolve})
  }).then(value=>{settled=true;return value})
  await Promise.resolve();await Promise.resolve()
  expect(settled).toBe(false)
  finish({ok:true})
  const value=await result
  expect(calls).toEqual([['a',false],['b',true]])
  expect(value.unresolved).toEqual([jobs[0]])
  expect(value.confirmed).toBe(1)
  expect(value.message).toContain('não comprova rejeição')
})
it('does not report ok:false as successful retry',async()=>{
  expect((await retryMediaJobs(jobs,async()=>({ok:false}))).confirmed).toBe(0)
})
it('reports complete success only after all replies',async()=>{
  const value=await retryMediaJobs(jobs,async()=>({ok:true}))
  expect(value.unresolved).toEqual([])
  expect(value.confirmed).toBe(2)
})
