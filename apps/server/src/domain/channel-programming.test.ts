import Fastify,{type FastifyInstance} from 'fastify'
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {randomUUID} from 'node:crypto'
import {createApp,runtimeFor,type App} from '../app.js'
import {registerRoutes} from '../routes.js'
import {channels,graphicTemplates,itemGraphics,mediaAssets,rundownItems,rundowns,sessions,users} from '../db/schema.js'
import {sessionDigest} from './access.js'
import {copyRundownToChannel,isMirrorLocked,mirrorOf,mirrorRundownId,setMirror,setMirrorUnlock,syncMirrorRundown} from './channel-programming.js'
vi.mock('../config.js',async original=>({...await original<Record<string,unknown>>(),ENGINE_BINARY:'',MEDIAMTX_BINARY:'',DEVICES_BINARY:'',AUTH_USER:'',AUTH_PASSWORD:'',DEFAULT_ROLE:'ADMIN'}))

let app:App,server:FastifyInstance
const token=randomUUID()
const now=new Date().toISOString()
const item=(id:string,rundownId:string,sortOrder:number,extra:Record<string,unknown>={})=>({id,rundownId,sortOrder,title:id,type:'VT' as const,mediaId:'vt',durationOverride:250,minDuration:0,anchor:{kind:'FLOW' as const},onOverrun:'PUSH' as const,locked:false,autoNext:false,loop:false,...extra})
beforeEach(async()=>{
  app=await createApp(':memory:')
  for(const [id,num] of [['A',25],['B',25],['C',30]] as const)app.db.insert(channels).values({id,name:`Canal ${id}`,rateNum:num,rateDen:1,width:320,height:180,targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,createdAt:now}).run()
  app.db.insert(mediaAssets).values({id:'vt',path:'C:/vt.mp4',title:'VT',contentHash:'a'.repeat(64),kind:'VIDEO',durationFrames:250,rateNum:25,rateDen:1,qcStatus:'APPROVED',createdAt:now}).run()
  app.db.insert(rundowns).values({id:'rA',channelId:'A',name:'Grade A',date:'2026-10-28',plannedStart:0,loop:false,createdAt:now,updatedAt:now}).run()
  for(const [n,id] of ['a1','a2','a3'].entries())app.db.insert(rundownItems).values(item(id,'rA',n)).run()
  app.db.insert(graphicTemplates).values([{id:'global',channelId:null,name:'G',svg:'<svg/>',fields:[],fadeMs:0,createdAt:now},{id:'soA',channelId:'A',name:'A',svg:'<svg/>',fields:[],fadeMs:0,createdAt:now}] as never).run()
  app.db.insert(itemGraphics).values([{id:'g1',itemId:'a1',templateId:'global',values:{},atSeconds:0,createdAt:now},{id:'g2',itemId:'a2',templateId:'soA',values:{},atSeconds:0,createdAt:now}] as never).run()
  server=Fastify();registerRoutes(app,server,()=>{});await server.ready()
})
afterEach(async()=>{await server?.close();app?.close()})

function login(role:string,channelIds:string[]|null){
  app.db.insert(users).values({id:'u',username:'u',passwordHash:'x',role,enabled:true,createdAt:now}).run()
  if(channelIds)app.sqlite.prepare('INSERT INTO user_access VALUES(?,?,?,?)').run('u',JSON.stringify(channelIds),null,now)
  app.db.insert(sessions).values({token:sessionDigest(token),userId:'u',expiresAt:new Date(Date.now()+600000).toISOString(),createdAt:now}).run()
  return {cookie:`rplayout_session=${token}`}
}

describe('cópia de grade entre canais',()=>{
  it('copia itens e grafismos utilizáveis; grafismo preso ao canal A fica de fora',()=>{
    const report=copyRundownToChannel(app.db,{sourceRundownId:'rA',targetChannelId:'B'})
    expect(report).toMatchObject({items:3,skippedGraphics:1})
    const copied=app.sqlite.prepare('SELECT title FROM rundown_items WHERE rundown_id=? ORDER BY sort_order').all(report.rundownId)
    expect(copied).toEqual([{title:'a1'},{title:'a2'},{title:'a3'}])
    expect(app.sqlite.prepare('SELECT channel_id AS c,name FROM rundowns WHERE id=?').get(report.rundownId)).toEqual({c:'B',name:'Grade A (cópia de Canal A)'})
    // A origem fica intacta.
    expect(app.sqlite.prepare("SELECT count(*) AS n FROM rundown_items WHERE rundown_id='rA'").get()).toEqual({n:3})
  })
  it('recusa canais de cadência diferente',()=>{
    expect(()=>copyRundownToChannel(app.db,{sourceRundownId:'rA',targetChannelId:'C'})).toThrow('cadências diferentes')
  })
})

