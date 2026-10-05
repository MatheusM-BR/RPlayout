import { and, asc, eq, inArray } from 'drizzle-orm'
import { convertTrim, resolvedAudioRouting, validateAudioRouting, validateAuxiliaryPairs, knownInputAudioChannels, type AudioLevel, type EditScope, type Trim } from '@rplayout/protocol'
import type { Db } from '../db/client.js'
import { channels, mediaAssets, rundownItems, rundowns } from '../db/schema.js'
import {sealHistoryCapture} from './history.js'
import {CollaborativeEditError} from './collaborative-edit.js'
import {requireMixMeasurement} from './audio-mix-analysis.js'

export interface ScopeResult {
  /** Quantos itens do rundown mudaram. */
  readonly itemsAffected: number
  /** Se o padrão do acervo foi reescrito. */
  readonly assetUpdated: boolean
  readonly message: string
}
export interface ScopeTargets { ids:string[];mediaId:string|null;rundownId:string }
export type ScopeGuard=(db:Pick<Db,'select'>,targets:ScopeTargets)=>void|(()=>void)

/** Quais linhas um escopo vai tocar. O desfazer precisa saber antes de aplicar. */
export function readScopeTargets(
  db: Pick<Db,'select'>,
  itemId: string,
  scope: EditScope,
): ScopeTargets {
  const row = db
    .select({
      id: rundownItems.id,
      mediaId: rundownItems.mediaId,
      rundownId: rundownItems.rundownId,
    })
    .from(rundownItems)
    .where(eq(rundownItems.id, itemId)).get()

  if (!row) throw new Error(`Item ${itemId} não existe.`)
  if (!row.mediaId || scope === 'ITEM' || scope === 'ASSET_DEFAULT') {
    return { ids: [row.id], mediaId: row.mediaId, rundownId: row.rundownId }
  }

  const siblings = db
    .select({ id: rundownItems.id })
    .from(rundownItems)
    .where(
      scope === 'RUNDOWN'
        ? and(eq(rundownItems.mediaId, row.mediaId), eq(rundownItems.rundownId, row.rundownId))
        : eq(rundownItems.mediaId, row.mediaId),
    ).orderBy(asc(rundownItems.id)).all()

  return { ids: siblings.map((s) => s.id), mediaId: row.mediaId, rundownId: row.rundownId }
}
export async function targetItemIds(db:Db,itemId:string,scope:EditScope):Promise<ScopeTargets>{return readScopeTargets(db,itemId,scope)}

/**
 * Grava o corte no escopo escolhido.
 *
 * `ASSET_DEFAULT` grava no acervo e limpa o override deste item, para que ele
 * passe a herdar de verdade — senão o operador escolhe "padrão do acervo" e a
 * linha continua mostrando o selo de override, o que não faz sentido nenhum.
 */
