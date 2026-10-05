import { afterEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../db/client.js'
import { channels, rundowns, rundownItems, graphicTemplates, itemGraphics, secondaryEvents,channelProjectSnapshots,operationalPlaylistRevisions } from '../db/schema.js'
import { eq } from 'drizzle-orm'
import { restoreChannelProject, saveChannelProject } from './channel-projects.js'
const databases:ReturnType<typeof openDatabase>[]=[]
afterEach(()=>{for(const value of databases.splice(0)) value.sqlite.close()})

describe('projetos preservam a programação editorial de gráficos',()=>{
  it('restaura deixas e eventos sem apagar os de outro canal',async()=>{
    const value=openDatabase(':memory:');databases.push(value)
    const db=value.db,now=new Date().toISOString()
    for(const id of ['a','b']) {
      await db.insert(channels).values({id,name:id,rateNum:25,rateDen:1,width:320,height:180,targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,createdAt:now})
      await db.insert(rundowns).values({id:'rd-'+id,channelId:id,name:id,date:'2026-09-30',plannedStart:0,loop:false,createdAt:now,updatedAt:now})
      await db.insert(rundownItems).values({id:'item-'+id,rundownId:'rd-'+id,sortOrder:0,title:id,type:'LIVE',durationOverride:250,minDuration:0,anchor:{kind:'FLOW'},onOverrun:'PUSH',locked:false,autoNext:true,loop:false})
      await db.insert(graphicTemplates).values({id:'cg-'+id,channelId:id,name:id,svg:'<svg>'+id+'</svg>',fields:[],fadeMs:0,createdAt:now})
      await db.insert(itemGraphics).values({id:'cue-'+id,itemId:'item-'+id,templateId:'cg-'+id,values:{},atSeconds:2,createdAt:now})
      const definition={id:'event-'+id,channelId:id,rundownItemId:'item-'+id,targetLayer:'LOWER_THIRD' as const,triggerMode:'MANUAL' as const,offsetFrames:0,templateId:'cg-'+id,payload:{},enabled:true}
      await db.insert(secondaryEvents).values({id:definition.id,channelId:id,itemId:'item-'+id,definition,createdAt:now,updatedAt:now})
    }
    const project=await saveChannelProject(db,'a','Antes')
    await db.insert(operationalPlaylistRevisions).values({id:'pub-a',rundownId:'rd-a',revision:1,state:'PUBLISHED',active:true,payload:{version:1,evidence:'immutable'},publishedAt:now})
    await db.delete(itemGraphics).where(eq(itemGraphics.itemId,'item-a'))
    await db.delete(secondaryEvents).where(eq(secondaryEvents.channelId,'a'))
    await restoreChannelProject(db,'a',project.id)
    expect((await db.select().from(itemGraphics)).map(row=>row.id).sort()).toEqual(['cue-a','cue-b'])
    expect((await db.select().from(secondaryEvents)).map(row=>row.id).sort()).toEqual(['event-a','event-b'])
    expect((await db.select().from(operationalPlaylistRevisions)).map(row=>row.id)).toEqual(['pub-a'])
    const [snapshot]=await db.select().from(channelProjectSnapshots)
    expect((snapshot!.payload as any).secondaryEvents[0].id).toBe('event-a')
    await expect(restoreChannelProject(db,'b',project.id)).rejects.toThrow('não pertence')
    await db.update(channels).set({rateNum:50}).where(eq(channels.id,'a'))
    await expect(restoreChannelProject(db,'a',project.id)).rejects.toThrow('cadência')
    expect((await db.select().from(channels).where(eq(channels.id,'a')))[0]!.rateNum).toBe(50)
    await db.update(channels).set({rateNum:25}).where(eq(channels.id,'a'))
    await db.insert(rundowns).values({id:'new-a',channelId:'a',name:'Nova publicada',date:'2026-10-01',plannedStart:0,loop:false,createdAt:now,updatedAt:now})
    await db.insert(operationalPlaylistRevisions).values({id:'pub-new',rundownId:'new-a',revision:1,state:'PUBLISHED',active:true,payload:{version:1},publishedAt:now})
    await expect(restoreChannelProject(db,'a',project.id)).rejects.toThrow('histórico publicado')
    expect((await db.select().from(operationalPlaylistRevisions)).map(row=>row.id).sort()).toEqual(['pub-a','pub-new'])
  })
})
