export interface RootCatalogReview {
  revision:number
  canEdit:boolean
  roots:{id:string;path:string;label:string;present:boolean}[]
}
export interface RootAddReview extends RootCatalogReview {
  candidate:{path:string;realPath:string;fingerprint:string}
}
export const rootCatalogETag=(review:Pick<RootCatalogReview,'revision'>)=>`"roots:${review.revision}"`
export const rootAddETag=(review:Pick<RootAddReview,'revision'|'candidate'>)=>`"root-add:${review.revision}:${review.candidate.fingerprint}"`
