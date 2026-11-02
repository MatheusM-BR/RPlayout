import {and,asc,desc,eq} from 'drizzle-orm'
import type {Db} from '../db/client.js'
import {channels,rundowns,rundownItems,mediaAssets,graphicTemplates,itemGraphics,operationalPlaylistRevisions,channelCadenceConversions} from '../db/schema.js'
import {toAsset,toChannel,toItem,toRundown} from '../db/repo.js'
import {EditorialVersions} from '../db/editorial-revisions.js'
import {configurationRevision} from '../db/channel-configuration.js'
import {applyQcDecisionsNow} from './qc-workflow.js'
import {buildView,type RundownView} from './plan.js'
import type {OnAirState} from '@rplayout/protocol'

/** No awaits inside the read transaction: attach only the version of these
 * actual rows, never a late/current version to stale cached runtime data. */
export function readEditorialState(db:Db,rundownId:string){
  return db.transaction(tx=>{
    const grade=tx.select().from(rundowns).where(eq(rundowns.id,rundownId)).get()
    if(!grade)return null
    const owner=tx.select().from(channels).where(eq(channels.id,grade.channelId)).get()
    if(!owner || owner.archivedAt)return null
    const channel=toChannel(owner,configurationRevision(tx,owner.id)),rundown=toRundown(grade)
    const editorialRevision=new EditorialVersions(db.$client).read(rundownId)
    const items=tx.select().from(rundownItems).where(eq(rundownItems.rundownId,rundownId)).orderBy(asc(rundownItems.sortOrder),asc(rundownItems.id)).all().map(toItem)
    const rawAssets=new Map(tx.select().from(mediaAssets).all().map(row=>[row.id,toAsset(row)]))
    const assets=applyQcDecisionsNow(tx,rawAssets,channel.id)
    const templates=tx.select().from(graphicTemplates).all()
    const cues=tx.select().from(itemGraphics).innerJoin(rundownItems,eq(itemGraphics.itemId,rundownItems.id)).where(eq(rundownItems.rundownId,rundownId)).all()
    const revision=tx.select().from(operationalPlaylistRevisions).where(and(eq(operationalPlaylistRevisions.rundownId,rundownId),eq(operationalPlaylistRevisions.active,true))).orderBy(desc(operationalPlaylistRevisions.revision)).get()??null
    const requiresPublishedCadence=!revision && Boolean(tx.select({id:channelCadenceConversions.id}).from(channelCadenceConversions).where(eq(channelCadenceConversions.channelId,channel.id)).limit(1).get())
    return {rundown,channel,items,assets,templates,cues,revision,editorialRevision,requiresPublishedCadence}
  })
}
export function withEditorialRevision(view:RundownView,editorialRevision:number):RundownView{
  return {...view,editorialRevision,items:view.items.map(entry=>({...entry,editorialRevision}))}
}
export function editorialView(state:NonNullable<ReturnType<typeof readEditorialState>>,now:number|null=null,onAir:OnAirState|null=null){
  return withEditorialRevision(buildView({...state.rundown,publicationRequired:state.rundown.publicationRequired||state.requiresPublishedCadence},state.channel,state.items,state.assets,now,onAir),state.editorialRevision)
}
