import Fastify,{type FastifyInstance} from 'fastify'
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest'
import {randomUUID} from 'node:crypto'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createApp,type App} from '../app.js'
import {registerRoutes} from '../routes.js'
import {openDatabase} from '../db/client.js'
import {channels,users,sessions,asRun} from '../db/schema.js'
import {assertLiveOutagesWithoutCredential} from '../db/live-outages.js'
import {LiveWatchdogRecorder} from './live-watchdog-events.js'
import {canonicalSourceAddress,storedSourceKey} from './source-address.js'
import {sessionDigest} from './access.js'
vi.mock('../config.js',async original=>({...await original<Record<string,unknown>>(),ENGINE_BINARY:'',MEDIAMTX_BINARY:'',DEVICES_BINARY:'',AUTH_USER:'',AUTH_PASSWORD:'',DEFAULT_ROLE:'ADMIN'}))

const SECRET='segredo-srt-123'
const endpoint=`srt://10.0.0.5:9000?mode=caller&passphrase=${SECRET}`
const day='2026-10-31T'

describe('endereço canônico e chave gravada',()=>{
  it('canonicaliza como o engine e a chave não revela o endereço',()=>{
    expect(canonicalSourceAddress(' decklink://0 ')).toBe('sdi:0')
    expect(canonicalSourceAddress('sdi://1')).toBe('sdi:1')
    expect(canonicalSourceAddress('ndi://ESTUDIO (vMix - Output 1)')).toBe('ndi:ESTUDIO (vMix - Output 1)')
    expect(canonicalSourceAddress('decklink:2')).toBe('sdi:2')
    expect(canonicalSourceAddress('omt://192.168.0.20:6400/x')).toBe('omt://192.168.0.20:6400/x')
    expect(storedSourceKey('ndi://X')).toBe(storedSourceKey('ndi:X'))
    expect(storedSourceKey(endpoint)).toMatch(/^src:v1:[A-Za-z0-9_-]{43}$/)
    expect(storedSourceKey(endpoint)).not.toBe(storedSourceKey(endpoint.replace(SECRET,'outra-senha-1')))
    expect(storedSourceKey(storedSourceKey(endpoint))).toBe(storedSourceKey(endpoint))
  })
})

