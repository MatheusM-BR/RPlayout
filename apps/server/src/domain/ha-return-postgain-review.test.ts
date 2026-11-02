// NOT_RUN: isolated encrypted journal fixtures; no media or native measurement.
import {it,expect} from 'vitest'
import Database from 'better-sqlite3'
import {createHash,randomUUID} from 'node:crypto'
import {HaReturnPostGainReviews,haReturnPostGainReviewRequest,HA_RETURN_POSTGAIN_REVIEW_RESERVE} from './ha-return-postgain-review.js'
import {summarizeReturnPostGain} from './ha-return-postgain-evidence.js'
import type {planReturnPostGainAudio} from './ha-return-postgain-plan.js'
function fixture(){
  const request={postGainReviewId:randomUUID(),mediaApplicationId:randomUUID(),channelId:'ch'},profile={channelId:'ch',targetLufs:-23,ceilingDbtp:-1,audioChannels:2 as const,rate:{num:25,den:1}},profileFingerprint=createHash('sha256').update(JSON.stringify(profile)).digest('hex')
  const capture={mediaReviewId:randomUUID(),mediaDatabaseHash:'a'.repeat(64),evidenceMac:'b'.repeat(43),profile,profileFingerprint,autoDecisionId:null}
  const plan={profile,profileFingerprint,jobs:[],issues:[],postGainQualified:false,busQualified:false,transitionQualified:false,publicationAuthorized:false} as ReturnType<typeof planReturnPostGainAudio>
  const evidence={version:1,profileFingerprint,runtimeHash:'c'.repeat(64),entries:[],issues:[],postGainQualified:false,busQualified:false,transitionQualified:false,publicationAuthorized:false}
  return {request,capture,plan,evidence,summary:summarizeReturnPostGain(evidence)}
}
it('ID-only intent, same UUID consults without replay, quota/history remain — NOT_RUN',()=>{
  const db=new Database(':memory:'),f=fixture()
  try{
    const journal=new HaReturnPostGainReviews(db,'postgain-contract','boot-a'),current=()=>{}
    expect(haReturnPostGainReviewRequest.safeParse({...f.request,gainDb:3}).success).toBe(false)
    const accepted=journal.accept(f.request,f.capture,'operator',current)
    expect(journal.accept(f.request,f.capture,'operator',current)).toEqual(accepted)
    expect(journal.reservedBytes()).toBe(HA_RETURN_POSTGAIN_REVIEW_RESERVE)
    expect(()=>journal.accept({...f.request,mediaApplicationId:randomUUID()},f.capture,'operator',current)).toThrow('outra intenção')
    expect(()=>db.exec('DELETE FROM ha_return_postgain_reviews')).toThrow('history')
    expect(new HaReturnPostGainReviews(db,'postgain-contract','boot-b').query(f.request.postGainReviewId,'ch').ownedHere).toBe(false)
    journal.closeInterrupted(f.request.postGainReviewId,'ch','ACCEPTED',accepted.updatedAt,()=>{},current)
    expect(journal.query(f.request.postGainReviewId,'ch').phase).toBe('FAILED')
    expect(journal.reservedBytes()).toBe(HA_RETURN_POSTGAIN_REVIEW_RESERVE)
  }finally{db.close()}
})
it('private evidence encrypted, summary-only consultation, terminal review cannot rerun — NOT_RUN',async()=>{
  const db=new Database(':memory:'),f=fixture()
  try{
    const journal=new HaReturnPostGainReviews(db,'postgain-contract','boot-a');journal.accept(f.request,f.capture,'operator',()=>{})
    let checks=0,runs=0
    const measure=async()=>{runs++;return {evidence:f.evidence,summary:f.summary}}
    const value=await journal.run(f.request,f.plan,measure,async()=>{checks++},()=>{})
    expect(value.phase).toBe('REVIEWED');expect(checks).toBe(2);expect(runs).toBe(1)
    expect(value.result?.summary.measured).toBe(0);expect(value.result?.summary.publicationAuthorized).toBe(false)
    expect('privateEvidence' in value).toBe(false)
    expect((db.prepare('SELECT payload FROM ha_return_postgain_reviews').get() as {payload:string}).payload).not.toContain(f.capture.mediaDatabaseHash)
    expect(journal.privateEvidence(f.request.postGainReviewId,'ch',f.plan).evidence).toEqual(f.evidence)
    await expect(journal.run(f.request,f.plan,measure,async()=>{},()=>{})).rejects.toThrow('já foi iniciada')
    expect(runs).toBe(1)
    expect(()=>journal.privateEvidence(f.request.postGainReviewId,'ch',{...f.plan,profileFingerprint:'e'.repeat(64)})).toThrow('capturados')
    expect(()=>new HaReturnPostGainReviews(db,'postgain-contract','boot-b').privateEvidence(f.request.postGainReviewId,'ch',f.plan)).toThrow('próprio')
    expect(()=>journal.closeInterrupted(f.request.postGainReviewId,'ch','REVIEWED',value.updatedAt,()=>{},()=>{})).toThrow('confirmação')
  }finally{db.close()}
})
it('runner failure leaves FAILED without proof and never retries — NOT_RUN',async()=>{
  const db=new Database(':memory:'),f=fixture()
  try{
    const journal=new HaReturnPostGainReviews(db,'postgain-contract','boot-a');journal.accept(f.request,f.capture,'operator',()=>{})
    await expect(journal.run(f.request,f.plan,async()=>{throw new Error('probe failed')},async()=>{},()=>{})).rejects.toThrow('probe failed')
    const value=journal.query(f.request.postGainReviewId,'ch');expect(value.phase).toBe('FAILED');expect(value.result).toBeNull()
    expect(journal.existing(f.request)?.phase).toBe('FAILED')
    expect(()=>journal.privateEvidence(f.request.postGainReviewId,'ch',f.plan)).toThrow('ausente')
  }finally{db.close()}
})
