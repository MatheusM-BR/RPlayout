import {describe,expect,it} from 'vitest'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import type {ManagedLiveSource,SrtTelemetry} from '@rplayout/protocol'
import type {Live} from '../types.js'
import {qcLiveSourceStatus} from './qc-live-source-status.js'
import {QcLiveSourceRow} from '../components/broadcast/QcLiveSourceRow.js'

const now=Date.parse('2026-10-16T19:00:00Z')
const source={id:'ndi',name:'Estúdio ÇÃÓ',kind:'NDI',targetUrl:'ndi:Estúdio ÇÃÓ',enabled:true,role:'PRIMARY'} as ManagedLiveSource
const preview={kind:'SOURCE' as const,source:source.targetUrl}
const row=()=>({source:source.targetUrl,itemId:'input',state:'PVW_READY',changedAt:new Date(now).toISOString(),message:null,
  busStates:{pvw:'PVW_READY'},measurements:{pvw:{width:1920,height:1080,rateNum:25,rateDen:1,audioChannels:2,sampleRate:48000,videoPresent:true,audioPresent:true,videoAgeMs:40,audioAgeMs:20,receivedFrames:100,arrivalJitterMs:0,sampledAt:new Date(now).toISOString()}}}) as Live['transport']['liveSources'][number]
const status=(signal=row(),at=now)=>qcLiveSourceStatus(source,signal,preview,'NATIVE',at)

