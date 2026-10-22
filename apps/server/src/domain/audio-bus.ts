import {eq} from 'drizzle-orm'
import {resolveAudio,audioCutIdentity,hasMatchingAudioMeasurement,validateAuxiliaryPairs,knownInputAudioChannels,type Rate,type AudioLevel,type MediaAsset,type RundownItem} from '@rplayout/protocol'
import type {Db} from '../db/client.js'
import {channels,mediaAssets,rundowns,rundownItems} from '../db/schema.js'
import {toAsset,toItem} from '../db/repo.js'
import {declaredFileTrim} from './execution-trim.js'

export function auxiliaryAudioError(audio:AudioLevel|undefined|null,outputChannels:number,asset:MediaAsset|null,track=0):string|null {
  const input=knownInputAudioChannels(asset,track)
  return validateAuxiliaryPairs(audio?.auxiliaryPairs??[],outputChannels,input)
}
export function assertPublishedAudio(outputChannels:number,items:readonly RundownItem[],assets:readonly MediaAsset[]=[],rate?:Rate):void {
  const byId=new Map(assets.map(a=>[a.id,a]))
  for(const item of items){
    const asset=item.mediaId?byId.get(item.mediaId)??null:null
    const level=item.audio??asset?.defaultAudio
    if(rate&&level?.mode==='AUTO'&&level.measured?.scope==='TRIM'){
      if(!asset)throw new Error(`${item.title}: medição de áudio do trecho exige versão congelada da mídia.`)
      const mounted=declaredFileTrim(item,asset,rate)
      if(!hasMatchingAudioMeasurement(level,asset.contentHash,item.audioTrack??0,audioCutIdentity(mounted,rate)))throw new Error(`${item.title}: corte não corresponde à medição de áudio. Meça novamente ou use ganho manual antes de publicar/operar.`)
    }
    const error=auxiliaryAudioError(asset?resolveAudio(item.audio,asset,item.audioTrack??0).value:item.audio,outputChannels,asset,item.audioTrack??0)
    if(error)throw new Error(`${item.title}: ${error} Confira os pares antes de publicar/operar.`)
  }
}
/** Called inside the configuration write transaction. Do not silently clear
 * a draft/default routing when reducing the channel's embedded bus. */
export function assertChannelAudioChange(db:Pick<Db,'select'>,channelId:string,outputChannels:2|8|16):void {
  const items=db.select({item:rundownItems,asset:mediaAssets}).from(rundownItems).innerJoin(rundowns,eq(rundowns.id,rundownItems.rundownId)).leftJoin(mediaAssets,eq(mediaAssets.id,rundownItems.mediaId)).where(eq(rundowns.channelId,channelId)).all()
  assertPublishedAudio(outputChannels,items.map(row=>toItem(row.item)),items.flatMap(row=>row.asset?[toAsset(row.asset)]:[]))
  if(!db.select({id:channels.id}).from(channels).where(eq(channels.id,channelId)).get())throw new Error('Canal não encontrado.')
}
