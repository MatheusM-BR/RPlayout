import {EventEmitter} from 'node:events'
import {PassThrough} from 'node:stream'
import {spawn} from 'node:child_process'
import {mkdtempSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import Fastify,{type FastifyInstance} from 'fastify'
import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest'
import {createApp,runtimeFor,type App} from '../app.js'
import {registerRoutes} from '../routes.js'
import {readExecutionOwner} from '../db/execution-ownership.js'
import {sessionDigest} from './access.js'
vi.mock('../config.js',async original=>({...await original<Record<string,unknown>>(),ENGINE_BINARY:'fake-native-engine',ENGINE_OUTPUTS:['null'],MEDIAMTX_BINARY:'',DEVICES_BINARY:'',AUTH_USER:'',AUTH_PASSWORD:'',DEFAULT_ROLE:'ADMIN'}))
vi.mock('node:child_process',async original=>({...await original<Record<string,unknown>>(),spawn:vi.fn()}))
vi.mock('./execution-host.js',()=>({executionHostIdentity:()=> 'fixture-host'}))
// Explicit broker fixture: tests here target the shared SQLite channel owner.
vi.mock('./host-distribution-fence.js',()=>({HostDistributionFence:class{acquire=async()=>true;assertOwned=()=>{};freshProof=async()=>{};close=()=>{};status=()=>({state:'READY',ownedHere:true,blocked:false})}}))
type Child=EventEmitter&{pid:number;stdin:PassThrough;stdout:PassThrough;stderr:PassThrough;kill:ReturnType<typeof vi.fn>}
let app:App,peer:App,server:FastifyInstance,children:Child[]
const status=()=>server.inject({url:'/api/channels/ch/execution-ownership'})
const saved=()=>Object.fromEntries(['execution_owner_slots','execution_owner_runs','execution_owner_asrun','channel_checkpoints','as_run','operator_decisions'].map(table=>[table,app.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]))
beforeEach(async()=>{
  children=[];vi.mocked(spawn).mockClear();vi.mocked(spawn).mockImplementation(()=>{
    const child=Object.assign(new EventEmitter(),{pid:900001+children.length,stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough(),kill:vi.fn()});children.push(child)
    queueMicrotask(()=>child.stdout.write(JSON.stringify({event:'ready',channelId:'ch'})+'\n'))
    return child as unknown as ReturnType<typeof spawn>
  })
  const file=join(mkdtempSync(join(tmpdir(),'RPlayout-owner-http-')),'fixture.db')
  app=await createApp(file)
  app.sqlite.exec("INSERT INTO channels(id,name,width,height,rate_num,rate_den,target_lufs,ceiling_dbtp,limiter_lookahead_ms,created_at) VALUES('ch','Fixture',320,180,25,1,-23,-1,5,'now')")
  peer=await createApp(file);server=Fastify();registerRoutes(peer,server,()=>{});await server.ready()
})
afterEach(async()=>{
  await server.close()
  // Fake ChildProcess events only. No OS process or physical output is used.
  for(const child of children)child.emit('exit',0,null)
  app.close();peer.close();vi.restoreAllMocks()
})
describe('admissão nativa compartilhada e diagnóstico HTTP privado',()=>{
  it('consulta sem runtime não cria lease, engine, cursor ou as-run',async()=>{
    const before=saved(),response=await status();expect(response.statusCode,response.body).toBe(200);expect(response.headers['cache-control']).toBe('private, no-store')
    expect(response.json()).toMatchObject({state:'UNCLAIMED',ownedHere:false,blocked:false,physicalOutputValidated:false,promotionReady:false});expect(saved()).toEqual(before);expect(spawn).not.toHaveBeenCalled()
  })
  it('duas Apps com o mesmo banco/PID não abrem dois engines; consulta não transfere posse',async()=>{
    const runtime=await runtimeFor(app,'ch');expect(runtime).not.toBeNull();expect(spawn).toHaveBeenCalledTimes(1)
    const owner=readExecutionOwner(app.sqlite,'ch')!,before=saved();expect(await runtimeFor(peer,'ch')).toBeNull()
    const response=await status();expect(response.statusCode).toBe(200);expect(response.json()).toMatchObject({state:'ACTIVE',ownedHere:false,ownerLocal:true,blocked:true})
    for(const secret of [owner.id,owner.boot,String(owner.pid),'enginePids','engineTokens','signature'])expect(response.body).not.toContain(secret)
    expect(saved()).toEqual(before);expect(spawn).toHaveBeenCalledTimes(1)
  })
  it.each(['cue','take','stop'])('instância estrangeira recebe conflito e não comando: %s',action=>{
    return runtimeFor(app,'ch').then(async()=>{
      const before=saved(),response=await server.inject({url:'/api/channels/ch/transport',method:'POST',payload:{action,sourceRef:'ndi:NOT_OPENED'}})
      // Global native admission now refuses before reaching channel dispatch.
      expect(response.statusCode,response.body).toBe(409);expect(response.json()).toMatchObject({distributionOwnershipBlocked:true});expect(response.body).not.toContain('NOT_OPENED');expect(spawn).toHaveBeenCalledTimes(1)
      // HTTP mutation audit may record the refusal; execution/cursor stay exact.
      const after=saved();delete before.operator_decisions;delete after.operator_decisions;expect(after).toEqual(before)
    })
  })
  it('consulta de registro adulterado devolve erro privado, sem abrir ou corrigir processo',async()=>{
    await runtimeFor(app,'ch');app.sqlite.exec("UPDATE execution_owner_runs SET signature='PRIVATE_CORRUPTED'");const before=saved(),response=await status()
    expect(response.statusCode).toBe(409);expect(response.headers['cache-control']).toBe('private, no-store');expect(response.body).not.toContain('PRIVATE');expect(saved()).toEqual(before);expect(spawn).toHaveBeenCalledTimes(1)
  })
  it('consulta respeita sessão, canal e estação; canal arquivado continua apenas consultável',async()=>{
    app.sqlite.exec("INSERT INTO users VALUES('admin','Admin','PRIVATE_HASH','ADMIN',1,'now'); INSERT INTO user_access(user_id,channel_ids,station_ips,updated_at) VALUES('admin','[]','[\"127.0.0.1\"]','now')")
    app.sqlite.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(sessionDigest('PRIVATE_ADMIN'),'admin','2099-01-01','now')
    const url='/api/channels/ch/execution-ownership',headers={cookie:'rplayout_session=PRIVATE_ADMIN'}
    expect((await server.inject({url})).statusCode).toBe(401);expect((await server.inject({url,headers})).statusCode).toBe(403)
    app.sqlite.exec("UPDATE user_access SET channel_ids='[\"ch\"]' WHERE user_id='admin'; UPDATE channels SET archived_at='now' WHERE id='ch'")
    expect((await server.inject({url,headers})).statusCode).toBe(200)
    expect((await server.inject({url,headers,remoteAddress:'192.0.2.1'})).statusCode).toBe(401)
    app.sqlite.exec('DELETE FROM sessions');expect((await server.inject({url,headers})).statusCode).toBe(401);expect(spawn).not.toHaveBeenCalled()
  })
})