describe('paradas do ao vivo sem credencial (live_outages)',()=>{
  let app:App,server:FastifyInstance,token=''
  beforeEach(async()=>{
    app=await createApp(':memory:')
    const now=new Date().toISOString()
    await app.db.insert(channels).values({id:'ch',name:'ch',rateNum:30000,rateDen:1001,width:320,height:180,targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,createdAt:now})
    token=randomUUID()
    await app.db.insert(users).values({id:'op',username:'op',passwordHash:'not-used',role:'OPERATOR',enabled:true,createdAt:now})
    await app.db.insert(sessions).values({token:sessionDigest(token),userId:'op',expiresAt:new Date(Date.now()+600000).toISOString(),createdAt:now})
    server=Fastify();registerRoutes(app,server,()=>{});await server.ready()
  })
  afterEach(async()=>{await server.close();app.close()})
  it('grava identificador e nome mascarado; AIRED e exportação continuam',async()=>{
    await app.db.insert(asRun).values([{id:'ar-live',channelId:'ch',itemId:'live-1',title:'Leilão SRT',type:'LIVE',startedAt:day+'15:00:00.000Z',endedAt:day+'16:00:00.000Z',actualStart:0,createdAt:day+'15:00:00.000Z'}] as never)
    const recorder=new LiveWatchdogRecorder(app.db,'ch')
    const base={severity:'INFO',sourceKey:endpoint,sourceId:null,sourceName:endpoint,bus:'pgm',itemId:'live-1'}
    recorder.persist([{...base,kind:'OUTAGE',message:`${endpoint}: parada iniciada.`,at:Date.parse(day+'15:05:00.000Z'),outage:{phase:'OPEN',id:'o1',startedAt:Date.parse(day+'15:05:00.000Z'),endedAt:null,reasons:['SIGNAL_LOSS'],action:'WAIT_ART',closedBy:null}},
      {...base,kind:'CONDITION',severity:'CRITICAL',detection:'SIGNAL_LOSS',message:`${endpoint}: sem sinal há 3,0 s`,at:Date.parse(day+'15:05:01.000Z')}] as never,{rundownId:'r',itemId:'live-1'})
    recorder.persist([{...base,kind:'OUTAGE',message:'encerrada',at:Date.parse(day+'15:05:20.000Z'),outage:{phase:'CLOSE',id:'o1',startedAt:Date.parse(day+'15:05:00.000Z'),endedAt:Date.parse(day+'15:05:20.000Z'),reasons:['SIGNAL_LOSS'],action:'WAIT_ART',closedBy:'SIGNAL_RETURNED'}}] as never,{rundownId:'r',itemId:'live-1'})
    const row=app.sqlite.prepare("SELECT source_key k,source_name n,ended_at e FROM live_outages WHERE id='o1'").get() as {k:string;n:string;e:string}
    expect(row.k).toBe(storedSourceKey(endpoint))
    expect(row.n).toContain('passphrase=REDACTED')
    expect(row.e).toBe(day+'15:05:20.000Z')
    // Nada do segredo em nenhuma tabela tocada pelo watchdog.
    for(const table of ['live_outages','operator_decisions','health_events'])expect(JSON.stringify(app.sqlite.prepare(`SELECT * FROM ${table}`).all())).not.toContain(SECRET)
    expect(()=>assertLiveOutagesWithoutCredential(app.sqlite)).not.toThrow()
    const read=await server.inject({method:'GET',url:'/api/channels/ch/asrun?since=2026-10-31T00:00:00.000Z',headers:{cookie:`rplayout_session=${token}`}})
    expect(read.statusCode).toBe(200)
    const live=(read.json().entries as Array<{id:string;outages:Array<{id:string;durationMs:number;sourceName:string}>}>).find(entry=>entry.id==='ar-live')!
    expect(live.outages).toMatchObject([{id:'o1',durationMs:20000}])
    expect(live.outages[0]!.sourceName).not.toContain(SECRET)
    const csv=await server.inject({method:'GET',url:'/api/channels/ch/asrun.csv?since=2026-10-31T00:00:00.000Z',headers:{cookie:`rplayout_session=${token}`}})
    expect(csv.statusCode).toBe(200);expect(csv.body).toContain('PARADA');expect(csv.body).not.toContain(SECRET)
  })
  it('a conferência recusa credencial em live_outages',()=>{
    app.sqlite.prepare('INSERT INTO live_outages(id,channel_id,as_run_id,item_id,source_key,source_name,started_at,ended_at,reasons,action,closed_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
      .run('o-bruto','ch',null,null,endpoint,'Câmera',day+'15:00:00.000Z',null,'[]','NONE',null,day+'15:00:00.000Z')
    expect(()=>assertLiveOutagesWithoutCredential(app.sqlite)).toThrow('live_outages')
  })
})

describe('migração 59: converte as paradas já gravadas',()=>{
  let directory='',savedMode:string|undefined
  beforeAll(()=>{savedMode=process.env.RPLAYOUT_STORAGE_MODE;process.env.RPLAYOUT_STORAGE_MODE='INLINE';directory=mkdtempSync(join(tmpdir(),'rplayout-m59-'))})
  afterAll(()=>{if(savedMode===undefined)delete process.env.RPLAYOUT_STORAGE_MODE;else process.env.RPLAYOUT_STORAGE_MODE=savedMode;rmSync(directory,{recursive:true,force:true})})
  it('endereço bruto vira identificador; nome com endereço é mascarado; nome do cadastro fica',()=>{
    const file=join(directory,'r88-37.db'),now=new Date().toISOString()
    const seed=openDatabase(file)
    seed.sqlite.prepare("INSERT INTO channels(id,name,rate_num,rate_den,width,height,target_lufs,ceiling_dbtp,limiter_lookahead_ms,created_at) VALUES('c','RW',30000,1001,1920,1080,-23,-1,5,?)").run(now)
    const insert=seed.sqlite.prepare('INSERT INTO live_outages(id,channel_id,as_run_id,item_id,source_key,source_name,started_at,ended_at,reasons,action,closed_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
    insert.run('a','c',null,null,endpoint,'Câmera do leilão',now,null,'[]','NONE',null,now)
    insert.run('b','c',null,null,'rtsps://op:senha-cam@cam.local/1','rtsps://op:senha-cam@cam.local/1',now,now,'[]','NONE','SIGNAL_RETURNED',now)
    insert.run('n','c',null,null,'ndi://ESTUDIO (vMix - Output 1)','ESTUDIO',now,now,'[]','NONE','SIGNAL_RETURNED',now)
    // Volta ao estado da r88-37 antes da revisão: sem a migração 59.
    seed.sqlite.prepare('DELETE FROM schema_migrations WHERE version=59').run()
    expect(()=>assertLiveOutagesWithoutCredential(seed.sqlite)).toThrow()
    seed.sqlite.close()
    const reopened=openDatabase(file)
    try{
      const rows=reopened.sqlite.prepare('SELECT id,source_key k,source_name n FROM live_outages ORDER BY id').all() as Array<{id:string;k:string;n:string}>
      expect(rows.map(row=>row.k)).toEqual([storedSourceKey(endpoint),storedSourceKey('rtsps://op:senha-cam@cam.local/1'),storedSourceKey('ndi:ESTUDIO (vMix - Output 1)')])
      expect(rows.map(row=>row.n)).toEqual(['Câmera do leilão','rtsps://REDACTED:REDACTED@cam.local/1','ESTUDIO'])
      expect(JSON.stringify(rows)).not.toContain(SECRET);expect(JSON.stringify(rows)).not.toContain('senha-cam')
      expect(()=>assertLiveOutagesWithoutCredential(reopened.sqlite)).not.toThrow()
      expect(reopened.sqlite.prepare('SELECT name FROM schema_migrations WHERE version=59').get()).toEqual({name:'live-outage-source-identity'})
    }finally{reopened.sqlite.close()}
  })
})
