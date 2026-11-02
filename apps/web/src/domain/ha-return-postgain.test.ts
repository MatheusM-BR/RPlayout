// NOT_RUN: response/intention contracts only; no browser, HTTP or audio work.
import {it,expect} from 'vitest'
import type {HaReturnMediaApplicationReport,HaReturnPostGainReviewReport} from '../api.js'
import {parseReturnPostGainIntent,readReturnPostGainReport} from './ha-return-postgain.js'
const id='00000000-0000-4000-8000-000000000001',mediaId='00000000-0000-4000-8000-000000000002',reviewId='00000000-0000-4000-8000-000000000003'
function fixture(){
  const media={request:{mediaApplicationId:mediaId,mediaReviewId:reviewId,channelId:'ch'},result:{databaseHash:'a'.repeat(64),evidenceMac:'b'.repeat(43)}} as unknown as HaReturnMediaApplicationReport
  const intent=parseReturnPostGainIntent({postGainReviewId:id,mediaApplicationId:mediaId,channelId:'ch'},media)
  const report={version:1,request:intent,capture:{mediaReviewId:reviewId,mediaDatabaseHash:'a'.repeat(64),evidenceMac:'b'.repeat(43),profile:{channelId:'ch',targetLufs:-23,ceilingDbtp:-1,audioChannels:8,rate:{num:25,den:1}},profileFingerprint:'c'.repeat(64),autoDecisionId:null},actor:'operator',phase:'REVIEWED',quotaBytes:64*1024*1024,updatedAt:'2026-10-11T12:00:00.000Z',ownedHere:true,confirmationIsHistorical:true,operationalReady:false,publicationAuthorized:false,result:{runtimeHash:'d'.repeat(64),checkedAt:'2026-10-11T12:00:00.000Z',evidenceMac:'e'.repeat(43),summary:{required:2,measured:1,failed:1,planBlocked:0,postGainQualified:false,busQualified:false,transitionQualified:false,editorialApproved:false,publicationAuthorized:false}}} as HaReturnPostGainReviewReport
  return {media,intent,report}
}
it('intention only admits exact copy/channel/UUID; response stays unqualified — NOT_RUN',()=>{
  const f=fixture();expect(readReturnPostGainReport(f.report,f.intent,f.media)).toEqual(f.report)
  expect(()=>parseReturnPostGainIntent({...f.intent,path:'private'},f.media)).toThrow()
  expect(()=>parseReturnPostGainIntent({...f.intent,channelId:'foreign'},f.media)).toThrow()
  expect(()=>parseReturnPostGainIntent({...f.intent,postGainReviewId:'invalid'},f.media)).toThrow()
  expect(()=>readReturnPostGainReport({...f.report,privateEvidence:'private'},f.intent,f.media)).toThrow()
  expect(()=>readReturnPostGainReport({...f.report,phase:'MEASURING'},f.intent,f.media)).toThrow()
  expect(()=>readReturnPostGainReport({...f.report,phase:'MEASURING',result:null},f.intent,f.media)).not.toThrow()
})
it('wrong provenance/decision/counts/approval are rejected — NOT_RUN',()=>{
  const f=fixture(),capture=f.report.capture,result=f.report.result!
  for(const bad of [
    {...f.report,capture:{...capture,mediaDatabaseHash:'f'.repeat(64)}},
    {...f.report,capture:{...capture,autoDecisionId:id}},
    {...f.report,capture:{...capture,profile:{...capture.profile,targetLufs:NaN}}},
    {...f.report,result:{...result,summary:{...result.summary,failed:0}}},
    {...f.report,result:{...result,summary:{...result.summary,busQualified:true}}},
    {...f.report,publicationAuthorized:true},
    {...f.report,result:null},
  ])expect(()=>readReturnPostGainReport(bad,f.intent,f.media)).toThrow()
})
