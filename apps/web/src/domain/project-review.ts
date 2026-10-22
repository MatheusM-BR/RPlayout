import {projectRestoreETag,type ProjectRestoreReview} from '@rplayout/protocol'
/** Confirmation submits the displayed proof, never fetches a newer one. */
export function projectRestoreRequest(channelId:string,projectId:string,review:ProjectRestoreReview){
  if(!review||review.channelId!==channelId||review.projectId!==projectId||!Number.isSafeInteger(review.projectRevision)||review.projectRevision<1||!Number.isSafeInteger(review.configurationRevision)||review.configurationRevision<1||!/^[a-f0-9]{64}$/.test(review.token))throw new Error('A conferência não pertence ao canal/projeto selecionado. Reabra a conferência.')
  return {headers:{'if-match':projectRestoreETag(review)},body:JSON.stringify({reviewToken:review.token})}
}
