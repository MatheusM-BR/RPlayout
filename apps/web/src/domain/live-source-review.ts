import {liveSourceETag,type LiveSourceReview} from '@rplayout/protocol'

/** Never fetch a newer revision as part of confirming an old form. */
export function liveSourceHeaders(review:LiveSourceReview|null,channelId:string,sourceId?:string):Record<string,string> {
  if(!review||review.channelId!==channelId||sourceId&&!review.sources.some(source=>source.id===sourceId&&source.channelId===channelId))throw new Error('Confira a lista destas entradas antes de confirmar.')
  return {'If-Match':liveSourceETag(channelId,review.revision)}
}
