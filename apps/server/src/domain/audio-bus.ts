import {eq} from 'drizzle-orm'
import {resolveAudio,validateAuxiliaryPairs,knownInputAudioChannels,type AudioLevel,type MediaAsset,type RundownItem} from '@rplayout/protocol'
import type {Db} from '../db/client.js'
import {channels,mediaAssets,rundowns,rundownItems} from '../db/schema.js'
import {toAsset,toItem} from '../db/repo.js'

export function auxiliaryAudioError(audio:AudioLevel|undefined|null,outputChannels:number,asset:MediaAsset|null,track=0):string|null {
  const input=knownInputAudioChannels(asset,track)
  return validateAuxiliaryPairs(audio?.auxiliaryPairs??[],outputChannels,input)
}
export function assertPublishedAudio(outputChannels:number,items:readonly RundownItem[],assets:readonly MediaAsset[]=[]):void {
  const byId=new Map(assets.map(a=>[a.id,a]))
  for(const item of items){
    const asset=item.mediaId?byId.get(item.mediaId)??null:null
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
