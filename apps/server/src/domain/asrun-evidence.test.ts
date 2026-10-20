import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from '../db/client.js'
import { getChannel } from '../db/repo.js'
import { AsRun, listAsRun, toAsRunRecordExtended, exportAsRunCsv, exportAsRunBxf, calculateAncineCompliance } from './asrun.js'
import {ExecutionOwnership} from './execution-ownership.js'

const databases: ReturnType<typeof openDatabase>[] = []
afterEach(() => { for (const value of databases.splice(0)) value.sqlite.close() })
async function setup() {
  const value = openDatabase(':memory:'); databases.push(value)
  value.sqlite.exec("INSERT INTO channels (id,name,rate_num,rate_den,width,height,target_lufs,ceiling_dbtp,limiter_lookahead_ms,created_at) VALUES ('ch','CH',25,1,320,180,-23,-1,5,'now')")
  return { ...value, channel: (await getChannel(value.db, 'ch'))! }
}
describe('proveniência durável do as-run', () => {
  it('API e exportações não substituem cadência ausente nem inventam fim por percentual', async () => {
    const value = await setup(), recorder = new AsRun(value.db, value.channel, 'NATIVE',new ExecutionOwnership(value.db).claim(value.channel.id))
    await recorder.follow('item', null, 'rev', 0)
    const open = (await listAsRun(value.db, 'ch'))[0]!
    const legacy = { ...open, title: '=HYPERLINK("invalid")', airedFrames: 750, plannedFrames: 750, endedAt: '2026-10-01T12:00:30Z', startedAt: '2026-10-01T12:00:00Z', endedBy: 'TAKE', rateNum: null, rateDen: null }
    expect(toAsRunRecordExtended(legacy, { num: 50, den: 1 })).toMatchObject({ status: 'INTERRUPTED', rate: null, durationSeconds: 30, durationEvidence: 'CLOCK_ESTIMATE', scheduledStart: legacy.startedAt, actualStart: legacy.startedAt })
    expect(exportAsRunCsv([legacy])).toContain("'=HYPERLINK")
    expect(exportAsRunBxf([legacy])).toContain('<Rate num="" den="" />')
    expect(toAsRunRecordExtended({ ...legacy, endedAt: null })).toMatchObject({ status: 'RUNNING', durationFrames: null, durationSeconds: null, durationEvidence: 'UNKNOWN' })
    expect(toAsRunRecordExtended({ ...legacy, endedAt: 'invalid', endedBy: 'RESTART' }).durationSeconds).toBeNull()
    expect(calculateAncineCompliance([{ ...legacy, type: 'COMMERCIAL', endedAt: null }])).toMatchObject({ durationMetadataComplete: false, missingDurationCount: 1 })
    expect(toAsRunRecordExtended({ ...legacy, endedBy: 'EOF' }).status).toBe('PLAYED_FULL')
    expect(toAsRunRecordExtended({ ...legacy, endedBy: 'FAILED_MEDIA_ERROR', airedFrames: null }).status).toBe('FAILED')
  })
  it('migra histórico anterior sem inventar cadência, duração ou transporte', () => {
    const directory = mkdtempSync(join(tmpdir(), 'RPlayout-asrun-migration-'))
    let handle: ReturnType<typeof openDatabase> | undefined
    try {
      const path = join(directory, 'legacy.db')
      handle = openDatabase(path)
      handle.sqlite.exec("INSERT INTO channels (id,name,rate_num,rate_den,width,height,target_lufs,ceiling_dbtp,limiter_lookahead_ms,created_at) VALUES ('ch','CH',25,1,320,180,-23,-1,5,'now')")
      handle.sqlite.exec("INSERT INTO as_run (id,channel_id,title,type,started_at,actual_start,planned_frames,created_at) VALUES ('old','ch','VT anterior','VT','2026-09-30T12:00:00Z',0,9999,'now')")
      for (const column of ['rate_num','rate_den','execution_kind','duration_evidence']) handle.sqlite.exec(`ALTER TABLE as_run DROP COLUMN ${column}`)
      handle.sqlite.exec('DELETE FROM schema_migrations WHERE version = 14')
      handle.sqlite.close(); handle = undefined
      handle = openDatabase(path)
      const row = handle.sqlite.prepare('SELECT * FROM as_run WHERE id = ?').get('old')
      expect(row).toMatchObject({ planned_frames: 9999, aired_frames: null, rate_num: null, rate_den: null, execution_kind: 'UNKNOWN', duration_evidence: 'UNKNOWN' })
      expect(handle.sqlite.prepare('SELECT count(*) AS count FROM schema_migrations WHERE version = 14').get()).toEqual({ count: 1 })
    } finally {
      handle?.sqlite.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })
  it('cursor nativo registra diferença, cadência e não usa tempo de espera do servidor', async () => {
    const value = await setup(), channel = { ...value.channel, rate: { ...value.channel.rate } }, recorder = new AsRun(value.db, channel, 'NATIVE',new ExecutionOwnership(value.db).claim(channel.id))
    await recorder.follow('item', null, 'rev', 500)
    channel.rate = { num: 50, den: 1 }
    await recorder.finish('LIVE_PRIORITY', 750)
    const [row] = await listAsRun(value.db, 'ch')
    expect(row).toMatchObject({ airedFrames: 250, rateNum: 25, rateDen: 1, executionKind: 'NATIVE', durationEvidence: 'ENGINE_POSITION', startPositionFrames: 500, endPositionFrames: 750 })
    expect(exportAsRunCsv([row!], channel.rate)).toContain('NATIVE,ENGINE_POSITION,25,1,NOT_HOMOLOGATED')
  })
  it('simulação e cursor inválido permanecem estimados; aberto não ganha duração planejada', async () => {
    for (const kind of ['NATIVE', 'SIMULATED'] as const) {
      const value = await setup(), recorder = new AsRun(value.db, value.channel, kind,kind==='NATIVE'?new ExecutionOwnership(value.db).claim(value.channel.id):null)
      await recorder.follow('item', null, 'rev', 500)
      const open = (await listAsRun(value.db, 'ch'))[0]!
      const extended = toAsRunRecordExtended({ ...open, plannedFrames: 9999 })
      expect(extended).toMatchObject({ status: 'RUNNING', durationFrames: null })
      expect(exportAsRunBxf([open])).not.toContain('<DurationFrames>9999')
      await recorder.finish('STOP', kind === 'NATIVE' ? 100 : 750)
      expect((await listAsRun(value.db, 'ch'))[0]).toMatchObject({ durationEvidence: 'CLOCK_ESTIMATE', executionKind: kind })
    }
  })
})
