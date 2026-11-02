import {afterEach,beforeEach,describe,expect,it} from 'vitest'
import {eq} from 'drizzle-orm'
import type {EditScope} from '@rplayout/protocol'
import {openDatabase,type Db} from '../db/client.js'
import {channels,mediaAssets,rundownItems,rundowns} from '../db/schema.js'
import {EditorialVersions} from '../db/editorial-revisions.js'
import {inspectEditScope,requireScopeReview} from './scoped-edit-review.js'
let db:Db,versions:EditorialVersions
const read=(scope:EditScope='ALL_RUNDOWNS',id='one')=>db.transaction(tx=>inspectEditScope(tx,id,scope,rid=>versions.read(rid),()=>{}))
beforeEach(()=>{
  db=openDatabase(':memory:').db;versions=new EditorialVersions(db.$client);const now=new Date().toISOString()
  for(const id of ['a','b'])db.insert(channels).values({id,name:'Canal '+id,rateNum:25,rateDen:1,width:320,height:180,targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,createdAt:now}).run()
  for(const id of ['a','b'])db.insert(rundowns).values({id,channelId:id,name:'Grade '+id,date:id==='a'?'2026-10-02':'2026-10-03',plannedStart:0,loop:false,createdAt:now,updatedAt:now}).run()
  db.insert(mediaAssets).values({id:'media',title:'VT ÇÃO',path:'C:/privado.mp4',contentHash:'HASH',kind:'VIDEO',durationFrames:2500,rateNum:25,rateDen:1,createdAt:now}).run()
  for(const [id,rid] of [['one','a'],['two','b']] as const)db.insert(rundownItems).values({id,rundownId:rid,type:'VT',title:id,sortOrder:10,mediaId:'media',minDuration:0,anchor:{kind:'FLOW'},onOverrun:'PUSH',locked:false,autoNext:true,loop:false}).run()
})
afterEach(()=>db.$client.close())
describe('revisão dos alvos amplos',()=>{
  it('revisar não escreve nem altera contadores; resumo não expõe arquivo ou fonte privada',()=>{
    const before=db.$client.prepare('SELECT * FROM editorial_revision_counters ORDER BY scope,rundown_id,item_id').all(),review=read()
    expect(review).toMatchObject({itemId:'one',scope:'ALL_RUNDOWNS',itemsAffected:2,references:2,assetUpdated:false})
    expect(review.owners.map(owner=>[owner.channelName,owner.date,owner.count])).toEqual([['Canal a','2026-10-02',1],['Canal b','2026-10-03',1]])
    expect(JSON.stringify(review)).not.toContain('privado.mp4')
    expect(db.$client.prepare('SELECT * FROM editorial_revision_counters ORDER BY scope,rundown_id,item_id').all()).toEqual(before)
    expect(read().token).toBe(review.token)
  })
  it.each(['ALL_RUNDOWNS','ASSET_DEFAULT'] as const)('confirmação ampla é obrigatória, exata e não aceita token de outro escopo: %s',scope=>{
    const review=read(scope)
    expect(()=>requireScopeReview(review,undefined)).toThrow('Confira os canais')
    expect(()=>requireScopeReview(review,read('ITEM').token)).toThrow('mudaram depois')
    expect(()=>requireScopeReview(review,review.token)).not.toThrow()
  })
  it('origem com revisão inalterada não neutraliza alteração posterior exclusiva de outra grade',()=>{
    const old=read(),sourceVersion=versions.read('a')
    db.update(rundownItems).set({trim:{in:0,out:100}}).where(eq(rundownItems.id,'two')).run()
    expect(versions.read('a')).toBe(sourceVersion)
    expect(()=>requireScopeReview(read(),old.token)).toThrow('mudaram depois')
  })
  it.each(['new-reference','remove-reference','move-reference','asset-default','media-hash','cadence','archive','aba'])('alvos ou dependências superados não reutilizam revisão: %s',kind=>{
    const old=read('ASSET_DEFAULT')
    if(kind==='new-reference')db.insert(rundownItems).values({id:'new',rundownId:'b',type:'VT',title:'Novo',sortOrder:20,mediaId:'media',minDuration:0,anchor:{kind:'FLOW'},onOverrun:'PUSH',locked:false,autoNext:true,loop:false}).run()
    if(kind==='remove-reference')db.delete(rundownItems).where(eq(rundownItems.id,'two')).run()
    if(kind==='move-reference')db.update(rundownItems).set({rundownId:'a'}).where(eq(rundownItems.id,'two')).run()
    if(kind==='asset-default')db.update(mediaAssets).set({defaultAudio:{mode:'MANUAL',gainDb:-3,measured:null}}).where(eq(mediaAssets.id,'media')).run()
    if(kind==='media-hash')db.update(mediaAssets).set({contentHash:'NEW'}).where(eq(mediaAssets.id,'media')).run()
    if(kind==='cadence')db.update(channels).set({rateNum:50}).where(eq(channels.id,'b')).run()
    if(kind==='archive')db.update(channels).set({archivedAt:'now'}).where(eq(channels.id,'b')).run()
    if(kind==='aba'){
      db.update(rundownItems).set({notes:'Mudou'}).where(eq(rundownItems.id,'two')).run()
      db.update(rundownItems).set({notes:null}).where(eq(rundownItems.id,'two')).run()
    }
    expect(()=>requireScopeReview(read('ASSET_DEFAULT'),old.token)).toThrow('mudaram depois')
  })
  it('identidade da origem faz parte da revisão mesmo com mídia e alvos compartilhados',()=>{
    expect(read('ALL_RUNDOWNS','one').token).not.toBe(read('ALL_RUNDOWNS','two').token)
  })
})
