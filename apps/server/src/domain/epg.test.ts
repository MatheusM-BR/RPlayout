import { describe, expect, it } from 'vitest'
import { exportXmltv } from './epg.js'

describe('XMLTV EPG', () => {
  it('exporta a grade resolvida com tempos XMLTV e conteúdo escapado', () => {
    const xml = exportXmltv({
      channel: { id: 'ch&1', name: 'TV <Matriz>', rate: { num: 25, den: 1 }, width: 1920, height: 1080, scan: 'PROGRESSIVE', fieldOrder: 'TFF', targetLufs: -23, ceilingDbtp: -1, limiterLookaheadMs: 5, programSdiDeviceId: null, slateTemplateId: null, createdAt: '2026-01-01T00:00:00Z' },
      rundowns: [{ rundown: { id: 'r1', channelId: 'ch&1', name: 'Grade', plannedStart: 0, loop: false, date: '2026-09-24', createdAt: '', updatedAt: '' }, items: [{ id: 'i1', rundownId: 'r1', order: 1, type: 'VT', title: 'Jornal & Noticias', mediaId: null, sourceRef: null, trim: null, audio: null, durationOverride: 1500, minDuration: 1, anchor: { kind: 'FLOW' }, onOverrun: 'PUSH', elastic: null, blockId: null, fit: 'PILLARBOX', audioTrack: null, locked: false, autoNext: true, loop: false, notes: null }] }],
      assets: new Map(),
    })
    expect(xml).toContain('<channel id="ch&amp;1">')
    expect(xml).toContain('TV &lt;Matriz&gt;')
    expect(xml).toContain('start="20260924000000 +0000"')
    expect(xml).toContain('stop="20260924000100 +0000"')
    expect(xml).toContain('Jornal &amp; Noticias')
  })
})
