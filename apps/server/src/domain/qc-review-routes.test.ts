import Fastify,{type FastifyInstance} from 'fastify'
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {createApp,runtimeFor,type App} from '../app.js'
import {registerRoutes} from '../routes.js'
import {qcAssetETag,DEFAULT_QC_PROFILE,qcDecisionETag} from '@rplayout/protocol'
import {qcRevision} from '../db/qc-revisions.js'
import {configurationRevision} from '../db/channel-configuration.js'
import {sessionDigest} from './access.js'
vi.mock('../config.js',async original=>({...await original<Record<string,unknown>>(),ENGINE_BINARY:'',MEDIAMTX_BINARY:'',DEVICES_BINARY:'',AUTH_USER:'',AUTH_PASSWORD:'',DEFAULT_ROLE:'ADMIN'}))
let app:App,server:FastifyInstance
beforeEach(async()=>{
  app=await createApp(':memory:')
  for(const id of ['ch','other'])app.sqlite.prepare("INSERT INTO channels(id,name,rate_num,rate_den,width,height,target_lufs,ceiling_dbtp,limiter_lookahead_ms,created_at) VALUES(?,?,25,1,320,180,-23,-1,5,'now')").run(id,id)
  app.sqlite.exec(`INSERT INTO media_assets(id,content_hash,path,title,kind,duration_frames,duration_ns,width,height,rate_num,rate_den,has_audio,interlace_mode,qc_status,created_at) VALUES('a','original','C:/ação.mp4','AÇÃO','VIDEO',250,10000000000,320,180,25,1,1,'progressive','PENDING','now');
    INSERT INTO rundowns(id,channel_id,name,planned_start,date,created_at,updated_at) VALUES('rd','ch','Grade',0,'2026-10-04','now','now');
    INSERT INTO rundown_items(id,rundown_id,sort_order,type,title,media_id,min_duration,anchor,on_overrun) VALUES('item','rd',0,'VT','VT','a',0,'{"kind":"FLOW"}','PUSH');`)
  server=Fastify();registerRoutes(app,server,()=>{});await server.ready();await app.sources.list();await (await runtimeFor(app,'ch'))!.load('rd')
})
afterEach(async()=>{vi.restoreAllMocks();await server.close();app.close()})
const read=(headers:Record<string,string>={})=>server.inject({url:'/api/assets/a/qc?channelId=ch',headers})
const write=(status='APPROVED',etag?:string,extra:Record<string,string>={})=>server.inject({method:'POST',url:'/api/assets/a/qc',headers:{...extra,...(etag?{'if-match':etag}:{})},payload:{channelId:'ch',contentHash:'original',status,notes:'Conferência'}})
const global=(etag?:string,extra:Record<string,string>={})=>server.inject({method:'PATCH',url:'/api/assets/a',headers:{...extra,...(etag?{'if-match':etag}:{})},payload:{ignored:true}})
const profile=(etag?:string,extra:Record<string,string>={})=>server.inject({method:'PUT',url:'/api/channels/ch/qc-profile',headers:{...extra,...(etag?{'if-match':etag}:{})},payload:{...DEFAULT_QC_PROFILE,requireAudio:true}})
const state=()=>({asset:app.sqlite.prepare("SELECT * FROM media_assets WHERE id='a'").get(),qc:app.sqlite.prepare('SELECT * FROM qc_decisions ORDER BY rowid').all(),assetRevision:qcRevision(app.db,'a'),channelRevision:configurationRevision(app.db,'ch'),editorial:app.concurrency.getRundownVersion('rd'),audit:app.sqlite.prepare("SELECT * FROM operator_decisions WHERE kind IN ('QC_DECISION','QC_GLOBAL_DECISION','QC_PROFILE_CHANGED') ORDER BY rowid").all()})
function login(){
  const token='qc-review-session'
  app.sqlite.exec("INSERT INTO users(id,username,password_hash,role,enabled,created_at) VALUES('user','qc','unused','SUPERVISOR',1,'now')")
  app.sqlite.prepare('INSERT INTO sessions(token,user_id,expires_at,created_at) VALUES(?,?,?,?)').run(sessionDigest(token),'user','2099-01-01','now')
  return {cookie:`rplayout_session=${token}`}
}
describe('aprovação/reprovação e perfil usam a conferência original',()=>{
  it('leitura entrega metadados/perfil/histórico e duas revisões no mesmo snapshot, sem escrita',async()=>{
    const before=state(),response=await read(),result=response.json()
    expect(response.statusCode).toBe(200);expect(response.headers.etag).toBe(qcDecisionETag(result.review));expect(result.review).toEqual({assetId:'a',channelId:'ch',contentHash:'original',assetRevision:before.assetRevision,configurationRevision:before.channelRevision})
    expect(response.headers['cache-control']).toBe('private, no-store');expect(state()).toEqual(before)
    const library=(await server.inject({url:'/api/library?channelId=ch'})).json().folders.flatMap((f:any)=>f.assets).find((a:any)=>a.id==='a')
    expect(library.qcRevision).toBe(result.review.assetRevision)
  })
  it.each([undefined,'*','W/"qc:a:1:ch:1"','"qc:a:0:ch:1"','"qc:a:01:ch:1"','"qc:a:9007199254740992:ch:1"','"qc:other:1:ch:1"','"qc:a:1:other:1"'])('recusa escrita cega ou prova inválida: %s',async etag=>{
    const before=state();expect((await write('APPROVED',etag)).statusCode).toBe(etag===undefined?428:400);expect(state()).toEqual(before)
  })
  it('duas decisões concorrentes resultam em um único vencedor e uma auditoria',async()=>{
    const before=state(),etag=(await read()).headers.etag!,results=await Promise.all([write('APPROVED',etag),write('BLOCKED',etag)])
    expect(results.map(r=>r.statusCode).sort()).toEqual([200,409]);const current=state()
    expect(current.qc).toHaveLength(1);expect(current.audit).toHaveLength(1);expect(current.assetRevision).toBe(before.assetRevision+1)
    expect(current.editorial).toBeGreaterThan(before.editorial)
  })
  it('mudança e retorno ao hash/perfil/metadata antigos não reutiliza a aprovação',async()=>{
    const etag=(await read()).headers.etag!
    app.sqlite.exec("UPDATE media_assets SET content_hash='new' WHERE id='a';UPDATE media_assets SET content_hash='original' WHERE id='a'")
    expect((await write('APPROVED',etag)).statusCode).toBe(409)
    const next=(await read()).headers.etag!
    app.sqlite.exec("UPDATE channels SET qc_profile='{}' WHERE id='ch';UPDATE channels SET qc_profile=NULL WHERE id='ch'")
    expect((await write('APPROVED',next)).statusCode).toBe(409)
    const latest=(await read()).headers.etag!
    app.sqlite.exec("UPDATE media_assets SET loudness_file='{}' WHERE id='a';UPDATE media_assets SET loudness_file=NULL WHERE id='a'")
    expect((await write('APPROVED',latest)).statusCode).toBe(409);expect(state().qc).toHaveLength(0)
  })
  it('decisão global invalida QC por canal e vice-versa; histórico inclui quarentena global',async()=>{
    const channel=(await read()).headers.etag!,all=qcAssetETag('a',qcRevision(app.db,'a'))
    expect((await global(all)).statusCode).toBe(200);expect((await write('APPROVED',channel)).statusCode).toBe(409)
    const fresh=await read();expect(fresh.json().decisions[0]).toMatchObject({channelId:'@all',status:'REJECTED'})
    const globalBefore=qcAssetETag('a',qcRevision(app.db,'a'))
    expect((await write('BLOCKED',fresh.headers.etag!)).statusCode).toBe(200);expect((await global(globalBefore)).statusCode).toBe(409)
    expect((await global()).statusCode).toBe(428)
  })
  it('perfil exige revisão própria e preserva a revisão nova contra duas edições',async()=>{
    const etag=(await server.inject({url:'/api/channels/ch/qc-profile'})).headers.etag!,before=state()
    expect((await profile()).statusCode).toBe(428);expect(state()).toEqual(before)
    const responses=await Promise.all([profile(etag),profile(etag)]);expect(responses.map(r=>r.statusCode).sort()).toEqual([200,409])
    expect(state().audit).toHaveLength(1)
    expect((await server.inject({url:'/api/channels/ch/qc-profile'})).json().profile.requireAudio).toBe(true)
  })
  it.each(['QC_DECISION','QC_GLOBAL_DECISION','QC_PROFILE_CHANGED'])('falha de auditoria reverte QC/perfil/quarentena e revisões: %s',async kind=>{
    const etag=(await read()).headers.etag!,config=(await server.inject({url:'/api/channels/ch/qc-profile'})).headers.etag!,all=qcAssetETag('a',qcRevision(app.db,'a'))
    app.sqlite.exec(`CREATE TRIGGER fail_qc_audit BEFORE INSERT ON operator_decisions WHEN NEW.kind='${kind}' BEGIN SELECT RAISE(ABORT,'QC audit rollback'); END`)
    const before=state(),response=await(kind==='QC_DECISION'?write('APPROVED',etag):kind==='QC_GLOBAL_DECISION'?global(all):profile(config))
    expect(response.statusCode,response.body).toBe(500);expect(state()).toEqual(before)
  })
  it('commit não é apresentado como rollback por falha posterior de refresh; transporte preservado',async()=>{
    const transport=app.runtimes.get('ch')!.transport,pgm=transport.state(),refresh=vi.spyOn(app.runtimes.get('ch')!,'refresh').mockRejectedValue(new Error('view failure'))
    const response=await write('APPROVED',(await read()).headers.etag!)
    expect(response.statusCode).toBe(200);expect(response.json()).toMatchObject({ok:true,refreshError:expect.stringContaining('QC gravado')})
    expect(state().qc).toHaveLength(1);expect(transport.state()).toEqual(pgm);expect(refresh).toHaveBeenCalled()
  })
  it.each(['session','channel','station','role'])('revalida acesso no commit mesmo após middleware: %s',async kind=>{
    const headers=login(),etag=(await read(headers)).headers.etag!,before=state(),original=app.db.transaction.bind(app.db)
    vi.spyOn(app.db,'transaction').mockImplementation(((callback:any,config:any)=>{
      if(config?.behavior==='immediate'){
        if(kind==='session')app.sqlite.exec('DELETE FROM sessions')
        if(kind==='role')app.sqlite.exec("UPDATE users SET role='OPERATOR' WHERE id='user'")
        if(kind==='channel'||kind==='station')app.sqlite.prepare('INSERT INTO user_access(user_id,channel_ids,station_ips,updated_at) VALUES(?,?,?,?)').run('user',kind==='channel'?JSON.stringify(['other']):null,kind==='station'?JSON.stringify(['192.0.2.1']):null,'now')
      }
      return original(callback,config)
    }) as typeof app.db.transaction)
    // OPERATOR can decide QC, but cannot change the supervisor's profile.
    const response=kind==='role'?await profile((await server.inject({url:'/api/channels/ch/qc-profile',headers})).headers.etag!,headers):await write('APPROVED',etag,headers)
    expect(response.statusCode,response.body).toBe(403);expect(state()).toEqual(before)
  })
  it('QC do canal continua acessível à conta restrita, quarentena global não',async()=>{
    const headers=login();app.sqlite.prepare('INSERT INTO user_access(user_id,channel_ids,station_ips,updated_at) VALUES(?,?,NULL,?)').run('user',JSON.stringify(['ch']),'now')
    const etag=(await read(headers)).headers.etag!
    expect((await write('BLOCKED',etag,headers)).statusCode).toBe(200)
    expect((await global(qcAssetETag('a',qcRevision(app.db,'a')),headers)).statusCode).toBe(403)
    expect((await server.inject({url:'/api/assets/a/qc?channelId=other',headers})).statusCode).toBe(403)
  })
})
