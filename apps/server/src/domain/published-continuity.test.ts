import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { hostname } from 'node:os'
import { createApp,type App,type ChannelRuntime } from '../app.js'
import { channels,rundowns,rundownItems,mediaAssets,operatorDecisions,users } from '../db/schema.js'
import { getChannel } from '../db/repo.js'
import { publishOperationalPlaylist } from './operational-playlist.js'
import { PublishedContinuity,readContinuityPolicy,selectPublishedSuccessor } from './published-continuity.js'
import { EngineTransport } from './engine.js'
import { inspectBoundary,PlaylistBoundaryLedger } from './playlist-boundary.js'

vi.mock('../config.js',async original=>({...await original<Record<string,unknown>>(),ENGINE_BINARY:'',MEDIAMTX_BINARY:'',DEVICES_BINARY:'',AUTH_USER:'',AUTH_PASSWORD:'',DEFAULT_ROLE:'ADMIN'}))
let app:App,runtime:ChannelRuntime,ids:string[],playing:boolean,source:string
const owner={userId:null,username:null},ledger=()=>new PlaylistBoundaryLedger(app.db,'ch')
beforeEach(async()=>{
  vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-03T00:00:01'))
  app=await createApp(':memory:');ids=[];playing=true
  const stamp=new Date().toISOString()
  app.db.insert(channels).values({id:'ch',name:'Canal',rateNum:25,rateDen:1,width:320,height:180,targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,createdAt:stamp}).run()
  app.db.insert(mediaAssets).values({id:'asset',title:'Aprovado',path:'C:/fixture/video.mkv',contentHash:'a'.repeat(64),kind:'VIDEO',durationFrames:250,rateNum:25,rateDen:1,qcStatus:'APPROVED',createdAt:stamp}).run()
  for(let index=0;index<3;index++){
    const id='rd'+index
    app.db.insert(rundowns).values({id,channelId:'ch',name:id,date:'2026-10-03',plannedStart:index*250,loop:false,createdAt:stamp,updatedAt:stamp}).run()
    app.db.insert(rundownItems).values({id:'vt'+index,rundownId:id,sortOrder:0,title:id,type:'VT',mediaId:'asset',minDuration:0,anchor:{kind:'FLOW'},onOverrun:'PUSH',autoNext:true,loop:false,locked:false}).run()
    ids.push((await publishOperationalPlaylist(app.db,(await getChannel(app.db,'ch'))!,id,null)).id)
  }
  source=ids[0]!
  const transport=Object.assign(Object.create(EngineTransport.prototype),{state:()=>({playing,onAir:playing?{itemId:'vt0'}:null}),health:()=>({ready:true}),processId:()=>process.pid,mutatePlaylist:async(action:()=>Promise<unknown>)=>action()})
  runtime={channel:(await getChannel(app.db,'ch'))!,transport,operationalRevision:{id:source},queuePlaylistBoundary:vi.fn(async(id,plan,token,authorize)=>{authorize();expect(inspectBoundary(app.db,'ch',plan.sourceRevisionId,plan.targetRevisionId,plan.owner).token).toBe(token);return ledger().enqueue(id,plan,()=>{authorize();return true})})} as unknown as ChannelRuntime
  app.runtimes.set('ch',runtime)
})
afterEach(()=>{app.runtimes.clear();app.close();vi.useRealTimers();vi.restoreAllMocks()})
const enable=()=>{const review=app.publishedContinuity.review(runtime,5,owner);return app.publishedContinuity.enable(runtime,5,owner,review.token,()=>{})}
function updatePolicy(change:Record<string,unknown>){const saved=readContinuityPolicy(app.db,'ch')!;app.db.update(operatorDecisions).set({payload:{...saved,...change}}).where(eq(operatorDecisions.id,'published-continuity:ch')).run()}

