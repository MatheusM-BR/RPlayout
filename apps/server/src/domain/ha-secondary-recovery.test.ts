import {it,expect} from 'vitest'
import type {SecondaryEvent} from '@rplayout/protocol'
import {prepareHaSecondaryRecovery} from './ha-secondary-recovery.js'
// NOT_RUN: frozen plan classification; no destination command/native proof.
const context={channelId:'ch',executionId:'primary-execution',revisionId:'primary-revision',itemId:'item',elapsed:73,duration:250}
const event=(id:string,offsetFrames:number,extra:Partial<SecondaryEvent>={}):SecondaryEvent=>({id,enabled:true,rundownItemId:'item',type:'GRAPHICS_OVERLAY',triggerMode:'OFFSET_FROM_START',offsetFrames,durationFrames:100,...extra} as SecondaryEvent)
const run=(id:string,eventId:string,extra:Record<string,unknown>={})=>({id,...context,eventId,mode:'FIRE',state:'EXECUTED',frames:20,...extra})
it('suppresses past triggers even when replication has no outcome; future/manual remain distinct',()=>{
  const result=prepareHaSecondaryRecovery([event('past',20),event('future',100),event('manual',0,{triggerMode:'MANUAL'})],[],context)
  expect(result.entries.map(row=>[row.eventId,row.disposition,row.seedFired,row.seedDismissed])).toEqual([['past','SUPPRESSED_NO_REPLAY',true,true],['future','FUTURE',false,false],['manual','MANUAL_ONLY',false,false]])
  expect(result.automaticReplay).toBe(false)
})
it('retains confirmed active display as an ownership obligation without a foreign replay',()=>{
  const result=prepareHaSecondaryRecovery([event('active',20)],[run('old-run','active')],context)
  expect(result.entries[0]).toMatchObject({sourceFireId:'old-run',localOwnershipRequired:true,disposition:'SUPPRESSED_NO_REPLAY'})
})
it('blocks uncertain FIRE and does not turn FAILED into permission to resend',()=>{
  const result=prepareHaSecondaryRecovery([event('uncertain',20),event('failed',20)],[run('pending','uncertain',{state:'FIRING'}),run('failed-run','failed',{state:'FAILED'})],context)
  expect(result.blockers).toEqual([{eventId:'uncertain',sourceRunId:'pending',reason:'FOREIGN_RESULT_UNCERTAIN'}])
  expect(result.entries[1]).toMatchObject({disposition:'SUPPRESSED_NO_REPLAY',localOwnershipRequired:false})
})
it('excludes another occurrence/revision and rejects duplicate phases',()=>{
  expect(prepareHaSecondaryRecovery([event('future',100)],[run('other','future',{revisionId:null})],context).entries[0]?.disposition).toBe('FUTURE')
  expect(()=>prepareHaSecondaryRecovery([event('active',20)],[run('one','active'),run('two','active')],context)).toThrow('ambíguas')
})
it('never treats live without a confirmed end as a zero-duration before-end trigger',()=>{
  expect(()=>prepareHaSecondaryRecovery([event('end',10,{triggerMode:'OFFSET_BEFORE_END'})],[],{...context,duration:0})).toThrow('duração confirmada')
})
