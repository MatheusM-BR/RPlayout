import {multiviewETag,type MultiviewReview} from '@rplayout/protocol'
export function multiviewHeaders(review:MultiviewReview|null,id:string|null){
  if(!review||review.channelId!==id||!Number.isSafeInteger(review.revision)||review.revision<1)throw new Error('Reabra explicitamente o multiview deste canal antes de salvar.')
  return {'If-Match':multiviewETag(id,review.revision)}
}
