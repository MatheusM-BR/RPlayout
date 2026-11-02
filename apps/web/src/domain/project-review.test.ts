import {describe,expect,it} from 'vitest'
import {PROJECT_SECTIONS,type ProjectRestoreReview} from '@rplayout/protocol'
import {projectRestoreRequest} from './project-review.js'
const counts=Object.fromEntries(PROJECT_SECTIONS.map(key=>[key,1])) as ProjectRestoreReview['restoring']
const review:ProjectRestoreReview={channelId:'canal:ç',projectId:'p/ã',projectRevision:123,configurationRevision:8,token:'a'.repeat(64),label:'QA',createdAt:'now',replacing:counts,restoring:counts,removedRundowns:0,preservedPublications:1,enabledOutputs:1,enabledDestinations:0,enabledGuests:0,formatBefore:{width:320,height:180,rateNum:25,rateDen:1,audioChannels:2},formatAfter:{width:320,height:180,rateNum:25,rateDen:1,audioChannels:2},requiresStoppedProgram:true,automaticTake:false,physicalOutputValidated:false}
describe('confirma a prova original exibida, sem renovação implícita',()=>{
  it('usa IDs codificados e envia apenas o token e revisão exibidos',()=>{
    const before=structuredClone(review),request=projectRestoreRequest(review.channelId,review.projectId,review)
    expect(request).toEqual({headers:{'if-match':'"project:canal%3A%C3%A7:p%2F%C3%A3:123"'},body:JSON.stringify({reviewToken:review.token})});expect(review).toEqual(before)
  })
  it.each([{channelId:'outro'},{projectId:'outro'},{projectRevision:NaN},{projectRevision:0},{configurationRevision:undefined},{token:'bad'}])('rejeita prova inválida %j',change=>{
    expect(()=>projectRestoreRequest(review.channelId,review.projectId,{...review,...change} as ProjectRestoreReview)).toThrow('conferência')
  })
})
