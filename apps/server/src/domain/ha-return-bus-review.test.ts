// NOT_RUN: encrypted journal only; no native work or STAGED-copy validation.
import {it,expect} from 'vitest'
import Database from 'better-sqlite3'
import {createHash,randomUUID} from 'node:crypto'
import {HaReturnBusReviews,haReturnBusReviewRequest,HA_RETURN_BUS_REVIEW_RESERVE} from './ha-return-bus-review.js'
import type {planReturnBusAudio} from './ha-return-bus-plan.js'
import {summarizeReturnBus} from './ha-return-bus-evidence.js'
function fixture(){
  const request={busReviewId:randomUUID(),mediaApplicationId:randomUUID(),channelId:'ch'}
  const profile={channelId:'ch',targetLufs:-23,ceilingDbtp:-1,audioChannels:8 as const,rate:{num:25,den:1}},profileFingerprint=createHash('sha256').update(JSON.stringify(profile)).digest('hex')
  const capture={mediaReviewId:randomUUID(),mediaDatabaseHash:'a'.repeat(64),evidenceMac:'b'.repeat(43),profile,profileFingerprint,autoDecisionId:null}
  const plan={profile,profileFingerprint,jobs:[],issues:[],busQualified:false,transitionQualified:false,avQualified:false,publicationAuthorized:false} as ReturnType<typeof planReturnBusAudio>
  const evidence={version:1,profileFingerprint,runtimeHash:'c'.repeat(64),entries:[],issues:[],busQualified:false,transitionQualified:false,avQualified:false,publicationAuthorized:false}
  return {request,capture,plan,evidence}
}
it('ID-only intent cannot be replaced/replayed and retains quota after interruption — NOT_RUN',()=>{
  const db=new Database(':memory:'),f=fixture()
  try{
    const journal=new HaReturnBusReviews(db,'bus-contract','boot-a'),current=()=>{}
    expect(haReturnBusReviewRequest.safeParse({...f.request,gainDb:0}).success).toBe(false)
    const initial=journal.accept(f.request,f.capture,'operator',current)
    expect(journal.accept(f.request,f.capture,'operator',current)).toEqual(initial)
    expect(()=>journal.accept({...f.request,mediaApplicationId:randomUUID()},f.capture,'operator',current)).toThrow()
    expect(()=>db.exec('DELETE FROM ha_return_bus_reviews')).toThrow()
    expect(new HaReturnBusReviews(db,'bus-contract','boot-b').query(f.request.busReviewId,'ch').ownedHere).toBe(false)
    expect(()=>journal.closeInterrupted(f.request.busReviewId,'ch','ACCEPTED','2020-01-01T00:00:00.000Z',()=>{},current)).toThrow()
    journal.closeInterrupted(f.request.busReviewId,'ch','ACCEPTED',initial.updatedAt,()=>{},current)
    expect(journal.query(f.request.busReviewId,'ch').phase).toBe('FAILED')
    expect(journal.reservedBytes()).toBe(HA_RETURN_BUS_REVIEW_RESERVE)
  }finally{db.close()}
})
it('confirmation is private/encrypted/historical and terminal work never reruns — NOT_RUN',async()=>{
  const db=new Database(':memory:'),f=fixture()
  try{
    const journal=new HaReturnBusReviews(db,'bus-contract','boot-a');journal.accept(f.request,f.capture,'operator',()=>{})
    await journal.run(f.request,f.plan,async()=>({evidence:f.evidence,summary:summarizeReturnBus(f.evidence)}),async()=>{},()=>{})
    const report=journal.query(f.request.busReviewId,'ch')
    expect(report.phase).toBe('REVIEWED');expect(report.operationalReady).toBe(false);expect(report).not.toHaveProperty('privateEvidence');expect(report).not.toHaveProperty('owner')
    expect(journal.privateEvidence(f.request.busReviewId,'ch',f.plan).summary.measured).toBe(0)
    await expect(journal.run(f.request,f.plan,async()=>{throw new Error('must not run')},async()=>{},()=>{})).rejects.toThrow()
    const row=db.prepare('SELECT payload FROM ha_return_bus_reviews').get() as {payload:string};expect(row.payload).not.toContain('"capture"')
  }finally{db.close()}
})
