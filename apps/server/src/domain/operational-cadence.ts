import {eq} from 'drizzle-orm'
import {sameRate,validateCadence,type Channel,type Rate} from '@rplayout/protocol'
import type {Db} from '../db/client.js'
import {channelCadenceConversions,channels} from '../db/schema.js'
import {assertPublishedAudio} from './audio-bus.js'
import type {MediaAsset,RundownItem} from '@rplayout/protocol'

/** Legacy publications remain viewable. After an explicit rate conversion,
 * unknown historical cadence cannot be guessed for execution/rollback. */
export function assertOperationalCadence(db:Pick<Db,'select'>,channel:Pick<Channel,'id'|'rate'>,payload:{rate?:Rate;audioChannels?:number;items?:readonly RundownItem[];assets?:readonly MediaAsset[]}):void{
  const current=db.select({audioChannels:channels.audioChannels}).from(channels).where(eq(channels.id,channel.id)).get()
  const published=payload.audioChannels??2
  if(![2,8,16].includes(published) || current && published!==current.audioChannels)throw new Error('Esta publicação usa outro barramento de áudio. Confira os pares e publique novamente; não é seguro descartar ou inventar canais de saída.')
  if(payload.items)assertPublishedAudio(published,payload.items,payload.assets)
  if(payload.rate){
    validateCadence(payload.rate)
    if(!sameRate(payload.rate,channel.rate))throw new Error('Esta publicação usa outra cadência. Consulte o histórico e publique a grade convertida; não é seguro reinterpretar seus quadros.')
  }else if(db.select({id:channelCadenceConversions.id}).from(channelCadenceConversions).where(eq(channelCadenceConversions.channelId,channel.id)).limit(1).get()){
    throw new Error('Publicação antiga sem cadência registrada. O canal já foi convertido; esta revisão só pode ser consultada, não executada ou usada em rollback.')
  }
}
