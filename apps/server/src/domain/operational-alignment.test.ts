import {beforeEach,afterEach,describe,it,expect} from 'vitest'
import {randomUUID} from 'node:crypto'
import {openDatabase} from '../db/client.js'
import {channels,rundowns,rundownItems,mediaAssets,operationalPlaylistRevisions,operatorDecisions} from '../db/schema.js'
import {getChannel} from '../db/repo.js'
import {publishOperationalPlaylist,readOperationalPayload} from './operational-playlist.js'
import type {CompensationContext} from './operational-compensation.js'
import {inspectAlignment,commitAlignment,type AlignmentInput} from './operational-alignment.js'
import {addCutMark} from './cut-marks.js'

let database:ReturnType<typeof openDatabase>,context:CompensationContext,tail:string,middle:string
const revision=()=>database.db.select().from(operationalPlaylistRevisions).all().find(row=>row.active)!
const payload=()=>readOperationalPayload(revision().payload)
const review=(input:AlignmentInput,ctx=context)=>inspectAlignment(database.db,ctx,input,'operador').review
beforeEach(async()=>{
  database=openDatabase(':memory:');const db=database.db,now=new Date().toISOString()
  db.insert(channels).values({id:'ch',name:'Canal',rateNum:25,rateDen:1,width:320,height:180,targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,createdAt:now}).run()
  db.insert(rundowns).values({id:'rd',channelId:'ch',name:'Leilão',date:'2026-10-28',plannedStart:0,loop:false,createdAt:now,updatedAt:now}).run()
  // VT de 200 s e vinheta de 10 s
  db.insert(mediaAssets).values([{id:'asset',path:'C:/vt.mkv',contentHash:'a'.repeat(64),title:'VT',kind:'VIDEO',durationFrames:5000,durationNs:200_000_000_000,rateNum:25,rateDen:1,qcStatus:'APPROVED',createdAt:now},{id:'fill',path:'C:/vinheta.mkv',contentHash:'b'.repeat(64),title:'Vinheta 10 s',kind:'VIDEO',durationFrames:250,durationNs:10_000_000_000,rateNum:25,rateDen:1,qcStatus:'APPROVED',createdAt:now}]).run()
  for(const [order,id] of ['live','vt','optional','hard'].entries())db.insert(rundownItems).values({id,rundownId:'rd',sortOrder:order,title:id,type:id==='live'?'LIVE':'VT',sourceRef:id==='live'?'ndi:CAM':null,mediaId:id==='live'?null:'asset',durationOverride:1000,trim:id==='live'?null:{in:0,out:1000},minDuration:0,elastic:null,protected:false,optional:id==='optional',trimmable:false,anchor:id==='hard'?{kind:'HARD_TIME',at:10000}:{kind:'FLOW'},onOverrun:'PUSH',autoNext:true,loop:false,locked:false}).run()
  const published=await publishOperationalPlaylist(db,(await getChannel(db,'ch'))!,'rd','programador')
  context={channelId:'ch',rundownId:'rd',revisionId:published.id,executionId:'occ-1',onAirItemId:'live',onAir:{itemId:'live',startedAt:0,elapsed:20},preview:null}
  tail=addCutMark(db,{assetId:'asset',contentHash:'a'.repeat(64),fromMs:30_000,toMs:200_000},'qc').id
  middle=addCutMark(db,{assetId:'asset',contentHash:'a'.repeat(64),fromMs:10_000,toMs:20_000},'qc').id
})
afterEach(()=>database.sqlite.close())

describe('alinhamento até o item em foco',()=>{
  it('conferência mostra quanto cada ajuste muda a chegada ao horário fixo',()=>{
    expect(review({focusItemId:'hard',actions:[{kind:'INSERT',mediaId:'fill'}]})).toMatchObject({beforeArrival:3000,afterArrival:3250,arrivalDeltaFrames:250,lines:[{kind:'INSERT',frames:250}]})
    expect(review({focusItemId:'hard',actions:[{kind:'DROP',itemId:'optional'}]}).arrivalDeltaFrames).toBe(-1000)
    expect(review({focusItemId:'hard',actions:[{kind:'CUT',itemId:'vt',markId:tail}]}).arrivalDeltaFrames).toBe(-250)
  })
  it('aplica tudo numa revisão só, no plano publicado, sem mexer na grade editável; repetir o pedido não duplica',()=>{
    const input:AlignmentInput={focusItemId:'hard',actions:[{kind:'CUT',itemId:'vt',markId:tail},{kind:'DROP',itemId:'optional'},{kind:'INSERT',mediaId:'fill'},{kind:'INSERT',mediaId:'fill'}]}
    const checked=review(input),requestId=randomUUID()
    expect(checked.afterArrival).toBe(1000+750+250+250)
    const first=commitAlignment(database.db,context,input,requestId,checked.reviewToken,'operador',()=>{})
    expect(first.deduplicated).toBe(false)
    expect(payload().items.map(item=>item.id)).toEqual(['live','vt',`align:${requestId}:2`,`align:${requestId}:3`,'hard'])
    expect(payload().items.find(item=>item.id==='vt')!.trim).toEqual({in:0,out:750})
    expect(payload().items.find(item=>item.id===`align:${requestId}:2`)).toMatchObject({optional:true,mediaId:'fill'})
    expect(payload().operation).toMatchObject({kind:'ALIGNMENT',focusItemId:'hard'})
    expect(database.db.select().from(rundownItems).all().map(row=>row.id).sort()).toEqual(['hard','live','optional','vt'])
    expect(commitAlignment(database.db,{...context,revisionId:revision().id},input,requestId,checked.reviewToken,'operador',()=>{})).toMatchObject({deduplicated:true})
    expect(database.db.select().from(operatorDecisions).all().filter(row=>row.kind==='OPERATIONAL_ALIGNMENT')).toHaveLength(1)
  })
  it('recusa o que não pode: item obrigatório, corte no meio, item já no ar, item no CUE, token velho',()=>{
    expect(()=>review({focusItemId:'hard',actions:[{kind:'DROP',itemId:'vt'}]})).toThrow(/opcional/)
    expect(()=>review({focusItemId:'hard',actions:[{kind:'CUT',itemId:'vt',markId:middle}]})).toThrow(/meio/)
    expect(()=>review({focusItemId:'live',actions:[{kind:'INSERT',mediaId:'fill'}]})).toThrow(/já entrou/)
    expect(()=>review({focusItemId:'hard',actions:[{kind:'CUT',itemId:'vt',markId:tail}]},{...context,preview:{kind:'ITEM',id:'vt'}})).toThrow(/CUE/)
    const input:AlignmentInput={focusItemId:'hard',actions:[{kind:'DROP',itemId:'optional'}]}
    const stale=review(input)
    database.sqlite.prepare("UPDATE media_assets SET qc_status='APPROVED' WHERE id='fill'").run()
    addCutMark(database.db,{assetId:'asset',contentHash:'a'.repeat(64),fromMs:40_000,toMs:200_000},'qc')
    expect(()=>commitAlignment(database.db,context,input,randomUUID(),stale.reviewToken,'operador',()=>{})).toThrow(/mudaram/)
  })
})
