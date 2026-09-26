import { describe, expect, it } from 'vitest'
import { outputCapability, targetOf, toEngineProfile, type OutputProfileRow } from './outputs.js'

const paths = { channelId: 'agro', program: 'agro/pgm', clean: 'agro/clean', preview: 'agro/pvw', monitor: 'agro/mon' }

function output(role: OutputProfileRow['role']): OutputProfileRow {
  return {
    id: role, channelId: 'agro', name: role, kind: 'RTMP', target: '', role,
    width: null, height: null, rateNum: null, rateDen: null, scan: null,
    bitrateKbps: null, enabled: true, createdAt: '2026-01-01T00:00:00.000Z',
  }
}

describe('perfis de distribuição do programa', () => {
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

  it('permite publicar NDI e bloqueia OMT enquanto não existe transmissor NMOS/RTP', () => {
    expect(outputCapability('NDI')).toEqual({ available: true })
    expect(outputCapability('OMT')).toMatchObject({ available: false })
  })
})
