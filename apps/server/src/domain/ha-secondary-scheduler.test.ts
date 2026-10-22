import {it,expect} from 'vitest'
import type {SecondaryEvent} from '@rplayout/protocol'
import {SecondaryEventScheduler} from './graphics.js'
// NOT_RUN: occurrence seeding/cadence only, no native effects or receipts.
const event=(id:string,offsetFrames:number):SecondaryEvent=>({id,enabled:true,rundownItemId:'item',type:'GRAPHICS_OVERLAY',triggerMode:'OFFSET_FROM_START',offsetFrames,durationFrames:50,templateId:'',targetLayer:'LOWER_THIRD',payload:{}} as SecondaryEvent)
it('seed suppresses foreign phases while the future event fires/dismisses once',async()=>{
  const calls:Array<[string,string]>=[],scheduler=new SecondaryEventScheduler((value,mode)=>{calls.push([value.id,mode])})
  scheduler.setEvents([event('past',20),event('future',100)])
  scheduler.seedRecoveredItem('item',[{eventId:'past',seedFired:true,seedDismissed:true},{eventId:'future',seedFired:false,seedDismissed:false}])
  expect(scheduler.hasDue('item',73,250)).toBe(false)
  expect(scheduler.hasDue('item',100,250)).toBe(true)
  await scheduler.tick('item',100,250);await scheduler.tick('item',100,250)
  expect(calls).toEqual([['future','FIRE']])
  await scheduler.tick('item',150,250);await scheduler.tick('item',150,250)
  expect(calls).toEqual([['future','FIRE'],['future','DISMISS']])
})
it('does not nominate a different occurrence as due or admit a second seed',()=>{
  const scheduler=new SecondaryEventScheduler(()=>{})
  scheduler.setEvents([event('future',100)])
  scheduler.seedRecoveredItem('item',[{eventId:'future',seedFired:false,seedDismissed:false}])
  expect(scheduler.hasDue('other',200,250)).toBe(false)
  expect(()=>scheduler.seedRecoveredItem('item',[])).toThrow('ocorrência nova')
})
it('rejects unregistered event and dismissed-without-fire recovery phases',()=>{
  const scheduler=new SecondaryEventScheduler(()=>{})
  scheduler.setEvents([event('future',100)])
  expect(()=>scheduler.seedRecoveredItem('item',[{eventId:'other',seedFired:true,seedDismissed:true}])).toThrow()
  expect(()=>scheduler.seedRecoveredItem('item',[{eventId:'future',seedFired:false,seedDismissed:true}])).toThrow()
})
