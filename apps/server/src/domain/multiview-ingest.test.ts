import {describe,expect,it} from 'vitest'
import {engineComposition} from './multiview-composite.js'
import {DEFAULT_LIVE_WATCHDOG_POLICY,type LiveWatchdogPolicy,type WatchdogSample} from '@rplayout/protocol'
import {ChannelLiveWatchdog,type WatchdogExecutor,type WatchdogObservedSource} from './live-watchdog.js'

describe('multiview composto: ingest único por entrada',()=>{
  it('cada célula de entrada vai ao engine com o endereço do cadastro, e só ela',()=>{
    const sources=[
      {id:'cam-1',kind:'SRT',targetUrl:'srt://10.0.0.5:9000?mode=caller&passphrase=segredo123',enabled:true},
      {id:'ndi-1',kind:'NDI',targetUrl:'ESTUDIO (CAM 2)',enabled:true},
      {id:'off',kind:'SRT',targetUrl:'srt://10.0.0.6:9000',enabled:false},
    ]
    const composition={layout:'MV_2X2' as const,quality:'LEVE' as const,cells:[{kind:'source' as const,id:'cam-1'},{kind:'source' as const,id:'ndi-1'},{kind:'source' as const,id:'off'},{kind:'pgm' as const}]}
    const engine=engineComposition(composition,sources)
    expect(engine.cells).toEqual([
      {kind:'source',id:'cam-1',endpoint:'srt://10.0.0.5:9000?mode=caller&passphrase=segredo123'},
      {kind:'source',id:'ndi-1',endpoint:'ndi:ESTUDIO (CAM 2)'},
      {kind:'source',id:'off'},
      {kind:'pgm'},
    ])
    // A composição salva/mostrada não ganha o endereço.
    expect(JSON.stringify(composition)).not.toContain('srt://')
  })

  it('na contingência, o watchdog observa a entrada pelo receptor compartilhado, sem PVW',async()=>{
    const T0=Date.parse('2026-10-31T12:00:00.000Z')
    const healthy=(now:number,patch:Partial<WatchdogSample>={}):WatchdogSample=>({sampledAt:new Date(now).toISOString(),videoAgeMs:20,audioAgeMs:15,videoPresent:true,audioPresent:true,rateNum:30000,rateDen:1001,
      receivedFrames:5000,sampledContentUnchangedMs:0,contentSampleAgeMs:100,arrivalFps:29.97,distinctFps:29.97,lumaMeanPercent:45,lumaStdPercent:22,
      lumaSampleAgeMs:100,audioRmsDbfs:-18,audioSampleRatio:1,audioStalledMs:null,inputKbps:4500,...patch} as WatchdogSample)
    const lost=(now:number,since:number)=>healthy(now,{videoAgeMs:now-since,audioAgeMs:now-since,arrivalFps:0,distinctFps:0})
    const calls:string[]=[]
    let contingency=false
    const executor:WatchdogExecutor={
      showWait:async art=>{calls.push('show:'+art.kind)},hideWait:async()=>{calls.push('hide')},
      enterContingency:async revision=>{calls.push('enter:'+revision);contingency=true},
      monitorSource:async source=>{calls.push('monitor:'+source)},returnLive:async()=>{calls.push('return');contingency=false},
      contingencyActive:()=>contingency,
    }
    const watchdog=new ChannelLiveWatchdog(executor),p={...structuredClone(DEFAULT_LIVE_WATCHDOG_POLICY),mode:'AUTOMATIC',contingencyRevisionId:'rev-reserva'} as LiveWatchdogPolicy
    const source=(sample:WatchdogSample|null):WatchdogObservedSource=>({sourceKey:'srt://cam',sourceId:'cam',name:'Câmera',kind:'SRT',itemId:'live-1',sample})
    let now=T0
    const step=async(until:number,program:(at:number)=>WatchdogSample|null,ingest:(at:number)=>WatchdogSample|null)=>{
      for(;now<=until;now+=250){
        // O PVW fica vazio o tempo todo: só o receptor compartilhado mede a entrada.
        watchdog.tick({now,policy:p,channelFps:29.97,program:contingency?null:source(program(now)),preview:[],ingest:contingency&&ingest(now)?[source(ingest(now))]:[]},()=>now)
        await new Promise(resolve=>setImmediate(resolve))
      }
    }
    await step(T0+1000,at=>healthy(at),()=>null)
    await step(T0+9000,at=>lost(at,T0+1000),()=>null)
    expect(calls).toEqual(['show:SLATE','enter:rev-reserva','monitor:srt://cam'])
    expect(watchdog.monitoredSourceKey()).toBe('srt://cam')
    await step(T0+20_000,at=>healthy(at),at=>healthy(at))
    expect(calls.at(-1)).toBe('return')
    expect(watchdog.monitoredSourceKey()).toBeNull()
  })
})
