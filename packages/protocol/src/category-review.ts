export interface CategoryReview {id:string;color:string;items:number;stored:boolean;revision:number;canEdit:boolean}
export const categoryETag=(review:Pick<CategoryReview,'id'|'revision'>)=>`"category:${encodeURIComponent(review.id)}:${review.revision}"`
