// NOT_RUN: bounded paging/metadata contracts, no recovery or native process.
import {it,expect} from 'vitest'
import Database from 'better-sqlite3'
import {listReturnPendingJobs,haReturnJobListQuery} from './ha-return-job-list.js'
const id=(n:number)=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0')
it('postgain list uses its own ID, only pending phases, and no replay — NOT_RUN',()=>{
  const db=new Database(':memory:')
  try{
    db.exec('CREATE TABLE ha_return_postgain_reviews(postgain_review_id TEXT PRIMARY KEY,channel_id TEXT)')
    for(let n=1;n<=3;n++)db.prepare('INSERT INTO ha_return_postgain_reviews VALUES(?,?)').run(id(n),'ch')
    const read:Parameters<typeof listReturnPendingJobs>[2]=(_kind,targetId,channelId)=>({version:1,request:{channelId,postGainReviewId:targetId,mediaApplicationId:id(9)},phase:targetId===id(3)?'FAILED':targetId===id(1)?'ACCEPTED':'MEASURING',updatedAt:'2026-10-11T12:00:00.000Z',ownedHere:false,confirmationIsHistorical:true,operationalReady:false,result:null})
    const value=listReturnPendingJobs(db,{channelId:'ch',kind:'POSTGAIN_REVIEW'},read)
    expect(value.rows.map(row=>row.phase)).toEqual(['ACCEPTED','MEASURING']);expect(value.processStoppedProven).toBe(false)
    expect(()=>listReturnPendingJobs(db,{channelId:'ch',kind:'POSTGAIN_REVIEW'},(kind,targetId,channelId)=>({...read(kind,targetId,channelId),request:{channelId,mediaApplicationId:targetId}}))).toThrow('diverge')
  }finally{db.close()}
})
it('empty matching page keeps cursor; channel isolation and final page explicit — NOT_RUN',()=>{
  const db=new Database(':memory:')
  try{
    db.exec('CREATE TABLE ha_return_media_reviews(media_review_id TEXT PRIMARY KEY,channel_id TEXT); CREATE TABLE ha_return_media_applications(media_application_id TEXT PRIMARY KEY,channel_id TEXT)')
    for(let n=1;n<=26;n++)db.prepare('INSERT INTO ha_return_media_reviews VALUES(?,?)').run(id(n),'ch')
    db.prepare('INSERT INTO ha_return_media_reviews VALUES(?,?)').run(id(27),'other')
    const read:Parameters<typeof listReturnPendingJobs>[2]=(_kind,targetId,channelId)=>({version:1,request:{channelId,mediaReviewId:targetId},phase:targetId===id(26)?'CHECKING':'FAILED',updatedAt:'2026-10-11T12:00:00.000Z',ownedHere:false,confirmationIsHistorical:true,operationalReady:false,result:null})
    const first=listReturnPendingJobs(db,{channelId:'ch',kind:'MEDIA_REVIEW'},read)
    expect(first.rows).toEqual([]);expect(first.scanned).toBe(25);expect(first.nextCursor).toBe(id(25));expect(first.processStoppedProven).toBe(false);expect(first.snapshot).toBe(false)
    const second=listReturnPendingJobs(db,{channelId:'ch',kind:'MEDIA_REVIEW',afterId:first.nextCursor},read)
    expect(second.rows).toHaveLength(1);expect(second.rows[0]?.id).toBe(id(26));expect(second.rows[0]?.ownedHere).toBe(false);expect(second.nextCursor).toBeNull();expect(second.publicationAuthorized).toBe(false)
    expect(listReturnPendingJobs(db,{channelId:'ch',kind:'MEDIA_APPLICATION'},read).rows).toEqual([])
  }finally{db.close()}
})
it('no SQL names, paths or arbitrary page sizes accepted — NOT_RUN',()=>{
  const body={channelId:'ch',kind:'MEDIA_REVIEW'}
  expect(haReturnJobListQuery.safeParse(body).success).toBe(true)
  for(const extra of [{kind:'arbitrary_table'},{limit:1000000},{path:'private.db'},{afterId:'not-a-uuid'}])expect(haReturnJobListQuery.safeParse({...body,...extra}).success).toBe(false)
})
it('early candidate/binding jobs list their own identity/phase without media metadata — NOT_RUN',()=>{
  const db=new Database(':memory:')
  try{
    db.exec('CREATE TABLE ha_return_candidate_stages(candidate_id TEXT PRIMARY KEY,channel_id TEXT); CREATE TABLE ha_return_applications(application_id TEXT PRIMARY KEY,channel_id TEXT)')
    db.prepare('INSERT INTO ha_return_candidate_stages VALUES(?,?)').run(id(1),'ch')
    db.prepare('INSERT INTO ha_return_applications VALUES(?,?)').run(id(2),'ch')
    const read:Parameters<typeof listReturnPendingJobs>[2]=(kind,targetId,channelId)=>({version:1,request:{channelId,...(kind==='CANDIDATE'?{candidateId:targetId}:{applicationId:targetId})},phase:kind==='CANDIDATE'?'MATERIALIZING':'APPLYING',updatedAt:'2026-10-11T12:00:00.000Z',ownedHere:false,confirmationIsHistorical:true,operationalReady:false,result:null})
    expect(listReturnPendingJobs(db,{channelId:'ch',kind:'CANDIDATE'},read).rows[0]).toMatchObject({id:id(1),phase:'MATERIALIZING'})
    expect(listReturnPendingJobs(db,{channelId:'ch',kind:'BINDING_APPLICATION'},read).rows[0]).toMatchObject({id:id(2),phase:'APPLYING'})
    expect(()=>listReturnPendingJobs(db,{channelId:'ch',kind:'CANDIDATE'},(kind,targetId,channelId)=>({...read(kind,targetId,channelId),request:{channelId,applicationId:targetId}}))).toThrow('diverge')
  }finally{db.close()}
})
it('technical/rekey records use own IDs; legacy missing owner stays explicit — NOT_RUN',()=>{
  const db=new Database(':memory:')
  try{
    db.exec('CREATE TABLE ha_return_reviews(review_id TEXT PRIMARY KEY,channel_id TEXT); CREATE TABLE ha_return_rekeys(rekey_id TEXT PRIMARY KEY,channel_id TEXT)')
    db.prepare('INSERT INTO ha_return_reviews VALUES(?,?)').run(id(1),'ch');db.prepare('INSERT INTO ha_return_rekeys VALUES(?,?)').run(id(2),'ch')
    const read:Parameters<typeof listReturnPendingJobs>[2]=(kind,targetId,channelId)=>({version:1,request:{channelId,...(kind==='DATABASE_REVIEW'?{reviewId:targetId}:{rekeyId:targetId})},phase:kind==='DATABASE_REVIEW'?'REVIEWING':'REKEYING',updatedAt:'2026-10-11T12:00:00.000Z',ownedHere:false,...(kind==='DATABASE_REVIEW'?{ownerRecorded:false}:{}),confirmationIsHistorical:true,operationalReady:false,result:null})
    expect(listReturnPendingJobs(db,{channelId:'ch',kind:'DATABASE_REVIEW'},read).rows[0]).toMatchObject({id:id(1),phase:'REVIEWING',ownerRecorded:false})
    expect(listReturnPendingJobs(db,{channelId:'ch',kind:'REKEY'},read).rows[0]).toMatchObject({id:id(2),phase:'REKEYING',ownerRecorded:true})
  }finally{db.close()}
})
