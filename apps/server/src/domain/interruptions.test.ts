import { afterEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../db/client.js'
import { Interruptions } from './interruptions.js'
import { AsRun } from './asrun.js'
import type { ItemView, RundownView } from './plan.js'
import type { Channel } from '@rplayout/protocol'
const databases: ReturnType<typeof openDatabase>[] = []
afterEach(() => { for (const value of databases.splice(0)) value.sqlite.close() })
function fixture() {
  const db = openDatabase(':memory:'); databases.push(db)
  db.sqlite.exec("INSERT INTO channels (id,name,rate_num,rate_den,width,height,target_lufs,ceiling_dbtp,limiter_lookahead_ms,created_at) VALUES ('ch','CH',25,1,320,180,-23,-1,5,'now')")
  const entry = { item: { id: 'vt', mediaId: 'media', title: 'VT', type: 'VT' }, asset: { id: 'media', kind: 'VIDEO', contentHash: 'original' }, trim: { in: 50, out: 300 }, audio: { mode: 'OFF' }, gainDb: 0 } as ItemView
  return { ...db, entry, interruptions: new Interruptions(db.sqlite) }
}
describe('VT interrompido e evidência de execução', () => {
  it('retém cursor e verifica a especificação sem liberar TAKE inconclusivo', () => {
    const { interruptions, entry } = fixture()
    const id = interruptions.record('ch', 'grade', 'revision', entry, 143)!
    expect(new Interruptions(databases[0]!.sqlite).list('ch')[0]).toMatchObject({ frames: 143, revision_id: 'revision' })
    expect(() => interruptions.validateEntry('ch', id, 'grade', { ...entry, trim: { in: 0, out: 300 } })).toThrow('mudou')
    expect(() => interruptions.validateEntry('other', id, 'grade', entry)).toThrow()
    expect(interruptions.validateEntry('ch', id, 'grade', entry)).toMatchObject({state:'PENDING',frames:143})
  })
  it('não cria retorno para live, cursor zero ou VT já terminado', () => {
    const { interruptions, entry } = fixture()
    expect(interruptions.record('ch', 'grade', null, entry, 0)).toBeNull()
    expect(interruptions.record('ch', 'grade', null, entry, 250)).toBeNull()
    expect(interruptions.record('ch', 'grade', null, { ...entry, asset: null }, 143)).toBeNull()
  })
  it('serializa chamadas concorrentes de as-run e vincula revisão/hash/motivo de interrupção', async () => {
    const { db, sqlite, entry } = fixture()
    const channel = { id: 'ch', rate: { num: 25, den: 1 } } as Channel
    const view = { rundown: { id: 'grade' }, items: [entry], schedule: { items: [{ id: 'vt', start: 0, duration: 250 }] } } as unknown as RundownView
    const log = new AsRun(db, channel)
    await Promise.all(Array.from({ length: 30 }, () => log.follow('vt', view, 'rev', 143)))
    expect(sqlite.prepare('SELECT count(*) n FROM as_run').get()).toEqual({ n: 1 })
    log.noteExit('vt', 'LIVE_PRIORITY', 170)
    await log.follow(null, view)
    expect(sqlite.prepare('SELECT revision_id,media_hash,start_position_frames,end_position_frames,ended_by FROM as_run').get())
      .toEqual({ revision_id: 'rev', media_hash: 'original', start_position_frames: 143, end_position_frames: 170, ended_by: 'LIVE_PRIORITY' })
    await log.follow('vt', view, 'rev', 170, true)
    await log.follow('vt', view, 'rev', 200, true)
    expect(sqlite.prepare('SELECT count(*) n FROM as_run').get()).toEqual({ n: 3 })
  })
})
