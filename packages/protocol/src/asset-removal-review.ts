export type AssetRemovalOperation='REMOVE'|'PRUNE'
export interface AssetRemovalUse {
  itemId:string;itemTitle:string;rundownId:string;rundownName:string;channelId:string;channelName:string
  action:'REMOVE_ITEM'|'CLEAR_FALLBACK';editorialRevision:number
}
export interface AssetRemovalImpact {
  assetId:string;title:string;revision:number;uses:AssetRemovalUse[]
  blockers:string[];publishedReferences:number;historicalReferences:number
}
export interface AssetRemovalReview {
  operation:AssetRemovalOperation;assetId:string|null;token:string;assets:AssetRemovalImpact[]
  filesPreserved:true;historyPreserved:true;automaticTake:false
}
export function assetRemovalETag(review:Pick<AssetRemovalReview,'operation'|'assetId'|'token'>){
  if(!['REMOVE','PRUNE'].includes(review.operation)||!/^[A-Za-z0-9_-]{43}$/.test(review.token)||review.operation==='REMOVE'&&!(typeof review.assetId==='string'&&review.assetId.length)||review.operation==='PRUNE'&&review.assetId!==null)throw new Error('Conferência de remoção inválida.')
  return `"asset-removal:${encodeURIComponent(review.operation==='REMOVE'?'A:'+review.assetId:'PRUNE')}:${review.token}"`
}
