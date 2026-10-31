import Fastify,{type FastifyInstance} from 'fastify'
import {createHash} from 'node:crypto'
import {mkdtemp,writeFile,readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {createApp,runtimeFor,type App} from '../app.js'
import {registerRoutes} from '../routes.js'
import {channels,rundowns,rundownItems,mediaAssets} from '../db/schema.js'
import {reviewedPublish} from './test-operational-review.js'
vi.mock('../config.js',async original=>({...await original<Record<string,unknown>>(),ENGINE_BINARY:'',MEDIAMTX_BINARY:'',DEVICES_BINARY:'',RELAY_BINARY:'',AUTH_USER:'',AUTH_PASSWORD:'',DEFAULT_ROLE:'ADMIN'}))
let primary:App,reserve:App,server:FastifyInstance,primaryServer:FastifyInstance,directory:string,clock:number
let requests:Array<{path:string;body:string;headers:Record<string,string>}>
const data=Buffer.from('ARQUIVO ORIGINAL DE APROVAÇÃO'),hash=createHash('sha256').update(data).digest('hex')
function configure(role:'PRIMARY'|'STANDBY'){
  for(const [key,value] of Object.entries({RPLAYOUT_HA_ROLE:role,RPLAYOUT_HA_CLUSTER:'httpmedia',RPLAYOUT_HA_NODE:role==='PRIMARY'?'a':'b',RPLAYOUT_HA_PEER_NODE:role==='PRIMARY'?'b':'a',RPLAYOUT_HA_KEY:'bd'.repeat(32),RPLAYOUT_HA_PEER:role==='PRIMARY'?'http://reserve.invalid':'',RPLAYOUT_HA_DB:':memory:',RPLAYOUT_HA_MEDIA_ROOT:join(directory,role),RPLAYOUT_HA_MEDIA_QUOTA_BYTES:'1048576'}))vi.stubEnv(key,value)
}
beforeEach(async()=>{
  directory=await mkdtemp(join(tmpdir(),'RPlayout-ha-media-http-'));const path=join(directory,'VÍDEO-ÇÃO.mp4');await writeFile(path,data)
  requests=[];clock=0;vi.spyOn(performance,'now').mockImplementation(()=>clock)
  vi.spyOn(globalThis,'fetch').mockImplementation(async(url,init)=>{
    const request={path:new URL(String(url)).pathname,body:String(init!.body),headers:init!.headers as Record<string,string>};requests.push(request)
    const response=await server.inject({method:'POST',url:request.path,payload:request.body,headers:request.headers});return new Response(response.body,{status:response.statusCode})
  })
  configure('PRIMARY');primary=await createApp(':memory:');const now=new Date().toISOString()
  primary.db.insert(channels).values({id:'ch',name:'CH',width:320,height:180,rateNum:25,rateDen:1,targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,createdAt:now}).run()
  primary.db.insert(rundowns).values({id:'rd',channelId:'ch',name:'Publicada',date:now.slice(0,10),plannedStart:0,loop:false,createdAt:now,updatedAt:now}).run()
  primary.db.insert(mediaAssets).values({id:'media',contentHash:hash,path,title:'Original',kind:'VIDEO',durationFrames:1000,hasAudio:false,createdAt:now}).run()
  primary.db.insert(rundownItems).values({id:'vt',rundownId:'rd',sortOrder:0,title:'Publicado',type:'VT',mediaId:'media',minDuration:0,anchor:{kind:'FLOW'},onOverrun:'PUSH',autoNext:false,loop:false,locked:false}).run()
  primaryServer=Fastify();registerRoutes(primary,primaryServer,()=>{});await primaryServer.ready();await(await runtimeFor(primary,'ch'))!.load('rd');await reviewedPublish(primaryServer,'rd')
  configure('STANDBY');reserve=await createApp(':memory:');reserve.sqlite.prepare('INSERT INTO users(id,username,password_hash,role,enabled,created_at) VALUES(?,?,?,?,1,?)').run('admin','admin','unused','ADMIN',now)
  server=Fastify();registerRoutes(reserve,server,()=>{});await server.ready();await primary.ha!.tick()
})
afterEach(async()=>{await server.close();await primaryServer.close();primary.close();reserve.close();await primary.ha!.settled();await reserve.ha!.settled();vi.restoreAllMocks();vi.unstubAllEnvs()})
const step=async()=>{clock+=1000;await primary.ha!.mediaTick(async asset=>asset.path)}
describe('fronteira HTTP de mídia HA',()=>{
  it('pareamento copia sem sessão, mas não instala canal ou runtime no reserva',async()=>{
    await step();await step();await step()
    expect(await readFile(join(directory,'STANDBY',hash+'.media'))).toEqual(data)
    expect(reserve.ha!.status().media).toMatchObject({required:1,verified:1,ready:false});expect(reserve.ha!.status().failoverReady).toBe(false)
    expect(reserve.runtimes.size).toBe(0);expect(reserve.db.select().from(channels).all()).toHaveLength(0)
    expect(JSON.stringify(requests)).not.toContain(data.toString('base64'))
  })
  it('prova de snapshot, token admin e prova de mídia não se substituem ou autorizam TAKE',async()=>{
    await step();const state=requests.find(row=>row.path==='/api/ha/replica')!,media=requests.find(row=>row.path==='/api/ha/media')!
    for(const headers of [state.headers,{'content-type':'application/json','x-rplayout-control-token':'bd'.repeat(32)}]){
      expect((await server.inject({method:'POST',url:'/api/ha/media',payload:media.body,headers})).statusCode).toBe(403)
    }
    expect((await server.inject({method:'POST',url:'/api/ha/replica',payload:state.body,headers:media.headers})).statusCode).toBe(403)
    expect((await server.inject({method:'POST',url:'/api/channels/ch/transport',payload:{action:'take',itemId:'vt'},headers:media.headers})).statusCode).toBe(409)
    expect(reserve.ha!.status().media.verified).toBe(0);expect(reserve.runtimes.size).toBe(0)
  })
  it('limite HTTP e cache privado conservam parcial não aprovado',async()=>{
    await step();const media=requests.find(row=>row.path==='/api/ha/media')!
    const repeat=await server.inject({method:'POST',url:media.path,payload:media.body,headers:media.headers})
    expect(repeat.statusCode).toBe(200);expect(repeat.headers['cache-control']).toBe('private, no-store');expect(repeat.json().progress.ready).toBe(false)
    const oversize=await server.inject({method:'POST',url:media.path,payload:JSON.stringify({data:'x'.repeat(1024*1024)}),headers:media.headers})
    expect(oversize.statusCode).toBe(413);expect(reserve.ha!.status().media.verified).toBe(0)
  })
})
