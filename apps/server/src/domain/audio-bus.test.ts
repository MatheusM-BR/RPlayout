import {afterEach,beforeEach,describe,it,expect} from 'vitest'
import {eq} from 'drizzle-orm'
import {openDatabase} from '../db/client.js'
import {channels,rundowns,rundownItems,mediaAssets} from '../db/schema.js'
import {getChannel,toAsset} from '../db/repo.js'
import {applyAudio} from './scopes.js'
import {assertChannelAudioChange,auxiliaryAudioError} from './audio-bus.js'
import {inspectOperationalPlaylist,publishOperationalPlaylist,inspectOperationalRollback,readOperationalPayload} from './operational-playlist.js'
import {assertOperationalCadence} from './operational-cadence.js'
let value:ReturnType<typeof openDatabase>
const audio={mode:'OFF' as const,gainDb:0,measured:null,auxiliaryPairs:[{outputPair:2,inputPair:2,gainDb:-6}]}
beforeEach(()=>{
  value=openDatabase(':memory:');const db=value.db,now=new Date().toISOString()
  for(const id of ['eight','two']){
    db.insert(channels).values({id,name:id,audioChannels:id==='eight'?8:2,width:320,height:180,rateNum:25,rateDen:1,targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,createdAt:now}).run()
    db.insert(rundowns).values({id,channelId:id,name:id,date:'2026-10-03',plannedStart:0,loop:false,createdAt:now,updatedAt:now}).run()
  }
  db.insert(mediaAssets).values({id:'asset',contentHash:'a'.repeat(64),path:'C:/ação.mkv',title:'Quatro canais',kind:'VIDEO',durationFrames:250,rateNum:25,rateDen:1,hasAudio:true,audioChannels:4,audioTracks:[{index:0,channels:4,rate:48000},{index:1,channels:2,rate:48000}],createdAt:now}).run()
  for(const id of ['eight','two'])db.insert(rundownItems).values({id,rundownId:id,mediaId:'asset',sortOrder:0,title:id,type:'VT',durationOverride:250,minDuration:0,anchor:{kind:'FLOW'},onOverrun:'PUSH',autoNext:true,loop:false,locked:false}).run()
})
afterEach(()=>value.sqlite.close())
describe('contrato editorial/operacional dos auxiliares',()=>{
  it('publicação e reexecução recusam TRIM AUTO cujo corte diverge do medido',async()=>{
    const routing={mode:'STEREO_1_2' as const},level={mode:'AUTO' as const,gainDb:0,analysisId:'job',routing,measured:{scope:'TRIM' as const,integratedLufs:-28,lra:2,truePeakDbtp:-6,measuredAt:new Date().toISOString(),input:{contentHash:'a'.repeat(64),audioTrack:0,routing,trim:{inNs:0,outNs:10e9}}}}
    value.db.update(rundownItems).set({audio:level}).where(eq(rundownItems.id,'eight')).run()
    const channel=(await getChannel(value.db,'eight'))!,row=await publishOperationalPlaylist(value.db,channel,'eight','QA'),payload=readOperationalPayload(row.payload)
    expect(()=>assertOperationalCadence(value.db,channel,payload)).not.toThrow()
    const changed={...payload,items:payload.items.map(item=>({...item,durationOverride:200}))}
    expect(()=>assertOperationalCadence(value.db,channel,changed)).toThrow('medição de áudio')
    value.db.update(rundownItems).set({durationOverride:200}).where(eq(rundownItems.id,'eight')).run()
    expect(()=>inspectOperationalPlaylist(value.db,'eight')).toThrow('medição de áudio')
  })
  it('escopo amplo e padrão compartilhado rejeitam canal estéreo sem escrita parcial',async()=>{
    const before=value.db.select().from(rundownItems).all()
    for(const scope of ['ALL_RUNDOWNS','ASSET_DEFAULT'] as const)await expect(applyAudio(value.db,'eight',audio,scope,undefined,0)).rejects.toThrow('2 canais')
    expect(value.db.select().from(rundownItems).all()).toEqual(before)
    expect(value.db.select().from(mediaAssets).get()?.defaultAudio).toBeNull()
  })
  it('track/ganho/auxiliares são atômicos e canal não é reduzido apagando pares',async()=>{
    await applyAudio(value.db,'eight',audio,'ITEM',undefined,0)
    await expect(applyAudio(value.db,'eight',audio,'ITEM',undefined,1)).rejects.toThrow('exige 4')
    const item=value.db.select().from(rundownItems).where(eq(rundownItems.id,'eight')).get()!
    expect(item.audio).toEqual(audio);expect(item.audioTrack).toBe(0)
    expect(()=>assertChannelAudioChange(value.db,'eight',2)).toThrow('2 canais')
    expect(()=>assertChannelAudioChange(value.db,'eight',16)).not.toThrow()
  })
  it('publicação congela total/pares; outro barramento bloqueia execução e rollback',async()=>{
    await applyAudio(value.db,'eight',audio,'ITEM',undefined,0)
    const channel=(await getChannel(value.db,'eight'))!,row=await publishOperationalPlaylist(value.db,channel,'eight','QA')
    const payload=readOperationalPayload(row.payload)
    expect(payload.audioChannels).toBe(8);expect(payload.items[0]?.audio?.auxiliaryPairs).toEqual(audio.auxiliaryPairs)
    value.db.update(channels).set({audioChannels:16}).where(eq(channels.id,'eight')).run()
    expect(()=>assertOperationalCadence(value.db,channel,payload)).toThrow('outro barramento')
    expect(()=>inspectOperationalRollback(value.db,'eight',row.id)).toThrow('outro barramento')
    const fresh=inspectOperationalPlaylist(value.db,'eight')
    expect(fresh.payload.audioChannels).toBe(16);expect(fresh.review.token).not.toBe(inspectOperationalPlaylist(value.db,'two').review.token)
  })
  it('publicação legada sem total é estéreo, não 8 presumido',async()=>{
    const channel=(await getChannel(value.db,'eight'))!
    expect(()=>assertOperationalCadence(value.db,channel,{})).toThrow('outro barramento')
    expect(()=>assertOperationalCadence(value.db,(awaitChannel()),{})).not.toThrow()
    function awaitChannel(){return {id:'two',rate:channel.rate}}
    value.db.update(rundownItems).set({audio:{...audio,auxiliaryPairs:[{outputPair:8,inputPair:1}]}}).where(eq(rundownItems.id,'eight')).run()
    expect(()=>inspectOperationalPlaylist(value.db,'eight')).toThrow('Par auxiliar')
  })
  it('probe parcial com zero legado é desconhecido, não ausência de áudio confirmada',()=>{
    const row=value.db.select().from(mediaAssets).get()!
    expect(auxiliaryAudioError(audio,8,toAsset({...row,audioChannels:null,audioTracks:null}),0)).toBeNull()
    expect(auxiliaryAudioError(audio,8,toAsset({...row,hasAudio:false,audioChannels:null,audioTracks:null}),0)).toContain('0 canal')
    expect(auxiliaryAudioError(audio,8,toAsset({...row,hasAudio:null,audioChannels:null,audioTracks:null}),0)).toBeNull()
    expect(auxiliaryAudioError(audio,8,toAsset({...row,hasAudio:null,audioChannels:2,audioTracks:null}),0)).toContain('exige 4')
  })
})
