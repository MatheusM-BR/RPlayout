import type {OperationalReview} from '@rplayout/protocol'

export function operationalReviewReady(review:OperationalReview|null|undefined,rundownId:string|undefined,channelId:string,editorialRevision:number|undefined):boolean {
  return !!review && review.operation==='PUBLISH' && review.rundownId===rundownId && review.channelId===channelId && review.editorialRevision===editorialRevision && /^[A-Za-z0-9_-]{43}$/.test(review.token)
}
