import { eq, inArray } from 'drizzle-orm'
import {createHash} from 'node:crypto'
import type { Db } from '../db/client.js'
import { mediaAssets, rundownItems, itemGraphics, secondaryEvents, rundowns,channels } from '../db/schema.js'
import {CollaborativeEditError} from './collaborative-edit.js'

type ItemRow = typeof rundownItems.$inferSelect
type AssetRow = typeof mediaAssets.$inferSelect

/**
 * O que uma operação pode ter mexido. Guardar só isso, em vez do banco
 * inteiro, é o que permite desfazer sem carregar a grade toda a cada clique.
 */
export interface Target {
  /** A operação mexe na ordem ou na quantidade de itens da grade. */
  readonly wholeRundown?: boolean
  readonly itemIds?: readonly string[]
  readonly assetIds?: readonly string[]
  readonly protectedZones?:boolean
  readonly itemAutomation?:boolean
}

interface Frame {
  readonly label: string
  readonly target: Target
  readonly rundownId: string
  readonly items: ItemRow[]
  readonly assets: AssetRow[]
  readonly cues: (typeof itemGraphics.$inferSelect)[]
  readonly events: (typeof secondaryEvents.$inferSelect)[]
  readonly protectedZones?:(typeof rundowns.$inferSelect)['protectedZones']
  readonly cadence: {id:string;channelId:string;rateNum:number;rateDen:number}[]
  readonly assetReferences:{id:string;rundownId:string;mediaId:string|null;state:string}[]
  expected?:string
}
export interface HistoryFootprint {rundownIds:string[];itemIds:string[];assetIds:string[];wholeRundownId?:string;restoredItemIds?:string[];deviceAutomation?:boolean}
export type HistoryGuard=(db:Pick<Db,'select'>,footprint:HistoryFootprint)=>void
export type HistoryCapture=(()=>void)&{seal:()=>void}
export function sealHistoryCapture(remember?:()=>void):void{
  const pending=remember as Partial<HistoryCapture>|undefined
  pending?.seal?.()
}

export interface HistoryState {
  readonly canUndo: boolean
  readonly canRedo: boolean
  readonly undoLabel: string | null
  readonly redoLabel: string | null
}

const EMPTY: HistoryState = { canUndo: false, canRedo: false, undoLabel: null, redoLabel: null }

/** Passos guardados por grade. Além disso, o operador já não lembra o que fez. */
const LIMIT = 50

function readNow(
  db: Pick<Db,'select'>,
  rundownId: string,
  label: string,
  target: Target,
): Frame {
  const items = target.wholeRundown
    ? db.select().from(rundownItems).where(eq(rundownItems.rundownId, rundownId)).all()
    : target.itemIds && target.itemIds.length > 0
      ? db.select().from(rundownItems).where(inArray(rundownItems.id, [...target.itemIds])).all()
      : []

  const assets =
    target.assetIds && target.assetIds.length > 0
      ? db.select().from(mediaAssets).where(inArray(mediaAssets.id, [...target.assetIds])).all()
      : []

  const cues = (target.wholeRundown || target.itemAutomation) && items.length > 0
    ? db.select().from(itemGraphics).where(inArray(itemGraphics.itemId, items.map((item) => item.id))).all()
    : []
  const events=(target.wholeRundown || target.itemAutomation) && items.length>0
    ? db.select().from(secondaryEvents).where(inArray(secondaryEvents.itemId,items.map(item=>item.id))).all()
    : []
  // A default affects existing inheritors, not just reference IDs. Seal their
  // state too, without retaining all of their private/full rows in every frame.
  const assetReferences=assets.length?db.select().from(rundownItems).where(inArray(rundownItems.mediaId,assets.map(asset=>asset.id))).all().map(item=>({id:item.id,rundownId:item.rundownId,mediaId:item.mediaId,state:createHash('sha256').update(JSON.stringify(canonical(item))).digest('hex')})):[]
  const ids=[...new Set([rundownId,...items.map(item=>item.rundownId),...assetReferences.map(item=>item.rundownId)])]
  const cadence=db.select({id:rundowns.id,channelId:rundowns.channelId,rateNum:channels.rateNum,rateDen:channels.rateDen}).from(rundowns).innerJoin(channels,eq(channels.id,rundowns.channelId)).where(inArray(rundowns.id,ids)).all()
  const protectedZones=target.protectedZones?db.select({zones:rundowns.protectedZones}).from(rundowns).where(eq(rundowns.id,rundownId)).get()?.zones:undefined
  return { label, target, rundownId, items, assets, cues, events,cadence,assetReferences,...(target.protectedZones?{protectedZones}:{} ) }
}
function canonical(value:unknown):unknown{
  if(Array.isArray(value))return value.map(canonical)
  if(value && typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,entry])=>[key,canonical(entry)]))
  return value
}
function fingerprint(frame:Frame):string{
  const sorted=<T extends {id:string}>(rows:readonly T[])=>[...rows].sort((a,b)=>a.id.localeCompare(b.id))
  return createHash('sha256').update(JSON.stringify(canonical({items:sorted(frame.items),assets:sorted(frame.assets).map(asset=>({id:asset.id,contentHash:asset.contentHash,defaultTrim:asset.defaultTrim,defaultTrimRateNum:asset.defaultTrimRateNum,defaultTrimRateDen:asset.defaultTrimRateDen,defaultAudio:asset.defaultAudio})),cues:sorted(frame.cues),events:sorted(frame.events),cadence:sorted(frame.cadence),assetReferences:sorted(frame.assetReferences),protectedZones:frame.protectedZones}))).digest('hex')
}

