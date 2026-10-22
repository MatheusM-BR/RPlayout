import {assetRemovalETag,type AssetRemovalReview} from '@rplayout/protocol'
export function assetRemovalHeaders(id:string|null,review:AssetRemovalReview){
  if(review.assetId!==id||review.operation!==(id===null?'PRUNE':'REMOVE'))throw new Error('Conferência de outro arquivo/operação recusada.')
  return {'If-Match':assetRemovalETag(review)}
}
export function removalSelection(review:AssetRemovalReview,ids:string[],acknowledged:boolean){
  if(!ids.length||new Set(ids).size!==ids.length)throw new Error('Selecione arquivos únicos conferidos.')
  const selected=review.assets.filter(asset=>ids.includes(asset.assetId))
  if(selected.length!==ids.length||selected.some(asset=>asset.blockers.length))throw new Error('Seleção ausente ou protegida na conferência.')
  if(review.operation==='REMOVE'&&(ids.length!==1||ids[0]!==review.assetId))throw new Error('Seleção de outro arquivo recusada.')
  if(!acknowledged&&selected.some(asset=>asset.uses.length))throw new Error('Confirme os itens e fallbacks conferidos.')
  return {assetIds:ids,removeEditorialUses:acknowledged}
}
