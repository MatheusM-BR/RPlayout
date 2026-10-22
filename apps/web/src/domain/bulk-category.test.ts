import {describe,expect,it} from 'vitest'
import {applyBulkCategory,nextSelection} from './bulk-category.js'
const review=(id:string,categoryId:string|null)=>({assetId:id,revision:1,title:id,categoryId,canEdit:true}) as unknown as import('@rplayout/protocol').AssetMetadataReview
describe('categoria em lote',()=>{
  it('grava cada arquivo pela própria conferência, pula iguais e continua após falha',async()=>{
    const patched:string[]=[]
    const api={
      assetMetadataReview:async(id:string)=>{if(id==='c')throw new Error('sumiu');return review(id,id==='b'?'LEILAO':null)},
      patchAssetMetadata:async(id:string,body:{categoryId:string|null})=>{patched.push(id+':'+body.categoryId);return {...review(id,body.categoryId),applied:true} as never},
    }
    const progress:number[]=[]
    const result=await applyBulkCategory(api,['a','b','c','d','a'],' LEILAO ',done=>progress.push(done))
    expect(patched).toEqual(['a:LEILAO','d:LEILAO'])
    expect(result.unchanged).toEqual(['b']);expect(result.failed.map(f=>f.id)).toEqual(['c'])
    expect(progress).toEqual([1,2,3,4])
  })
  it('categoria vazia remove',async()=>{
    let body:unknown
    await applyBulkCategory({assetMetadataReview:async id=>review(id,'X'),patchAssetMetadata:async(id,b)=>{body=b;return {...review(id,null),applied:true} as never}},['a'],'  ')
    expect(body).toEqual({categoryId:null})
  })
  it('seleção com Ctrl e Shift',()=>{
    const order=['a','b','c','d']
    expect([...nextSelection(new Set(),order,'b',null,{ctrl:false,shift:false})]).toEqual(['b'])
    expect([...nextSelection(new Set(['b']),order,'d',null,{ctrl:true,shift:false})]).toEqual(['b','d'])
    expect([...nextSelection(new Set(['b','d']),order,'d',null,{ctrl:true,shift:false})]).toEqual(['b'])
    expect([...nextSelection(new Set(['a']),order,'c','a',{ctrl:false,shift:true})]).toEqual(['a','b','c'])
  })
})
