import {afterEach,it,expect,vi} from 'vitest'
import {api} from '../api.js'
import {BoundedLatestRead} from './bounded-latest-read.js'
import {retryMediaJobs} from './media-job-retry.js'
afterEach(()=>vi.unstubAllGlobals())

it('cancelled workflow GET cannot abort recovery POST',async()=>{
  const requests:Array<{path:string;init:RequestInit}>=[]
  vi.stubGlobal('fetch',vi.fn(async(path:string,init:RequestInit={})=>{
    requests.push({path,init})
    if(path.includes('/workflow'))return new Promise<Response>((_,reject)=>{
      init.signal!.addEventListener('abort',()=>reject(new Error('Read aborted')),{once:true})
    })
    return new Response('{"ok":true}',{headers:{'content-type':'application/json'}})
  }))
  const reads=new BoundedLatestRead(),reading=reads.start()!
  const query=api.mediaWorkflow('ação/Ç','hash+id',reading.signal).catch(error=>String(error))
  reads.cancel()
  const result=await retryMediaJobs([{id:'job/Ç',retryRequiresConfirmation:true}],(id,confirmed)=>api.retryMediaJob(id,confirmed))
  expect(await query).toContain('Read aborted')
  expect(reading.isCurrent()).toBe(false)
  expect(requests[0]!.path).toContain('a%C3%A7%C3%A3o%2F%C3%87/workflow?hash=hash%2Bid')
  expect(requests[1]!.path).toContain('job%2F%C3%87/retry')
  expect(requests[1]!.init.method).toBe('POST')
  expect(requests[1]!.init.signal).toBeUndefined()
  expect(JSON.parse(String(requests[1]!.init.body))).toEqual({confirmedPreviousStopped:true})
  expect(result.confirmed).toBe(1)
})

it('HTTP partial failure stays unresolved without replaying confirmed work',async()=>{
  const calls:string[]=[]
  vi.stubGlobal('fetch',vi.fn(async(path:string)=>{
    calls.push(path)
    return new Response(path.includes('/failed/')?'{"error":"Owner still unknown"}':'{"ok":true}',{status:path.includes('/failed/')?409:200,headers:{'content-type':'application/json'}})
  }))
  const result=await retryMediaJobs([{id:'ready',retryRequiresConfirmation:false},{id:'failed',retryRequiresConfirmation:true}],(id,confirmed)=>api.retryMediaJob(id,confirmed))
  expect(result.confirmed).toBe(1)
  expect(result.unresolved.map(job=>job.id)).toEqual(['failed'])
  expect(calls).toHaveLength(2)
})
