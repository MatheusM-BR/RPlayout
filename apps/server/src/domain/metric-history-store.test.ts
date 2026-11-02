import {afterEach,expect,it} from 'vitest'
import {openDatabase} from '../db/client.js'
import {persistMetricHistory} from './metric-history-store.js'
const opened:ReturnType<typeof openDatabase>[]=[]
afterEach(()=>{for(const entry of opened.splice(0))entry.sqlite.close()})
function fixture(){const f=openDatabase(':memory:');opened.push(f);return f.sqlite}
const now=Date.parse('2026-10-09T12:00:00.000Z'),boundary='2026-09-25T12:00:00.000Z',expired='2026-09-25T11:59:59.999Z'
it('expira só registros anteriores a14dias e preserva payloads na fronteira',()=>{
  const sqlite=fixture(),insert=sqlite.prepare('INSERT INTO host_metric_samples VALUES(?,?)')
  for(const time of [expired,boundary,'2026-10-08T00:00:00.000Z'])insert.run(time,JSON.stringify({generatedAt:time,legacy:true}))
  const existing=sqlite.prepare('SELECT payload FROM host_metric_samples WHERE sampled_at=?').get(boundary)
  persistMetricHistory(sqlite,{generatedAt:new Date(now).toISOString()},now)
  expect(sqlite.prepare('SELECT COUNT(*) AS count FROM host_metric_samples').get()).toEqual({count:3})
  expect(sqlite.prepare('SELECT payload FROM host_metric_samples WHERE sampled_at=?').get(boundary)).toEqual(existing)
  expect(sqlite.prepare('SELECT payload FROM host_metric_samples WHERE sampled_at=?').get(expired)).toBeUndefined()
})
it('falha de expiração reverte a nova amostra e preserva registros antigos',()=>{
  const sqlite=fixture();sqlite.prepare('INSERT INTO host_metric_samples VALUES(?,?)').run(expired,'{}')
  sqlite.exec("CREATE TRIGGER qa_refuse_expiry BEFORE DELETE ON host_metric_samples BEGIN SELECT RAISE(ABORT,'fixture_expiry_failure'); END")
  expect(()=>persistMetricHistory(sqlite,{generatedAt:new Date(now).toISOString()},now)).toThrow('fixture_expiry_failure')
  expect(sqlite.prepare('SELECT sampled_at FROM host_metric_samples').all()).toEqual([{sampled_at:expired}])
})
it('falha de evento relacionado reverte expiração e inserção juntas',()=>{
  const sqlite=fixture();sqlite.prepare('INSERT INTO host_metric_samples VALUES(?,?)').run(expired,'{}')
  expect(()=>persistMetricHistory(sqlite,{generatedAt:new Date(now).toISOString()},now,()=>{throw new Error('fixture_event_failure')})).toThrow('fixture_event_failure')
  expect(sqlite.prepare('SELECT sampled_at FROM host_metric_samples').all()).toEqual([{sampled_at:expired}])
})
it('recusa datas inválidas sem alterar histórico',()=>{
  const sqlite=fixture()
  expect(()=>persistMetricHistory(sqlite,{generatedAt:'invalid'},now)).toThrow()
  expect(()=>persistMetricHistory(sqlite,{generatedAt:new Date(now).toISOString()},NaN)).toThrow()
  expect(sqlite.prepare('SELECT COUNT(*) AS count FROM host_metric_samples').get()).toEqual({count:0})
})
