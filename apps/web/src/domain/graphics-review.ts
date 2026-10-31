import {graphicsETag,type GraphicsReview} from '@rplayout/protocol'
export function graphicsHeaders(review:GraphicsReview|null,id:string|null){
  if(!review||review.channelId!==id)throw new Error('Confira as artes deste escopo antes de salvar. Rascunho não enviado.')
  return {'If-Match':graphicsETag(review)}
}
