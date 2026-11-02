import {describe,expect,it} from 'vitest'
import {qcAssetHeaders,qcDecisionHeaders,qcReviewMatches} from './qc-review.js'
import {qcAssetETag,qcDecisionETag,type QcReview} from '@rplayout/protocol'
const review:QcReview={assetId:'AÇÃO/01',channelId:'Canal:Ç',contentHash:'hash',assetRevision:17,configurationRevision:42}
describe('cliente conserva a conferência QC, nunca autoriza com leitura implícita',()=>{
  it('header vincula arquivo/canal e as duas revisões com identificadores escapados',()=>{
    expect(qcDecisionHeaders(review.assetId,review.channelId,'hash',review)).toEqual({'If-Match':qcDecisionETag(review)})
    expect(qcAssetHeaders(review.assetId,17)).toEqual({'If-Match':qcAssetETag(review.assetId,17)})
  })
  it.each([undefined,{...review,assetId:'another'},{...review,channelId:'another'},{...review,contentHash:'new'},{...review,assetRevision:0},{...review,configurationRevision:Infinity}])('recusa decisão sem prova correspondente: %j',candidate=>{
    expect(qcReviewMatches(candidate,review.assetId,'hash',review.channelId)).toBe(false)
    expect(()=>qcDecisionHeaders(review.assetId,review.channelId,'hash',candidate)).toThrow('nenhum pedido')
  })
  it.each([undefined,0,-1,1.5,NaN,Number.MAX_SAFE_INTEGER+1])('recusa quarentena com revisão inválida: %s',revision=>{expect(()=>qcAssetHeaders('a',revision)).toThrow('revisão QC')})
})
