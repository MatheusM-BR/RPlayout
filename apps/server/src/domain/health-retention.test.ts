import {afterEach,beforeEach,expect,it} from 'vitest'
import {openDatabase} from '../db/client.js'
import {healthEvents} from '../db/schema.js'
import {pruneHealthHistory,pruneHttpAudit} from './health-retention.js'
import {operatorDecisions} from '../db/schema.js'
import {randomUUID} from 'node:crypto'
import {mkdtemp} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import Database from 'better-sqlite3'
import {validateBackupRestore} from './backup.js'
let value:ReturnType<typeof openDatabase>
beforeEach(()=>{value=openDatabase(':memory:')})
afterEach(()=>value.sqlite.close())
it('mantém falha reconhecida não resolvida e observação encerrada, remove só resolvida/reconhecida antiga',()=>{
  const time='2026-01-01T00:00:00.000Z'
  for(const [id,extra]of [
    ['pgm-signal:active:active',{acknowledgedAt:time}],
    ['pgm-signal:ended:active',{acknowledgedAt:time,observationEndedAt:time}],
    ['pgm-signal:resolved:active',{acknowledgedAt:time,resolvedAt:time}],
    ['pgm-signal:unacked:active',{resolvedAt:time}],
    ['pgm-signal:recent-resolution:active',{acknowledgedAt:time,resolvedAt:'2026-10-09T00:00:00.000Z'}],
    ['pgm-signal:recent-ack:active',{acknowledgedAt:'2026-10-09T00:00:00.000Z',resolvedAt:time}],
    ['legacy',{acknowledgedAt:time}],
    ['legacy-unacked',{}]
  ] as const)value.db.insert(healthEvents).values({id,component:'SIGNAL',state:'black',occurredAt:time,...extra}).run()
  expect(pruneHealthHistory(value.sqlite,30,Date.parse('2026-10-10T00:00:00.000Z'))).toBe(2)
  expect(value.db.select().from(healthEvents).all().map(row=>row.id).sort()).toEqual(['legacy-unacked','pgm-signal:active:active','pgm-signal:ended:active','pgm-signal:recent-ack:active','pgm-signal:recent-resolution:active','pgm-signal:unacked:active'])
})
it('desativada/inválida ou em quarentena não exclui nada',()=>{
  for(const days of [0,-1,NaN,Infinity,1e300])expect(pruneHealthHistory(value.sqlite,days)).toBe(0)
  value.sqlite.exec('CREATE TABLE ha_recovery_origin(id TEXT)');expect(pruneHealthHistory(value.sqlite,30)).toBe(0)
})
it('backup/restauração mantém reconhecimento separado de recuperação e rejeita resolução corrompida',async()=>{
  const time='2026-10-10T00:00:00.000Z'
  value.db.insert(healthEvents).values({id:'pgm-signal:backup:active',component:'SIGNAL',state:'black',occurredAt:time,acknowledgedAt:null,resolvedAt:time}).run()
  const directory=await mkdtemp(join(tmpdir(),'RPlayout-health-backup-')),path=join(directory,'own-copy.db')
  await value.sqlite.backup(path)
  const restored=await validateBackupRestore(path);expect(restored.integrity).toBe('ok')
  const copy=new Database(path)
  try{
    expect(copy.prepare('SELECT acknowledged_at,resolved_at FROM health_events').get()).toEqual({acknowledged_at:null,resolved_at:time})
    copy.prepare('UPDATE health_events SET resolved_at=?').run('invalid-time')
  }finally{copy.close()}
  await expect(validateBackupRestore(path)).rejects.toThrow('Horário de resolução')
  expect(value.db.select().from(healthEvents).all()[0]!.resolvedAt).toBe(time)
})

it('auditoria HTTP antiga sai em lotes; registro operacional e auditoria recente ficam',()=>{
  const now=Date.parse('2026-10-26T12:00:00.000Z'),old='2026-07-01T00:00:00.000Z',recent='2026-10-20T00:00:00.000Z'
  const add=(rundownId:string,kind:string,createdAt:string)=>value.db.insert(operatorDecisions).values({id:randomUUID(),rundownId,itemId:null,kind,payload:{x:1},actorUsername:null,createdAt}).run()
  for(let i=0;i<7;i++)add('@http','API_MUTATION',old)
  add('@http','API_MUTATION',recent);add('rd','ITEM_ADDED',old);add('@execution','RUNTIME_INCIDENT_RECOVERED',old)
  expect(pruneHttpAudit(value.sqlite,90,now,5)).toBe(5)
  expect(pruneHttpAudit(value.sqlite,90,now,5)).toBe(2)
  expect(pruneHttpAudit(value.sqlite,90,now,5)).toBe(0)
  const kinds=value.db.select().from(operatorDecisions).all().map(row=>row.kind).sort()
  expect(kinds).toEqual(['API_MUTATION','ITEM_ADDED','RUNTIME_INCIDENT_RECOVERED'])
  expect(pruneHttpAudit(value.sqlite,0,now)).toBe(0)
})
