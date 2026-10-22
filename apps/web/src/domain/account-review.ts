import {accountCatalogETag,accountETag,accountSessionsETag,type AccountCatalogReview,type AccountSessionsReview} from '@rplayout/protocol'
export const accountCatalogHeaders=(review:AccountCatalogReview)=>({'If-Match':accountCatalogETag(review)})
export const accountHeaders=(review:AccountCatalogReview,id:string)=>({'If-Match':accountETag(review,id)})
export function accountSessionHeaders(review:AccountSessionsReview,id:string) {
  if(review.userId!==id)throw new Error('Sessões não pertencem à conta conferida.')
  return {'If-Match':accountSessionsETag(review)}
}
