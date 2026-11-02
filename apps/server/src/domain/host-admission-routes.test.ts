import {mkdtempSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {spawn} from 'node:child_process'
import Fastify from 'fastify'
import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest'
import {createApp,runtimeFor,syncDistribution,type App} from '../app.js'
import {registerRoutes} from '../routes.js'
import {writePrivateConfig} from './private-config-file.js'
const broker=vi.hoisted(()=>({admit:false,live:false}))
vi.mock('../config.js',async original=>({...await original<Record<string,unknown>>(),ENGINE_BINARY:'fake-engine',HOST_GUARD_BINARY:'explicit-fixture',MEDIAMTX_BINARY:'fake-media',RELAY_BINARY:'fake-relay',DEVICES_BINARY:'',AUTH_USER:'',AUTH_PASSWORD:'',DEFAULT_ROLE:'ADMIN'}))
vi.mock('node:child_process',async original=>({...await original<Record<string,unknown>>(),spawn:vi.fn()}))
vi.mock('./private-config-file.js',()=>({writePrivateConfig:vi.fn()}))
// Deliberate broker simulation at this unit boundary, never a production bypass.
vi.mock('./host-distribution-fence.js',()=>({HostDistributionFence:class{
  owned=broker.admit;acquire=vi.fn(async()=>this.owned);close=vi.fn(()=>{this.owned=false});freshProof=async()=>this.assertOwned();
  assertOwned(){if(!this.owned||!broker.live)throw new Error('Host denied')}
  status(){return{state:this.owned&&broker.live?'READY':'BUSY',ownedHere:this.owned&&broker.live,blocked:!this.owned||!broker.live}}
}}))
let apps:App[],servers:ReturnType<typeof Fastify>[]
const saved=(app:App)=>Object.fromEntries(['distribution_owner_runs','distribution_owner_slot','execution_owner_runs','channels','output_profiles','guest_keys','destinations'].map(table=>[table,app.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]))
async function fixture(){const directory=mkdtempSync(join(tmpdir(),'RPlayout-host-http-')),app=await createApp(join(directory,'fixture.db'));apps.push(app);app.sqlite.exec("INSERT INTO channels(id,name,rate_num,rate_den,width,height,target_lufs,ceiling_dbtp,limiter_lookahead_ms,created_at) VALUES('ch','Fixture',25,1,320,180,-23,-1,5,'now')");const server=Fastify();servers.push(server);registerRoutes(app,server,()=>{});await server.ready();return{app,server}}
beforeEach(()=>{apps=[];servers=[];broker.admit=false;broker.live=true;vi.mocked(spawn).mockClear();vi.mocked(writePrivateConfig).mockClear()})
afterEach(async()=>{for(const server of servers)await server.close();for(const app of apps)app.close()})
describe('admissão do computador precede efeitos em bancos distintos',()=>{
  it('host ocupado conserva banco/configuração/processos e diagnóstico não transfere posse',async()=>{
    const a=await fixture(),b=await fixture(),before=[saved(a.app),saved(b.app)]
    for(const {app,server}of[a,b]){
      await syncDistribution(app);expect(await runtimeFor(app,'ch')).toBeNull()
      const response=await server.inject({url:'/api/distribution/execution-ownership'});expect(response.json()).toMatchObject({blocked:true,ownedHere:false,hostDistributionBlocked:true,enabled:true});expect(response.headers['cache-control']).toBe('private, no-store')
      for(const token of['nonce','processPids','guardPid','processToken'])expect(response.body).not.toContain(token)
      for(const [url,payload]of[['/api/channels/ch/transport',{action:'take'}],['/api/channels/ch/guests',{label:'NOT_CREATED'}]] as const){const denied=await server.inject({url,method:'POST',payload});expect(denied.statusCode,denied.body).toBe(409);expect(denied.json().hostDistributionBlocked).toBe(true)}
    }
    expect([saved(a.app),saved(b.app)]).toEqual(before);expect(spawn).not.toHaveBeenCalled();expect(writePrivateConfig).not.toHaveBeenCalled()
  })
  it('perda de IPC não reutiliza posse SQLite já obtida nem libera reserva por prazo',async()=>{
    broker.admit=true;const {app,server}=await fixture();app.distributionOwnership.claim();const before=saved(app);broker.live=false
    expect(()=>app.distributionOwnership.claim()).toThrow('computador');expect(app.distributionOwnership.canSpawn('MEDIAMTX')).toBe(false)
    const response=await server.inject({url:'/api/channels/ch/guests',method:'POST',payload:{label:'NOT_CREATED'}});expect(response.statusCode).toBe(409);expect(response.json().hostDistributionBlocked).toBe(true)
    await syncDistribution(app);expect(await runtimeFor(app,'ch')).toBeNull();expect(saved(app)).toEqual(before);expect(spawn).not.toHaveBeenCalled();expect(writePrivateConfig).not.toHaveBeenCalled()
  })
})
