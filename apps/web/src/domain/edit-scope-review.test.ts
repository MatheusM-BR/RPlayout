import {describe,expect,it} from 'vitest'
import type {EditScopeReview} from '@rplayout/protocol'
import {reviewedScopeReady} from './edit-scope-review.js'
const review:EditScopeReview={itemId:'one',scope:'ALL_RUNDOWNS',sourceRevision:5,token:'A'.repeat(43),itemsAffected:2,references:2,assetUpdated:false,owners:[]}
describe('confirmar alvos do escopo na página',()=>{
  it('escopo restrito não depende de uma revisão ampla',()=>expect(reviewedScopeReady(null,'one',5,'ITEM',false)).toBe(true))
  it('sem revisão ou confirmação explícita não arma o botão',()=>{
    expect(reviewedScopeReady(null,'one',5,'ALL_RUNDOWNS',true)).toBe(false)
    expect(reviewedScopeReady(review,'one',5,'ALL_RUNDOWNS',false)).toBe(false)
    expect(reviewedScopeReady(review,'one',5,'ALL_RUNDOWNS',true)).toBe(true)
  })
  it.each(['item','revision','scope','token'])('resposta de outra seleção não arma esta edição: %s',kind=>{
    const value={...review,...(kind==='item'?{itemId:'two'}:kind==='revision'?{sourceRevision:6}:kind==='scope'?{scope:'ASSET_DEFAULT' as const}:{token:'invalid'})}
    expect(reviewedScopeReady(value,'one',5,'ALL_RUNDOWNS',true)).toBe(false)
  })
})
