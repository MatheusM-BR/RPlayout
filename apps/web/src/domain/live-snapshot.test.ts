import {describe,expect,it} from 'vitest'
import type {Live} from '../types.js'
import {liveSnapshot} from './live-snapshot.js'

describe('contrato HTTP/WebSocket da operação',()=>{
  it('conserva estado de recuperação sem metadados do envelope',()=>{
    const message={transport:{channelId:'ch'},reconfiguration:{ready:false,reason:'Recuperação pendente'},graphic:null,alerts:[],now:123,meters:{},type:'live',channelId:'ch'} as unknown as Live
    const snapshot=liveSnapshot(message)
    expect(snapshot.reconfiguration).toEqual({ready:false,reason:'Recuperação pendente'})
    expect(snapshot.transport).toBe(message.transport)
    expect(snapshot).not.toHaveProperty('type');expect(snapshot).not.toHaveProperty('channelId')
    expect(liveSnapshot({...message,reconfiguration:undefined}).reconfiguration).toBeUndefined()
  })
})
