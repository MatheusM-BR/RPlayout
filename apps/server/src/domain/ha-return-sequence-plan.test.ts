// NOT_RUN: frozen ordering/cut contracts, not execution or native continuity.
import {it,expect} from 'vitest'
import type {MediaAsset} from '@rplayout/protocol'
import {orderReturnSequenceJobs} from './ha-return-sequence-plan.js'
import type {planReturnBusAudio} from './ha-return-bus-plan.js'
import {returnBusJobKey} from './ha-return-bus-plan.js'
import {returnAudioMountKey} from './ha-return-audio-mounts.js'
import {busEvidenceFixture} from './ha-return-bus-fixtures.js'
function fixture(){
  const {job,plan}=busEvidenceFixture(),asset={id:'a',kind:'VIDEO',contentHash:job.mount.contentHash,durationFrames:100,durationNs:4e9,defaultTrim:{in:0,out:100}} as MediaAsset
  const items=[0,1].map(order=>({id:'vt'+order,rundownId:'r',title:'Deferred VT '+order,order,type:'VT',mediaId:'a',sourceRef:null,audio:null,minDuration:0,elastic:null,onOverrun:'PUSH',blockId:null,fit:'PILLARBOX',audioTrack:null,locked:false,autoNext:true,loop:false,notes:null,trim:{in:25,out:75},durationOverride:null,anchor:{kind:'FLOW'}}))
  const schedule={items:items.map((item,index)=>({id:item.id,order:item.order,start:index*50,end:(index+1)*50,duration:50,plannedDuration:50,state:'READY',adjustments:[],anchorHit:true,deviation:0})),conflicts:[],suggestions:[],endsAt:100}
  const edition={revision:{id:'rev',rundownId:'r'},payload:{version:1,rundown:{id:'r',channelId:'ch',name:'Deferred sequence fixture',plannedStart:0,loop:false,date:'2026-10-13',createdAt:'2026-10-13T00:00:00Z',updatedAt:'2026-10-13T00:00:00Z'},items,assets:[asset],rate:{num:25,den:1},audioChannels:8,schedule}} as Parameters<typeof orderReturnSequenceJobs>[0]
  const jobs=items.map(item=>{const identity={...job.mount,itemId:item.id},mount={...identity,key:returnAudioMountKey(identity)},fields={...job,mount};return {...fields,key:returnBusJobKey(fields)}})
  const bus={...plan,jobs} as ReturnType<typeof planReturnBusAudio>
  return {edition,bus,assets:new Map([['a:'+asset.contentHash,asset]])}
}
it('preserves full published order and exact operational cuts — NOT_RUN',()=>{
  const f=fixture(),value=orderReturnSequenceJobs(f.edition,f.bus,f.assets)
  expect(value.errors).toEqual([]);expect(value.jobs.map(job=>job.mount.itemId)).toEqual(['vt0','vt1'])
})
it('gap, dropped/live/missing job or dynamic changed cut blocks whole edition — NOT_RUN',()=>{
  for(const mode of ['gap','drop','live','missing','trim']){
    const f=fixture()
    if(mode==='gap')f.edition.payload.schedule={...f.edition.payload.schedule,items:f.edition.payload.schedule.items.map((row,index)=>index===1?{...row,start:51,end:101}:row)}
    if(mode==='drop')f.edition.payload.schedule={...f.edition.payload.schedule,items:f.edition.payload.schedule.items.map((row,index)=>index===1?{...row,state:'DROPPED'}:row)}
    if(mode==='live')f.edition.payload.items=[f.edition.payload.items[0]!,{...f.edition.payload.items[1]!,liveEndpoint:'ndi://source'}]
    if(mode==='missing')f.bus.jobs=f.bus.jobs.slice(0,1)
    if(mode==='trim')f.edition.payload.schedule={...f.edition.payload.schedule,items:f.edition.payload.schedule.items.map((row,index)=>index===1?{...row,end:99,duration:49}:row)}
    const value=orderReturnSequenceJobs(f.edition,f.bus,f.assets);expect(value.errors.length).toBeGreaterThan(0);expect(value.jobs).toEqual([])
  }
})
