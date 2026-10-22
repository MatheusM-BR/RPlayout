import {describe,expect,it} from 'vitest'
import {assetRemovalETag,type AssetRemovalReview} from '@rplayout/protocol'
import {assetRemovalHeaders,removalSelection} from './asset-removal-review.js'
const original:AssetRemovalReview={operation:'REMOVE',assetId:'asset:ç',token:'a'.repeat(43),assets:[{assetId:'asset:ç',title:'Título',revision:1,uses:[],blockers:[],publishedReferences:0,historicalReferences:0}],filesPreserved:true,historyPreserved:true,automaticTake:false}
describe('prova de remoção do navegador não vira force nem outra operação',()=>{
  it('cabeçalho mantém original e identidade Unicode',()=>{expect(assetRemovalHeaders('asset:ç',original)).toEqual({'If-Match':assetRemovalETag(original)});expect(assetRemovalETag(original)).toContain('A%3Aasset%3A%C3%A7')})
  it.each([null,'other'])('recusa outro alvo %s',id=>expect(()=>assetRemovalHeaders(id,original)).toThrow('outro'))
  it.each(['', '*', 'a'.repeat(42)])('recusa token inválido %s',token=>expect(()=>assetRemovalETag({...original,token})).toThrow('inválida'))
  it.each([{ids:[]},{ids:['other']},{ids:['asset:ç','asset:ç']}])('recusa seleção ausente/estrangeira/duplicada %j',({ids})=>expect(()=>removalSelection(original,ids,true)).toThrow())
  it('proteção impede envio e vínculo exige confirmação',()=>{
    expect(()=>removalSelection({...original,assets:[{...original.assets[0]!,blockers:['PGM']}]},['asset:ç'],true)).toThrow('protegida')
    const used={...original,assets:[{...original.assets[0]!,uses:[{itemId:'live',itemTitle:'Live',rundownId:'rd',rundownName:'Grade',channelId:'a',channelName:'A',action:'CLEAR_FALLBACK' as const,editorialRevision:1}]}]}
    expect(()=>removalSelection(used,['asset:ç'],false)).toThrow('Confirme');expect(removalSelection(used,['asset:ç'],true)).toEqual({assetIds:['asset:ç'],removeEditorialUses:true})
  })
})
