import type {EditScope,EditScopeReview} from '@rplayout/protocol'
export const wideEditScope=(scope:EditScope)=>scope==='ALL_RUNDOWNS'||scope==='ASSET_DEFAULT'
export function reviewedScopeReady(review:EditScopeReview|null,itemId:string,revision:number|undefined,scope:EditScope,acknowledged:boolean):boolean{
  if(!wideEditScope(scope))return true
  return !!review && acknowledged && review.itemId===itemId && review.sourceRevision===revision && review.scope===scope && /^[A-Za-z0-9_-]{43}$/.test(review.token)
}
