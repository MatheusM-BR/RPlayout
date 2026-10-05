import Fastify,{type FastifyInstance} from 'fastify'
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {eq} from 'drizzle-orm'
import {createApp,runtimeFor,syncDistribution,type App} from '../app.js'
import {registerRoutes} from '../routes.js'
import {channels,rundowns,rundownItems,asRun,operatorDecisions,operationalPlaylistRevisions,guestKeys} from '../db/schema.js'
import {getChannel,listChannels} from '../db/repo.js'
import {Checkpoints} from './checkpoints.js'
import {setChannelArchived} from './channel-archive.js'
import {publishOperationalPlaylist} from './operational-playlist.js'
import {sessionDigest} from './access.js'
import {backupDatabase} from './backup.js'
import {openDatabase} from '../db/client.js'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

vi.mock('../config.js',async original=>({...await original<Record<string,unknown>>(),ENGINE_BINARY:'',MEDIAMTX_BINARY:'',DEVICES_BINARY:'',RELAY_BINARY:'',DEFAULT_ROLE:'ADMIN',AUTH_USER:'',AUTH_PASSWORD:''}))
let app:App,server:FastifyInstance,revisionId:string
beforeEach(async()=>{
  app=await createApp(':memory:');const now=new Date().toISOString()
  for(const id of ['a','b']){
    await app.db.insert(channels).values({id,name:id,rateNum:25,rateDen:1,width:320,height:180,targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,createdAt:now})
    await app.db.insert(rundowns).values({id:`rd-${id}`,channelId:id,name:id,date:now.slice(0,10),plannedStart:0,loop:false,createdAt:now,updatedAt:now})
    await app.db.insert(rundownItems).values({id:`item-${id}`,rundownId:`rd-${id}`,sortOrder:0,title:id,type:'LIVE',sourceRef:'ndi:CAM',durationOverride:250,minDuration:0,anchor:{kind:'FLOW'},onOverrun:'PUSH',autoNext:true,loop:false,locked:false})
  }
  revisionId=(await publishOperationalPlaylist(app.db,(await getChannel(app.db,'a'))!,'rd-a','@fixture')).id
  await app.db.insert(asRun).values({id:'historic',channelId:'a',rundownId:'rd-a',itemId:'item-a',revisionId,title:'VT histórico',type:'VT',startedAt:now,endedAt:now,actualStart:0,airedFrames:25,rateNum:25,rateDen:1,createdAt:now})
  await app.db.insert(operatorDecisions).values({id:'historic-decision',rundownId:'rd-a',itemId:'item-a',kind:'TAKE_REQUESTED',payload:{itemId:'item-a'},createdAt:now})
  server=Fastify();registerRoutes(app,server,()=>{});await server.ready()
})
afterEach(async()=>{await server.close();app.close();vi.restoreAllMocks()})
describe('arquivo de canais conserva execução e desativa operação',()=>{
  it('backup restaurado/reaberto conserva migração, arquivo, histórico e STOP',async()=>{
    const directory=await mkdtemp(join(tmpdir(),'RPlayout-archive-backup-'))
    let restored:ReturnType<typeof openDatabase>|undefined
    try {
      new Checkpoints(app.sqlite).write({version:1,channelId:'a',rundownId:'rd-a',revisionId,itemId:'item-a',playing:true,realEngine:true,elapsed:42})
      setChannelArchived(app.sqlite,'a',true,'admin')
      const backup=await backupDatabase(app.sqlite,directory)
      expect(backup.validation).toMatchObject({integrity:'ok',foreignKeys:'ok',protectedSecrets:'verified'})
      restored=openDatabase(backup.file)
      expect(await getChannel(restored.db,'a')).toBeNull()
      expect((await getChannel(restored.db,'a',true))?.archivedAt).toEqual(expect.any(String))
      expect(restored.sqlite.prepare('SELECT version FROM schema_migrations WHERE version=15').get()).toEqual({version:15})
      expect(new Checkpoints(restored.sqlite).read('a')).toMatchObject({playing:false,itemId:null,elapsed:0})
      expect(restored.db.select().from(asRun).get()?.id).toBe('historic')
      expect(restored.db.select().from(operationalPlaylistRevisions).get()?.id).toBe(revisionId)
      expect(restored.db.select().from(operatorDecisions).where(eq(operatorDecisions.kind,'CHANNEL_ARCHIVED')).get()?.payload.channelId).toBe('a')
    } finally {
      restored?.sqlite.close()
      // Exact freshly allocated test directory, never the operational backups.
      await rm(directory,{recursive:true,force:true})
    }
  })
  it('supervisor restrito pode arquivar o único canal visível, não o último global',async()=>{
    const now=new Date().toISOString(),token='QA_ARCHIVE_SUPERVISOR'
    app.sqlite.prepare('INSERT INTO users VALUES (?,?,?,?,?,?)').run('supervisor','supervisor','unused','SUPERVISOR',1,now)
    app.sqlite.prepare('INSERT INTO sessions VALUES (?,?,?,?)').run(sessionDigest(token),'supervisor',new Date(Date.now()+60_000).toISOString(),now)
    app.sqlite.prepare('INSERT INTO user_access (user_id,channel_ids,station_ips,updated_at) VALUES (?,?,?,?)').run('supervisor',JSON.stringify(['a']),null,now)
    const headers={cookie:`rplayout_session=${token}`}
    expect((await server.inject({url:'/api/state',headers})).json().channels.map((row:any)=>row.id)).toEqual(['a'])
    expect((await server.inject({method:'DELETE',url:'/api/channels/a',headers})).statusCode).toBe(200)
    expect((await server.inject({url:'/api/state',headers})).json().channels).toEqual([])
    expect((await listChannels(app.db)).map(row=>row.id)).toEqual(['b'])
    expect((await server.inject({method:'DELETE',url:'/api/channels/b',headers})).statusCode).toBe(403)
  })
  it('operador consulta somente arquivos autorizados e não pode reativar',async()=>{
    setChannelArchived(app.sqlite,'a',true,'admin')
    const now=new Date().toISOString(),token='QA_ARCHIVE_SCOPE'
    app.sqlite.prepare('INSERT INTO users VALUES (?,?,?,?,?,?)').run('operator','operator','unused','OPERATOR',1,now)
    app.sqlite.prepare('INSERT INTO sessions VALUES (?,?,?,?)').run(sessionDigest(token),'operator',new Date(Date.now()+60_000).toISOString(),now)
    app.sqlite.prepare('INSERT INTO user_access (user_id,channel_ids,station_ips,updated_at) VALUES (?,?,?,?)').run('operator',JSON.stringify(['a']),null,now)
    const headers={cookie:`rplayout_session=${token}`}
    expect((await server.inject({url:'/api/channels/archived',headers})).json().channels.map((row:any)=>row.id)).toEqual(['a'])
    expect((await server.inject({url:'/api/channels/a/asrun?since=',headers})).json().entries[0].id).toBe('historic')
    expect((await server.inject({url:'/api/channels/b/asrun?since=',headers})).statusCode).toBe(403)
    expect((await server.inject({method:'POST',url:'/api/channels/a/reactivate',payload:{},headers})).statusCode).toBe(403)
    expect(await getChannel(app.db,'a')).toBeNull()
    app.sqlite.prepare('UPDATE user_access SET channel_ids=? WHERE user_id=?').run(JSON.stringify(['b']),'operator')
    expect((await server.inject({url:'/api/channels/archived',headers})).json().channels).toEqual([])
  })
  it('arquiva sem cascata, não aparece na operação e mantém JSON/CSV/PDF de histórico',async()=>{
    const runtime=(await runtimeFor(app,'a'))!,close=vi.spyOn(runtime,'close')
    const response=await server.inject({method:'DELETE',url:'/api/channels/a'})
    expect(response.statusCode).toBe(200);expect(response.json()).toMatchObject({archived:true,historyPreserved:true})
    expect(close).toHaveBeenCalledOnce();expect(app.runtimes.has('a')).toBe(false)
    expect(await getChannel(app.db,'a')).toBeNull();expect(await runtimeFor(app,'a')).toBeNull()
    expect((await listChannels(app.db)).map(row=>row.id)).toEqual(['b'])
    expect(app.db.select().from(rundowns).all()).toHaveLength(2)
    expect(app.db.select().from(operationalPlaylistRevisions).get()?.id).toBe(revisionId)
    expect(app.db.select().from(asRun).get()?.id).toBe('historic')
    expect(app.db.select().from(operatorDecisions).where(eq(operatorDecisions.id,'historic-decision')).get()).toBeDefined()
    expect((await server.inject({url:'/api/state'})).json().rundowns.map((row:any)=>row.id)).toEqual(['rd-b'])
    expect((await server.inject({url:'/api/channels/archived'})).json().channels).toEqual([expect.objectContaining({id:'a',archivedAt:expect.any(String)})])
    const history=await server.inject({url:'/api/channels/a/asrun?since='})
    expect(history.statusCode).toBe(200);expect(history.json().entries[0].id).toBe('historic')
    expect((await server.inject({url:'/api/channels/a/asrun.csv?since='})).statusCode).toBe(200)
    expect((await server.inject({url:'/api/channels/a/reports/commercial.pdf?since='})).statusCode).toBe(200)
    expect((await server.inject({method:'POST',url:'/api/channels/a/restart',payload:{}})).statusCode).toBe(409)
    expect((await server.inject({method:'POST',url:'/api/rundowns/rd-a/operational-publish',payload:{}})).statusCode).toBe(409)
  })
  it('PGM/CUE e recuperação impedem arquivar sem retirar o runtime',async()=>{
    const runtime=(await runtimeFor(app,'a'))!;await runtime.load('rd-a');await runtime.transport.take('rd-a','item-a')
    expect((await server.inject({method:'DELETE',url:'/api/channels/a'})).statusCode).toBe(409)
    await runtime.transport.stop();await runtime.transport.cue({kind:'ITEM',id:'item-a'})
    expect((await server.inject({method:'DELETE',url:'/api/channels/a'})).statusCode).toBe(409)
    await runtime.transport.cue(null)
    const guard=vi.spyOn(runtime,'assertReconfigurationReady').mockImplementation(()=>{throw new Error('Recuperação pendente')})
    expect((await server.inject({method:'DELETE',url:'/api/channels/a'})).statusCode).toBe(409)
    expect(app.runtimes.get('a')).toBe(runtime);expect((await getChannel(app.db,'a'))?.id).toBe('a');guard.mockRestore()
  })
  it('reativação preserva STOP durável e não instancia engine/TAKE',async()=>{
    const checkpoints=new Checkpoints(app.sqlite)
    checkpoints.write({version:1,channelId:'a',rundownId:'rd-a',revisionId,itemId:'item-a',playing:true,realEngine:true,elapsed:123,rate:{num:25,den:1}})
    setChannelArchived(app.sqlite,'a',true,'admin')
    expect(checkpoints.read('a')).toMatchObject({playing:false,itemId:null,elapsed:0})
    const response=await server.inject({method:'POST',url:'/api/channels/a/reactivate',payload:{}})
    expect(response.statusCode).toBe(200);expect(response.json()).toMatchObject({archived:false,automaticTake:false})
    expect(app.runtimes.has('a')).toBe(false);expect(checkpoints.read('a')?.playing).toBe(false)
    expect(app.db.select().from(operationalPlaylistRevisions).get()?.id).toBe(revisionId)
  })
  it('último ativo é protegido na transação e duplicata não repete auditoria',async()=>{
    expect(setChannelArchived(app.sqlite,'a',true,null).alreadyApplied).toBe(false)
    expect(setChannelArchived(app.sqlite,'a',true,null).alreadyApplied).toBe(true)
    expect(()=>setChannelArchived(app.sqlite,'b',true,null)).toThrow('único canal ativo')
    expect(app.db.select().from(operatorDecisions).where(eq(operatorDecisions.kind,'CHANNEL_ARCHIVED')).all()).toHaveLength(1)
    expect((await server.inject({method:'DELETE',url:'/api/channels/absent'})).statusCode).toBe(404)
  })
  it('distribuição remove publicação de convidado pertencente a canal arquivado',async()=>{
    const now=new Date().toISOString()
    for(const id of ['a','b'])await app.db.insert(guestKeys).values({id:`guest-${id}`,channelId:id,label:id,streamKey:`KEY_${id}`,enabled:true,createdAt:now})
    setChannelArchived(app.sqlite,'a',true,null)
    const apply=vi.fn(async(_paths:unknown,_guests:unknown)=>{}),relays=vi.spyOn(app.relays,'sync').mockImplementation(()=>{})
    Object.defineProperty(app,'mediamtx',{value:{apply,start:vi.fn(),waitUntilReady:vi.fn(async()=>true),stop:vi.fn()},configurable:true})
    await syncDistribution(app)
    expect(app.paths.map(row=>row.channelId)).toEqual(['b'])
    expect(apply.mock.calls[0]?.[1]).toEqual([{label:'b',streamKey:'KEY_b'}]);expect(relays).toHaveBeenCalledOnce()
  })
})