export async function applyTrim(
  db: Db,
  itemId: string,
  trim: Trim,
  scope: EditScope,
  guard?:ScopeGuard,
): Promise<ScopeResult> {
  const committed:{remember?:()=>void}={}
  const result:ScopeResult=db.transaction(tx=>{
  const targets=readScopeTargets(tx,itemId,scope),{ids,mediaId}=targets
  const remember=guard?.(tx,targets)
  if(typeof remember==='function')committed.remember=remember

  // Source and destination rates are read after the guard, in this same write
  // snapshot. Never copy channel-frame counts into a different channel's units.
  const rates=tx.select({id:rundownItems.id,num:channels.rateNum,den:channels.rateDen})
    .from(rundownItems).innerJoin(rundowns,eq(rundowns.id,rundownItems.rundownId))
    .innerJoin(channels,eq(channels.id,rundowns.channelId))
    .where(scope==='ASSET_DEFAULT' && mediaId ? eq(rundownItems.mediaId,mediaId) : inArray(rundownItems.id,ids)).all()
  const source=rates.find(row=>row.id===itemId)
  if(!source || (scope!=='ASSET_DEFAULT' && rates.length!==ids.length))throw new Error('Não foi possível identificar a cadência dos canais deste corte.')
  const from={num:source.num,den:source.den}
  const convert=(num:number,den:number)=>{
    try{return convertTrim(trim,from,{num,den})}
    catch(error){throw new CollaborativeEditError(409,{error:'TRIM_CADENCE_UNREPRESENTABLE',message:error instanceof Error?error.message:'Não foi possível converter o corte. Confira as cadências dos canais.'})}
  }

  if (scope === 'ASSET_DEFAULT') {
    if (!mediaId) throw new Error('Item sem arquivo não tem padrão de acervo.')
    for(const row of rates)convert(row.num,row.den)
    tx.update(mediaAssets).set({ defaultTrim: trim, defaultTrimRateNum:from.num, defaultTrimRateDen:from.den }).where(eq(mediaAssets.id, mediaId)).run()
    tx.update(rundownItems).set({ trim: null }).where(eq(rundownItems.id, itemId)).run()
    sealHistoryCapture(committed.remember)
    return {
      itemsAffected: 1,
      assetUpdated: true,
      message: 'Corte gravado como padrão do acervo. Item novo já nasce cortado.',
    }
  }

  const converted=rates.map(row=>({id:row.id,trim:convert(row.num,row.den)}))
  for(const row of converted)tx.update(rundownItems).set({trim:row.trim}).where(eq(rundownItems.id,row.id)).run()
  sealHistoryCapture(committed.remember)
  return {
    itemsAffected: ids.length,
    assetUpdated: false,
    message:
      ids.length === 1
        ? 'Corte aplicado só neste item.'
        : `Corte aplicado em ${ids.length} itens do mesmo arquivo.`,
  }
  },{behavior:'immediate'})
  committed.remember?.()
  return result
}

