import Fastify,{type FastifyInstance} from 'fastify'
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {createApp,type App,runtimeFor} from '../app.js'
import {registerRoutes} from '../routes.js'
import {sessionDigest} from './access.js'
import {rundownItems} from '../db/schema.js'
import {applyAssetRemoval,captureAssetRemovalAuthority,readAssetRemoval} from './asset-removal.js'
import {assetRemovalETag} from '@rplayout/protocol'
vi.mock('../config.js',async original=>({...await original<Record<string,unknown>>(),ENGINE_BINARY:'',MEDIAMTX_BINARY:'',DEVICES_BINARY:'',AUTH_USER:'',AUTH_PASSWORD:'',DEFAULT_ROLE:'ADMIN'}))
let app:App,server:FastifyInstance,changed:ReturnType<typeof vi.fn>
const id='asset:ç',path='/api/assets/'+encodeURIComponent(id),headers={cookie:'rplayout_session=PRIVATE_ADMIN'},body={assetIds:[id],removeEditorialUses:true}
beforeEach(async()=>{
  app=await createApp(':memory:');changed=vi.fn()
  app.sqlite.exec("INSERT INTO users VALUES('admin','Admin','PRIVATE_HASH','ADMIN',1,'now')")
  app.sqlite.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(sessionDigest('PRIVATE_ADMIN'),'admin','2099-01-01','now')
  app.sqlite.prepare('INSERT INTO media_assets(id,content_hash,path,title,kind,duration_frames,probe_error,created_at) VALUES(?,?,?,?,?,?,?,?)').run(id,'PRIVATE_HASH','C:/PRIVATE_ROOT/test.mp4','Título Çãó','VIDEO',250,'PRIVATE_PROBE_ERROR','now')
  app.sqlite.exec("INSERT INTO channels(id,name,width,height,rate_num,rate_den,target_lufs,ceiling_dbtp,limiter_lookahead_ms,created_at) VALUES('a','A',320,180,25,1,-23,-1,5,'now'); INSERT INTO rundowns(id,channel_id,name,date,planned_start,created_at,updated_at) VALUES('rd-a','a','Grade','2026-10-06',0,'now','now')")
  app.db.insert(rundownItems).values({id:'vt',rundownId:'rd-a',sortOrder:2,type:'VT',title:'VT',mediaId:id,minDuration:0,anchor:{kind:'FLOW'},onOverrun:'PUSH',locked:false,autoNext:false,loop:false}).run()
  server=Fastify();registerRoutes(app,server,changed);await server.ready()
})
afterEach(async()=>{await server.close();app.close();vi.restoreAllMocks()})
const read=()=>server.inject({url:path+'/removal-review',headers})
const state=()=>Object.fromEntries(['media_assets','rundown_items','asset_removal_versions','operator_decisions'].map(table=>[table,app.sqlite.prepare(`SELECT * FROM ${table}${table==='operator_decisions'?" WHERE kind<>'API_MUTATION'":''} ORDER BY rowid`).all()]))
describe('HTTP de remoção original, sem force ou comandos implícitos',()=>{
  it('consulta privada e estável sem efeitos ou segredos',async()=>{
    const before=state(),a=await read(),b=await read();expect(a.statusCode).toBe(200);expect(a.headers['cache-control']).toBe('private, no-store');expect(a.headers.etag).toBe(b.headers.etag);expect(JSON.stringify(a.json())).not.toContain('PRIVATE');expect(state()).toEqual(before);expect(changed).not.toHaveBeenCalled()
  })
  it('DELETE cego não altera acervo; force não contorna nem com prova válida',async()=>{
    const before=state();expect((await server.inject({url:path,method:'DELETE',headers,payload:body})).statusCode).toBe(428)
    const proof=(await read()).headers.etag as string
    expect((await server.inject({url:path+'?force=1',method:'DELETE',headers:{...headers,'if-match':proof},payload:body})).statusCode).toBe(400);expect(state()).toEqual(before)
  })
  it('prune cego não limpa e namespace REMOVE não autoriza PRUNE',async()=>{
    const proof=(await read()).headers.etag as string,before=state()
    for(const [extra,status]of [[{},428],[{'if-match':proof},400]] as const)expect((await server.inject({url:'/api/assets/prune',method:'POST',headers:{...headers,...extra},payload:body})).statusCode).toBe(status)
    expect(state()).toEqual(before)
  })
  it('dois DELETE têm só um commit auditado',async()=>{
    const proof=(await read()).headers.etag as string,responses=await Promise.all([1,2].map(()=>server.inject({url:path,method:'DELETE',headers:{...headers,'if-match':proof},payload:body})))
    expect(responses.map(row=>row.statusCode).sort()).toEqual([200,409]);expect(app.sqlite.prepare("SELECT count(*) n FROM operator_decisions WHERE kind='ASSET_REMOVAL_APPLIED'").get()).toEqual({n:1});expect(changed).toHaveBeenCalledTimes(1)
  })
  it('sessão revogada e escopo global restrito não removem',async()=>{
    const proof=(await read()).headers.etag as string;app.sqlite.exec("INSERT INTO user_access VALUES('admin','[\"a\"]',NULL,'now')")
    expect((await read()).statusCode).toBe(403)
    expect((await server.inject({url:path,method:'DELETE',headers:{...headers,'if-match':proof},payload:body})).statusCode).toBe(403)
    app.sqlite.exec('DELETE FROM sessions');expect((await server.inject({url:path,method:'DELETE',headers:{...headers,'if-match':proof},payload:body})).statusCode).toBe(401)
    expect(app.sqlite.prepare('SELECT ignored FROM media_assets WHERE id=?').get(id)).toEqual({ignored:0})
  })
  it('falha auditada reverte; falha pós-commit não finge rollback',async()=>{
    let proof=(await read()).headers.etag as string;const before=state()
    app.sqlite.exec("CREATE TRIGGER removal_audit_failure BEFORE INSERT ON operator_decisions WHEN NEW.kind='ASSET_REMOVAL_APPLIED' BEGIN SELECT RAISE(ABORT,'HTTP_REMOVAL_FIXTURE'); END")
    expect((await server.inject({url:path,method:'DELETE',headers:{...headers,'if-match':proof},payload:body})).statusCode).toBe(500);expect(state()).toEqual(before);expect(changed).not.toHaveBeenCalled()
    app.sqlite.exec('DROP TRIGGER removal_audit_failure');proof=(await read()).headers.etag as string;changed.mockImplementation(()=>{throw new Error('PUSH_FIXTURE')})
    const response=await server.inject({url:path,method:'DELETE',headers:{...headers,'if-match':proof},payload:body});expect(response.statusCode).toBe(200);expect(response.json()).toMatchObject({applied:true,refreshError:expect.stringContaining('gravada')})
  })
  async function playing(){
    for(const [itemId,sortOrder]of [['live',0],['next',1]] as const)app.db.insert(rundownItems).values({id:itemId,rundownId:'rd-a',sortOrder,type:'LIVE',title:'SIMULATED NOT PHYSICAL',sourceRef:'ndi:'+itemId,durationOverride:150000,minDuration:0,anchor:{kind:'FLOW'},onOverrun:'PUSH',locked:false,autoNext:false,loop:false}).run()
    const runtime=(await runtimeFor(app,'a'))!;await runtime.load('rd-a');runtime.transport.take('rd-a','live');runtime.transport.cue({kind:'SOURCE',source:'ndi:OTHER_PVW'});return runtime
  }
  it('remoção de VT futuro atualiza editorial sem TAKE/CUE/STOP ou mudança do PGM/PVW',async()=>{
    const runtime=await playing(),before=runtime.transport.state(),take=vi.spyOn(runtime.transport,'take'),cue=vi.spyOn(runtime.transport,'cue'),stop=vi.spyOn(runtime.transport,'stop'),proof=(await read()).headers.etag as string
    const result=await server.inject({url:path,method:'DELETE',headers:{...headers,'if-match':proof},payload:body});expect(result.statusCode).toBe(200)
    expect(runtime.view?.items.some(row=>row.item.id==='vt')).toBe(false)
    const after=runtime.transport.state();expect(after.playing).toBe(true);expect(after.onAir?.startedAt).toBe(before.onAir?.startedAt);expect(after.onAir?.itemId).toBe('live');expect(after.preview).toEqual(before.preview)
    expect(take).not.toHaveBeenCalled();expect(cue).not.toHaveBeenCalled();expect(stop).not.toHaveBeenCalled()
  })
  it('ASSET em PVW é protegido; ABA CUE invalida prova mesmo voltando ao preview anterior',async()=>{
    const runtime=await playing(),proof=(await read()).headers.etag as string
    runtime.transport.cue({kind:'ASSET',id});expect((await read()).json().assets[0].blockers.length).toBeGreaterThan(0)
    runtime.transport.cue({kind:'SOURCE',source:'ndi:OTHER_PVW'})
    expect((await server.inject({url:path,method:'DELETE',headers:{...headers,'if-match':proof},payload:body})).statusCode).toBe(409)
  })
  it('refresh iniciado antes do commit não reinstala item removido depois do await',async()=>{
    const runtime=await playing(),authority=captureAssetRemovalAuthority(app.db,{headers,ip:'127.0.0.1'}),review=readAssetRemoval(app,'REMOVE',id,authority)
    const pending=runtime.load('rd-a')
    applyAssetRemoval(app,'REMOVE',id,body,assetRemovalETag(review),authority)
    runtime.invalidateCatalogRemoval([id]);await pending
    expect(runtime.executionView?.items.some(row=>row.item.id==='vt')).toBe(false);expect(runtime.transport.state().onAir?.itemId).toBe('live')
  })
})
