import {it,expect} from 'vitest'
import {materializeHaPayload,inspectHaLocalGraphics} from './ha-local-payload.js'
import {haSourceBindingKey} from './ha-bindings.js'
import type {MediaAsset} from '@rplayout/protocol'

// Prepared for the consolidated review; NOT_RUN in the integration batch.
const plan={planId:'local-plan',bindingDigest:'configuration-digest',inputs:[{sourceKey:haSourceBindingKey('ndi:PRIMARY'),local:{key:'local',family:'NDI',label:'ESTÚDIO-ÇÃO',reference:'ndi:ESTÚDIO-ÇÃO'}}]}
const input=()=>({version:1,rundown:{id:'rd',channelId:'ch'},schedule:{items:[{id:'live',start:3600,end:7200}],conflicts:[]},items:[{id:'live',rundownId:'rd',type:'LIVE',title:'Jornal',sourceRef:'ndi:PRIMARY',liveEndpoint:'ndi:PRIMARY',trim:{in:0,out:900},audio:{mode:'MANUAL',gainDb:-3}}],assets:[]})
const paths=new Map<string,string>(),assets=new Map<string,MediaAsset>(),rate={num:25,den:1}
it('derives local identity while keeping schedule/editorial title/trim/audio unchanged',()=>{
  const source=input(),before=structuredClone(source)
  const result=materializeHaPayload(source,'primary-rev',plan,paths,assets,rate,2)
  expect(source).toEqual(before);expect(result.id).toMatch(/^ha-local:/)
  expect(result.payload.schedule).toEqual(source.schedule)
  expect(result.payload.items[0]).toMatchObject({id:'live',title:'Jornal',sourceRef:'ndi:ESTÚDIO-ÇÃO',liveEndpoint:'ndi:ESTÚDIO-ÇÃO',trim:source.items[0]!.trim,audio:source.items[0]!.audio})
  expect(result.checks[0]?.livePending).toBe(true)
})
it('refuses missing local binding and conflicting source references',()=>{
  expect(()=>materializeHaPayload(input(),'rev',{...plan,inputs:[]},paths,assets,rate,2)).toThrow('vínculo')
  const source=input();source.items[0]!.liveEndpoint='ndi:OTHER'
  expect(()=>materializeHaPayload(source,'rev',plan,paths,assets,rate,2)).toThrow('conflitantes')
})
it('unused metadata is not left pointing to a primary path; external automation remains blocked',()=>{
  const source={...input(),assets:[{id:'unused',contentHash:'a'.repeat(64),path:'C:/primary/private.mp4'}],secondaryEvents:[{id:'external',rundownItemId:'live',type:'DEVICE_AUTOMATION',enabled:true,deviceConfig:{target:'primary-device'}}]}
  const result=materializeHaPayload(source,'rev',plan,paths,assets,rate,2)
  expect(result.payload.assets).toEqual([])
  expect(result.checks.some(row=>row.errors.includes('EXTERNAL_AUTOMATION_LOCAL_BINDING_REQUIRED'))).toBe(true)
})
it('never retains a configured primary identity when using a discovered local input',()=>{
  const source={...input(),items:input().items.map(item=>({...item,configuredSourceId:'primary-configured-id'}))}
  expect(materializeHaPayload(source,'rev',plan,paths,assets,rate,2).payload.items[0]?.configuredSourceId).toBeNull()
  const configured={...plan,inputs:plan.inputs.map(row=>({...row,local:{...row.local,key:'configured:local-configured-id'}}))}
  expect(materializeHaPayload(source,'rev',configured,paths,assets,rate,2).payload.items[0]?.configuredSourceId).toBe('local-configured-id')
})
it('inventories external graphic dependencies but does not mistake inline geometry for an external file',()=>{
  const source={...input(),graphics:{templates:[{id:'local',svg:'<svg><use href="#shape"/></svg>'},{id:'foreign',svg:'<svg><image href="file:///C:/primary/logo.png"/></svg>'}],cues:[{itemId:'live',templateId:'local'},{itemId:'live',templateId:'foreign'},{itemId:'live',templateId:'missing'}]}}
  const result=materializeHaPayload(source,'rev',plan,paths,assets,rate,2)
  expect(result.checks.find(row=>row.itemId==='live:graphic:local')?.errors).toEqual([])
  expect(result.checks.find(row=>row.itemId==='live:graphic:foreign')?.errors).toContain('GRAPHIC_EXTERNAL_RESOURCE_LOCAL_BINDING_REQUIRED')
  expect(result.checks.find(row=>row.itemId==='live:graphic:missing')?.errors).toContain('LOCAL_GRAPHIC_TEMPLATE_MISSING')
})
it('checks the live fallback default cut against locally decoded duration without borrowing the live trim',()=>{
  const hash='b'.repeat(64),local:MediaAsset={id:'fallback',contentHash:hash,path:'D:/reserve/fallback.media',title:'Reserva',kind:'VIDEO',durationFrames:100,durationNs:4e9,probe:{width:1920,height:1080,rate,interlaceMode:'progressive',hasAudio:false,audioChannels:0,audioTracks:[]},probeError:null,categoryId:null,defaultTrim:{in:0,out:200},defaultAudio:{mode:'OFF',gainDb:0,measured:null},loudnessFile:null,suggestedTrim:null,qcStatus:'APPROVED',qcNotes:null,qcCheckedAt:null,createdAt:new Date().toISOString()}
  const source={...input(),items:input().items.map(item=>({...item,liveFallbackMediaId:'fallback'})),assets:[{...local,path:'C:/primary/fallback.mp4'}]}
  const result=materializeHaPayload(source,'rev',plan,new Map([[hash,local.path]]),new Map([['fallback:'+hash,local]]),rate,2)
  expect(result.checks.find(row=>row.itemId==='live:fallback:fallback')?.errors).toContain('TRIM_OUTSIDE_LOCAL_MEDIA')
  expect(result.payload.assets?.[0]?.path).toBe(local.path)
  expect(source.assets[0]?.path).toBe('C:/primary/fallback.mp4')
})
it('checks graphic dependencies after filling cue values, without leaking the resolved path — NOT_RUN',()=>{
  const source={...input(),graphics:{templates:[{id:'logo',name:'Marca',svg:'<svg><image href="{{image}}"/></svg>',fields:[{key:'image',label:'Imagem',defaultValue:'#local'}]}],cues:[{itemId:'live',templateId:'logo',values:{image:'file:///C:/PRIVATE/logo.png'}}]}}
  const variant=materializeHaPayload(source,'rev',plan,paths,assets,rate,2)
  expect(variant.checks[1]?.errors).toContain('GRAPHIC_EXTERNAL_RESOURCE_LOCAL_BINDING_REQUIRED')
  expect(variant.checks[1]?.warnings).toContain('LOCAL_GRAPHIC_RENDER_PENDING')
  expect(JSON.stringify(variant.checks)).not.toContain('PRIVATE')
  expect(inspectHaLocalGraphics(variant.payload).map(({revisionId,...check})=>check)).toEqual(variant.checks.slice(1).map(({revisionId,...check})=>check))
})
it('secondary values/defaults are inspected, while disabled automation does not block — NOT_RUN',()=>{
  const source={...input(),graphics:{templates:[{id:'logo',name:'Marca',svg:'<svg><image href="{{image}}"/></svg>',fields:[{key:'image',label:'Imagem',defaultValue:'https://foreign.invalid/logo.png'}]}],cues:[]},secondaryEvents:[{id:'graphic',templateId:'logo',rundownItemId:'live',enabled:true,type:'GRAPHICS_OVERLAY',payload:{image:'#shape'}},{id:'disabled',enabled:false,type:'DEVICE_AUTOMATION',deviceConfig:{target:'foreign'}},{id:'scte',enabled:true,type:'SCTE_TRIGGER',rundownItemId:'live'}]}
  const result=materializeHaPayload(source,'rev',plan,paths,assets,rate,2)
  expect(result.checks.find(row=>row.itemId==='live:graphic:logo')?.errors).toEqual([])
  expect(result.checks.filter(row=>row.errors.includes('EXTERNAL_AUTOMATION_LOCAL_BINDING_REQUIRED'))).toHaveLength(1)
  const noValues={...result.payload,secondaryEvents:result.payload.secondaryEvents?.map(event=>({...event,payload:{}}))}
  expect(inspectHaLocalGraphics(noValues,'original-revision')[0]).toMatchObject({revisionId:'original-revision',errors:['GRAPHIC_EXTERNAL_RESOURCE_LOCAL_BINDING_REQUIRED']})
})
it('duplicate graphic templates are rejected instead of silently choosing the last — NOT_RUN',()=>{
  const source={...input(),graphics:{templates:[{id:'same',svg:'<svg/>'},{id:'same',svg:'<svg/>'}],cues:[]}}
  expect(()=>materializeHaPayload(source,'rev',plan,paths,assets,rate,2)).toThrow('duplicados')
})
