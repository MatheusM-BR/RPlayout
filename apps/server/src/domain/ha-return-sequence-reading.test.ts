// NOT_RUN: pure response contracts, no native/file/hardware work.
import {it,expect} from 'vitest'
import {readReturnSequence,returnSequenceConfigurations} from './ha-return-sequence-reading.js'
function fixture(){
  const configs=[0,-3].map(gainDb=>({audioTrack:0,inputChannels:2,audioChannels:2,routing:{mode:'DEFAULT'},auxiliaryPairs:[],gainDb,ceilingDbtp:-1,trim:{inNs:0,outNs:400000000}}))
  const pairs=(frames:number)=>[{outputPair:1,sampleFrames:frames,integratedLufs:-23,lra:0,truePeakDbtp:-3}]
  const raw={ok:true,kind:'CONTINUOUS_RENDERED_CUT_SEQUENCE',rate:48000,channels:2,sampleFrames:38400,segments:configs.map((_,index)=>({segmentIndex:index,firstFrame:index*19200,sampleFrames:19200,pairs:pairs(19200)})),pairs:pairs(38400),startupFramesRemoved:240,flushedFrames:240,limiterReductionDb:0,initialState:'RESET_ONCE',statePreservedAcrossCuts:true,sourceCoverageConfirmed:true,trimStage:'AFTER_ITEM_MIX',decodeFromStart:true,configurations:configs,operationalSelectorQualified:false,nativeTransitionQualified:false,avQualified:false,editorialApproved:false,publicationAuthorized:false}
  return {configs,raw}
}
it('requires exact ordered cuts and rejects frames, ordinals and approval claims — NOT_RUN',()=>{
  const {raw,configs}=fixture();expect(readReturnSequence(raw,configs).sampleFrames).toBe(38400)
  expect(()=>readReturnSequence(raw,[...configs].reverse())).toThrow()
  for(const patch of [{sampleFrames:38401},{segments:[raw.segments[1],raw.segments[0]]},{segments:raw.segments.map(segment=>({...segment,firstFrame:0}))},{segments:raw.segments.map(segment=>({...segment,sampleFrames:19199}))},{pairs:[]},{flushedFrames:239},{initialState:'RESET'},{sourceCoverageConfirmed:false},{statePreservedAcrossCuts:false},{operationalSelectorQualified:true},{nativeTransitionQualified:true},{avQualified:true},{publicationAuthorized:true},{privatePath:'D:/media'}])expect(()=>readReturnSequence({...raw,...patch},configs)).toThrow()
})
it('rejects empty, changing bus/ceiling and short cuts — NOT_RUN',()=>{
  const {configs}=fixture();expect(()=>returnSequenceConfigurations.parse([])).toThrow()
  for(const patch of [{audioChannels:8},{ceilingDbtp:-2},{trim:{inNs:0,outNs:399999999}}])expect(()=>returnSequenceConfigurations.parse([configs[0],{...configs[1],...patch}])).toThrow()
})