function restore(tx:Pick<Db,'select'|'insert'|'update'|'delete'>,frame:Frame):void{
  if (frame.target.wholeRundown) {
    // Ordem e quantidade voltam juntas: reescreve a grade como ela estava.
    const currentIds=tx.select({id:rundownItems.id}).from(rundownItems).where(eq(rundownItems.rundownId,frame.rundownId)).all().map(item=>item.id)
    const eventItemIds=[...new Set([...currentIds,...frame.items.map(item=>item.id)])]
    if(eventItemIds.length)tx.delete(secondaryEvents).where(inArray(secondaryEvents.itemId,eventItemIds)).run()
    tx.delete(rundownItems).where(eq(rundownItems.rundownId, frame.rundownId)).run()
    for (const item of frame.items) tx.insert(rundownItems).values(item).run()
    for (const cue of frame.cues) tx.insert(itemGraphics).values(cue).run()
    for (const event of frame.events) tx.insert(secondaryEvents).values(event).run()
  } else {
    for (const item of frame.items) {
      tx.update(rundownItems).set(item).where(eq(rundownItems.id, item.id)).run()
    }
    if(frame.target.itemAutomation && frame.items.length){
      const ids=frame.items.map(item=>item.id)
      tx.delete(itemGraphics).where(inArray(itemGraphics.itemId,ids)).run()
      tx.delete(secondaryEvents).where(inArray(secondaryEvents.itemId,ids)).run()
      for(const cue of frame.cues)tx.insert(itemGraphics).values(cue).run()
      for(const event of frame.events)tx.insert(secondaryEvents).values(event).run()
    }
  }
  if(frame.target.protectedZones)tx.update(rundowns).set({protectedZones:frame.protectedZones??[],updatedAt:new Date().toISOString()}).where(eq(rundowns.id,frame.rundownId)).run()

  for (const asset of frame.assets) {
    tx
      .update(mediaAssets)
      .set({ defaultTrim: asset.defaultTrim, defaultTrimRateNum:asset.defaultTrimRateNum, defaultTrimRateDen:asset.defaultTrimRateDen, defaultAudio: asset.defaultAudio })
      .where(eq(mediaAssets.id, asset.id))
      .run()
  }
}

/**
 * Pilha de desfazer por grade.
 *
 * Local ao processo e descartada no reinício. O estado aplicado é selado na
 * transação original; não se pode restaurar sobre alterações de outra estação.
 */
export class History {
  private readonly past = new Map<string, Frame[]>()
  private readonly future = new Map<string, Frame[]>()
  private readonly pending = new Map<string, Promise<unknown>>()
  private readonly epochs=new Map<string,number>()

