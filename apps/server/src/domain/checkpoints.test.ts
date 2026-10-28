import { afterEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../db/client.js'
import { Checkpoints } from './checkpoints.js'
const databases: ReturnType<typeof openDatabase>[] = []
afterEach(() => { for (const value of databases.splice(0)) value.sqlite.close() })
describe('checkpoint durável e migração', () => {
  it('persiste quadro mantido explícito sem aceitar pausa reclassificada ou inconclusiva',()=>{
    const value=openDatabase(':memory:');databases.push(value)
    value.sqlite.exec("INSERT INTO channels (id,name,rate_num,rate_den,width,height,target_lufs,ceiling_dbtp,limiter_lookahead_ms,created_at) VALUES ('ch','CH',25,1,320,180,-23,-1,5,'now')")
    const checkpoints=new Checkpoints(value.sqlite)
    const cursor={version:1 as const,channelId:'ch',rundownId:'rd',revisionId:'rev',itemId:'vt',elapsed:36,playing:false,realEngine:true,programTrim:{in:25,out:100,contentHash:'a'.repeat(64)},programHold:{status:'HELD' as const,decoderId:7,frames:36}}
    checkpoints.write(cursor);expect(new Checkpoints(value.sqlite).read('ch')).toEqual(cursor)
    for(const invalid of [{...cursor,programHold:undefined},{...cursor,playing:true},{...cursor,realEngine:false},{...cursor,programTrim:undefined},{...cursor,revisionId:null},{...cursor,elapsed:37},{...cursor,programHold:{...cursor.programHold,decoderId:0}}])expect(()=>checkpoints.write(invalid)).toThrow()
    expect(checkpoints.read('ch')).toEqual(cursor)
  })
  it('persiste corte montado e SHA, recusa corrupção sem sobrescrever o cursor anterior',()=>{
    const value=openDatabase(':memory:');databases.push(value)
    value.sqlite.exec("INSERT INTO channels (id,name,rate_num,rate_den,width,height,target_lufs,ceiling_dbtp,limiter_lookahead_ms,created_at) VALUES ('ch','CH',25,1,320,180,-23,-1,5,'now')")
    const checkpoints=new Checkpoints(value.sqlite),cursor={version:1 as const,channelId:'ch',rundownId:'rd',revisionId:'rev',itemId:'vt',elapsed:50,playing:true,realEngine:true,programTrim:{in:25,out:100,contentHash:'a'.repeat(64)}}
    checkpoints.write(cursor);expect(new Checkpoints(value.sqlite).read('ch')).toEqual(cursor)
    for(const programTrim of [{...cursor.programTrim,out:25},{...cursor.programTrim,contentHash:'invalid'}])expect(()=>checkpoints.write({...cursor,programTrim})).toThrow()
    expect(()=>checkpoints.write({...cursor,elapsed:75})).toThrow()
    expect(()=>checkpoints.write({...cursor,realEngine:false})).toThrow()
    expect(checkpoints.read('ch')).toEqual(cursor)
  })
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
    expect(value.sqlite.prepare('SELECT version FROM schema_migrations ORDER BY version').all()).toEqual(Array.from({ length: 51 }, (_, i) => ({ version: i+1 })))
    expect(value.sqlite.prepare('SELECT name FROM schema_migrations WHERE version=50').get()).toEqual({name:'durable-upgrade-backup-requests'})
    expect(value.sqlite.prepare('SELECT name FROM schema_migrations WHERE version=51').get()).toEqual({name:'multichannel-programming-mirrors'})
    expect(value.sqlite.prepare('SELECT name FROM schema_migrations WHERE version=33').get()).toEqual({name:'durable-distribution-process-ownership'})
    expect(value.sqlite.prepare('SELECT name FROM schema_migrations WHERE version=32').get()).toEqual({name:'durable-native-execution-ownership'})
    expect(value.sqlite.prepare('SELECT name FROM schema_migrations WHERE version=31').get()).toEqual({name:'durable-asset-removal-impact'})
  })
  it('recusa cursor inválido e dados corrompidos', () => {
    const value = openDatabase(':memory:'); databases.push(value)
    const checkpoints = new Checkpoints(value.sqlite)
    expect(() => checkpoints.write({ version: 1, channelId: 'missing', rundownId: null, revisionId: null, itemId: null, elapsed: -1, playing: true, realEngine: true })).toThrow()
    expect(checkpoints.read('missing')).toBeNull()
  })
})