/** Mesma mecânica do corte, para o nivelamento de áudio. */
export async function applyAudio(
  db: Db,
  itemId: string,
  audio: AudioLevel,
  scope: EditScope,
  guard?:ScopeGuard,
  audioTrack?:number,
): Promise<ScopeResult> {
  const committed:{remember?:()=>void}={}
  const result:ScopeResult=db.transaction(tx=>{
  const targets=readScopeTargets(tx,itemId,scope),{ids,mediaId}=targets
  const remember=guard?.(tx,targets)
  if(typeof remember==='function')committed.remember=remember

  const routing=resolvedAudioRouting(audio),invalid=validateAudioRouting(routing)
  const reject=(message:string):never=>{throw new CollaborativeEditError(409,{error:'AUDIO_ROUTING_INVALID',message})}
  if(invalid)reject(invalid)
  // ASSET_DEFAULT is shared by every referencing channel, including uses not
  // being edited now. Validate all of them before any level/track write.
  const auxTargets=scope==='ASSET_DEFAULT'&&mediaId?tx.select({id:rundownItems.id}).from(rundownItems).where(eq(rundownItems.mediaId,mediaId)).all().map(row=>row.id):ids
  for(let offset=0;offset<auxTargets.length;offset+=400){
    const rows=tx.select({id:rundownItems.id,title:rundownItems.title,audioTrack:rundownItems.audioTrack,outputChannels:channels.audioChannels,inputChannels:mediaAssets.audioChannels,audioTracks:mediaAssets.audioTracks,hasAudio:mediaAssets.hasAudio}).from(rundownItems).innerJoin(rundowns,eq(rundowns.id,rundownItems.rundownId)).innerJoin(channels,eq(channels.id,rundowns.channelId)).leftJoin(mediaAssets,eq(mediaAssets.id,rundownItems.mediaId)).where(inArray(rundownItems.id,auxTargets.slice(offset,offset+400))).all()
    for(const item of rows){
      const selected=item.id===itemId?audioTrack??item.audioTrack??0:item.audioTrack??0
      const metadata={probe:null,audioMetadata:{hasAudio:item.hasAudio,channels:item.inputChannels,tracks:item.audioTracks}}
      const known=knownInputAudioChannels(metadata,selected)
      const error=validateAuxiliaryPairs(audio.auxiliaryPairs??[],item.outputChannels,known)
      if(error)reject(`${item.title}: ${error} Nenhum alvo foi alterado.`)
      if(scope==='ASSET_DEFAULT'){
        const baseline=knownInputAudioChannels(metadata,0)
        const error=validateAuxiliaryPairs(audio.auxiliaryPairs??[],item.outputChannels,baseline)
        if(error)reject(`Padrão do acervo (trilha inicial): ${error}`)
      }
    }
  }
  if(audio.mode==='AUTO' && routing.mode!=='DEFAULT' && !audio.analysisId)reject('O mix escolhido não tem medição de loudness própria. Meça o mix ou use ganho manual/sem ganho.')
  if(routing.mode!=='DEFAULT'||audio.analysisId||audio.mode==='AUTO')for(let offset=0;offset<ids.length;offset+=400){
    const rows=tx.select({id:rundownItems.id,title:rundownItems.title,audioTrack:rundownItems.audioTrack,audioChannels:mediaAssets.audioChannels,audioTracks:mediaAssets.audioTracks,hasAudio:mediaAssets.hasAudio,contentHash:mediaAssets.contentHash}).from(rundownItems).leftJoin(mediaAssets,eq(mediaAssets.id,rundownItems.mediaId)).where(inArray(rundownItems.id,ids.slice(offset,offset+400))).all()
    for(const item of rows){
      const selected=item.id===itemId?audioTrack??item.audioTrack??0:item.audioTrack??0
      if(audio.mode==='AUTO'&&selected>0&&!audio.analysisId)reject('A trilha escolhida não tem medição própria. Meça antes de usar AUTO.')
      if(audio.analysisId){
        if(!item.contentHash)reject('Entrada live não possui medição de arquivo. Use ganho manual/sem ganho.')
        const measured=requireMixMeasurement(tx,audio.analysisId,item.contentHash!,selected,routing)
        // Never trust loudness numbers supplied by a client/imported preset.
        audio={...audio,measured}
        if(scope==='ASSET_DEFAULT')requireMixMeasurement(tx,audio.analysisId!,item.contentHash!,0,routing)
      }
      // Audio metadata is independent of a complete video probe. A partial
      // probe must not turn a known two-channel track into an unknown input.
      const known=item.hasAudio===false?0:item.audioTracks?.find(track=>track.index===selected)?.channels ?? (selected===0?item.audioChannels??undefined:undefined)
      const error=validateAudioRouting(routing,known)
      if(error)reject(`${item.title}: ${error} Nenhum alvo foi alterado.`)
      if(scope==='ASSET_DEFAULT'){
        const baseline=item.hasAudio===false?0:item.audioTracks?.find(track=>track.index===0)?.channels ?? item.audioChannels??undefined
        const defaultError=validateAudioRouting(routing,baseline)
        if(defaultError)reject(`Padrão do acervo (trilha inicial): ${defaultError} Use somente este item para escolher outra trilha.`)
      }
    }
  }

  // Track selection belongs only to the source item, even with a wide level
  // scope. Commit it together with gain/defaults, never as an immediate edit.
  if(audioTrack!==undefined)tx.update(rundownItems).set({audioTrack}).where(eq(rundownItems.id,itemId)).run()

  if (scope === 'ASSET_DEFAULT') {
    if (!mediaId) throw new Error('Item sem arquivo não tem padrão de acervo.')
    tx.update(mediaAssets).set({ defaultAudio: audio }).where(eq(mediaAssets.id, mediaId)).run()
    tx.update(rundownItems).set({ audio: null }).where(eq(rundownItems.id, itemId)).run()
    sealHistoryCapture(committed.remember)
    return {
      itemsAffected: 1,
      assetUpdated: true,
      message: 'Nível gravado como padrão do acervo. Item novo já nasce nivelado.',
    }
  }

  tx.update(rundownItems).set({ audio }).where(inArray(rundownItems.id, ids)).run()
  sealHistoryCapture(committed.remember)
  return {
    itemsAffected: ids.length,
    assetUpdated: false,
    message:
      ids.length === 1
        ? 'Nível aplicado só neste item.'
        : `Nível aplicado em ${ids.length} itens do mesmo arquivo.`,
  }
  },{behavior:'immediate'})
  committed.remember?.()
  return result
}
