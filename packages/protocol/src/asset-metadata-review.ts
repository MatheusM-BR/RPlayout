/** Metadata is shared catalog data, not a QC approval or a rundown edit. */
export interface AssetMetadataReview {
  assetId:string
  title:string
  categoryId:string|null
  revision:number
  canEdit:boolean
}
export function assetMetadataETag(review:Pick<AssetMetadataReview,'assetId'|'revision'>):string {
  if(!review.assetId||!Number.isSafeInteger(review.revision)||review.revision<1)throw new Error('Conferência do acervo ausente ou inválida.')
  return `"asset-metadata:${encodeURIComponent(review.assetId)}:${review.revision}"`
}
