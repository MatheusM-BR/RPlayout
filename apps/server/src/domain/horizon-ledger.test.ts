import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../db/client.js'
import { healthEvents, operatorDecisions } from '../db/schema.js'
import { recordHorizonWarning } from './horizon-ledger.js'

const warning={rundownId:'grade',channelRevision:'published-1',date:'2026-09-30',endBucket:288,message:'Confira a próxima faixa.'}
let connection:ReturnType<typeof openDatabase>
beforeEach(()=>{connection=openDatabase(':memory:')})
afterEach(()=>connection.sqlite.close())
describe('aviso durável de horizonte sem montar/publicar/TAKE',()=>{
  it('uma revisão/data/janela gera somente um aviso e outra revisão pode avisar',()=>{
    expect(recordHorizonWarning(connection.db,'channel',warning)).toBe(true)
    expect(recordHorizonWarning(connection.db,'channel',warning)).toBe(false)
    expect(recordHorizonWarning(connection.db,'channel',{...warning,channelRevision:'published-2'})).toBe(true)
    expect(connection.db.select().from(healthEvents).all()).toHaveLength(2)
    expect(connection.db.select().from(operatorDecisions).all()).toHaveLength(2)
    for(const table of ['rundowns','rundown_items','operational_playlist_revisions','as_run'])expect(connection.sqlite.prepare(`SELECT count(*) n FROM ${table}`).get()).toEqual({n:0})
  })
  it('persiste entre reinício e duas conexões, sem apagar evidência ao reconhecer health',()=>{
    const path=join(mkdtempSync(join(tmpdir(),'RPlayout-horizon-ledger-')),'test.db')
    connection.sqlite.close();connection=openDatabase(path)
    expect(recordHorizonWarning(connection.db,'channel',warning)).toBe(true)
    connection.sqlite.close();connection=openDatabase(path)
    const other=openDatabase(path)
    try {
      connection.sqlite.prepare("UPDATE health_events SET acknowledged_at=?").run(new Date().toISOString())
      expect(recordHorizonWarning(other.db,'channel',warning)).toBe(false)
      expect(recordHorizonWarning(connection.db,'channel',warning)).toBe(false)
      expect(other.db.select().from(healthEvents).all()).toHaveLength(1)
    } finally {other.sqlite.close()}
  })
  it('falha de gravação health desfaz a trava e permite repetir aviso com sucesso',()=>{
    connection.sqlite.exec("CREATE TRIGGER fail_warning BEFORE INSERT ON health_events BEGIN SELECT RAISE(ABORT,'health falhou'); END")
    expect(()=>recordHorizonWarning(connection.db,'channel',warning)).toThrow('health falhou')
    expect(connection.db.select().from(operatorDecisions).all()).toHaveLength(0)
    connection.sqlite.exec('DROP TRIGGER fail_warning')
    expect(recordHorizonWarning(connection.db,'channel',warning)).toBe(true)
  })
})