describe('espelho vinculado',()=>{
  it('sincroniza com ids estáveis e remove o que saiu da origem',()=>{
    setMirror(app.db,'B','A','admin')
    const first=syncMirrorRundown(app.db,'B','rA')
    const ids=(app.sqlite.prepare('SELECT id FROM rundown_items WHERE rundown_id=? ORDER BY sort_order').all(first.rundownId) as {id:string}[]).map(row=>row.id)
    app.sqlite.prepare("DELETE FROM rundown_items WHERE id='a3'").run()
    app.sqlite.prepare("UPDATE rundown_items SET title='a1 novo' WHERE id='a1'").run()
    const second=syncMirrorRundown(app.db,'B','rA')
    expect(second.rundownId).toBe(first.rundownId)
    expect(app.sqlite.prepare('SELECT id,title FROM rundown_items WHERE rundown_id=? ORDER BY sort_order').all(first.rundownId)).toEqual([{id:ids[0],title:'a1 novo'},{id:ids[1],title:'a2'}])
  })
  it('sem cadeias nem cadência diferente',()=>{
    setMirror(app.db,'B','A','admin')
    expect(()=>setMirror(app.db,'A','B','admin')).toThrow()
    expect(()=>setMirror(app.db,'C','A','admin')).toThrow('cadências diferentes')
  })
})

