import {asc,eq} from 'drizzle-orm'
import type {Db} from '../db/client.js'
import {rundownItems,secondaryEvents} from '../db/schema.js'
import {readEditorialState} from './editorial-state.js'

/** Rows, rate and precondition belong to the same SQL read snapshot. */
export function readItemAutomationState(db:Db,itemId:string){
  return db.transaction(tx=>{
    const owner=tx.select().from(rundownItems).where(eq(rundownItems.id,itemId)).get()
    const state=owner&&readEditorialState(db,owner.rundownId)
    if(!state)return null
    const templates=state.templates.filter(template=>!template.channelId||template.channelId===state.channel.id)
    const names=new Map(templates.map(template=>[template.id,template.name]))
    return {itemId,rundownId:state.rundown.id,channelId:state.channel.id,editorialRevision:state.editorialRevision,rate:state.channel.rate,requiresPublication:true,
      templates,cues:state.cues.filter(row=>row.item_graphics.itemId===itemId).map(row=>({...row.item_graphics,templateName:names.get(row.item_graphics.templateId)??'Arte indisponível'})).sort((a,b)=>a.atSeconds-b.atSeconds||a.id.localeCompare(b.id)),
      events:tx.select().from(secondaryEvents).where(eq(secondaryEvents.itemId,itemId)).orderBy(asc(secondaryEvents.id)).all().map(row=>row.definition)}
  })
}
