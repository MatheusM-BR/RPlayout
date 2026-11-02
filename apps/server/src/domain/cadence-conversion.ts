import {createHash,randomUUID} from 'node:crypto'
import {asc,and,eq,sql} from 'drizzle-orm'
import {frameConverter,sameRate,resolveTrim,type Anchor,type Rate,type CadenceConversionReport} from '@rplayout/protocol'
import type {Db} from '../db/client.js'
import {channels,rundowns,rundownItems,secondaryEvents,mediaAssets,itemGraphics,operationalPlaylistRevisions,channelCadenceConversions,operatorDecisions} from '../db/schema.js'
import {toAsset} from '../db/repo.js'
import {configurationRevision} from '../db/channel-configuration.js'

export type FormatPatch=Partial<Pick<typeof channels.$inferSelect,'name'|'width'|'height'|'scan'|'fieldOrder'|'targetLufs'|'ceilingDbtp'>>

type ReadDb=Pick<Db,'select'|'selectDistinct'|'get'>
function capture(db:ReadDb,channelId:string){
  const channel=db.select().from(channels).where(and(eq(channels.id,channelId))).get()
  if(!channel || channel.archivedAt)throw new Error('Canal ativo não encontrado.')
  const grades=db.select().from(rundowns).where(eq(rundowns.channelId,channelId)).orderBy(asc(rundowns.id)).all()
  const items=db.select().from(rundownItems).innerJoin(rundowns,eq(rundownItems.rundownId,rundowns.id)).where(eq(rundowns.channelId,channelId)).orderBy(asc(rundownItems.id)).all().map(row=>row.rundown_items)
  const assets=db.selectDistinct().from(mediaAssets).innerJoin(rundownItems,eq(rundownItems.mediaId,mediaAssets.id)).innerJoin(rundowns,eq(rundownItems.rundownId,rundowns.id)).where(eq(rundowns.channelId,channelId)).orderBy(asc(mediaAssets.id)).all().map(row=>row.media_assets)
  const events=db.select().from(secondaryEvents).where(eq(secondaryEvents.channelId,channelId)).orderBy(asc(secondaryEvents.id)).all()
  const cues=db.select().from(itemGraphics).innerJoin(rundownItems,eq(itemGraphics.itemId,rundownItems.id)).innerJoin(rundowns,eq(rundownItems.rundownId,rundowns.id)).where(eq(rundowns.channelId,channelId)).orderBy(asc(itemGraphics.id)).all().map(row=>row.item_graphics)
  const revisions=db.select().from(operationalPlaylistRevisions).innerJoin(rundowns,eq(operationalPlaylistRevisions.rundownId,rundowns.id)).where(and(eq(rundowns.channelId,channelId),eq(operationalPlaylistRevisions.active,true))).orderBy(asc(operationalPlaylistRevisions.id)).all().map(row=>row.operational_playlist_revisions)
  const editorialSeal=db.get<{seal:string}>(sql`SELECT json_group_array(json_array(scope,rundown_id,item_id,version)) AS seal FROM
    (SELECT scope,rundown_id,item_id,version FROM editorial_revision_counters WHERE rundown_id IN
      (SELECT id FROM rundowns WHERE channel_id=${channelId}) ORDER BY scope,rundown_id,item_id)`).seal
  return {channel,configurationRevision:configurationRevision(db,channelId),editorialSeal,grades,items,assets,events,cues,revisions}
}

/** Pure planning from one synchronous SQLite read transaction. Reports never
 * contain endpoints or media paths; encrypted snapshot retains the originals. */
