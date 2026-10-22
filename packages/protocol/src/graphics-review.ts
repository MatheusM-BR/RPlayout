import type {GraphicTemplate} from './graphics.js'
export const graphicsScope=(id:string|null)=>id===null?'G':`C:${id}`
export interface GraphicsReview {
  channelId:string|null;revision:number;sharedRevision:number;templates:GraphicTemplate[]
  slateTemplateId:string|null;channelArchived:boolean;automaticTake:false;physicalOutputValidated:false
}
export function graphicsETag(review:Pick<GraphicsReview,'channelId'|'revision'|'sharedRevision'>){
  if(![review.revision,review.sharedRevision].every(value=>Number.isSafeInteger(value)&&value>0))throw new Error('Revisão de artes inválida.')
  return `"graphics:${encodeURIComponent(graphicsScope(review.channelId))}:${review.revision}:${review.sharedRevision}"`
}
