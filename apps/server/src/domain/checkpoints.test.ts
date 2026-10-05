import { afterEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../db/client.js'
import { Checkpoints } from './checkpoints.js'
const databases: ReturnType<typeof openDatabase>[] = []
afterEach(() => { for (const value of databases.splice(0)) value.sqlite.close() })
describe('checkpoint durável e migração', () => {
  it('preserva cadência original do cursor e recusa denominador inválido', () => {
    const value = openDatabase(':memory:'); databases.push(value)
    value.sqlite.exec("INSERT INTO channels (id,name,rate_num,rate_den,width,height,target_lufs,ceiling_dbtp,limiter_lookahead_ms,created_at) VALUES ('ch','CH',25,1,320,180,-23,-1,5,'now')")
    const checkpoints = new Checkpoints(value.sqlite)
    const cursor = {version:1 as const,channelId:'ch',rundownId:'rd',revisionId:'rev',itemId:'vt',elapsed:1432,playing:true,realEngine:true,rate:{num:30000,den:1001}}
    checkpoints.write(cursor)
    expect(new Checkpoints(value.sqlite).read('ch')).toEqual(cursor)
    expect(() => checkpoints.write({...cursor,rate:{num:25,den:0}})).toThrow()
    expect(checkpoints.read('ch')).toEqual(cursor)
  })
  it('preserva a origem e o cursor de retorno de contingência através de nova instância', () => {
    const value = openDatabase(':memory:'); databases.push(value)
    value.sqlite.exec("INSERT INTO channels (id,name,rate_num,rate_den,width,height,target_lufs,ceiling_dbtp,limiter_lookahead_ms,created_at) VALUES ('ch','CH',25,1,320,180,-23,-1,5,'now')")
    const cursor = { version: 1 as const, channelId: 'ch', rundownId: 'reserve', revisionId: 'loop-rev', itemId: 'backup', elapsed: 25, playing: true, realEngine: true,
      contingency: { loopRevisionId: 'loop-rev', loopRundownId: 'reserve', rundownId: 'original', revisionId: 'original-rev', itemId: 'vt', elapsed: 1432, activatedAt: '2026-10-01T06:00:00Z' } }
    new Checkpoints(value.sqlite).write(cursor)
    expect(new Checkpoints(value.sqlite).read('ch')).toEqual(cursor)
    expect(() => new Checkpoints(value.sqlite).write({ ...cursor, contingency: { ...cursor.contingency, elapsed: -1 } })).toThrow()
  })
  it('persiste cursor, revisão e STOP explícito em um único registro', () => {
    const value = openDatabase(':memory:'); databases.push(value)
    value.sqlite.exec("INSERT INTO channels (id,name,rate_num,rate_den,width,height,target_lufs,ceiling_dbtp,limiter_lookahead_ms,created_at) VALUES ('ch','CH',25,1,320,180,-23,-1,5,'now')")
    const checkpoints = new Checkpoints(value.sqlite)
    const cursor = { version: 1 as const, channelId: 'ch', rundownId: 'rd', revisionId: 'rev1', itemId: 'vt', elapsed: 1432, playing: true, realEngine: true }
    checkpoints.write(cursor)
    expect(new Checkpoints(value.sqlite).read('ch')).toEqual(cursor)
    checkpoints.write({ ...cursor, playing: false, itemId: null, elapsed: 0 })
    expect(checkpoints.read('ch')).toMatchObject({ playing: false, itemId: null })
    expect(value.sqlite.prepare('SELECT count(*) n FROM channel_checkpoints').get()).toEqual({ n: 1 })
    expect(value.sqlite.prepare('SELECT version FROM schema_migrations ORDER BY version').all()).toEqual(Array.from({ length: 23 }, (_, i) => ({ version: i+1 })))
  })
  it('recusa cursor inválido e dados corrompidos', () => {
    const value = openDatabase(':memory:'); databases.push(value)
    const checkpoints = new Checkpoints(value.sqlite)
    expect(() => checkpoints.write({ version: 1, channelId: 'missing', rundownId: null, revisionId: null, itemId: null, elapsed: -1, playing: true, realEngine: true })).toThrow()
    expect(checkpoints.read('missing')).toBeNull()
  })
})
