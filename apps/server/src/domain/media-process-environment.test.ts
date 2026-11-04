import {describe,it,expect} from 'vitest'
import {mediaProcessEnvironment,mediaMtxProcessEnvironment,engineProcessEnvironment} from './media-process-environment.js'

describe('ambiente exclusivo do broker MediaMTX',()=>{
  it.each(['MTX_','mtx_','RtSp_'])('descarta o namespace inteiro %s sem listas parciais',prefix=>{
    const environment=Object.freeze(Object.fromEntries(['CONFKEY','MOq','APIADDRESS','RTSPADDRESS','RTPADDRESS','RTCPADDRESS','WEBRTCLOCALUDPADDRESS','AUTHINTERNALUSERS_0_PASS','PATHS_ALL_RUNONINIT','FUTURE_OPTION'].map(key=>[prefix+key,'PRIVATE_VALUE'])))
    expect(mediaMtxProcessEnvironment(environment)).toEqual({})
    expect(Object.keys(environment)).toHaveLength(10)
  })
  it('preserva runtime do sistema e não altera política do engine ou dos demais helpers',()=>{
    const environment=Object.freeze({Path:'runtime',SystemRoot:'C:\\Windows',TEMP:'own-temp',GST_PLUGIN_PATH:'plugins',MTX_API:'no',RTSP_CONFKEY:'PRIVATE_KEY',RPLAYOUT_OMT_RUNTIME:'libomt.dll',RPLAYOUT_ENCODER:'x264',RPLAYOUT_HARDWARE_DECODE:'1',RPLAYOUT_VAULT_KEY:'PRIVATE_VAULT'})
    expect(mediaMtxProcessEnvironment(environment)).toEqual({Path:'runtime',SystemRoot:'C:\\Windows',TEMP:'own-temp',GST_PLUGIN_PATH:'plugins',RPLAYOUT_OMT_RUNTIME:'libomt.dll',RPLAYOUT_ENCODER:'x264'})
    expect(mediaProcessEnvironment(environment)).toHaveProperty('MTX_API','no')
    expect(engineProcessEnvironment(environment)).toHaveProperty('RPLAYOUT_HARDWARE_DECODE','1')
    expect(engineProcessEnvironment(environment)).toHaveProperty('RTSP_CONFKEY','PRIVATE_KEY')
  })
  it('não remove variáveis de nomes apenas parecidos',()=>{
    expect(mediaMtxProcessEnvironment({MTX:'keep',RTSP:'keep',MTXCLIENT:'keep',MY_MTX_SETTING:'keep'})).toEqual({MTX:'keep',RTSP:'keep',MTXCLIENT:'keep',MY_MTX_SETTING:'keep'})
  })
})

describe('ambiente do engine: ingest único por entrada',()=>{
  it('repassa só os valores qualificados do receptor compartilhado',async()=>{
    const {engineProcessEnvironment}=await import('./media-process-environment.js')
    const env=engineProcessEnvironment({PATH:'/bin',RPLAYOUT_INGEST_SHARED:'0',RPLAYOUT_INGEST_LINGER_MS:'5000',RPLAYOUT_INGEST_ITEM_LATENCY_MS:'120',RPLAYOUT_ADMIN_PASSWORD:'x'})
    expect(env.RPLAYOUT_INGEST_SHARED).toBe('0')
    expect(env.RPLAYOUT_INGEST_LINGER_MS).toBe('5000')
    expect(env.RPLAYOUT_INGEST_ITEM_LATENCY_MS).toBe('120')
    expect(env.RPLAYOUT_ADMIN_PASSWORD).toBeUndefined()
    const bad=engineProcessEnvironment({RPLAYOUT_INGEST_SHARED:'talvez',RPLAYOUT_INGEST_LINGER_MS:'999999',RPLAYOUT_INGEST_ITEM_LATENCY_MS:'-1'})
    expect(bad.RPLAYOUT_INGEST_SHARED).toBe('0')
    // Sem opt-in exato, a produção fica no caminho da r88-36 (receptor desligado).
    expect(engineProcessEnvironment({}).RPLAYOUT_INGEST_SHARED).toBe('0')
    expect(engineProcessEnvironment({RPLAYOUT_INGEST_SHARED:'1'}).RPLAYOUT_INGEST_SHARED).toBe('1')
    // Saída de emergência da latência do tsdemux SRT agora chega ao engine (50–2000 ms).
    expect(engineProcessEnvironment({RPLAYOUT_SRT_DEMUX_LATENCY_MS:'700'}).RPLAYOUT_SRT_DEMUX_LATENCY_MS).toBe('700')
    expect(engineProcessEnvironment({RPLAYOUT_SRT_DEMUX_LATENCY_MS:'10'}).RPLAYOUT_SRT_DEMUX_LATENCY_MS).toBeUndefined()
    expect(bad.RPLAYOUT_INGEST_LINGER_MS).toBeUndefined()
    expect(bad.RPLAYOUT_INGEST_ITEM_LATENCY_MS).toBeUndefined()
  })
})
