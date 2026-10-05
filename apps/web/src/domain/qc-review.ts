import {qcAssetETag,qcDecisionETag,type QcReview} from '@rplayout/protocol'

export function qcReviewMatches(review:QcReview|null|undefined,assetId:string|undefined,contentHash:string|undefined,channelId:string):review is QcReview {
  return Boolean(review && review.assetId===assetId && review.contentHash===contentHash && review.channelId===channelId &&
    Number.isSafeInteger(review.assetRevision)&&review.assetRevision>0 && Number.isSafeInteger(review.configurationRevision)&&review.configurationRevision>0)
}
export function qcDecisionHeaders(id:string,channelId:string,contentHash:string,review:QcReview|undefined):Record<string,string>{
  if(!qcReviewMatches(review,id,contentHash,channelId))throw new Error('Confira a versão e o canal no QC antes de decidir; nenhum pedido foi enviado.')
  return {'If-Match':qcDecisionETag(review)}
}
export function qcAssetHeaders(id:string,revision:number|undefined):Record<string,string>{
  if(revision===undefined || !Number.isSafeInteger(revision)||revision<1)throw new Error('A tela não tem a revisão QC do arquivo. Reabra a conferência antes de alterar seu estado.')
  return {'If-Match':qcAssetETag(id,revision)}
}
