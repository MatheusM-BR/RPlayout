import {expect,it} from 'vitest'
import type {TransportState} from './transport.js'
import {restoredLiveVideoConfirmed} from './restored-live-confirmation.js'
type Mutable<T>=T extends object?{-readonly [K in keyof T]:Mutable<T[K]>}:T
const fixture=()=>({mode:'NATIVE',playing:true,onAir:{itemId:'live'},liveSources:[{busItemIds:{pgm:'live'},busStates:{pgm:'ON_PGM'},busSignals:{pgm:{status:'SIGNAL_OK',videoRecent:true,audioRecent:true,sampleAgeMs:0}}}]} as unknown as Mutable<TransportState>)
it('confirma somente vídeo recente da live exata no PGM nativo',()=>{expect(restoredLiveVideoConfirmed(fixture(),'live')).toBe(true)})
it.each(['SIMULATED','PVW_ONLY','NO_VIDEO','FAILED','OTHER_ITEM','LOST','NO_PGM'] as const)('não promove por %s',mode=>{
  const state=fixture(),source=state.liveSources[0]!
  if(mode==='SIMULATED')state.mode='SIMULATED'
  if(mode==='PVW_ONLY'){source.busItemIds={pvw:'live'};source.busStates={pvw:'PVW_READY'}}
  if(mode==='NO_VIDEO')source.busSignals!.pgm!.videoRecent=false
  if(mode==='FAILED')source.busSignals!.pgm!.status='FAILED'
  if(mode==='OTHER_ITEM')source.busItemIds!.pgm='other'
  if(mode==='LOST')source.busStates!.pgm='LOST'
  if(mode==='NO_PGM')state.onAir=null
  expect(restoredLiveVideoConfirmed(state,'live')).toBe(false)
})
it('ausência de áudio não é fabricada como sucesso de áudio nem substitui prova de vídeo',()=>{
  const state=fixture();state.liveSources[0]!.busSignals!.pgm={status:'NO_AUDIO',videoRecent:true,audioRecent:false,sampleAgeMs:0}
  expect(restoredLiveVideoConfirmed(state,'live')).toBe(true)
})