describe('QC source rows distinguish current signal from retained history',()=>{
  it('shows bound, recent native measurement and adds browser elapsed time',()=>{
    const value=status(row(),now+500)
    expect(value).toMatchObject({label:'PVW PRONTO',tone:'ok'})
    expect(value.details).toContain('Medição PVW · 1920×1080 · 25.00 fps · áudio 2 ch · quadro 540 ms')
  })
  it('IDLE with a recent cached frame is historical, not current signal',()=>{
    const signal=row();signal.state='IDLE';signal.busStates={pvw:'IDLE'}
    expect(status(signal)).toMatchObject({label:'NÃO SINTONIZADA',tone:'warning'})
    expect(status(signal).details).toContain('Última amostra (histórica)')
    expect(status(signal).details).toContain('idade do quadro na coleta: 40 ms')
    expect(status(signal).detailsTitle).toContain('Não confirma vídeo ou áudio atuais')
  })
  it('READY ages out even with no new WebSocket message',()=>{
    expect(status(row(),now+3000)).toMatchObject({label:'SEM MEDIÇÃO RECENTE',tone:'warning'})
    expect(status(row(),now+3000).details).toContain('histórica')
  })
  it('fresh telemetry with an old buffer is no recent video, not green',()=>{
    const signal=row();signal.measurements!.pvw!.videoAgeMs=1900
    expect(status(signal,now+200)).toMatchObject({label:'SEM VÍDEO RECENTE',tone:'warning'})
    expect(status(signal,now+200).details).toContain('quadro 2100 ms · SEM VÍDEO RECENTE')
  })
  it.each(['invalid',new Date(now+1000).toISOString()])('invalid/future sample time is history (%s)',sampledAt=>{
    const signal=row();signal.measurements!.pvw!.sampledAt=sampledAt
    expect(status(signal).tone).toBe('warning');expect(status(signal).details).toContain('histórica')
  })
  it('another PVW selection cannot reuse the previous source READY',()=>{
    const value=qcLiveSourceStatus(source,row(),{kind:'SOURCE',source:'omt:Other'},'NATIVE',now)
    expect(value).toMatchObject({label:'NÃO SINTONIZADA',tone:'warning'})
    expect(value.details).toContain('histórica')
  })
  it('same-source PGM and PVW retain distinct measurements',()=>{
    const signal=row();signal.busStates={pgm:'ON_PGM',pvw:'IDLE'}
    signal.measurements!.pgm={...signal.measurements!.pvw!,width:1280,height:720}
    const value=qcLiveSourceStatus(source,signal,{kind:'SOURCE',source:'omt:Other'},'NATIVE',now)
    expect(value).toMatchObject({label:'NO PGM',tone:'ok'});expect(value.details).toContain('Medição PGM · 1280×720')
  })
  it('a missing explicit PVW state cannot borrow the aggregate PGM state',()=>{
    const signal=row();signal.state='ON_PGM';signal.busStates={pgm:'ON_PGM'}
    signal.measurements!.pgm={...signal.measurements!.pvw!,width:1280,height:720}
    expect(status(signal).details).toContain('Medição PGM · 1280×720')
    expect(status(signal).label).toBe('NO PGM')
  })
  it('ITEM CUE binds bus item identity, not another item from this source',()=>{
    const signal=row();signal.busItemIds={pvw:'new-item'}
    expect(qcLiveSourceStatus(source,signal,{kind:'ITEM',id:'new-item'},'NATIVE',now).tone).toBe('ok')
    expect(qcLiveSourceStatus(source,signal,{kind:'ITEM',id:'input'},'NATIVE',now).details).toContain('histórica')
  })
  it.each(['SIMULATED',undefined] as const)('simulation/unknown mode does not certify native signal (%s)',mode=>{
    const value=qcLiveSourceStatus(source,row(),preview,mode,now)
    expect(value.tone).toBe('warning');expect(value.details).toContain('histórica')
  })
  it('expired audio is not reported present merely because buffers once arrived',()=>{
    const signal=row();signal.measurements!.pvw!.audioAgeMs=2001
    expect(status(signal)).toMatchObject({label:'VÍDEO SEM ÁUDIO',tone:'warning'})
    expect(status(signal).details).toContain('SEM ÁUDIO RECENTE')
  })
  it('disabled/failed inputs never show green or current measurement',()=>{
    expect(qcLiveSourceStatus({...source,enabled:false},row(),preview,'NATIVE',now).details).toContain('histórica')
    const signal=row();signal.busStates={pvw:'FAILED'}
    expect(status(signal)).toMatchObject({label:'FALHOU',tone:'error'});expect(status(signal).details).toContain('histórica')
  })
  it('missing measurement is unknown, not confirmed no-signal or audio',()=>{
    const signal=row();delete signal.measurements
    expect(status(signal)).toMatchObject({label:'SEM MEDIÇÃO RECENTE',tone:'warning',details:null})
    expect(qcLiveSourceStatus(source,undefined,preview,'NATIVE',now)).toMatchObject({label:'CADASTRADA · SINAL N/D',details:null})
  })
  it('rejects measurement from a different source and accepts absent jitter defensively',()=>{
    const signal=row();signal.source='omt:wrong'
    expect(status(signal).details).toBeNull()
    const partial=row();partial.measurements!.pvw!.arrivalJitterMs=null
    expect(status(partial).details).not.toContain('variação')
  })
  it('uses the per-channel warning policy without converting it into TAKE permission',()=>{
    const signal=row();signal.measurements!.pvw!.arrivalJitterMs=150
    expect(status(signal)).toMatchObject({label:'SINAL INSTÁVEL',tone:'warning'})
    expect(qcLiveSourceStatus(source,signal,preview,'NATIVE',now,{arrivalWarningEnabled:false,minimumReceivedFrames:50,warningFrameIntervals:3}).tone).toBe('ok')
  })
  it('SRT OPTIMAL is labelled network-only and cannot color unmonitored video green',()=>{
    const html=renderToStaticMarkup(createElement(QcLiveSourceRow,{source:{...source,kind:'SRT'},selected:false,disabled:false,onSelect:()=>{},now,transportMode:'NATIVE',telemetry:{linkState:'OPTIMAL',bitrateKbps:5000,rttMs:2,packetLossPercent:0} as SrtTelemetry}))
    expect(html).toContain('Rede SRT');expect(html).toContain('não confirma vídeo')
    expect(html).toContain('CADASTRADA · SINAL N/D');expect(html).not.toContain('text-status-ok')
  })
})
