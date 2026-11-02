import Fastify,{type FastifyInstance} from 'fastify'
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {createApp,type App,runtimeFor} from '../app.js'
import {registerRoutes} from '../routes.js'
import {sessionDigest} from './access.js'
import {rundownItems} from '../db/schema.js'
vi.mock('../config.js',async original=>({...await original<Record<string,unknown>>(),ENGINE_BINARY:'',MEDIAMTX_BINARY:'',DEVICES_BINARY:'',AUTH_USER:'',AUTH_PASSWORD:'',DEFAULT_ROLE:'ADMIN'}))
let app:App,server:FastifyInstance,changed:ReturnType<typeof vi.fn>
const id='asset:ç',path='/api/assets/'+encodeURIComponent(id),headers={cookie:'rplayout_session=PRIVATE_ADMIN'}
beforeEach(async()=>{
  app=await createApp(':memory:');changed=vi.fn()
  app.sqlite.exec("INSERT INTO users VALUES('admin','Admin','PRIVATE_HASH','ADMIN',1,'now')")
  app.sqlite.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(sessionDigest('PRIVATE_ADMIN'),'admin','2099-01-01','now')
  app.sqlite.prepare('INSERT INTO media_assets(id,content_hash,path,title,kind,duration_frames,qc_status,created_at) VALUES(?,?,?,?,?,?,?,?)').run(id,'PRIVATE_HASH','C:/PRIVATE_ROOT/test.mp4','Título Çãó','VIDEO',250,'BLOCKED','now')
  app.sqlite.exec("INSERT INTO channels(id,name,width,height,rate_num,rate_den,target_lufs,ceiling_dbtp,limiter_lookahead_ms,created_at) VALUES('a','A',320,180,25,1,-23,-1,5,'now'); INSERT INTO rundowns(id,channel_id,name,date,planned_start,created_at,updated_at) VALUES('rd-a','a','Grade','2026-10-05',0,'now','now')")
  app.sqlite.prepare("INSERT INTO rundown_items(id,rundown_id,sort_order,type,title,media_id,min_duration,anchor,on_overrun,locked,auto_next,loop) VALUES('vt','rd-a',0,'VT','Título da grade',?,0,'{\"kind\":\"FLOW\"}','PUSH',0,0,0)").run(id)
  server=Fastify();registerRoutes(app,server,changed);await server.ready()
})
afterEach(async()=>{await server.close();app.close();vi.restoreAllMocks()})
const read=()=>server.inject({url:path+'/metadata-review',headers})
const state=()=>Object.fromEntries(['media_assets','qc_review_versions','qc_decisions','rundown_items','editorial_revision_counters','operator_decisions'].map(table=>[table,app.sqlite.prepare(`SELECT * FROM ${table}${table==='operator_decisions'?" WHERE kind<>'API_MUTATION'":''} ORDER BY rowid`).all()]))
describe('HTTP metadata exige prova e não comanda transporte',()=>{
  it('snapshot Unicode privado/estável sem caminho/hash/QC e sem mutação',async()=>{
    const before=state(),original=await read(),next=await read();expect(original.statusCode).toBe(200);expect(original.headers['cache-control']).toBe('private, no-store');expect(next.headers.etag).toBe(original.headers.etag);expect(next.json()).toEqual(original.json());expect(state()).toEqual(before);expect(JSON.stringify(original.json())).not.toContain('PRIVATE');expect(changed).not.toHaveBeenCalled()
  })
  it.each(['/metadata',''])('endpoint %s não permite edição cega; original é consumida uma vez',async suffix=>{
    const before=state();expect((await server.inject({url:path+suffix,method:'PATCH',headers,payload:{title:'Blind'}})).statusCode).toBe(428);expect(state()).toEqual(before)
    const proof=(await read()).headers.etag as string
    expect((await server.inject({url:path+suffix,method:'PATCH',headers:{...headers,'if-match':proof},payload:{title:'Novo título',categoryId:'AÇÃO'}})).statusCode).toBe(200)
    const after=state();expect((await server.inject({url:path+suffix,method:'PATCH',headers:{...headers,'if-match':proof},payload:{title:'Old'}})).statusCode).toBe(409);expect(state()).toEqual(after)
    expect(app.sqlite.prepare("SELECT title FROM rundown_items WHERE id='vt'").get()).toEqual({title:'Título da grade'});expect(app.sqlite.prepare('SELECT * FROM qc_decisions').all()).toEqual([])
  })
  it('duas confirmações concorrentes têm um commit auditado',async()=>{
    const proof=(await read()).headers.etag as string
    const responses=await Promise.all(['First','Second'].map(title=>server.inject({url:path+'/metadata',method:'PATCH',headers:{...headers,'if-match':proof},payload:{title}})))
    expect(responses.map(row=>row.statusCode).sort()).toEqual([200,409]);expect(app.sqlite.prepare("SELECT count(*) n FROM operator_decisions WHERE kind='ASSET_METADATA_CHANGED'").get()).toEqual({n:1})
  })
  it.each([{title:'X',ignored:false},{title:'X',qcStatus:'APPROVED'},{title:'X',expectedContentHash:'PRIVATE_HASH'},{title:'X',path:'fake'},{expectedContentHash:'PRIVATE_HASH'},{}])('rota legada não mistura QC nem ignora campos %j',async payload=>{
    const proof=(await read()).headers.etag as string,before=state();expect((await server.inject({url:path,method:'PATCH',headers:{...headers,'if-match':proof},payload})).statusCode).toBe(400);expect(state()).toEqual(before)
  })
  it('conta restrita vê canEdit=false e não escreve nem com canal forjado',async()=>{
    app.sqlite.exec("INSERT INTO user_access VALUES('admin','[\"a\"]',NULL,'now')");const review=await read();expect(review.statusCode).toBe(200);expect(review.json().canEdit).toBe(false)
    const before=state();expect((await server.inject({url:path+'/metadata?channelId=a',method:'PATCH',headers:{...headers,'if-match':review.headers.etag as string},payload:{title:'Not global'}})).statusCode).toBe(403);expect(state()).toEqual(before)
  })
  it('sessão revogada recusa consulta/escrita sem reabrir modo anônimo',async()=>{
    const proof=(await read()).headers.etag as string;app.sqlite.exec('DELETE FROM sessions');const before=state()
    expect((await read()).statusCode).toBe(401);expect((await server.inject({url:path+'/metadata',method:'PATCH',headers:{...headers,'if-match':proof},payload:{title:'Never'}})).statusCode).toBe(401);expect(state()).toEqual(before)
  })
  it('auditoria SQL falha sem metadata parcial ou callback de alteração',async()=>{
    const proof=(await read()).headers.etag as string,before=state();app.sqlite.exec("CREATE TRIGGER metadata_audit_failure BEFORE INSERT ON operator_decisions WHEN NEW.kind='ASSET_METADATA_CHANGED' BEGIN SELECT RAISE(ABORT,'HTTP_METADATA_FIXTURE'); END")
    expect((await server.inject({url:path+'/metadata',method:'PATCH',headers:{...headers,'if-match':proof},payload:{title:'Never'}})).statusCode).toBe(500);expect(state()).toEqual(before);expect(changed).not.toHaveBeenCalled()
  })
  it('falha pós-commit informa gravado com aviso, não rollback',async()=>{
    const proof=(await read()).headers.etag as string;changed.mockImplementation(()=>{throw new Error('PUSH_FIXTURE')})
    const result=await server.inject({url:path+'/metadata',method:'PATCH',headers:{...headers,'if-match':proof},payload:{title:'Gravado'}})
    expect(result.statusCode).toBe(200);expect(result.json()).toMatchObject({applied:true,title:'Gravado',refreshError:expect.stringContaining('gravados')});expect(result.headers.etag).toBe((await read()).headers.etag)
  })
  it('editar metadata não faz refresh/CUE/TAKE/rebuild nem altera o PGM/PVW',async()=>{
    app.db.insert(rundownItems).values({id:'live',rundownId:'rd-a',sortOrder:1,type:'LIVE',title:'SIMULATED',sourceRef:'ndi:SIMULATED',durationOverride:150000,minDuration:0,anchor:{kind:'FLOW'},onOverrun:'PUSH',locked:false,autoNext:false,loop:false}).run()
    const runtime=(await runtimeFor(app,'a'))!;await runtime.load('rd-a')
    for(const payload of [{action:'cue',sourceRef:'ndi:SIMULATED'},{action:'take'},{action:'cue',sourceRef:'ndi:OTHER_PREVIEW'}])expect((await server.inject({url:'/api/channels/a/transport',method:'POST',headers,payload})).statusCode).toBe(200)
    const before=runtime.live().transport,refresh=vi.spyOn(runtime,'refresh'),cue=vi.spyOn(runtime.transport,'cue'),take=vi.spyOn(runtime.transport,'take'),proof=(await read()).headers.etag as string
    expect((await server.inject({url:path+'/metadata',method:'PATCH',headers:{...headers,'if-match':proof},payload:{title:'Catalog only'}})).statusCode).toBe(200)
    const after=runtime.live().transport
    expect(before.onAir?.itemId).toBe('live');expect(before.playing).toBe(true)
    expect(after.onAir!.elapsed).toBeGreaterThanOrEqual(before.onAir!.elapsed)
    // Playback is supposed to advance; elapsed clock is not a configuration
    // change. All other transport fields (including start, CUE and Next) match.
    expect(after).toEqual({...before,onAir:{...before.onAir,elapsed:after.onAir!.elapsed}})
    expect(refresh).not.toHaveBeenCalled();expect(cue).not.toHaveBeenCalled();expect(take).not.toHaveBeenCalled()
  })
})
