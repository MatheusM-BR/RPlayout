import {describe,it,expect} from 'vitest'
import {operationalReviewReady} from './operational-review.js'
import type {OperationalReview} from '@rplayout/protocol'
const review:OperationalReview={operation:'PUBLISH',rundownId:'rd',channelId:'ch',editorialRevision:31,activeRevisionId:null,token:'A'.repeat(43)}
describe('conferência corresponde à seleção exibida',()=>{
  it('somente a publicação desta grade, canal e versão habilita confirmação',()=>{
    expect(operationalReviewReady(review,'rd','ch',31)).toBe(true)
    for(const value of [null,undefined,{...review,operation:'ROLLBACK' as const},{...review,token:''}])expect(operationalReviewReady(value,'rd','ch',31)).toBe(false)
    expect(operationalReviewReady(review,'other','ch',31)).toBe(false)
    expect(operationalReviewReady(review,'rd','other',31)).toBe(false)
    expect(operationalReviewReady(review,'rd','ch',32)).toBe(false)
    expect(operationalReviewReady(review,'rd','ch',undefined)).toBe(false)
  })
})
