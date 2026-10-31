import { describe, expect, it } from 'vitest'
import { ensureManagedOutputs,lowBandwidthMonitor, outputCapability, targetOf, toEngineProfile, type OutputProfileRow } from './outputs.js'
import {openDatabase} from '../db/client.js'
import {channels,outputProfiles} from '../db/schema.js'
import {configurationRevision} from '../db/channel-configuration.js'
import {getChannel} from '../db/repo.js'
import {eq} from 'drizzle-orm'

const paths = { channelId: 'agro', program: 'agro/pgm', clean: 'agro/clean', preview: 'agro/pvw', monitor: 'agro/mon' }

function output(role: OutputProfileRow['role']): OutputProfileRow {
  return {
    id: role, channelId: 'agro', name: role, kind: 'RTMP', target: '', role,
    width: null, height: null, rateNum: null, rateDen: null, scan: null,
    bitrateKbps: null, enabled: true, createdAt: '2026-01-01T00:00:00.000Z',
  }
}

describe('perfis de distribuição do programa', () => {
  it('sincronizar monitores leves sem mudança não invalida rascunho; upgrade real invalida uma vez',async()=>{
    const f=openDatabase(':memory:')
    try{
      f.db.insert(channels).values({id:'agro',name:'QA',width:1920,height:1080,rateNum:25,rateDen:1,targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,createdAt:'now'}).run()
      const channel=(await getChannel(f.db,'agro'))!
      await ensureManagedOutputs(f.db,channel,paths);const revision=configurationRevision(f.db,'agro')
      await ensureManagedOutputs(f.db,channel,paths);await ensureManagedOutputs(f.db,channel,paths)
      expect(configurationRevision(f.db,'agro')).toBe(revision)
      f.db.update(outputProfiles).set({width:1920,height:1080,rateNum:60,rateDen:1,bitrateKbps:6000}).where(eq(outputProfiles.role,'PREVIEW')).run()
      const upgraded=configurationRevision(f.db,'agro')
      await ensureManagedOutputs(f.db,channel,paths);expect(configurationRevision(f.db,'agro')).toBe(upgraded+1)
      await ensureManagedOutputs(f.db,channel,paths);expect(configurationRevision(f.db,'agro')).toBe(upgraded+1)
      expect(f.db.select().from(outputProfiles).where(eq(outputProfiles.role,'PROGRAM')).get()).toMatchObject({width:null,height:null,bitrateKbps:null})
    }finally{f.sqlite.close()}
  })
  it('publica PGM em RTMP/AAC para relays RTMP e SRT', () => {
    const program = output('PROGRAM')
    expect(targetOf(program, paths)).toBe('rtmp://127.0.0.1:1935/agro/pgm')
    expect(toEngineProfile(program, paths)).toMatchObject({ kind: 'rtmp' })
  })

  it('mantém os monitores em SRT/Opus, separados do master de distribuição', () => {
    const monitor = output('MONITOR')
    expect(targetOf(monitor, paths)).toContain('streamid=publish:agro/mon')
    expect(toEngineProfile(monitor, paths)).toMatchObject({ kind: 'srt', role: 'mon' })
  })

  it('mantém preview em 240p/15fps e baixa banda, sem alterar o master', () => {
    expect(lowBandwidthMonitor({ width: 1920, height: 1080 })).toMatchObject({ height: 240, rateNum: 15, rateDen: 1, bitrateKbps: 450, scan: 'PROGRESSIVE' })
  })

  it('permite publicar NDI e OMT através de seus transmissores nativos', () => {
    expect(outputCapability('NDI')).toEqual({ available: true })
    expect(outputCapability('OMT')).toEqual({ available: true })
    expect(toEngineProfile({ ...output('EXTRA'), kind: 'OMT', target: 'omt:RPLAYOUT PGM' }, paths)).toMatchObject({ kind: 'omt', target: 'omt:RPLAYOUT PGM' })
  })
})
