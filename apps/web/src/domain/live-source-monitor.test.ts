import {describe,expect,it} from 'vitest'
import type {ManagedLiveSource,SrtTelemetry} from '@rplayout/protocol'
import type {Live} from '../types.js'
import {liveSourceMonitor} from './live-source-monitor.js'

const now=Date.parse('2026-10-01T23:00:00Z')
const monitors={port:8889,program:'ch/monitor',preview:'ch/preview'}
const source=(kind:ManagedLiveSource['kind']='NDI')=>({id:'source',name:'Estúdio',kind,targetUrl:`${kind.toLowerCase()}:CÂMERA ÇÃO`,enabled:true,role:'PRIMARY'} as ManagedLiveSource)
const sample=()=>({width:1920,height:1080,rateNum:30000,rateDen:1001,interlaceMode:'progressive',audioChannels:2,sampleRate:48000,videoAgeMs:40,audioAgeMs:20,videoPresent:true,audioPresent:true,receivedFrames:100,arrivalJitterMs:0,sampledAt:new Date(now).toISOString()})
const live=(kind:ManagedLiveSource['kind']='NDI'):Live=>({transport:{mode:'NATIVE',channelId:'ch',rundownId:'rd',onAir:null,preview:{kind:'ITEM',id:'live-item'},previewPosition:null,preparedItemId:null,preparingItemId:null,playing:false,standby:true,liveSources:[{source:source(kind).targetUrl,itemId:'live-item',state:'PVW_READY',message:null,changedAt:new Date(now).toISOString(),busStates:{pvw:'PVW_READY'},measurements:{pvw:sample()}}]},graphic:null,alerts:[],now:0,meters:{} as Live['meters']})
describe('monitor de fonte deriva sinal dos barramentos, não do cadastro',()=>{
  it.each(['NDI','OMT','SDI'] as const)('reconhece CUE de item e medidas %s, sem sonda SRT',kind=>{
    const result=liveSourceMonitor(source(kind),live(kind),monitors,undefined,now)
    expect(result).toMatchObject({tally:'CUED',syncState:'LOCKED',signalLabel:'VÍDEO PRESENTE',monitorBus:'pvw',whepPath:'ch/preview'})
    expect(result.fps).toBeCloseTo(29.970,3);expect(result.format).toContain('1920×1080')
  })
  it('CUE de fonte direta aceita referência protegida estável, não a máscara',()=>{
    const state=live('SRT'),id='A'.repeat(43)
    const input={...source('SRT'),targetUrl:'srt://host:9000?passphrase=REDACTED',controlRef:`srt:protected:v1:${id}.envelopeNew`}
    const reference=`srt:protected:v1:${id}.envelopeOld`
    state.transport.preview={kind:'SOURCE',source:reference};state.transport.liveSources[0]!.source=reference
    expect(liveSourceMonitor(input,state,monitors,undefined,now).whepPath).toBe('ch/preview')
  })
  it('PGM usa monitor de programa e suas medidas; PVW perdido não apaga PGM saudável',()=>{
    const state=live(),row=state.transport.liveSources[0]!
    state.transport.onAir={itemId:'live-item',startedAt:0,elapsed:0}
    row.state='LOST';row.busStates={pgm:'ON_PGM',pvw:'LOST'};row.measurements={pgm:sample(),pvw:{...sample(),videoPresent:false}}
    expect(liveSourceMonitor(source(),state,monitors,undefined,now)).toMatchObject({tally:'ON_AIR',syncState:'LOCKED',monitorBus:'mon',whepPath:'ch/monitor'})
  })
  it('QC da mesma fonte não perde identidade de PGM nem CUE de outro item',()=>{
    const state=live(),row=state.transport.liveSources[0]!
    state.transport.onAir={itemId:'pgm-item',startedAt:0,elapsed:0}
    row.itemId='source:ndi:CÂMERA ÇÃO';row.busItemIds={pgm:'pgm-item',pvw:'live-item'}
    row.busStates={pgm:'ON_PGM',pvw:'PVW_READY'};row.measurements={pgm:sample(),pvw:sample()}
    expect(liveSourceMonitor(source(),state,monitors,undefined,now)).toMatchObject({tally:'ON_AIR',whepPath:'ch/monitor'})
    state.transport.onAir=null
    expect(liveSourceMonitor(source(),state,monitors,undefined,now)).toMatchObject({tally:'CUED',whepPath:'ch/preview'})
  })
  it('entrada cadastrada não ganha CUE ou SEM SINAL sem ter sido aberta',()=>{
    expect(liveSourceMonitor(source(),null,monitors,undefined,now)).toMatchObject({tally:'OFFLINE',signalLabel:'NÃO MONITORADA',whepPath:null})
  })
  it('telemetria SRT saudável não confirma vídeo/áudio e não atribui CUE',()=>{
    const result=liveSourceMonitor(source('SRT'),null,monitors,{linkState:'OPTIMAL'} as SrtTelemetry,now)
    expect(result).toMatchObject({tally:'OFFLINE',signalLabel:'NÃO MONITORADA',syncState:'LOST',whepPath:null})
  })
  it('mede áudio separadamente, sem inventar silêncio ou nível em dB',()=>{
    const state=live();state.transport.liveSources[0]!.measurements!.pvw!.audioPresent=false
    const result=liveSourceMonitor(source(),state,monitors,undefined,now)
    expect(result.signalLabel).toBe('VÍDEO PRESENTE');expect(result.signalMessage).toContain('áudio ausente')
    expect(result).not.toHaveProperty('audioLevels')
  })
  it('simulação, medida vencida e instante futuro não viram vídeo presente',()=>{
    const state=live();state.transport.mode='SIMULATED'
    expect(liveSourceMonitor(source(),state,monitors,undefined,now)).toMatchObject({signalLabel:'SIMULADO',whepPath:null,tally:'OFFLINE'})
    state.transport.mode='NATIVE'
    for(const timestamp of [now-3000,now+1000]){
      state.transport.liveSources[0]!.measurements!.pvw!.sampledAt=new Date(timestamp).toISOString()
      expect(liveSourceMonitor(source(),state,monitors,undefined,now)).toMatchObject({signalLabel:'MEDIÇÃO INDISPONÍVEL',whepPath:null})
    }
  })
  it('sinal perdido no PGM conserva tally do item selecionado, mas não mostra vídeo antigo',()=>{
    const state=live(),row=state.transport.liveSources[0]!
    state.transport.onAir={itemId:'live-item',startedAt:0,elapsed:0};row.busStates={pgm:'LOST'};row.measurements={pgm:{...sample(),videoPresent:false}}
    expect(liveSourceMonitor(source(),state,monitors,undefined,now)).toMatchObject({tally:'ON_AIR',signalLabel:'SEM VÍDEO RECENTE',whepPath:null})
  })
  it('registro antigo com mesma fonte não substitui item que está realmente selecionado',()=>{
    const state=live();state.transport.preview={kind:'ITEM',id:'another-item'}
    expect(liveSourceMonitor(source(),state,monitors,undefined,now)).toMatchObject({tally:'OFFLINE',signalLabel:'NÃO MONITORADA',whepPath:null})
  })
})
