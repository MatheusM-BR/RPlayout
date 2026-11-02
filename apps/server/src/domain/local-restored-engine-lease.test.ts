import {describe,it,expect,vi} from 'vitest'
import {LocalRestoredEngineLease,LocalRestoredEngineGenerations} from './local-restored-engine-lease.js'
import type {ExecutionLease} from './execution-ownership.js'
import type {DistributionOwnership} from './distribution-ownership.js'
import type {HostDistributionFence} from './host-distribution-fence.js'
const generation='12345678-1234-1234-1234-123456789abc'
function fixture(){
 let row={id:'run',sequence:4,spawning:false,enginePids:[42],engineTokens:{token:42} as Record<string,number>},admitted=true
 const host={assertOwned:vi.fn(),freshProof:vi.fn(async()=>{}),pinProcess:vi.fn(async(pid:number,token:string)=>({pid,token})),processBindings:vi.fn(async()=>[]),releaseProcess:vi.fn(async()=>{})}
 const lease=new LocalRestoredEngineLease({assertOwned:()=>row} as unknown as ExecutionLease,{assertOwned:()=>{}} as DistributionOwnership,host as unknown as HostDistributionFence,()=>42,()=>{if(!admitted)throw new Error('admission lost')})
 return {lease,host,setRow:(next:typeof row)=>{row=next},row,revoke:()=>{admitted=false}}
}
describe('local restored engine lease, without HA witness',()=>{
 it('new UUID on same process does not create a new generation',async()=>{
  const f=fixture()
  const pool=new LocalRestoredEngineGenerations({assertOwned:()=>f.row} as unknown as ExecutionLease,{assertOwned:()=>{}} as DistributionOwnership,f.host as unknown as HostDistributionFence,()=>42,()=>{})
  await pool.grant(generation,1)
  await expect(pool.grant('22345678-1234-1234-1234-123456789abc',1)).rejects.toThrow('mesmo processo')
  expect(f.host.pinProcess).toHaveBeenCalledTimes(1)
 })
 it('replacement waits for old process registration to be cleared before pinning',async()=>{
  const f=fixture();let pid=42,row=f.row
  const pool=new LocalRestoredEngineGenerations({assertOwned:()=>row} as unknown as ExecutionLease,{assertOwned:()=>{}} as DistributionOwnership,f.host as unknown as HostDistributionFence,()=>pid,()=>{})
  await pool.grant(generation,1);pid=43
  await expect(pool.grant('22345678-1234-1234-1234-123456789abc',1)).rejects.toThrow('ainda registrado')
  expect(f.host.pinProcess).toHaveBeenCalledTimes(1)
  row={...row,enginePids:[43],engineTokens:{token:43}}
  await expect(pool.grant('22345678-1234-1234-1234-123456789abc',1)).resolves.toEqual({term:4,ttlMs:5000})
  expect(f.host.releaseProcess).toHaveBeenCalledTimes(1);expect(f.host.pinProcess).toHaveBeenCalledTimes(2)
 })
 it('pins one process and grants real channel sequence with native TTL',async()=>{
  const f=fixture();expect(await f.lease.grant(generation,1)).toEqual({term:4,ttlMs:5000})
  await f.lease.grant(generation,2);expect(f.host.pinProcess).toHaveBeenCalledTimes(1);expect(f.host.processBindings).toHaveBeenCalledTimes(2)
 })
 it('replayed nonce revokes rather than renewing a deadline',async()=>{
  const f=fixture();await f.lease.grant(generation,1)
  await expect(f.lease.grant(generation,1)).rejects.toThrow('inválida')
  await expect(f.lease.grant(generation,2)).rejects.toThrow('revogada')
 })
 it('loss of admission during host proof refuses the grant',async()=>{
  const f=fixture();f.host.freshProof.mockImplementation(async()=>{f.revoke()})
  await expect(f.lease.grant(generation,1)).rejects.toThrow('admission lost')
  expect(f.host.pinProcess).not.toHaveBeenCalled()
 })
 it('ambiguous/missing process registration refuses before native pin',async()=>{
  const f=fixture();f.setRow({...f.row,enginePids:[]})
  await expect(f.lease.grant(generation,1)).rejects.toThrow('não é a geração')
  expect(f.host.pinProcess).not.toHaveBeenCalled()
 })
 it('cannot retire while old process remains registered',async()=>{
  const f=fixture();await f.lease.grant(generation,1)
  await expect(f.lease.retireAfterObservedExit()).rejects.toThrow('ainda registrado')
  f.setRow({...f.row,enginePids:[],engineTokens:{}})
  await f.lease.retireAfterObservedExit();expect(f.host.releaseProcess).toHaveBeenCalledTimes(1)
 })
})