describe('rotas de programação multicanal',()=>{
  it('operador não copia nem espelha',async()=>{
    const headers=login('OPERATOR',null)
    expect((await server.inject({method:'POST',url:'/api/channels/B/copy-rundown',headers,payload:{copyFromRundownId:'rA'}})).statusCode).toBe(403)
    expect((await server.inject({method:'PUT',url:'/api/channels/B/mirror',headers,payload:{sourceChannelId:'A'}})).statusCode).toBe(403)
  })
  it('supervisor só com acesso ao destino não lê a grade do outro canal',async()=>{
    const headers=login('SUPERVISOR',['B'])
    expect((await server.inject({method:'POST',url:'/api/channels/B/copy-rundown',headers,payload:{copyFromRundownId:'rA'}})).statusCode).toBe(403)
    expect((await server.inject({method:'PUT',url:'/api/channels/B/mirror',headers,payload:{sourceChannelId:'A'}})).statusCode).toBe(403)
    expect(app.sqlite.prepare("SELECT count(*) AS n FROM rundowns WHERE channel_id='B'").get()).toEqual({n:0})
  })
  it('supervisor com os dois canais copia; publicação em A chega ao espelho B; B não edita a grade espelhada',async()=>{
    const headers=login('SUPERVISOR',['A','B'])
    const copy=await server.inject({method:'POST',url:'/api/channels/B/copy-rundown',headers,payload:{copyFromRundownId:'rA',date:'2026-10-29'}})
    expect(copy.statusCode,copy.body).toBe(201)
    const mirror=await server.inject({method:'PUT',url:'/api/channels/B/mirror',headers,payload:{sourceChannelId:'A'}})
    expect(mirror.statusCode,mirror.body).toBe(200)
    await (await runtimeFor(app,'A'))!.load('rA')
    const inspected=await server.inject({url:'/api/rundowns/rA/operational-simulation',headers})
    expect(inspected.statusCode,inspected.body).toBe(200)
    const review=inspected.json().review
    const published=await server.inject({method:'POST',url:'/api/rundowns/rA/operational-publish',headers:{...headers,'if-match':`w/"${review.editorialRevision}"`},payload:{reviewToken:review.token}})
    expect(published.statusCode,published.body).toBe(201)
    expect(published.json().mirrors).toEqual([expect.objectContaining({channelId:'B',ok:true,items:3})])
    const target=mirrorRundownId('B','rA')
    expect(app.sqlite.prepare('SELECT count(*) AS n FROM operational_playlist_revisions WHERE rundown_id=? AND active=1').get(target)).toEqual({n:1})
    const mirrored=(app.sqlite.prepare('SELECT id FROM rundown_items WHERE rundown_id=? LIMIT 1').get(target) as {id:string}).id
    const edit=await server.inject({method:'DELETE',url:`/api/items/${mirrored}`,headers:{...headers,'if-match':'w/"1"'}})
    expect(edit.statusCode).toBe(409)
    expect(edit.json().error).toContain('espelha outro canal')
    // Desligado o espelho, a grade vira uma cópia comum (editável).
    expect((await server.inject({method:'PUT',url:'/api/channels/B/mirror',headers,payload:{sourceChannelId:null}})).statusCode).toBe(200)
    const after=await server.inject({method:'DELETE',url:`/api/items/${mirrored}`,headers:{...headers,'if-match':'w/"1"'}})
    expect(after.body).not.toContain('espelha outro canal')
  })
  it('canal espelhado fica travado na grade espelhada; destrave com motivo e trava de novo',async()=>{
    const headers=login('SUPERVISOR',['B'])
    setMirror(app.db,'B','A',null);syncMirrorRundown(app.db,'B','rA')
    app.db.insert(rundowns).values({id:'rB',channelId:'B',name:'Grade própria B',date:'2026-10-28',plannedStart:0,loop:false,createdAt:now,updatedAt:now}).run()
    app.db.insert(rundownItems).values(item('b1','rB',0)).run()
    const load=(rundownId:string)=>server.inject({method:'POST',url:'/api/channels/B/load-rundown',headers,payload:{rundownId}})
    const blocked=await load('rB')
    expect(blocked.statusCode).toBe(409)
    expect(blocked.json().code).toBe('MIRROR_LOCKED')
    expect((await load(mirrorRundownId('B','rA'))).body).not.toContain('MIRROR_LOCKED')
    expect((await server.inject({method:'POST',url:'/api/channels/B/mirror/unlock',headers,payload:{reason:''}})).statusCode).toBe(400)
    const unlocked=await server.inject({method:'POST',url:'/api/channels/B/mirror/unlock',headers,payload:{reason:'Leilão extra só no B'}})
    expect(unlocked.statusCode,unlocked.body).toBe(200)
    expect(unlocked.json().mirror).toEqual(expect.objectContaining({unlockedBy:'u',unlockReason:'Leilão extra só no B'}))
    expect(app.sqlite.prepare("SELECT count(*) AS n FROM operator_decisions WHERE kind='MIRROR_UNLOCK' AND actor_username='u'").get()).toEqual({n:1})
    expect((await load('rB')).body).not.toContain('MIRROR_LOCKED')
    const locked=await server.inject({method:'POST',url:'/api/channels/B/mirror/lock',headers})
    expect(locked.statusCode,locked.body).toBe(200)
    expect(locked.json().mirror.unlockedAt).toBeNull()
    expect((await load('rB')).json().code).toBe('MIRROR_LOCKED')
  })
  it('operador destrava o canal dele, não o de outro',async()=>{
    const headers=login('OPERATOR',['B'])
    setMirror(app.db,'B','A',null)
    expect((await server.inject({method:'POST',url:'/api/channels/B/mirror/unlock',headers,payload:{reason:'Emergência'}})).statusCode).toBe(200)
    expect([403,404]).toContain((await server.inject({method:'POST',url:'/api/channels/A/mirror/unlock',headers,payload:{reason:'Emergência'}})).statusCode)
    expect((await server.inject({method:'POST',url:'/api/channels/B/mirror/lock',headers})).statusCode).toBe(200)
  })
  it('destrave com prazo volta a travar sozinho e registra na auditoria; sem prazo fica até travar',async()=>{
    setMirror(app.db,'B','A',null)
    const timed=setMirrorUnlock(app.db,'B',{by:'op',reason:'Leilão extra',duration:'1h'})
    expect(Date.parse(timed.unlockExpiresAt!)-Date.parse(timed.unlockedAt!)).toBe(3_600_000)
    expect(isMirrorLocked(app.db,'B')).toBe(false)
    app.sqlite.prepare("UPDATE channel_mirrors SET unlock_expires_at='2000-01-01T00:00:00.000Z'").run()
    expect(isMirrorLocked(app.db,'B')).toBe(true)
    expect(mirrorOf(app.db,'B')).toEqual(expect.objectContaining({unlockedAt:null,unlockExpiresAt:null}))
    expect(app.sqlite.prepare("SELECT count(*) AS n FROM operator_decisions WHERE kind='MIRROR_RELOCK_AUTO'").get()).toEqual({n:1})
    expect(setMirrorUnlock(app.db,'B',{by:'op',reason:'Até eu travar',duration:'manual'}).unlockExpiresAt).toBeNull()
    expect(isMirrorLocked(app.db,'B')).toBe(false)
    const headers=login('OPERATOR',['B'])
    expect((await server.inject({method:'POST',url:'/api/channels/B/mirror/unlock',headers,payload:{reason:'Teste',duration:'2d'}})).statusCode).toBe(400)
  })
})