function plan(db:ReadDb,channelId:string,to:Rate,format:FormatPatch={}){
  const original=capture(db,channelId),from={num:original.channel.rateNum,den:original.channel.rateDen}
  const converter=frameConverter(from,to),f=converter.frames
  if(sameRate(from,to))throw new Error('A cadência escolhida já é a cadência atual.')
  const anchor=(value:Anchor):Anchor=>{
    switch(value.kind){
      case 'FLOW':return value
      case 'FIXED':case 'HARD_TIME':return {...value,at:f(value.at)}
      case 'SOFT':return {...value,at:f(value.at),tolerance:f(value.tolerance)}
      case 'WINDOW':{
        const from=f(value.from),to=f(value.to)
        if(to<=from)throw new Error('Janela horária ficaria vazia na nova cadência.')
        return {...value,from,to}
      }
    }
  }
  const grades=original.grades.map(grade=>({...grade,plannedStart:f(grade.plannedStart),publicationRequired:true,
    protectedZones:grade.protectedZones.map(zone=>{
      const from=f(zone.from),to=f(zone.to)
      if(to<=from)throw new Error(`Zona “${zone.label}” ficaria vazia na nova cadência.`)
      return {...zone,from,to}
    })}))
  const assets=new Map(original.assets.map(asset=>[asset.id,toAsset(asset)]))
  let inheritedTrims=0
  const items=original.items.map(item=>{
    const asset=item.mediaId?assets.get(item.mediaId):null
    if(item.mediaId&&!asset)throw new Error('Uma mídia da grade não existe. Corrija os vínculos antes de converter.')
    let trim=item.trim
    if(asset){
      trim=resolveTrim(item.trim,asset,from).value
      if(!item.trim)inheritedTrims++
    }
    if(trim){
      trim={in:f(trim.in),out:f(trim.out)}
      if(trim.out<=trim.in)throw new Error(`Corte de “${item.title}” ficaria vazio na nova cadência.`)
    }
    const optional=(value:number|null)=>value===null?null:f(value)
    const audio=item.audio?.measured?.scope==='TRIM'?{...item.audio,measured:null}:item.audio
    return {...item,trim,audio,durationOverride:optional(item.durationOverride),minDuration:f(item.minDuration),anchor:anchor(item.anchor),
      liveEstimatedDuration:optional(item.liveEstimatedDuration),liveMaxDuration:optional(item.liveMaxDuration),
      elastic:item.elastic?{min:f(item.elastic.min),max:f(item.elastic.max)}:null}
  })
  const itemIds=new Set(items.map(item=>item.id))
  const events=original.events.map(event=>{
    if(!itemIds.has(event.itemId))throw new Error('Evento secundário não pertence a uma grade deste canal.')
    const definition={...event.definition,offsetFrames:f(event.definition.offsetFrames),
      ...(event.definition.durationFrames===undefined?{}:{durationFrames:f(event.definition.durationFrames)})}
    if(event.definition.durationFrames && !definition.durationFrames)throw new Error('Duração de evento ficaria vazia na nova cadência.')
    return {...event,definition}
  })
  const requestedFormat=Object.fromEntries(Object.entries(format).filter(([,value])=>value!==undefined).sort(([a],[b])=>a.localeCompare(b)))
  const fingerprint=createHash('sha256').update(JSON.stringify({original,to,format:requestedFormat})).digest('hex')
  const pendingInterruptions=db.get<{n:number}>(sql`SELECT count(*) AS n FROM interrupted_items WHERE channel_id=${channelId} AND state IN ('PENDING','RESUMING')`).n
  const report:CadenceConversionReport={channelId,from,to,fingerprint,rundowns:grades.length,items:items.length,events:events.length,
    ...converter.statistics(),inheritedTrims,activeRevisions:original.revisions.length,pendingInterruptions,
    warnings:[
      'PGM parado e CUE limpo são obrigatórios. Após a conversão, revise e publique cada grade antes de operar.',
      'Publicações e as-run antigos são preservados. Rollback com outra cadência ou sem cadência histórica conhecida será recusado.',
      'Cortes herdados tornam-se explícitos neste canal; os padrões do acervo e outros canais não mudam.',
      'Saídas com FPS explícito e perfil de QC não mudam automaticamente. Confira-os antes de publicar.',
    ]}
  return {original,grades,items,events,report}
}

type ConversionTransaction=Parameters<Parameters<Db['transaction']>[0]>[0]
export function previewCadenceConversion(db:Db,channelId:string,to:Rate,format:FormatPatch={},authorize?:(tx:ConversionTransaction)=>void):CadenceConversionReport{
  return db.transaction(tx=>{authorize?.(tx);return plan(tx,channelId,to,format).report})
}

/** The native configuration queue owns STOP/CUE guards. Re-plan and compare
 * inside the same write transaction; no stale preview, partial grade or TAKE. */
export function applyCadenceConversion(db:Db,channelId:string,to:Rate,fingerprint:string,actor:string|null,format:FormatPatch={},authorize?:(tx:ConversionTransaction)=>void){
  return db.transaction(tx=>{
    authorize?.(tx)
    const candidate=plan(tx,channelId,to,format)
    if(candidate.report.fingerprint!==fingerprint)throw new Error('A grade, mídia ou configuração mudou desde a simulação. Revise a conversão novamente.')
    if(candidate.report.pendingInterruptions)throw new Error('Há VT interrompido aguardando retorno ou descarte. Resolva-o antes de converter para não reinterpretar o cursor antigo.')
    const now=new Date().toISOString(),id=randomUUID()
    tx.insert(channelCadenceConversions).values({id,channelId,fingerprint,fromNum:candidate.report.from.num,fromDen:candidate.report.from.den,toNum:to.num,toDen:to.den,
      snapshot:candidate.original as unknown as Record<string,unknown>,createdAt:now,actor}).run()
    tx.update(channels).set({...format,rateNum:to.num,rateDen:to.den}).where(eq(channels.id,channelId)).run()
    for(const grade of candidate.grades)tx.update(rundowns).set({...grade,updatedAt:now}).where(eq(rundowns.id,grade.id)).run()
    for(const item of candidate.items)tx.update(rundownItems).set(item).where(eq(rundownItems.id,item.id)).run()
    for(const event of candidate.events)tx.update(secondaryEvents).set({...event,updatedAt:now}).where(eq(secondaryEvents.id,event.id)).run()
    for(const revision of candidate.original.revisions)tx.update(operationalPlaylistRevisions).set({active:false,state:'SUPERSEDED'}).where(eq(operationalPlaylistRevisions.id,revision.id)).run()
    tx.run(sql`UPDATE channel_checkpoints SET payload=json_set(json_remove(payload,'$.contingency'),'$.playing',json('false'),'$.itemId',NULL,'$.elapsed',0,'$.revisionId',NULL,'$.rate.num',${to.num},'$.rate.den',${to.den}),saved_at=${now} WHERE channel_id=${channelId}`)
    tx.insert(operatorDecisions).values({id:randomUUID(),rundownId:'@configuration',kind:'CHANNEL_CADENCE_CONVERTED',payload:{...candidate.report,conversionId:id,automaticTake:false,requiresPublication:true},actorUsername:actor,createdAt:now}).run()
    return {conversionId:id,report:candidate.report,rundownIds:candidate.grades.map(grade=>grade.id),requiresPublication:true as const}
  },{behavior:'immediate'})
}
