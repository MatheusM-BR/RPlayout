import Fastify,{type FastifyInstance} from 'fastify'
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {createApp,runtimeFor,type App} from '../app.js'
import {registerRoutes} from '../routes.js'
import {configurationRevision} from '../db/channel-configuration.js'
import {channelConfigurationETag} from '@rplayout/protocol'
import {channels,rundowns,transmissionPresets,operatorDecisions,outputProfiles} from '../db/schema.js'
import {eq} from 'drizzle-orm'
import {sessionDigest} from './access.js'
vi.mock('../config.js',async original=>({...await original<Record<string,unknown>>(),ENGINE_BINARY:'',MEDIAMTX_BINARY:'',DEVICES_BINARY:'',AUTH_USER:'',AUTH_PASSWORD:'',DEFAULT_ROLE:'ADMIN'}))
let app:App,server:FastifyInstance
const base='/api/channels/ch/transmission-presets',body={name:'Destino',kind:'SRT',target:'srt://localhost:9000?mode=caller&passphrase=PRIVATE_PRESET'}
beforeEach(async()=>{
  app=await createApp(':memory:');const now=new Date().toISOString()
  for(const id of ['ch','other']){
    app.db.insert(channels).values({id,name:id,width:320,height:180,rateNum:25,rateDen:1,targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,createdAt:now}).run()
    app.db.insert(rundowns).values({id:`rd-${id}`,channelId:id,name:id,date:'2026-10-03',plannedStart:0,loop:false,createdAt:now,updatedAt:now}).run()
  }
  app.db.insert(transmissionPresets).values({id:'preset',channelId:'ch',...body,kind:'SRT',createdAt:now}).run()
  server=Fastify();registerRoutes(app,server,()=>{});await server.ready()
  await (await runtimeFor(app,'ch'))!.load('rd-ch')
})
afterEach(async()=>{vi.restoreAllMocks();await server.close();app.close()})
const headers=(id='ch')=>({'if-match':channelConfigurationETag(id,configurationRevision(app.db,id))})
function request(action:'create'|'apply'|'delete',version:Record<string,string>|undefined=headers()){
  return server.inject({method:action==='delete'?'DELETE':'POST',url:action==='create'?base:base+'/preset'+(action==='apply'?'/apply':''),...(action==='delete'?{}:{payload:action==='create'?body:{}}),headers:version})
}
const decisions=()=>app.db.select().from(operatorDecisions).all().filter(row=>row.kind.startsWith('TRANSMISSION_PRESET_'))
describe('preset usa a configuração conferida, com auditoria atômica',()=>{
  it('lista e revisão pertencem ao mesmo snapshot privado, sem comando ou segredo',async()=>{
    const before=configurationRevision(app.db,'ch'),state=app.runtimes.get('ch')!.transport.state()
    const response=await server.inject({url:base})
    expect(response.statusCode).toBe(200);expect(response.headers.etag).toBe(headers()['if-match']);expect(response.headers['cache-control']).toBe('private, no-store')
    expect(response.json()).toMatchObject({configurationRevision:before,presets:[{id:'preset',name:'Destino'}]})
    expect(response.body).not.toContain('PRIVATE_PRESET');expect(decisions()).toHaveLength(0);expect(app.runtimes.get('ch')!.transport.state()).toEqual(state)
    expect((await server.inject({url:'/api/channels/absent/transmission-presets'})).statusCode).toBe(404)
  })
  it.each(['create','apply','delete'] as const)('%s exige revisão original e não aceita revisão de outro canal',async(action)=>{
    const close=vi.spyOn(app.runtimes.get('ch')!,'close'),before=configurationRevision(app.db,'ch')
    expect((await request(action,{})).statusCode).toBe(428)
    expect((await request(action,{'if-match':'*'})).statusCode).toBe(400)
    expect((await request(action,headers('other'))).statusCode).toBe(400)
    expect(configurationRevision(app.db,'ch')).toBe(before);expect(app.db.select().from(transmissionPresets).all()).toHaveLength(1)
    expect(app.db.select().from(outputProfiles).all()).toHaveLength(0);expect(close).not.toHaveBeenCalled();expect(decisions()).toHaveLength(0)
  })
  it.each(['create','apply','delete'] as const)('ABA de preset invalida %s sem comando ao engine',async(action)=>{
    const original=headers(),close=vi.spyOn(app.runtimes.get('ch')!,'close')
    app.db.update(transmissionPresets).set({name:'Temporário'}).where(eq(transmissionPresets.id,'preset')).run()
    app.db.update(transmissionPresets).set({name:body.name}).where(eq(transmissionPresets.id,'preset')).run()
    const response=await request(action,original)
    expect(response.statusCode,response.body).toBe(409);expect(response.json().configurationRevision).toBe(configurationRevision(app.db,'ch'))
    expect(app.db.select().from(transmissionPresets).all()).toHaveLength(1);expect(app.db.select().from(outputProfiles).all()).toHaveLength(0)
    expect(close).not.toHaveBeenCalled();expect(decisions()).toHaveLength(0)
  })
  it('somente uma confirmação concorrente da mesma revisão cria e audita',async()=>{
    const original=headers(),before=configurationRevision(app.db,'ch')
    const results=await Promise.all([request('create',original),request('create',original)])
    expect(results.map(row=>row.statusCode).sort()).toEqual([201,409])
    expect(app.db.select().from(transmissionPresets).all()).toHaveLength(2);expect(decisions()).toHaveLength(1)
    expect(configurationRevision(app.db,'ch')).toBe(before+1);expect(configurationRevision(app.db,'other')).toBe(1)
    expect(decisions()[0]!.payload).toMatchObject({channelId:'ch',revisionBefore:before,revisionAfter:before+1,name:'Destino',kind:'SRT'})
    expect(JSON.stringify(decisions())).not.toContain('PRIVATE_PRESET')
  })
  it.each([['create','TRANSMISSION_PRESET_CREATED'],['apply','TRANSMISSION_PRESET_APPLIED'],['delete','TRANSMISSION_PRESET_REMOVED']] as const)('falha de auditoria de %s reverte contador e dados antes do engine',async(action,kind)=>{
    const before=configurationRevision(app.db,'ch'),close=vi.spyOn(app.runtimes.get('ch')!,'close')
    app.sqlite.exec(`CREATE TRIGGER qa_preset_audit BEFORE INSERT ON operator_decisions WHEN NEW.kind='${kind}' BEGIN SELECT RAISE(ABORT,'QA preset audit rollback'); END`)
    const response=await request(action)
    expect(response.statusCode,response.body).toBe(409);expect(response.body).toContain('QA preset audit rollback')
    expect(configurationRevision(app.db,'ch')).toBe(before);expect(app.db.select().from(transmissionPresets).all()).toHaveLength(1)
    expect(app.db.select().from(outputProfiles).all()).toHaveLength(0);expect(close).not.toHaveBeenCalled();expect(decisions()).toHaveLength(0)
  })
  it.each(['sessão','papel','canal'])('reconfere %s dentro da confirmação enfileirada',async(condition)=>{
    const token='preset-session',now=new Date().toISOString(),before=configurationRevision(app.db,'ch')
    app.sqlite.prepare('INSERT INTO users(id,username,password_hash,role,enabled,created_at) VALUES(?,?,?,?,1,?)').run('editor','editor','unused','ADMIN',now)
    app.sqlite.prepare('INSERT INTO sessions(token,user_id,expires_at,created_at) VALUES(?,?,?,?)').run(sessionDigest(token),'editor',new Date(Date.now()+60_000).toISOString(),now)
    const original={...headers(),cookie:`rplayout_session=${token}`}
    vi.spyOn(app.runtimes.get('ch')!,'assertReconfigurationReady').mockImplementation(()=>{
      if(condition==='sessão')app.sqlite.exec('DELETE FROM sessions')
      if(condition==='papel')app.sqlite.exec("UPDATE users SET role='OPERATOR' WHERE id='editor'")
      if(condition==='canal')app.sqlite.prepare('INSERT INTO user_access(user_id,channel_ids,station_ips,updated_at) VALUES(?,?,NULL,?)').run('editor',JSON.stringify(['other']),now)
    })
    const result=await request('create',original)
    expect(result.statusCode,result.body).toBe(403);expect(configurationRevision(app.db,'ch')).toBe(before)
    expect(app.db.select().from(transmissionPresets).all()).toHaveLength(1);expect(decisions()).toHaveLength(0)
  })
  it('aplicar remove ambiguidade entre commit e falha de reconstrução do engine',async()=>{
    const before=configurationRevision(app.db,'ch')
    vi.spyOn(app.runtimes.get('ch')!,'close').mockImplementation(()=>{throw new Error('QA publisher rebuild failure')})
    const response=await request('apply')
    expect(response.statusCode,response.body).toBe(201)
    expect(response.json()).toMatchObject({applied:true,restartRequired:true,engineError:'QA publisher rebuild failure',configurationRevision:before+1,output:{channelId:'ch',kind:'SRT'}})
    expect(response.body).not.toContain('PRIVATE_PRESET');expect(app.db.select().from(outputProfiles).all()).toHaveLength(1);expect(decisions()).toHaveLength(1)
  })
  it('remoção não elimina saída aplicada; seleção em outro canal não aplica preset estranho',async()=>{
    expect((await request('apply')).statusCode).toBe(201)
    const wrong=await server.inject({method:'POST',url:'/api/channels/other/transmission-presets/preset/apply',headers:headers('other'),payload:{}})
    expect(wrong.statusCode).toBe(404)
    const removed=await request('delete');expect(removed.statusCode).toBe(200);expect(removed.json()).toMatchObject({ok:true,applied:true})
    expect(app.db.select().from(transmissionPresets).all()).toHaveLength(0);expect(app.db.select().from(outputProfiles).all()).toHaveLength(1)
  })
  it('canal arquivado recusa mudança e destinos incompatíveis não são cadastrados',async()=>{
    for(const extra of [{target:'rtmp://host/app/key'}, {target:'não é url'}, {kind:'RTMP',target:'srt://host:9000'}, {unknown:true}]){
      const response=await server.inject({method:'POST',url:base,headers:headers(),payload:{...body,...extra}})
      expect(response.statusCode,response.body).toBe(400)
    }
    app.sqlite.exec("UPDATE channels SET archived_at='now' WHERE id='ch'")
    expect((await request('create')).statusCode).toBe(409);expect(decisions()).toHaveLength(0)
  })
})
