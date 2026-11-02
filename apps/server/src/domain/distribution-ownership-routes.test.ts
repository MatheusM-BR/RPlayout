import {mkdtempSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {spawn} from 'node:child_process'
import Fastify,{type FastifyInstance} from 'fastify'
import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest'
import {createApp,runtimeFor,syncDistribution,type App} from '../app.js'
import {registerRoutes} from '../routes.js'
import {writePrivateConfig} from './private-config-file.js'
vi.mock('../config.js',async original=>({...await original<Record<string,unknown>>(),ENGINE_BINARY:'fake-engine',MEDIAMTX_BINARY:'fake-media',RELAY_BINARY:'fake-relay',DEVICES_BINARY:'',AUTH_USER:'',AUTH_PASSWORD:'',DEFAULT_ROLE:'ADMIN'}))
vi.mock('node:child_process',async original=>({...await original<Record<string,unknown>>(),spawn:vi.fn()}))
vi.mock('./private-config-file.js',()=>({writePrivateConfig:vi.fn()}))
// Explicit broker fixture. Native Windows admission is verified separately.
vi.mock('./host-distribution-fence.js',()=>({HostDistributionFence:class{acquire=async()=>true;assertOwned=()=>{};freshProof=async()=>{};close=()=>{};status=()=>({state:'READY',ownedHere:true,blocked:false})}}))
let app:App,peer:App,server:FastifyInstance
const state=()=>Object.fromEntries(['distribution_owner_runs','distribution_owner_slot','execution_owner_runs','execution_owner_slots','channels','destinations','guest_keys','output_profiles','channel_checkpoints','as_run'].map(table=>[table,app.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]))
beforeEach(async()=>{
  vi.mocked(spawn).mockClear();vi.mocked(writePrivateConfig).mockClear()
  const file=join(mkdtempSync(join(tmpdir(),'RPlayout-global-http-')),'fixture.db');app=await createApp(file)
  app.sqlite.exec("INSERT INTO channels(id,name,rate_num,rate_den,width,height,target_lufs,ceiling_dbtp,limiter_lookahead_ms,created_at) VALUES('ch','Fixture',25,1,320,180,-23,-1,5,'now')")
  peer=await createApp(file);server=Fastify();registerRoutes(peer,server,()=>{});await server.ready()
})
afterEach(async()=>{await server.close();app.close();peer.close()})
describe('controle global não é posse de um único canal',()=>{
  it('GET privado sem IDs, escrita ou processos, com declaração física explícita',async()=>{
    const before=state(),response=await server.inject({url:'/api/distribution/execution-ownership'});expect(response.statusCode,response.body).toBe(200);expect(response.headers['cache-control']).toBe('private, no-store');expect(response.json()).toMatchObject({state:'UNCLAIMED',ownedHere:false,blocked:false,enabled:true,physicalOutputValidated:false,promotionReady:false});expect(state()).toEqual(before);expect(spawn).not.toHaveBeenCalled()
  })
  it('startup de peer preserva config/relays/perfis e não abre engine em canal livre',async()=>{
    app.distributionOwnership.claim();const before=state();await syncDistribution(peer)
    expect(await runtimeFor(peer,'ch')).toBeNull();expect(peer.mediamtx!.lastError).toContain('Outra instância');expect(state()).toEqual(before);expect(spawn).not.toHaveBeenCalled();expect(writePrivateConfig).not.toHaveBeenCalled()
  })
  it.each([
    ['POST','/api/channels/ch/destinations',{name:'NOT_CREATED',url:'srt://127.0.0.1:9999'}],
    ['POST','/api/channels/ch/guests',{label:'NOT_CREATED'}],
    ['PATCH','/api/channels/ch',{name:'NOT_CHANGED'}],
    ['DELETE','/api/channels/ch',{}],
    ['POST','/api/channels/ch/outputs',{name:'NOT_CREATED',kind:'SRT'}],
    ['POST','/api/channels/ch/transport',{action:'cue',sourceRef:'ndi:NOT_OPENED'}],
  ] as const)('peer recusa %s %s antes de dados/arquivo/processo',async(method,url,payload)=>{
    app.distributionOwnership.claim();const before=state(),response=await server.inject({method,url,payload})
    expect(response.statusCode,response.body).toBe(409);expect(response.json().distributionOwnershipBlocked).toBe(true);expect(state()).toEqual(before);expect(spawn).not.toHaveBeenCalled();expect(writePrivateConfig).not.toHaveBeenCalled()
  })
  it('consulta de peer não revela boot/run/signature e papel operador não ganha controle',async()=>{
    const id=app.distributionOwnership.claim(),before=state(),response=await server.inject({url:'/api/distribution/execution-ownership'})
    expect(response.json()).toMatchObject({blocked:true,ownedHere:false});for(const secret of[id,app.distributionOwnership.identity.boot,'signature','children'])expect(response.body).not.toContain(secret)
    expect((await server.inject({url:'/api/distribution/execution-ownership',headers:{'x-rplayout-role':'OPERATOR'}})).statusCode).toBe(403)
    expect(state()).toEqual(before);expect(spawn).not.toHaveBeenCalled()
  })
  it('expõe falha nativa limitada apenas na consulta autorizada, sem adquirir ou alterar reserva',async()=>{
    const nativeQueryFailure={reason:'PORT_OWNERSHIP_UNAVAILABLE',operation:'ports',observedAt:'2026-10-18T00:00:00Z'}
    vi.spyOn(peer.hostFence!,'status').mockReturnValue({state:'READY',ownedHere:true,blocked:false,nativeQueryFailure} as any)
    const before=state(),response=await server.inject({url:'/api/distribution/execution-ownership'})
    expect(response.statusCode).toBe(200);expect(response.json().nativeQueryFailure).toEqual(nativeQueryFailure)
    expect(response.headers['cache-control']).toBe('private, no-store')
    const denied=await server.inject({url:'/api/distribution/execution-ownership',headers:{'x-rplayout-role':'OPERATOR'}})
    expect(denied.statusCode).toBe(403);expect(denied.body).not.toContain('PORT_OWNERSHIP_UNAVAILABLE');expect(state()).toEqual(before);expect(spawn).not.toHaveBeenCalled()
  })
})