  /** Read inside the same write transaction, but remember only after commit.
   * A permission/SQL failure must not create a fictitious undo action. */
  prepareCapture(db:Pick<Db,'select'>,rundownId:string,label:string,target:Target):HistoryCapture{
    const epoch=this.epochs.get(rundownId)??0,frame=readNow(db,rundownId,label,target)
    const remember=()=>{
      if(epoch!==(this.epochs.get(rundownId)??0))return
      if(!frame.expected)return // Never expose an unsealed/partially applied edit.
      const stack=this.past.get(rundownId)??[]
      stack.push(frame);if(stack.length>LIMIT)stack.shift()
      this.past.set(rundownId,stack);this.future.delete(rundownId)
    }
    remember.seal=()=>{frame.expected=fingerprint(readNow(db,rundownId,label,target))}
    return remember
  }
  /** Both before/after snapshots and writes belong to one immediate transaction. */
  edit<T>(db:Db,rundownId:string,label:string,target:Target,work:(tx:Pick<Db,'select'|'insert'|'update'|'delete'>)=>T):T{
    const committed=db.transaction(tx=>{
      const remember=this.prepareCapture(tx,rundownId,label,target),value=work(tx)
      if(value && typeof(value as {then?:unknown}).then==='function')throw new Error('A edição de histórico deve ser síncrona dentro da transação.')
      remember.seal();return {value,remember}
    },{behavior:'immediate'})
    committed.remember();return committed.value
  }

  state(rundownId: string): HistoryState {
    const past = this.past.get(rundownId) ?? []
    const future = this.future.get(rundownId) ?? []
    if (past.length === 0 && future.length === 0) return EMPTY
    return {
      canUndo: past.length > 0,
      canRedo: future.length > 0,
      undoLabel: past[past.length - 1]?.label ?? null,
      redoLabel: future[future.length - 1]?.label ?? null,
    }
  }

  private async step(db: Db, rundownId: string, from: Map<string, Frame[]>, to: Map<string, Frame[]>,guard?:HistoryGuard) {
    const epoch=this.epochs.get(rundownId) ?? 0
    const stack = from.get(rundownId)
    const frame = stack?.[stack.length - 1]
    if (!frame){db.transaction(tx=>guard?.(tx,{rundownIds:[rundownId],itemIds:[],assetIds:[]}),{behavior:'immediate'});return null}

    const mirror=db.transaction(tx=>{
      const current=readNow(tx,rundownId,frame.label,frame.target)
      guard?.(tx,{rundownIds:[...new Set([rundownId,...frame.items.map(item=>item.rundownId),...current.items.map(item=>item.rundownId)])],itemIds:[...new Set([...frame.items.map(item=>item.id),...current.items.map(item=>item.id)])],assetIds:frame.assets.map(asset=>asset.id),deviceAutomation:[...frame.events,...current.events].some(event=>event.definition.type==='DEVICE_AUTOMATION'||event.definition.deviceConfig),...(frame.target.wholeRundown?{wholeRundownId:rundownId,restoredItemIds:frame.items.map(item=>item.id)}:{})})
      if(!frame.expected || fingerprint(current)!==frame.expected)throw new CollaborativeEditError(409,{error:'HISTORY_SUPERSEDED',message:'Os dados desta operação foram alterados depois por outra edição. Desfazer/refazer foi recusado para não sobrescrever essas alterações. Confira a grade; nenhum dado foi restaurado.'})
      restore(tx,frame)
      current.expected=fingerprint(readNow(tx,rundownId,frame.label,frame.target))
      return current
    },{behavior:'immediate'})
    if(epoch!==(this.epochs.get(rundownId) ?? 0))return null
    stack!.pop()

    const other = to.get(rundownId) ?? []
    other.push(mirror)
    if (other.length > LIMIT) other.shift()
    to.set(rundownId, other)
    return frame.label
  }

  undo(db: Db, rundownId: string,guard?:HistoryGuard): Promise<string | null> {
    return this.serial(rundownId, () => this.step(db, rundownId, this.past, this.future,guard))
  }

  redo(db: Db, rundownId: string,guard?:HistoryGuard): Promise<string | null> {
    return this.serial(rundownId, () => this.step(db, rundownId, this.future, this.past,guard))
  }

  private serial<T>(rundownId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.pending.get(rundownId) ?? Promise.resolve()
    const current = previous.then(operation, operation)
    this.pending.set(rundownId, current)
    void current.finally(() => {
      if (this.pending.get(rundownId) === current) this.pending.delete(rundownId)
    }).catch(()=>{})
    return current
  }

  forget(rundownId: string): void {
    this.epochs.set(rundownId,(this.epochs.get(rundownId) ?? 0)+1)
    this.past.delete(rundownId)
    this.future.delete(rundownId)
  }
}
