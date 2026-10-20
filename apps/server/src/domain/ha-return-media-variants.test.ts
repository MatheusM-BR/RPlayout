// NOT_RUN: pure construction/contracts only; no files/probe/native checks.
import {it,expect} from 'vitest'
import {randomUUID} from 'node:crypto'
import {prepareReturnMediaVariants} from './ha-return-media-variants.js'
import type {readReturnCandidateOrigin} from './ha-return-candidate-origin.js'
import type {HaReturnMediaReviews} from './ha-return-media-review.js'
import {haSourceBindingKey} from './ha-bindings.js'
import {planReturnAudioMounts} from './ha-return-audio-mounts.js'
import type {MediaAsset} from '@rplayout/protocol'
function fixture(){
  const origin={channel:{id:'ch'},entries:[{revision:{id:'rev'},payload:{version:1,rate:{num:25,den:1},audioChannels:2,rundown:{id:'rd',channelId:'ch'},items:[{id:'live',title:'Estúdio',type:'LIVE',sourceRef:'ndi:RESERVE'}],assets:[],graphics:{templates:[],cues:[]},secondaryEvents:[],schedule:{}}}]} as unknown as ReturnType<typeof readReturnCandidateOrigin>
  const receipt={request:{mediaReviewId:randomUUID(),applicationId:randomUUID(),channelId:'ch'},result:{bytesAndDecodeComplete:true,blockedMounts:0,evidenceMac:'a'.repeat(43)},evidence:{required:[],evidence:[],localAssets:[]}} as unknown as ReturnType<HaReturnMediaReviews['privateEvidence']>
  const plan={planId:randomUUID(),bindingDigest:'b'.repeat(64),inputs:[{sourceKey:haSourceBindingKey('ndi:RESERVE'),local:{key:'discovered:local',label:'LOCAL-ÇÃO',family:'NDI',reference:'ndi:LOCAL-ÇÃO'}}],outputs:[]}
  return {origin,receipt,plan}
}
it('nova variante mantém original e live continua sem prontidão nativa — NOT_RUN',()=>{
  const f=fixture(),before=JSON.stringify(f.origin),prepared=prepareReturnMediaVariants(f.origin,f.receipt,f.plan,{num:25,den:1},2)
  expect(JSON.stringify(f.origin)).toBe(before);expect(prepared.variants[0]?.payload.items[0]?.sourceRef).toBe('ndi:LOCAL-ÇÃO');expect(prepared.variants[0]?.checks[0]?.livePending).toBe(true)
  expect(prepared.operationalReady).toBe(false);expect(prepared.publicationAuthorized).toBe(false);expect(prepared.variants[0]?.payload.haReturnMediaOrigin.nativePrepared).toBe(false)
})
it('cadência/barramento diferentes e evidência bloqueada recusados — NOT_RUN',()=>{
  const f=fixture();expect(()=>prepareReturnMediaVariants(f.origin,f.receipt,f.plan,{num:50,den:1},2)).toThrow('decisão explícita');expect(()=>prepareReturnMediaVariants(f.origin,f.receipt,f.plan,{num:25,den:1},8)).toThrow('decisão explícita')
  expect(()=>prepareReturnMediaVariants(f.origin,{...f.receipt,result:{...f.receipt.result,blockedMounts:1}},f.plan,{num:25,den:1},2)).toThrow('não admitidos')
  expect(()=>prepareReturnMediaVariants(f.origin,{...f.receipt,request:{...f.receipt.request,channelId:'other'}},f.plan,{num:25,den:1},2)).toThrow('não admitidos')
})
function autoFixture(){
  const f=fixture(),contentHash='c'.repeat(64),asset={id:'asset',contentHash,kind:'VIDEO',path:'D:/PRIVATE/video.mxf',durationNs:8e9,durationFrames:200,defaultTrim:{in:0,out:200},defaultAudio:{mode:'AUTO',gainDb:-3,measured:null},probe:{},probeError:null,audioMetadata:{hasAudio:true,channels:2,tracks:[{index:0,channels:2,rate:48000}]}} as unknown as MediaAsset
  const edition=f.origin.entries[0]!
  edition.payload.items=[{id:'vt',title:'VT',type:'VT',mediaId:asset.id,trim:{in:25,out:75},audio:{mode:'AUTO',gainDb:-3,measured:null}} as typeof edition.payload.items[number]]
  edition.payload.assets=[asset]
  const plan=planReturnAudioMounts(f.origin,new Map([[asset.id+':'+contentHash,asset]])),entries=plan.mounts.map(({path,...mount})=>({mount,status:'MEASURED',receipt:{mountKey:mount.key,contentHash:mount.contentHash,audioTrack:mount.audioTrack,routing:mount.routing,trim:mount.trim,runtimeHash:'d'.repeat(64),checkedAt:'2026-10-11T12:00:00.000Z',reading:{ok:true,integratedLufs:-23,lra:4,truePeakDbtp:-2,sampleFrames:96000,rate:48000,channels:2,trim:mount.trim},preGainMeasured:true,postGainQualified:false,busQualified:false,editorialApproved:false,publicationAuthorized:false}}))
  const receipt={...f.receipt,result:{...f.receipt.result,blockedMounts:1,applicationDatabaseHash:'e'.repeat(64)},evidence:{required:[[asset.id+':'+contentHash,asset]],evidence:[[contentHash,{local:asset,qcStatus:'APPROVED',validation:{decoded:true,checks:{playable:true}}}]],localAssets:[[asset.id+':'+contentHash,asset]],mounts:[{revisionId:'rev',itemId:'vt',errors:['SELECTED_AUDIO_MEASUREMENT_MISSING'],warnings:[],livePending:false}],audio:{version:1,runtimeHash:'d'.repeat(64),issues:plan.issues,entries}}} as unknown as typeof f.receipt
  const decision={decisionId:randomUUID(),mediaReviewId:receipt.request.mediaReviewId,channelId:'ch',evidenceMac:receipt.result.evidenceMac,mountKeys:entries.map(row=>row.mount.key),reason:'Adotar apenas medição deste corte'}
  return {...f,receipt,decision}
}
it('AUTO explícito só altera nova cópia, mantém ganho/corte e qualificação pendente — NOT_RUN',()=>{
  const f=autoFixture(),before=JSON.stringify(f.origin),result=prepareReturnMediaVariants(f.origin,f.receipt,f.plan,{num:25,den:1},2,f.decision),variant=result.variants[0]!,item=variant.payload.items[0]!
  expect(JSON.stringify(f.origin)).toBe(before);expect(item.audio?.mode).toBe('AUTO');expect(item.audio?.gainDb).toBe(-3);expect(item.trim).toEqual({in:25,out:75});expect(item.audio?.measured?.integratedLufs).toBe(-23)
  expect(variant.checks[0]?.errors).not.toContain('SELECTED_AUDIO_MEASUREMENT_MISSING');expect(variant.checks[0]?.warnings).toContain('LOCAL_SELECTED_AUDIO_POSTGAIN_BUS_QUALIFICATION_PENDING');expect(result.autoAppliedMounts).toBe(1);expect(result.operationalReady).toBe(false)
  const another=prepareReturnMediaVariants(f.origin,f.receipt,f.plan,{num:25,den:1},2,{...f.decision,decisionId:randomUUID()});expect(another.variants[0]?.id).not.toBe(variant.id)
})
it('AUTO não dispensa outros erros nem permite copiar medição de outra revisão — NOT_RUN',()=>{
  const f=autoFixture()
  expect(()=>prepareReturnMediaVariants(f.origin,f.receipt,f.plan,{num:25,den:1},2)).toThrow('não admitidos')
  expect(()=>prepareReturnMediaVariants(f.origin,f.receipt,f.plan,{num:25,den:1},2,{...f.decision,mediaReviewId:randomUUID()})).toThrow('não corresponde')
  f.receipt.evidence.mounts[0]!.errors.push('LOCAL_AUDIO_TRACK_MISSING')
  expect(()=>prepareReturnMediaVariants(f.origin,f.receipt,f.plan,{num:25,den:1},2,f.decision)).toThrow('não admitidos')
})
it('alterar duração declarada invalida recibo AUTO de corte nominal — NOT_RUN',()=>{
  const f=autoFixture()
  f.origin.entries[0]!.payload.items[0]={...f.origin.entries[0]!.payload.items[0]!,durationOverride:25}
  expect(()=>prepareReturnMediaVariants(f.origin,f.receipt,f.plan,{num:25,den:1},2,f.decision)).toThrow('Recibo')
})
