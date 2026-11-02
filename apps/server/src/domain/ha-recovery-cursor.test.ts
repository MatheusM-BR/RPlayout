import {it,expect} from 'vitest'
import {stoppedHaCheckpoint,haResumeIntent,assertHaNativeResumeIntent} from './ha-recovery-cursor.js'
import type {ChannelCheckpoint} from './checkpoints.js'
// NOT_RUN: aggregate implementation, fixtures reserved for consolidated review.
const mapping=new Map([['published','ha-local:derived'],['loop','ha-local:loop']])
const cursor:ChannelCheckpoint={version:1,channelId:'ch',rundownId:'rd',revisionId:'published',itemId:'vt',elapsed:73,playing:true,realEngine:true,
  executionId:'execution',ownerRunId:'11111111-1111-4111-8111-111111111111',graphicReceiptId:'primary-receipt',rate:{num:25,den:1},audioChannels:2,programTrim:{in:10,out:500,contentHash:'ab'.repeat(32)}}
const capturedAt='2026-10-10T12:00:00.000Z'
it('preparation strips active-only proof without mutating the original playing cursor',()=>{
  const original=JSON.stringify(cursor),stopped=stoppedHaCheckpoint(cursor,'ch',mapping)
  expect(stopped).toMatchObject({playing:false,realEngine:false,elapsed:73,executionId:'execution',revisionId:'ha-local:derived'})
  expect(stopped.programTrim).toBeUndefined();expect(stopped.ownerRunId).toBeUndefined();expect(stopped.graphicReceiptId).toBeUndefined()
  expect(JSON.stringify(cursor)).toBe(original)
})
it('resume preserves exact confirmed trim/offset but not foreign process or composition acknowledgement',()=>{
  const intent=haResumeIntent(cursor,'ch',mapping,capturedAt),native=assertHaNativeResumeIntent(intent)
  expect(intent).toMatchObject({capturedAt,offsetPolicy:'LAST_CONFIRMED_OFFSET',foreignOwnerRunId:cursor.ownerRunId,foreignGraphicReceiptId:'primary-receipt',graphicRecoveryRequired:true,automaticTake:false,promotionReady:false})
  expect(native).toMatchObject({elapsed:73,programTrim:{in:10,out:500,contentHash:'ab'.repeat(32)},revisionId:'ha-local:derived',playing:true,realEngine:true})
  expect(native?.ownerRunId).toBeUndefined();expect(native?.graphicReceiptId).toBeUndefined()
})
it('remaps both contingency editions without borrowing the primary engine identity',()=>{
  const source={...cursor,contingency:{loopRevisionId:'loop',loopRundownId:'rd-loop',rundownId:'rd',revisionId:'published',itemId:'vt',elapsed:22,activatedAt:capturedAt}}
  expect(haResumeIntent(source,'ch',mapping,capturedAt).checkpoint?.contingency).toMatchObject({loopRevisionId:'ha-local:loop',revisionId:'ha-local:derived',elapsed:22})
})
it('does not guess an edition or extrapolate seconds into the playback offset',()=>{
  expect(()=>stoppedHaCheckpoint(cursor,'ch',new Map())).toThrow('sem variante local')
  expect(()=>haResumeIntent(cursor,'other',mapping,capturedAt)).toThrow('outro canal')
  expect(()=>haResumeIntent(cursor,'ch',mapping,'not-a-date')).toThrow('captura')
  expect(haResumeIntent(cursor,'ch',mapping,'2026-10-11T12:00:00.000Z').checkpoint?.elapsed).toBe(73)
})
it('native activation rejects simulated, paused and legacy recovery while preserving its original intent',()=>{
  const {programTrim:_trim,...base}=cursor
  for(const source of [{...base,realEngine:false},{...base,playing:false},{...base,executionId:undefined},{...base,rate:undefined},{...base,audioChannels:undefined}]){
    const intent=haResumeIntent(source,'ch',mapping,capturedAt),before=JSON.stringify(intent)
    expect(()=>assertHaNativeResumeIntent(intent)).toThrow();expect(JSON.stringify(intent)).toBe(before)
  }
  expect(assertHaNativeResumeIntent(haResumeIntent(null,'ch',mapping,capturedAt))).toBeNull()
})
