import {afterEach,beforeEach,expect,it} from 'vitest'
import {randomUUID} from 'node:crypto'
import type {IncidentContext} from '@rplayout/protocol'
import {openDatabase} from '../db/client.js'
import {healthEvents,integrations,integrationDeliveries,operatorDecisions} from '../db/schema.js'
import {ExecutionOwnership} from './execution-ownership.js'
import {endPreviousPgmObservation,persistPgmSignalIncidents} from './pgm-signal-incidents.js'
import {PgmProbe} from './pgm-probe.js'
let value:ReturnType<typeof openDatabase>
beforeEach(()=>{
  value=openDatabase(':memory:')
  for(const id of ['a','b'])value.sqlite.prepare('INSERT INTO channels(id,name,rate_num,rate_den,width,height,target_lufs,ceiling_dbtp,limiter_lookahead_ms,created_at) VALUES(?,?,25,1,320,180,-23,-1,5,?)').run(id,id,'now')
  value.db.insert(integrations).values({id:'gateway',channelId:'a',name:'Fixture',url:'http://127.0.0.1:1/fixture',events:['signal.black_unobserved'],enabled:true,createdAt:'now'}).run()
})
afterEach(()=>value.sqlite.close())
function seed(channelId='a'){
  const context:IncidentContext={version:1,capturedAt:'2026-10-09T00:00:00.000Z',channelId,rundownId:null,revisionId:null,executionId:null,itemId:'previous-item',itemName:'Jornal São José',elapsedFrames:300,engine:{ready:true,processPresent:true},sources:[],outputs:[],sourcesTruncated:false,outputsTruncated:false,physicalSignalValidated:false}
  const probe=new PgmProbe();probe.onContext(()=>context);probe.feedMetrics({isBlack:true,deltaMs:2100});persistPgmSignalIncidents(value.db,channelId,probe)
  return value.db.select().from(healthEvents).all().find(row=>row.channelId===channelId)!
}
function claim(channelId='a'){return new ExecutionOwnership(value.db,{host:'fixture',pid:100,boot:randomUUID()},()=>false).claim(channelId)}
it('admissão após parada comprovada encerra somente observação, com fila/auditoria únicas',()=>{
  const old=new ExecutionOwnership(value.db,{host:'fixture',pid:99,boot:randomUUID()},()=>false).claim('a')
  const first=seed();seed('b')
  value.sqlite.prepare('UPDATE health_events SET acknowledged_at=? WHERE id=?').run('2026-10-09T01:00:00.000Z',first.id)
  const lease=new ExecutionOwnership(value.db,{host:'fixture',pid:100,boot:randomUUID()},pid=>pid===99).claim('a')
  expect(lease.identity.recoveredRunId).toBe(old.identity.id)
  const at='2026-10-10T01:00:00.000Z'
  expect(endPreviousPgmObservation(value.db,'a',lease,at)).toBe(1)
  expect(endPreviousPgmObservation(value.db,'a',lease,at)).toBe(0)
  const rows=value.db.select().from(healthEvents).all()
  expect(rows.find(row=>row.id===first.id)).toMatchObject({resolvedAt:null,observationEndedAt:at,acknowledgedAt:'2026-10-09T01:00:00.000Z',context:first.context})
  expect(rows.find(row=>row.channelId==='b')).toMatchObject({resolvedAt:null,observationEndedAt:null})
  expect(rows.find(row=>row.state==='black_unobserved')).toMatchObject({resolvedAt:null,acknowledgedAt:null,context:first.context})
  expect(first.context).toMatchObject({itemId:'previous-item',itemName:'Jornal São José'})
  expect(value.db.select().from(integrationDeliveries).all()).toHaveLength(1)
  expect(value.db.select().from(integrationDeliveries).all()[0]!.payload.payload).toMatchObject({signalRecovered:false,reason:'EXECUTION_ADMITTED',ownerRunId:lease.identity.id})
  expect(value.db.select().from(operatorDecisions).all().filter(row=>row.kind==='PGM_OBSERVATION_ENDED')).toHaveLength(1)
})
it('posse de outro canal ou encerrada não autoriza alterar observações',()=>{
  seed();const lease=claim('b')
  expect(()=>endPreviousPgmObservation(value.db,'a',lease)).toThrow('não pertence')
  lease.release();expect(()=>endPreviousPgmObservation(value.db,'b',lease)).toThrow('posse')
  expect(value.db.select().from(healthEvents).all()).toHaveLength(1)
  expect(value.db.select().from(healthEvents).all()[0]!.observationEndedAt).toBeNull()
})
it('quarentena preserva incidente e não enfileira alerta',()=>{
  seed();const lease=claim();value.sqlite.exec('CREATE TABLE ha_recovery_origin (id TEXT)')
  expect(endPreviousPgmObservation(value.db,'a',lease)).toBe(0)
  expect(value.db.select().from(healthEvents).all()[0]!.observationEndedAt).toBeNull()
  expect(value.db.select().from(integrationDeliveries).all()).toHaveLength(0)
})
it('falha de outbox desfaz fim, evento e auditoria; retry não duplica',()=>{
  seed();const lease=claim()
  value.sqlite.exec("CREATE TRIGGER fail_restart_queue BEFORE INSERT ON integration_deliveries BEGIN SELECT RAISE(ABORT,'restart queue failed'); END")
  expect(()=>endPreviousPgmObservation(value.db,'a',lease)).toThrow('restart queue failed')
  expect(value.db.select().from(healthEvents).all()).toHaveLength(1)
  expect(value.db.select().from(healthEvents).all()[0]!.observationEndedAt).toBeNull()
  expect(value.db.select().from(operatorDecisions).all().filter(row=>row.kind==='PGM_OBSERVATION_ENDED')).toHaveLength(0)
  value.sqlite.exec('DROP TRIGGER fail_restart_queue')
  expect(endPreviousPgmObservation(value.db,'a',lease)).toBe(1)
  expect(endPreviousPgmObservation(value.db,'a',lease)).toBe(0)
})
it('recuperações anteriores e alertas não nativos não são encerrados',()=>{
  const probe=new PgmProbe();probe.feedMetrics({isBlack:true,deltaMs:2100});probe.feedMetrics({isBlack:false,deltaMs:1});persistPgmSignalIncidents(value.db,'a',probe)
  value.db.insert(healthEvents).values({id:'legacy',channelId:'a',component:'SIGNAL',state:'black',severity:'CRITICAL',message:'legacy',occurredAt:new Date().toISOString()}).run()
  expect(endPreviousPgmObservation(value.db,'a',claim())).toBe(0)
  expect(value.db.select().from(healthEvents).all().find(row=>row.id==='legacy')!.observationEndedAt).toBeNull()
})
it('consulta antecipada com sonda vazia não impede fechamento; sonda ativa/pending é preservada',()=>{
  const previous=seed(),probe=new PgmProbe(),lease=claim()
  expect(endPreviousPgmObservation(value.db,'a',lease,undefined,probe)).toBe(1)
  expect(value.db.select().from(healthEvents).all().find(row=>row.id===previous.id)!.observationEndedAt).not.toBeNull()
  probe.feedMetrics({isBlack:true,deltaMs:2100});persistPgmSignalIncidents(value.db,'a',probe)
  expect(endPreviousPgmObservation(value.db,'a',lease,undefined,probe)).toBe(0)
  probe.feedMetrics({isBlack:false,deltaMs:1})
  expect(endPreviousPgmObservation(value.db,'a',lease,undefined,probe)).toBe(0)
  expect(persistPgmSignalIncidents(value.db,'a',probe)).toBe(1)
  expect(value.db.select().from(healthEvents).all().filter(row=>row.state==='black'&&row.resolvedAt!==null)).toHaveLength(1)
})
