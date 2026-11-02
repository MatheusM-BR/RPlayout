import type {AssetMetadataReview} from '@rplayout/protocol'
import {assetMetadataHeaders} from './asset-metadata-review.js'

export interface BulkCategoryApi {
  assetMetadataReview:(id:string)=>Promise<AssetMetadataReview>
  patchAssetMetadata:(id:string,body:{categoryId:string|null},review:AssetMetadataReview)=>Promise<AssetMetadataReview&{applied?:boolean}>
}
export interface BulkCategoryResult {saved:AssetMetadataReview[];unchanged:string[];failed:Array<{id:string;message:string}>}

/** Applies one category to several files, each through its own fresh review
 * (same version check as the single editor). One failure never stops the rest. */
export async function applyBulkCategory(api:BulkCategoryApi,ids:readonly string[],category:string,onProgress?:(done:number)=>void):Promise<BulkCategoryResult>{
  const categoryId=category.trim()||null,result:BulkCategoryResult={saved:[],unchanged:[],failed:[]}
  let done=0
  for(const id of [...new Set(ids)]){
    try{
      const review=await api.assetMetadataReview(id);assetMetadataHeaders(id,review)
      if(!review.canEdit)throw new Error('Sua conta não pode editar metadados compartilhados.')
      if((review.categoryId??null)===categoryId)result.unchanged.push(id)
      else{
        const saved=await api.patchAssetMetadata(id,{categoryId},review)
        if(saved.assetId!==id||saved.applied===false)throw new Error('Gravação sem confirmação do arquivo.')
        result.saved.push(saved)
      }
    }catch(error){result.failed.push({id,message:error instanceof Error?error.message:'Falha ao gravar.'})}
    onProgress?.(++done)
  }
  return result
}

/** Ctrl toggles, Shift extends from the anchor, plain click selects one. */
export function nextSelection(current:ReadonlySet<string>,order:readonly string[],id:string,anchor:string|null,mod:{ctrl:boolean;shift:boolean}):Set<string>{
  if(mod.shift&&anchor&&order.includes(anchor)&&order.includes(id)){
    const from=Math.min(order.indexOf(anchor),order.indexOf(id)),to=Math.max(order.indexOf(anchor),order.indexOf(id))
    return new Set([...(mod.ctrl?current:[]),...order.slice(from,to+1)])
  }
  if(mod.ctrl){const next=new Set(current);if(next.has(id))next.delete(id);else next.add(id);return next}
  return new Set([id])
}
