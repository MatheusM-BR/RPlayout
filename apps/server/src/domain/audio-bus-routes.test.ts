import Fastify,{type FastifyInstance} from 'fastify'
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {createApp,runtimeFor,type App} from '../app.js'
import {registerRoutes} from '../routes.js'
import {channels,rundowns,rundownItems,operationalPlaylistRevisions} from '../db/schema.js'
import {publishOperationalPlaylist} from './operational-playlist.js'
import {getChannel} from '../db/repo.js'
import {channelConfigurationETag} from '@rplayout/protocol'
import {configurationRevision} from '../db/channel-configuration.js'
vi.mock('../config.js',async original=>({...await original<Record<string,unknown>>(),ENGINE_BINARY:'',MEDIAMTX_BINARY:'',DEVICES_BINARY:'',AUTH_USER:'',AUTH_PASSWORD:'',DEFAULT_ROLE:'ADMIN'}))
let app:App,server:FastifyInstance
beforeEach(async()=>{
  app=await createApp(':memory:');const now=new Date().toISOString()
  app.db.insert(channels).values({id:'ch',name:'QA',width:320,height:180,rateNum:25,rateDen:1,targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,createdAt:now}).run()
  app.db.insert(rundowns).values({id:'rd',channelId:'ch',name:'QA',date:'2026-10-03',plannedStart:0,loop:false,createdAt:now,updatedAt:now}).run()
  app.db.insert(rundownItems).values({id:'live',rundownId:'rd',sortOrder:0,title:'CAM',type:'LIVE',sourceRef:'ndi:CAM',durationOverride:2500,minDuration:0,anchor:{kind:'FLOW'},onOverrun:'PUSH',autoNext:false,loop:false,locked:false}).run()
  server=Fastify();registerRoutes(app,server,()=>{});await server.ready();await app.sources.list()
  await (await runtimeFor(app,'ch'))!.load('rd')
})
afterEach(async()=>{await server.close();app.close()})
const patch=(payload:object)=>server.inject({method:'PATCH',url:'/api/channels/ch',payload,headers:{'if-match':channelConfigurationETag('ch',configurationRevision(app.db,'ch'))}})
const apply=(audio:object)=>server.inject({method:'POST',url:'/api/items/live/audio',headers:{'if-match':app.concurrency.generateETag('rd')},payload:{scope:'ITEM',audioTrack:0,audio:{mode:'OFF',gainDb:0,measured:null,...audio}}})
describe('barramento configurável sem mudança implícita de PGM',()=>{
  it('exige leitura anterior e total 2/8/16; dados não mudam em recusa',async()=>{
    expect((await patch({audioChannels:4,expectedAudioChannels:2})).statusCode).toBe(400)
    expect((await patch({audioChannels:8})).statusCode).toBe(428)
    expect((await patch({audioChannels:8,expectedAudioChannels:16})).statusCode).toBe(409)
    expect((await getChannel(app.db,'ch'))!.audioChannels).toBe(2)
  })
  it('CUE ou PGM ativo impede alteração sem apagar seleção',async()=>{
    const runtime=app.runtimes.get('ch')!
    await runtime.transport.cue({kind:'ITEM',id:'live'})
    expect((await patch({audioChannels:8,expectedAudioChannels:2})).statusCode).toBe(409)
    expect(runtime.transport.state().preview).toEqual({kind:'ITEM',id:'live'})
    await runtime.transport.cue(null);await runtime.transport.take('rd','live')
    expect((await patch({audioChannels:8,expectedAudioChannels:2})).statusCode).toBe(409)
    expect(runtime.transport.state().onAir?.itemId).toBe('live')
  })
  it('mudança invalida publicação, preserva histórico e permite corrigir/republish',async()=>{
    const original=await publishOperationalPlaylist(app.db,(await getChannel(app.db,'ch'))!,'rd','QA')
    const changed=await patch({audioChannels:8,expectedAudioChannels:2})
    expect(changed.statusCode,changed.body).toBe(200)
    expect(app.db.select().from(operationalPlaylistRevisions).get()).toMatchObject({id:original.id,active:false,payload:original.payload})
    expect(app.db.select().from(rundowns).get()?.publicationRequired).toBe(true)
    expect(app.runtimes.get('ch')!.executionView).toBeNull()
    const result=await apply({auxiliaryPairs:[{outputPair:2,inputPair:2,gainDb:-6}]})
    expect(result.statusCode,result.body).toBe(200)
    const fresh=await publishOperationalPlaylist(app.db,(await getChannel(app.db,'ch'))!,'rd','QA')
    expect(fresh.payload.audioChannels).toBe(8)
    expect((await patch({audioChannels:2,expectedAudioChannels:8})).statusCode).toBe(409)
    expect((await getChannel(app.db,'ch'))!.audioChannels).toBe(8)
  })
  it('auxiliares inválidos não são descartados silenciosamente pelo schema',async()=>{
    const changed=await patch({audioChannels:8,expectedAudioChannels:2});expect(changed.statusCode,changed.body).toBe(200)
    for(const pair of [{outputPair:1,inputPair:1},{outputPair:2,inputPair:1,gainDb:13},{outputPair:2,inputPair:1,unknown:true}])expect((await apply({auxiliaryPairs:[pair]})).statusCode).toBe(400)
    expect((await apply({auxiliaryPairs:[{outputPair:2,inputPair:1},{outputPair:2,inputPair:2}]})).statusCode).toBe(409)
    expect(app.db.select().from(rundownItems).get()?.audio).toBeNull()
  })
})