describe('continuidade durável de grades publicadas',()=>{
  it('desligada por padrão, confere sem mutar e não habilita uma conferência antiga',()=>{
    expect(app.publishedContinuity.status('ch').state).toBe('DISABLED')
    const before=app.sqlite.prepare('SELECT count(*) n FROM operator_decisions').get(),review=app.publishedContinuity.review(runtime,5,owner)
    expect(app.sqlite.prepare('SELECT count(*) n FROM operator_decisions').get()).toEqual(before)
    expect(()=>app.publishedContinuity.enable(runtime,5,owner,undefined,()=>{})).toThrow('Confira')
    enable();app.publishedContinuity.suspend('ch',null,'STOP')
    expect(()=>app.publishedContinuity.enable(runtime,5,owner,review.token,()=>{})).toThrow('mudou')
    expect(app.publishedContinuity.status('ch')).toMatchObject({state:'SUSPENDED',version:2})
  })
  it('enfileira uma passagem por origem e repete em outra publicação sem alterar editorial',async()=>{
    enable();const before=app.sqlite.prepare('SELECT count(*) n FROM rundown_items').get()
    await Promise.all([app.publishedContinuity.tick(),app.publishedContinuity.tick()]);expect(ledger().list()).toHaveLength(1)
    const run=ledger().list()[0]!;expect(run.plan.targetRevisionId).toBe(ids[1]);expect(run.plan.owner.policy?.version).toBe(1)
    ledger().phase(run.id,['QUEUED'],'PREPARING',()=>true);ledger().phase(run.id,['PREPARING'],'SWITCHING',()=>true);ledger().phase(run.id,['SWITCHING'],'CONFIRMED',()=>true)
    runtime.operationalRevision={id:ids[1]!,revision:1,publishedAt:new Date().toISOString()}
    await app.publishedContinuity.tick();expect(ledger().list()).toHaveLength(2);expect(ledger().list()[0]!.plan.targetRevisionId).toBe(ids[2])
    expect(app.sqlite.prepare('SELECT count(*) n FROM rundown_items').get()).toEqual(before)
  })
  it('suspensão invalida intenção enfileirada e não envia outra nem repete falha',async()=>{
    enable();await app.publishedContinuity.tick();const run=ledger().list()[0]!
    app.publishedContinuity.suspend('ch',null,'STOP');expect(()=>inspectBoundary(app.db,'ch',source,ids[1]!,run.plan.owner)).toThrow('política')
    await app.publishedContinuity.tick();expect(ledger().list()).toHaveLength(1)
  })
  it('não rouba dono vivo/remoto e não suspende uma versão nova por trabalho antigo',async()=>{
    enable();const second=new PublishedContinuity({db:app.db,runtimes:app.runtimes});await second.tick();expect(ledger().list()).toHaveLength(0)
    updatePolicy({worker:{host:'remote-host',pid:2147483647,enginePid:2147483647,boot:'foreign'}})
    expect(app.publishedContinuity.status('ch').workerState).toBe('OTHER_OR_UNKNOWN_SERVER')
    await app.publishedContinuity.tick();expect(ledger().list()).toHaveLength(0)
    app.publishedContinuity.suspend('ch',null,'old work','SUSPENDED',99);expect(app.publishedContinuity.status('ch').state).toBe('ENABLED')
    second.close()
  })
  it('assume somente após ambos os PIDs locais estarem comprovadamente mortos',async()=>{
    enable();updatePolicy({worker:{host:hostname(),pid:2147483647,enginePid:2147483647,boot:'dead'}})
    await app.publishedContinuity.tick();expect(ledger().list()).toHaveLength(1)
    expect(readContinuityPolicy(app.db,'ch')!.worker.pid).toBe(process.pid)
    expect(app.publishedContinuity.status('ch').workerState).toBe('CURRENT_SERVER')
    expect(app.db.select().from(operatorDecisions).all().filter(row=>row.kind==='PUBLISHED_CONTINUITY_OWNER_RECLAIMED')).toHaveLength(1)
  })
  it('invalidar autorização anônima suspende quando autenticação passa a ser exigida',async()=>{
    enable();app.db.insert(users).values({id:'admin',username:'admin',passwordHash:'unused',role:'ADMIN',enabled:true,createdAt:new Date().toISOString()}).run()
    await app.publishedContinuity.tick();expect(app.publishedContinuity.status('ch').state).toBe('SUSPENDED');expect(ledger().list()).toHaveLength(0)
  })
  it('formato alterado exige nova autorização e passagem recusada não será repetida',async()=>{
    enable();app.db.update(channels).set({width:640}).where(eq(channels.id,'ch')).run()
    await app.publishedContinuity.tick();expect(app.publishedContinuity.status('ch').state).toBe('SUSPENDED');expect(ledger().list()).toHaveLength(0)
  })
  it('falha ou cancelamento da passagem suspende e atraso é revalidado no momento do EOS',async()=>{
    enable();await app.publishedContinuity.tick();const run=ledger().list()[0]!
    vi.setSystemTime(new Date('2026-10-03T00:10:01'))
    expect(()=>inspectBoundary(app.db,'ch',source,ids[1]!,run.plan.owner)).toThrow('atraso')
    ledger().phase(run.id,['QUEUED'],'FAILED',()=>true,{message:'Fonte recusada'})
    await app.publishedContinuity.tick();expect(app.publishedContinuity.status('ch').state).toBe('SUSPENDED');expect(ledger().list()).toHaveLength(1)
  })
  it('não desempata duas grades, pula sobreposição/gap ou executa programação vencida',async()=>{
    expect(selectPublishedSuccessor(app.db,'ch',source,Date.now(),5).revisionId).toBe(ids[1])
    expect(()=>selectPublishedSuccessor(app.db,'ch',source,Date.now()+600_000,5)).toThrow('atraso')
    app.db.update(rundowns).set({plannedStart:251}).where(eq(rundowns.id,'rd1')).run();ids[1]=(await publishOperationalPlaylist(app.db,(await getChannel(app.db,'ch'))!,'rd1',null)).id
    // One frame tolerance is permitted; two-frame gap is not.
    app.db.update(rundowns).set({plannedStart:252}).where(eq(rundowns.id,'rd1')).run();ids[1]=(await publishOperationalPlaylist(app.db,(await getChannel(app.db,'ch'))!,'rd1',null)).id
    expect(()=>selectPublishedSuccessor(app.db,'ch',source,Date.now(),5)).toThrow('intervalo')
    app.db.update(rundowns).set({plannedStart:252}).where(eq(rundowns.id,'rd2')).run();await publishOperationalPlaylist(app.db,(await getChannel(app.db,'ch'))!,'rd2',null)
    expect(()=>selectPublishedSuccessor(app.db,'ch',source,Date.now(),5)).toThrow('duas grades')
  })
})
