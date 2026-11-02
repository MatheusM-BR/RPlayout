// NOT_RUN: output contract only. No child/file/native audio execution.
import {it,expect} from 'vitest'
import {readReturnAudioMount,readReturnPostGainAudioMount} from './ha-return-audio-probe.js'
const trim={inNs:1e9,outNs:3e9}
const reading=()=>({ok:true,integratedLufs:-23,lra:4,truePeakDbtp:-2,sampleFrames:96000,rate:48000,channels:2,trim})
it('flushed mode requires explicit policy and exact startup/tail coverage; legacy remains distinct — NOT_RUN',()=>{
  const config={gainDb:-3,ceilingDbtp:-1,tailPolicy:'COMPENSATE_AND_FLUSH'},processing={kind:'ISOLATED_POSTGAIN_FLUSHED_STEREO',gainDb:-3,ceilingDbtp:-1,lookaheadMs:5,releaseMs:50,limiterReductionDb:0,initialState:'RESET',tailFlushed:true,startupFramesRemoved:240,flushedFrames:240,busQualified:false,transitionQualified:false,publicationAuthorized:false},raw={...reading(),processing}
  expect(readReturnPostGainAudioMount(raw,trim,config).processing.tailFlushed).toBe(true)
  expect(()=>readReturnPostGainAudioMount(raw,trim,{gainDb:-3,ceilingDbtp:-1})).toThrow('Política')
  for(const extra of [{flushedFrames:239},{startupFramesRemoved:0},{tailFlushed:false},{busQualified:true}])expect(()=>readReturnPostGainAudioMount({...raw,processing:{...processing,...extra}},trim,config)).toThrow()
  expect(()=>readReturnAudioMount(raw,trim)).toThrow()
})
it('requires sample coverage and exact selected interval — NOT_RUN',()=>{
  expect(readReturnAudioMount(reading(),trim).sampleFrames).toBe(96000)
  expect(()=>readReturnAudioMount({...reading(),sampleFrames:95998},trim)).toThrow('PCM')
  expect(()=>readReturnAudioMount({...reading(),trim:{inNs:0,outNs:2e9}},trim)).toThrow('PCM')
})
it('whole-file, missing samples, failed/native-invalid or nonfinite values are refused — NOT_RUN',()=>{
  for(const value of [{...reading(),trim:null},{...reading(),sampleFrames:0},{...reading(),channels:8},{...reading(),ok:false},{...reading(),integratedLufs:Infinity},{...reading(),lra:-1}])expect(()=>readReturnAudioMount(value,trim)).toThrow()
  expect(()=>readReturnAudioMount(reading(),{inNs:0,outNs:399999999})).toThrow('Corte')
})
it('post-gain requires exact processing settings and cannot be passed off as pre-gain — NOT_RUN',()=>{
  const config={gainDb:-3,ceilingDbtp:-1},processing={kind:'ISOLATED_POSTGAIN_LIMITED_STEREO',...config,lookaheadMs:5,releaseMs:50,limiterReductionDb:0,initialState:'RESET',tailFlushed:false,busQualified:false,transitionQualified:false,publicationAuthorized:false},raw={...reading(),processing}
  expect(readReturnPostGainAudioMount(raw,trim,config).processing.gainDb).toBe(-3)
  expect(()=>readReturnAudioMount(raw,trim)).toThrow()
  expect(()=>readReturnPostGainAudioMount(reading(),trim,config)).toThrow()
  expect(()=>readReturnPostGainAudioMount(raw,trim,{...config,gainDb:0})).toThrow('Ganho')
  for(const extra of [{lookaheadMs:0},{tailFlushed:true},{busQualified:true},{transitionQualified:true},{publicationAuthorized:true},{initialState:'CONTINUOUS'},{limiterReductionDb:-1}])expect(()=>readReturnPostGainAudioMount({...raw,processing:{...processing,...extra}},trim,config)).toThrow()
})
