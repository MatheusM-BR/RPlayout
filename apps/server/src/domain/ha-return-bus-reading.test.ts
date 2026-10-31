// NOT_RUN: pure result contracts; no native/file/hardware execution.
import {it,expect} from 'vitest'
import {readReturnBus,returnBusConfigSchema} from './ha-return-bus-reading.js'
function fixture(channels:2|8|16){
  const config={audioTrack:0,inputChannels:2,audioChannels:channels,routing:{mode:'DEFAULT' as const},auxiliaryPairs:[],gainDb:-3,ceilingDbtp:-1,trim:{inNs:1e9,outNs:3e9}}
  const {audioChannels,trim,...settings}=config
  const reading={ok:true,rate:48000,channels:audioChannels,trim,sampleFrames:96000,startupFramesRemoved:240,flushedFrames:240,limiterReductionDb:0,pairs:Array.from({length:channels/2},(_,index)=>({outputPair:index+1,integratedLufs:-23,lra:0,truePeakDbtp:-3,sampleFrames:96000})),processing:{...settings,routing:{mode:'DEFAULT',matrix:null,pairs:null},kind:'ISOLATED_RENDERED_BUS',initialState:'RESET',sourceCoverageConfirmed:true,trimStage:'AFTER_ITEM_MIX',decodeFromStart:true,tailFlushed:true,pairLinked:channels>2,busQualified:false,transitionQualified:false,avQualified:false,publicationAuthorized:false}}
  return {config,reading}
}
it('accepts exact 2/8/16 bus only, never qualification — NOT_RUN',()=>{
  for(const channels of [2,8,16]as const){const {config,reading}=fixture(channels);expect(readReturnBus(reading,config).pairs).toHaveLength(channels/2)}
})
it('rejects missing/duplicate/reordered pairs, partial cuts and missing tail — NOT_RUN',()=>{
  const {config,reading}=fixture(8)
  for(const override of [{pairs:reading.pairs.slice(1)},{pairs:[reading.pairs[1],reading.pairs[0],...reading.pairs.slice(2)]},{pairs:reading.pairs.map(pair=>({...pair,sampleFrames:95999}))},{sampleFrames:95998},{flushedFrames:239},{startupFramesRemoved:0},{trim:{inNs:0,outNs:2e9}},{channels:16},{ok:false},{privatePath:'C:/media'}])expect(()=>readReturnBus({...reading,...override},config)).toThrow()
})
it('rejects padding, other routing/gain, continuous state and approval claims — NOT_RUN',()=>{
  const {config,reading}=fixture(8)
  for(const override of [{sourceCoverageConfirmed:false},{gainDb:0},{ceilingDbtp:-2},{inputChannels:4},{audioTrack:1},{routing:{mode:'STEREO_1_2'}},{pairLinked:false},{tailFlushed:false},{decodeFromStart:false},{trimStage:'BEFORE_ITEM_MIX'},{initialState:'CONTINUOUS'},{busQualified:true},{transitionQualified:true},{avQualified:true},{publicationAuthorized:true}])expect(()=>readReturnBus({...reading,processing:{...reading.processing,...override}},config)).toThrow()
})
it('rejects undeclared/missing input pairs and out-of-range configurations — NOT_RUN',()=>{
  const {config}=fixture(8)
  for(const override of [{inputChannels:0},{audioChannels:4},{routing:{mode:'STEREO_3_4'}},{auxiliaryPairs:[{outputPair:2,inputPair:2}]},{auxiliaryPairs:[{outputPair:2,inputPair:1},{outputPair:2,inputPair:1}]},{gainDb:13},{ceilingDbtp:1},{trim:{inNs:1e9,outNs:1e9+399999999}},{path:'C:/media'}])expect(()=>returnBusConfigSchema.parse({...config,...override})).toThrow()
})
