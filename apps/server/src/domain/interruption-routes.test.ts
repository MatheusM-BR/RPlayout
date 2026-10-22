import Fastify,{type FastifyInstance} from 'fastify'
import {randomUUID} from 'node:crypto'
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {eq} from 'drizzle-orm'
import {createApp,runtimeFor,type App} from '../app.js'
import {registerRoutes} from '../routes.js'
import {channels,rundowns,rundownItems,mediaAssets,operatorDecisions} from '../db/schema.js'
import {Interruptions} from './interruptions.js'
import {EngineTransport,type TakeLifecycle} from './engine.js'
import {sessionDigest} from './access.js'
import {Checkpoints} from './checkpoints.js'
vi.mock('../config.js',async original=>({...await original<Record<string,unknown>>(),ENGINE_BINARY:'',MEDIAMTX_BINARY:'',DEVICES_BINARY:'',RELAY_BINARY:'',AUTH_USER:'',AUTH_PASSWORD:'',DEFAULT_ROLE:'ADMIN'}))
let app:App,server:FastifyInstance,id:string
beforeEach(async()=>{
  app=await createApp(':memory:');const now=new Date().toISOString()
  for(const ch of ['ch','other'])app.db.insert(channels).values({id:ch,name:ch,width:320,height:180,rateNum:25,rateDen:1,targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,createdAt:now}).run()
  app.db.insert(rundowns).values({id:'rd',channelId:'ch',name:'Grade',date:'2026-10-03',plannedStart:0,loop:false,createdAt:now,updatedAt:now}).run()
  app.db.insert(mediaAssets).values({id:'media',contentHash:'a'.repeat(64),path:'original.mp4',title:'VT',kind:'VIDEO',durationFrames:1000,createdAt:now}).run()
  for(const [n,kind] of ['VT','LIVE'].entries())app.db.insert(rundownItems).values({id:kind.toLowerCase(),rundownId:'rd',sortOrder:n,title:kind,type:kind as 'VT'|'LIVE',...(kind==='VT'?{mediaId:'media'}:{sourceRef:'ndi:CAM',durationOverride:1000}),minDuration:0,anchor:{kind:'FLOW'},onOverrun:'PUSH',autoNext:false,loop:false,locked:false}).run()
  const runtime=(await runtimeFor(app,'ch'))!;await runtime.load('rd');await runtime.transport.take('rd','live')
  id=new Interruptions(app.sqlite).record('ch','rd',null,runtime.executionView!.items.find(item=>item.item.id==='vt')!,143)!
  server=Fastify();registerRoutes(app,server,()=>{});await server.ready()
})
afterEach(async()=>{vi.restoreAllMocks();await server.close();app.close()})
const snapshot=async()=>{const res=await server.inject('/api/channels/ch/interruptions');expect(res.statusCode,res.body).toBe(200);return res.json().items.find((row:any)=>row.id===id)}
const resolve=(payload:object,headers:Record<string,string>={})=>server.inject({method:'POST',url:`/api/channels/ch/interruptions/${id}`,payload,headers})
const request=async()=>({action:'RESUME',requestId:randomUUID(),reviewToken:(await snapshot()).reviewToken})
function native(work:(lifecycle:TakeLifecycle)=>Promise<void>){
  const runtime=app.runtimes.get('ch')!,simulated=runtime.transport,double=Object.create(EngineTransport.prototype)
  for(const key of Object.getOwnPropertyNames(Object.getPrototypeOf(simulated)))if(key!=='constructor'&&typeof(simulated as any)[key]==='function')double[key]=(simulated as any)[key].bind(simulated)
  // Teardown must not run EngineTransport internals on an uninitialised double.
  double.closeGracefully=async()=>({ownedNativeProcessesStopped:true,graceful:true,forceRequested:false});double.closeConfirmed=async()=>{}
  double.takeWithLifecycle=vi.fn(async(_rd:string,_vt:string,_frames:number,lifecycle:TakeLifecycle)=>work(lifecycle));double.processId=()=>null;double.mutatePlaylist=async(action:()=>Promise<unknown>)=>action()
  Object.defineProperty(runtime,'transport',{value:double});return double
}
const authorizeUser=()=>{
  const now=new Date().toISOString(),token='resume-session'
  app.sqlite.prepare('INSERT INTO users(id,username,password_hash,role,enabled,created_at) VALUES(?,?,?,?,1,?)').run('editor','editor','unused','ADMIN',now)
  app.sqlite.prepare('INSERT INTO sessions(token,user_id,expires_at,created_at) VALUES(?,?,?,?)').run(sessionDigest(token),'editor',new Date(Date.now()+60_000).toISOString(),now)
  return {cookie:`rplayout_session=${token}`}
}
describe('retorno de VT exige conferência original e nunca repete efeito desconhecido',()=>{
  it('snapshot privado sem criar engine; simulação não anuncia confirmação nativa',async()=>{
    const res=await server.inject('/api/channels/ch/interruptions');expect(res.headers['cache-control']).toBe('private, no-store')
    expect(res.json()).toMatchObject({cursorEvidence:'LAST_ENGINE_REPORT',items:[{state:'PENDING',frames:143,reviewToken:expect.stringMatching(/^[A-Za-z0-9_-]{43}$/)}]})
    const body=await request(),runtime=app.runtimes.get('ch')!,take=vi.spyOn(runtime.transport,'take')
    const result=await resolve(body);expect(result.statusCode,result.body).toBe(200);expect(result.json()).toMatchObject({run:{phase:'CONFIRMED',nativeProgramConfirmed:false,physicalOutputValidated:false}})
    expect(runtime.transport.state()).toMatchObject({onAir:{itemId:'vt'}})
    expect((await resolve(body)).json()).toMatchObject({deduplicated:true});expect(take).toHaveBeenCalledTimes(1)
  })
  it.each(['grade','configuration','PGM','specification'])('conferência obsoleta por %s não corta',async change=>{
    const body=await request(),runtime=app.runtimes.get('ch')!,take=vi.spyOn(runtime.transport,'take')
    if(change==='grade'){app.sqlite.exec("UPDATE rundown_items SET title='temp' WHERE id='vt'; UPDATE rundown_items SET title='VT' WHERE id='vt'")}
    if(change==='configuration')app.db.update(channels).set({name:'temp'}).where(eq(channels.id,'ch')).run()
    if(change==='PGM')await runtime.transport.stop()
    if(change==='specification'){const entry=runtime.executionView!.items.find(item=>item.item.id==='vt')!;Object.assign(entry,{trim:{...entry.trim,in:entry.trim.in+1}})}
    const res=await resolve(body);expect(res.statusCode,res.body).toBe(409);expect(take).not.toHaveBeenCalled();expect((await snapshot()).state).toBe('PENDING')
  })
  it('sessão revogada entre preroll e TAKE preserva PGM e registra FAILED',async()=>{
    const double=native(async l=>{l.validate();app.sqlite.exec('DELETE FROM sessions');l.beforeTake()}),body=await request(),headers=authorizeUser()
    const res=await resolve(body,headers);expect(res.statusCode,res.body).toBe(403);expect(double.takeWithLifecycle).toHaveBeenCalledTimes(1)
    expect(app.interruptionCommands.current(id)?.phase).toBe('FAILED');expect(new Interruptions(app.sqlite).list('ch')[0]?.state).toBe('PENDING');expect(app.runtimes.get('ch')!.transport.state().onAir?.itemId).toBe('live')
  })
  it.each(['session','channel','archive'])('reconfere %s durante preparação, não apenas no clique',async change=>{
    native(async l=>{
      l.validate()
      if(change==='session')app.sqlite.exec("UPDATE users SET enabled=0 WHERE id='editor'")
      if(change==='channel')app.sqlite.prepare('INSERT INTO user_access(user_id,channel_ids,station_ips,updated_at) VALUES(?,?,NULL,?)').run('editor',JSON.stringify(['other']),new Date().toISOString())
      if(change==='archive')app.db.update(channels).set({archivedAt:new Date().toISOString()}).where(eq(channels.id,'ch')).run()
      l.beforeTake()
    })
    const body=await request(),headers=authorizeUser(),res=await resolve(body,headers)
    expect(res.statusCode,res.body).toBe(change==='archive'?404:403)
    expect(new Interruptions(app.sqlite).list('ch')[0]?.state).toBe('PENDING');expect(app.runtimes.get('ch')!.transport.state().onAir?.itemId).toBe('live')
  })
  it('QC reprovado em outra requisição bloqueia retorno mesmo antes do refresh do runtime',async()=>{
    const runtime=app.runtimes.get('ch')!,before=await request(),take=vi.spyOn(runtime.transport,'take')
    app.db.update(mediaAssets).set({qcStatus:'BLOCKED'}).where(eq(mediaAssets.id,'media')).run()
    expect((await resolve(before)).statusCode).toBe(409)
    const fresh=await resolve(await request());expect(fresh.statusCode,fresh.body).toBe(409);expect(fresh.body).toContain('QC')
    expect(take).not.toHaveBeenCalled();expect(new Interruptions(app.sqlite).list('ch')[0]?.state).toBe('PENDING')
  })
  it('retorno de outro canal e corpo sem conferência não autorizam decisão',async()=>{
    const body=await request()
    const other=await server.inject({method:'POST',url:`/api/channels/other/interruptions/${id}`,payload:body});expect(other.statusCode).toBe(409)
    const missing=await resolve({action:'RESUME',requestId:randomUUID()});expect(missing.statusCode).toBe(400)
    expect(new Interruptions(app.sqlite).list('ch')[0]?.state).toBe('PENDING')
  })
  it('perda de ACK cerca outros TAKEs e encerramento exige STOP/CUE limpo sem reabrir retorno',async()=>{
    native(async l=>{l.validate();l.beforeTake();throw new Error('TAKE timeout')})
    const body=await request(),res=await resolve(body);expect(res.statusCode,res.body).toBe(409)
    expect((await snapshot())).toMatchObject({state:'UNCERTAIN',operation:{phase:'UNCERTAIN'},canReconcile:true})
    const runtime=app.runtimes.get('ch')!
    expect(runtime.reconfigurationStatus().ready).toBe(false)
    const ordinary=await server.inject({method:'POST',url:'/api/channels/ch/transport',payload:{action:'take',itemId:'vt'}});expect(ordinary.statusCode,ordinary.body).toBe(409)
    const ack=async()=>server.inject({method:'POST',url:`/api/channels/ch/interruptions/${id}/acknowledge`,payload:{requestId:body.requestId,reviewToken:(await snapshot()).reviewToken,confirm:true}})
    expect((await ack()).statusCode).toBe(409)
    await runtime.transport.stop();await runtime.transport.cue({kind:'ITEM',id:'vt'});expect((await ack()).statusCode).toBe(409)
    await runtime.transport.cue(null);runtime.checkpoint()
    const closed=await ack();expect(closed.statusCode,closed.body).toBe(200);expect(closed.json()).toMatchObject({closed:true,automaticTake:false})
    expect(new Checkpoints(app.sqlite).read('ch')).toMatchObject({playing:false,itemId:null,elapsed:0})
    expect((await resolve(body)).json()).toMatchObject({deduplicated:true,run:{phase:'CLOSED_UNCERTAIN'}})
    expect(runtime.transport.state().onAir).toBeNull()
  })
  it('novo runtime não nasce com RESUMING antigo; GET exibe pendência sem reset/replay',async()=>{
    app.sqlite.prepare("UPDATE interrupted_items SET state='RESUMING' WHERE id=?").run(id)
    app.runtimes.get('ch')!.close();app.runtimes.delete('ch')
    const row=await snapshot();expect(row).toMatchObject({state:'RESUMING',canReconcile:false,operation:null})
    expect(await runtimeFor(app,'ch')).toBeNull()
    expect(app.runtimes.has('ch')).toBe(false)
  })
  it('falha de auditoria no descarte mantém cursor pendente e PGM intacto',async()=>{
    const body={...await request(),action:'DISCARD'}
    app.sqlite.exec("CREATE TRIGGER qa_discard BEFORE INSERT ON operator_decisions WHEN NEW.kind='INTERRUPTION_COMMAND' BEGIN SELECT RAISE(ABORT,'audit failed'); END")
    expect((await resolve(body)).statusCode).toBe(409);expect((await snapshot()).state).toBe('PENDING')
    expect(app.db.select().from(operatorDecisions).all().filter(row=>row.kind==='INTERRUPTION_COMMAND')).toHaveLength(0)
    expect(app.runtimes.get('ch')!.transport.state().onAir?.itemId).toBe('live')
  })
})
