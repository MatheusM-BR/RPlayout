import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { openDatabase } from '../db/client.js'
import { channels,mediaAssets,rundowns,rundownItems,qcDecisions } from '../db/schema.js'
import { getChannel } from '../db/repo.js'
import { publishOperationalPlaylist } from './operational-playlist.js'
import { publishedCachePlan } from './published-cache-plan.js'
import type { Channel } from '@rplayout/protocol'

let database:ReturnType<typeof openDatabase>, channel:Channel
const now = new Date(2026,9,1,12), createdAt=now.toISOString()
beforeEach(async()=>{
  database=openDatabase(':memory:')
  for (const id of ['ch','other']) await database.db.insert(channels).values({id,name:id,rateNum:25,rateDen:1,width:320,height:180,targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,createdAt})
  channel=(await getChannel(database.db,'ch'))!
})
afterEach(()=>database.sqlite.close())

async function edition(id:string,date:string,startHours:number,options:{channelId?:string;published?:boolean;assetId?:string;hash?:string;qc?:'APPROVED'|'PENDING';live?:boolean;durationHours?:number}={}) {
  const channelId=options.channelId??'ch', assetId=options.assetId??`asset-${id}`,hash=options.hash??id.padEnd(64,'a').slice(0,64)
  await database.db.insert(mediaAssets).values({id:assetId,title:assetId,path:`C:/Acervo/AÇÃO-${id}.mp4`,contentHash:hash,kind:'VIDEO',durationFrames:(options.durationHours??1)*25*3600, qcStatus:options.qc??'APPROVED',createdAt}).onConflictDoNothing()
  await database.db.insert(rundowns).values({id,channelId,name:id,date,plannedStart:startHours*3600*25,loop:false,createdAt,updatedAt:createdAt})
  await database.db.insert(rundownItems).values({id:`item-${id}`,rundownId:id,sortOrder:0,title:id,type:options.live?'LIVE':'VT',mediaId:options.live?null:assetId,sourceRef:options.live?'ndi:ESTÚDIO':null,durationOverride:(options.durationHours??1)*3600*25,minDuration:0,anchor:{kind:'FLOW'},onOverrun:'PUSH',locked:false,autoNext:true,loop:false})
  if (options.published!==false) await publishOperationalPlaylist(database.db,(await getChannel(database.db,channelId))!,id,'test')
  return {assetId,hash}
}

describe('pré-cópia futura por revisão publicada',()=>{
  it('separa 48h/7d, ignora edição não publicada, outro canal e limites já passados',async()=>{
    await edition('b','2026-10-01',13)
    await edition('c','2026-10-03',11)
    await edition('d','2026-10-03',12)
    await edition('e','2026-10-08',11)
    await edition('f','2026-10-08',12)
    await edition('a','2026-10-01',11)
    await edition('a1','2026-10-02',1,{published:false})
    await edition('a2','2026-10-02',1,{channelId:'other'})
    const plan=await publishedCachePlan(database.db,channel,now)
    expect(plan.assets48h.map(asset=>asset.id)).toEqual(['asset-b','asset-c'])
    expect(plan.assets7d.map(asset=>asset.id)).toEqual(['asset-b','asset-c','asset-d','asset-e'])
    expect(plan.revisions.map(row=>row.rundownId)).toEqual(['b','c','d','e'])
    expect(plan.criticalUntil).toBe(new Date(now.getTime()+48*3600_000).toISOString())
  })
  it('inclui arquivo iniciado ontem que atravessa a meia-noite, sem repetir loop',async()=>{
    await edition('a','2026-09-30',23,{durationHours:14})
    await database.db.update(rundowns).set({loop:true}).where(eq(rundowns.id,'a'))
    const plan=await publishedCachePlan(database.db,channel,now)
    expect(plan.assets48h).toHaveLength(1)
    expect(plan.revisions).toHaveLength(1)
  })
  it('conserva versão publicada apesar de fonte/caminho/hash editados, preferindo arquivo arquivado',async()=>{
    const {assetId,hash}=await edition('a','2026-10-01',13)
    await database.db.update(mediaAssets).set({contentHash:'b'.repeat(64),path:'C:/ALTERADO.mp4',qcStatus:'PENDING'}).where(eq(mediaAssets.id,assetId))
    await database.db.update(rundowns).set({date:'2027-01-01'}).where(eq(rundowns.id,'a'))
    const archive=vi.fn(async()=>`C:/Versões/${hash}.mp4`)
    const plan=await publishedCachePlan(database.db,channel,now,archive)
    expect(plan.assets48h).toMatchObject([{id:assetId,contentHash:hash,path:`C:/Versões/${hash}.mp4`}])
    expect(archive).toHaveBeenCalledWith(assetId,hash)
  })
  it('reprovação posterior por canal bloqueia a versão, não reutiliza aprovação de outro canal',async()=>{
    const {assetId,hash}=await edition('a','2026-10-01',13)
    await database.db.insert(qcDecisions).values({id:'decision',assetId,contentHash:hash,channelId:'ch',status:'REJECTED',notes:'Sinal inválido',checks:{playable:false,errors:['Sinal inválido'],warnings:[]},actor:'test',createdAt})
    const plan=await publishedCachePlan(database.db,channel,now)
    expect(plan.assets48h).toEqual([])
    expect(plan.blockedItems).toBe(1)
  })
  it('não copia entrada live, mídia pendente nem hash legado e elimina conteúdos duplicados',async()=>{
    await edition('a','2026-10-01',13,{hash:'a'.repeat(64)})
    await edition('b','2026-10-01',14,{hash:'a'.repeat(64)})
    await edition('c','2026-10-01',15,{qc:'PENDING'})
    await edition('d','2026-10-01',16,{hash:'legacy-hash'})
    await edition('e','2026-10-01',17,{live:true})
    const plan=await publishedCachePlan(database.db,channel,now)
    expect(plan.assets48h).toHaveLength(1)
    expect(plan.blockedItems).toBe(1)
    expect(plan.unversionedItems).toBe(1)
  })
  it('recusa revisão com data inválida e não esconde a falha',async()=>{
    await edition('a','2026-10-99',13)
    // Editorial corrections do not silently repair an invalid frozen edition.
    await database.db.update(rundowns).set({date:'2026-10-02'}).where(eq(rundowns.id,'a'))
    await expect(publishedCachePlan(database.db,channel,now)).rejects.toThrow('Data/cadência inválida')
  })
})
