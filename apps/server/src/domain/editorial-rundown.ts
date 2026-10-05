import { randomUUID } from 'node:crypto'
import { and, asc, eq, inArray } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { itemGraphics, rundownItems, rundowns, secondaryEvents } from '../db/schema.js'
import { rundownMidnight } from './rundown-clock.js'

export class EditorialRundownError extends Error {}

/** Clona a intenção editorial inteira; não clona publicação, as-run ou ledger.
 * A transação impede uma grade parcialmente copiada e lê uma só revisão local. */
export function createEditorialRundown(db: Db, options: {channelId:string;date:string;name:string;copyFromRundownId?:string}): string {
  if (rundownMidnight(options.date) === null) throw new EditorialRundownError('Data de calendário inválida. Nenhuma grade foi criada.')
  return db.transaction(tx => {
    const source = options.copyFromRundownId ? tx.select().from(rundowns)
      .where(and(eq(rundowns.id,options.copyFromRundownId),eq(rundowns.channelId,options.channelId))).get() : null
    if(options.copyFromRundownId && !source)throw new EditorialRundownError('A grade de origem não existe neste canal. Nenhuma grade foi criada.')
    const id=randomUUID(),now=new Date().toISOString()
    tx.insert(rundowns).values({id,channelId:options.channelId,name:options.name,date:options.date,
      plannedStart:source?.plannedStart ?? 0,loop:source?.loop ?? true,protectedZones:source?.protectedZones ?? [],publicationRequired:source?.publicationRequired ?? false,createdAt:now,updatedAt:now}).run()
    if(!source)return id
    const rows=tx.select().from(rundownItems).where(eq(rundownItems.rundownId,source.id)).orderBy(asc(rundownItems.sortOrder),asc(rundownItems.id)).all()
    const items=new Map(rows.map(row=>[row.id,randomUUID()])),blocks=new Map<string,string>()
    for(const row of rows){
      if(row.blockId && !blocks.has(row.blockId))blocks.set(row.blockId,randomUUID())
      tx.insert(rundownItems).values({...row,id:items.get(row.id)!,rundownId:id,blockId:row.blockId ? blocks.get(row.blockId)! : null}).run()
    }
    if(!rows.length)return id
    for(const cue of tx.select().from(itemGraphics).where(inArray(itemGraphics.itemId,[...items.keys()])).all()){
      tx.insert(itemGraphics).values({...cue,id:randomUUID(),itemId:items.get(cue.itemId)!,createdAt:now}).run()
    }
    for(const event of tx.select().from(secondaryEvents).where(and(eq(secondaryEvents.channelId,options.channelId),inArray(secondaryEvents.itemId,[...items.keys()]))).all()){
      const eventId=randomUUID(),itemId=items.get(event.itemId)!
      tx.insert(secondaryEvents).values({...event,id:eventId,itemId,definition:{...event.definition,id:eventId,rundownItemId:itemId},createdAt:now,updatedAt:now}).run()
    }
    return id
  })
}
