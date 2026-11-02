// NOT_RUN: response/intention contracts only; no browser, HTTP or audio work.
import {it,expect} from 'vitest'
import type {HaReturnMediaApplicationReport,HaReturnBusReviewReport} from '../api.js'
import {parseReturnBusIntent,readReturnBusReport} from './ha-return-bus.js'
const id='00000000-0000-4000-8000-000000000001',mediaId='00000000-0000-4000-8000-000000000002',reviewId='00000000-0000-4000-8000-000000000003'
function fixture(){
  const media={request:{mediaApplicationId:mediaId,mediaReviewId:reviewId,channelId:'ch'},result:{databaseHash:'a'.repeat(64),evidenceMac:'b'.repeat(43)}} as unknown as HaReturnMediaApplicationReport
  const intent=parseReturnBusIntent({busReviewId:id,mediaApplicationId:mediaId,channelId:'ch'},media)
  const report={version:1,request:intent,capture:{mediaReviewId:reviewId,mediaDatabaseHash:'a'.repeat(64),evidenceMac:'b'.repeat(43),profile:{channelId:'ch',targetLufs:-23,ceilingDbtp:-1,audioChannels:8,rate:{num:25,den:1}},profileFingerprint:'c'.repeat(64),autoDecisionId:null},actor:'operator',phase:'REVIEWED',quotaBytes:64*1024*1024,updatedAt:'2026-10-11T12:00:00.000Z',ownedHere:true,confirmationIsHistorical:true,operationalReady:false,publicationAuthorized:false,result:{runtimeHash:'d'.repeat(64),checkedAt:'2026-10-11T12:00:00.000Z',evidenceMac:'e'.repeat(43),summary:{required:2,measured:1,failed:1,planBlocked:0,avQualified:false,busQualified:false,transitionQualified:false,editorialApproved:false,publicationAuthorized:false}}} as HaReturnBusReviewReport
  return {media,intent,report}
}
it('intention only admits exact copy/channel/UUID; response stays unqualified — NOT_RUN',()=>{
  const f=fixture();expect(readReturnBusReport(f.report,f.intent,f.media)).toEqual(f.report)
  expect(()=>parseReturnBusIntent({...f.intent,path:'private'},f.media)).toThrow()
  expect(()=>parseReturnBusIntent({...f.intent,channelId:'foreign'},f.media)).toThrow()
  expect(()=>parseReturnBusIntent({...f.intent,busReviewId:'invalid'},f.media)).toThrow()
  expect(()=>readReturnBusReport({...f.report,privateEvidence:'private'},f.intent,f.media)).toThrow()
  expect(()=>readReturnBusReport({...f.report,phase:'MEASURING'},f.intent,f.media)).toThrow()
  expect(()=>readReturnBusReport({...f.report,phase:'MEASURING',result:null},f.intent,f.media)).not.toThrow()
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
  ])expect(()=>readReturnBusReport(bad,f.intent,f.media)).toThrow()
})
it('assessment requires captured policy and never turns missing measurements into success — NOT_RUN',()=>{
  const f=fixture(),policy={channelId:'ch',configurationRevision:7,audioChannels:8 as const,pairs:Array.from({length:4},(_,index)=>({outputPair:index+1,loudness:null,maxTruePeakDbtp:-1}))}
  const assessment={required:2,withinProfile:1,failed:1,planBlocked:0,isolatedAssessmentComplete:false,policyFingerprint:'f'.repeat(64),configurationRevision:7}
  const report={...f.report,capture:{...f.report.capture,policy},result:{...f.report.result!,assessment}}
  expect(readReturnBusReport(report,f.intent,f.media).result?.assessment?.withinProfile).toBe(1)
  for(const bad of [
    {...report,result:{...report.result,assessment:{...assessment,withinProfile:2,failed:0,isolatedAssessmentComplete:true}}},
    {...report,result:{...report.result,assessment:{...assessment,configurationRevision:8}}},
    {...report,capture:{...report.capture,policy:null}},
    {...report,result:{...report.result,assessment:null}},
    {...report,capture:{...report.capture,policy:{...policy,pairs:[]}}},
  ])expect(()=>readReturnBusReport(bad,f.intent,f.media)).toThrow()
})
