import {assetMetadataETag,type AssetMetadataReview} from '@rplayout/protocol'
/** Live entries share the library list, not the catalog's metadata/QC identity. */
export function isCatalogMediaAsset(asset:{isLiveSource?:boolean}){
  return asset.isLiveSource!==true
}
export function assetMetadataHeaders(id:string,review:Pick<AssetMetadataReview,'assetId'|'revision'>){
  if(review.assetId!==id)throw new Error('A conferência pertence a outro arquivo.')
  return {'If-Match':assetMetadataETag(review)}
}
