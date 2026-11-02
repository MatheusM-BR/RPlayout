import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { openDatabase } from '../db/client.js'
import { channels, graphicTemplates, itemGraphics, rundownItems, rundowns, secondaryEvents } from '../db/schema.js'
import { createEditorialRundown } from './editorial-rundown.js'
let value:ReturnType<typeof openDatabase>
beforeEach(()=>{value=openDatabase(':memory:')})
afterEach(()=>value.sqlite.close())
const zones=[{id:'news',label:'Jornal — proteção',from:0,to:90000,priority:5 as const}]
async function fixture(){
  const {db}=value,now=new Date().toISOString()
  for(const id of ['a','b'])await db.insert(channels).values({id,name:id,rateNum:25,rateDen:1,width:320,height:180,targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,createdAt:now})
  await db.insert(rundowns).values({id:'source',channelId:'a',name:'Origem',date:'2026-10-01',plannedStart:1000,loop:false,protectedZones:zones,createdAt:now,updatedAt:now})
  for(const id of ['live','vt'])await db.insert(rundownItems).values({id,rundownId:'source',sortOrder:id==='live'?10:20,title:'Ação '+id,type:id==='live'?'LIVE':'VT',sourceRef:id==='live'?'ndi:Câmera — QA':null,
    eventType:id==='live'?'HARD_TIME':'SEQUENTIAL',durationOverride:2500,minDuration:25,anchor:{kind:'FLOW'},onOverrun:'TRIM_PREV',trimmable:true,optional:true,protected:true,
    liveSourceType:id==='live'?'NDI':null,liveEndpoint:id==='live'?'ndi:Câmera — QA':null,liveEstimatedDuration:2500,liveMaxDuration:3000,liveAutoFollowOnEnd:true,
    blockId:'block',locked:true,autoNext:false,loop:false,notes:'Preservar'})
  await db.insert(graphicTemplates).values({id:'cg',channelId:'a',name:'GC',svg:'<svg/>',fields:[],fadeMs:0,createdAt:now})
  await db.insert(itemGraphics).values({id:'cue',itemId:'live',templateId:'cg',values:{title:'Notícia'},atSeconds:2,createdAt:now})
  const definition={id:'event',channelId:'a',rundownItemId:'live',targetLayer:'LOWER_THIRD' as const,triggerMode:'OFFSET_FROM_START' as const,offsetFrames:25,templateId:'cg',payload:{title:'Ação'},enabled:true}
  await db.insert(secondaryEvents).values({id:'event',channelId:'a',itemId:'live',definition,createdAt:now,updatedAt:now})
}
describe('cópia integral e atômica da intenção editorial',()=>{
  it('preserva regras, live, zonas e grafismos com identidades novas, sem publicação/execução herdada',async()=>{
    await fixture()
    const {db,sqlite}=value
    const id=createEditorialRundown(db,{channelId:'a',date:'2026-10-02',name:'Cópia',copyFromRundownId:'source'})
    const copy=db.select().from(rundowns).where(eq(rundowns.id,id)).get()!
    expect(copy).toMatchObject({date:'2026-10-02',plannedStart:1000,loop:false,protectedZones:zones})
    const rows=db.select().from(rundownItems).where(eq(rundownItems.rundownId,id)).all()
    expect(rows).toHaveLength(2)
    expect(new Set(rows.map(row=>row.blockId)).size).toBe(1);expect(rows[0]!.blockId).not.toBe('block')
    const live=rows.find(row=>row.type==='LIVE')!
    expect(live).toMatchObject({eventType:'HARD_TIME',sourceRef:'ndi:Câmera — QA',liveEstimatedDuration:2500,liveMaxDuration:3000,liveAutoFollowOnEnd:true,trimmable:true,optional:true,protected:true,locked:true,autoNext:false})
    const cue=db.select().from(itemGraphics).where(eq(itemGraphics.itemId,live.id)).get()!
    expect(cue).toMatchObject({templateId:'cg',values:{title:'Notícia'},atSeconds:2});expect(cue.id).not.toBe('cue')
    const event=db.select().from(secondaryEvents).where(eq(secondaryEvents.itemId,live.id)).get()!
    expect(event.definition).toMatchObject({id:event.id,rundownItemId:live.id,offsetFrames:25,payload:{title:'Ação'}})
    expect(event.id).not.toBe('event')
    expect(JSON.stringify(sqlite.prepare('SELECT source_ref,live_endpoint FROM rundown_items WHERE id=?').get(live.id))).not.toContain('Câmera')
    for(const table of ['operational_playlist_revisions','secondary_event_runs','as_run'])expect(sqlite.prepare(`SELECT count(*) n FROM ${table}`).get()).toEqual({n:0})
    expect(db.select().from(rundownItems).where(eq(rundownItems.rundownId,'source')).all()).toHaveLength(2)
  })
  it('não cria grade vazia quando origem está ausente ou pertence a outro canal',async()=>{
    await fixture()
    for(const source of ['source','missing'])expect(()=>createEditorialRundown(value.db,{channelId:'b',date:'2026-10-02',name:'Recusada',copyFromRundownId:source})).toThrow('Nenhuma grade foi criada')
    expect(value.db.select().from(rundowns).all()).toHaveLength(1)
  })
  it('uma falha durante grafismo desfaz a grade e todos os itens já copiados',async()=>{
    await fixture()
    value.sqlite.exec("CREATE TRIGGER fail_clone BEFORE INSERT ON item_graphics WHEN NEW.id != 'cue' BEGIN SELECT RAISE(ABORT,'falha de teste'); END")
    expect(()=>createEditorialRundown(value.db,{channelId:'a',date:'2026-10-02',name:'Recusada',copyFromRundownId:'source'})).toThrow('falha de teste')
    expect(value.db.select().from(rundowns).all()).toHaveLength(1)
    expect(value.db.select().from(rundownItems).all()).toHaveLength(2)
    expect(value.db.select().from(itemGraphics).all()).toHaveLength(1)
    expect(value.db.select().from(secondaryEvents).all()).toHaveLength(1)
  })
})
