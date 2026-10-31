import {spawn} from 'node:child_process'
import {afterEach,beforeEach,it,expect,vi} from 'vitest'
import {createApp,runtimeFor,type App} from '../app.js'
// Real HostDistributionFence with an explicitly missing runtime. Native engine
// requested, MediaMTX absent: SDI-only operation must NOT bypass admission.
vi.mock('../config.js',async original=>({...await original<Record<string,unknown>>(),HOST_GUARD_BINARY:'',ENGINE_BINARY:'fake-native-engine',MEDIAMTX_BINARY:'',RELAY_BINARY:'',DEVICES_BINARY:'',PROBE_BINARY:'',PROXY_BINARY:'',AUDIO_ANALYSIS_BINARY:''}))
vi.mock('node:child_process',async original=>({...await original<Record<string,unknown>>(),spawn:vi.fn()}))
let app:App
beforeEach(async()=>{vi.mocked(spawn).mockClear();app=await createApp(':memory:');app.sqlite.exec("INSERT INTO channels(id,name,rate_num,rate_den,width,height,target_lufs,ceiling_dbtp,limiter_lookahead_ms,created_at) VALUES('ch','Fixture',25,1,320,180,-23,-1,5,'now')")})
afterEach(()=>app.close())
it('binário ausente recusa engine sem MediaMTX, sem proprietário simulado por modo de teste',async()=>{
  expect(app.hostFence?.status()).toMatchObject({state:'UNAVAILABLE',ownedHere:false,blocked:true})
  expect(app.distributionOwnership.status()).toMatchObject({hostDistributionBlocked:true,ownedHere:false,blocked:true})
  expect(await runtimeFor(app,'ch')).toBeNull();expect(()=>app.distributionOwnership.claim()).toThrow('computador')
  for(const table of['distribution_owner_runs','execution_owner_runs'])expect((app.sqlite.prepare(`SELECT COUNT(*) n FROM ${table}`).get() as {n:number}).n).toBe(0)
  expect(spawn).not.toHaveBeenCalled()
})
