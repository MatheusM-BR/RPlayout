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
