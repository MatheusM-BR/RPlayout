import type {RootAddReview} from '@rplayout/protocol'
/** The visible path must be the candidate actually reviewed, not a draft
 * changed after the review request began. The server still enforces its ETag. */
export function rootSelectionReady(review:RootAddReview|null,path:string):boolean{
  return Boolean(review?.canEdit && review.candidate.path===path.trim())
}
export function rootListingMatches(path:string,draft:string):boolean{return path===draft.trim()}
