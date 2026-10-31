import {afterEach,beforeEach,expect,it} from 'vitest'
import {randomUUID} from 'node:crypto'
import {openDatabase} from '../db/client.js'
import {healthEvents,integrations,integrationDeliveries} from '../db/schema.js'
import {ExecutionOwnership} from './execution-ownership.js'
import {persistRuntimeSignalIncidents,runtimeObservationSnapshot,RuntimeIncidentRecorder,type RuntimeObservationSnapshot} from './runtime-signal-incidents.js'
import {pruneHealthHistory} from './health-retention.js'
import type {MetricRuntime} from './operational-metrics.js'
import {readHealthIncidentPage} from './health-incidents.js'
let value:ReturnType<typeof openDatabase>
beforeEach(()=>{
  value=openDatabase(':memory:')
  for(const id of ['a','b'])value.sqlite.prepare('INSERT INTO channels(id,name,rate_num,rate_den,width,height,target_lufs,ceiling_dbtp,limiter_lookahead_ms,created_at) VALUES(?,?,25,1,320,180,-23,-1,5,?)').run(id,id,'now')
  value.db.insert(integrations).values({id:'gateway',channelId:'a',name:'Fixture',url:'http://127.0.0.1:1/fixture',events:['source.failed','source.recovered','source.unobserved','output.failed','output.recovered','output.unobserved'],enabled:true,createdAt:'now'}).run()
})
afterEach(()=>value.sqlite.close())
const claim=(channelId='a')=>new ExecutionOwnership(value.db,{host:'fixture',pid:100,boot:randomUUID()},()=>false).claim(channelId)
function snapshot(component:'LIVE_SOURCE'|'OUTPUT'='LIVE_SOURCE'):RuntimeObservationSnapshot{
  return {channelId:'a',context:{version:1,capturedAt:'2026-01-01T00:00:00.000Z',channelId:'a',rundownId:null,revisionId:null,executionId:null,itemId:'item',itemName:'Jornal São José',elapsedFrames:42,engine:{ready:true,processPresent:true},sources:[],outputs:[],sourcesTruncated:false,outputsTruncated:false,physicalSignalValidated:false},observations:[{identity:'hashed-entity',component,bus:component==='OUTPUT'?'output':'pgm',state:'FAILED',result:'FAILED',delivered:10,name:'Estúdio Óptico'}]}
}
it('falha persistida uma vez; UNKNOWN/READY não resolve; recuperação preserva contexto original',()=>{
  const lease=claim(),s=snapshot();expect(persistRuntimeSignalIncidents(value.db,lease,s)).toBe(1);expect(persistRuntimeSignalIncidents(value.db,lease,s)).toBe(0)
  const original=value.db.select().from(healthEvents).all()[0]!
  s.observations[0]!.result='UNKNOWN';s.observations[0]!.state='PVW_READY';expect(persistRuntimeSignalIncidents(value.db,lease,s)).toBe(0)
  s.context.itemId='next';s.observations[0]!.result='HEALTHY';s.observations[0]!.state='SIGNAL_OK'
  expect(persistRuntimeSignalIncidents(value.db,lease,s)).toBe(1);expect(persistRuntimeSignalIncidents(value.db,lease,s)).toBe(0)
  const rows=value.db.select().from(healthEvents).all();expect(rows.find(row=>row.id===original.id)).toMatchObject({context:original.context,acknowledgedAt:null});expect(rows.find(row=>row.id===original.id)!.resolvedAt).not.toBeNull()
  expect(rows.find(row=>row.id.endsWith(':recovered'))!.context!.itemId).toBe('next');expect(value.db.select().from(integrationDeliveries).all()).toHaveLength(2)
})
it('saída exige avanço real após baseline; onAir isolado não resolve',()=>{
  const lease=claim(),s=snapshot('OUTPUT');persistRuntimeSignalIncidents(value.db,lease,s)
  s.observations[0]!.result='HEALTHY';s.observations[0]!.state='onAir'
  expect(persistRuntimeSignalIncidents(value.db,lease,s)).toBe(0)
  s.observations[0]!.delivered=11;expect(persistRuntimeSignalIncidents(value.db,lease,s)).toBe(1)
})
it('trocar destino do mesmo perfil encerra observação antiga sem declarar recuperação',()=>{
  const lease=claim(),s=snapshot('OUTPUT');s.observations[0]!.endpointIdentity='old-destination';persistRuntimeSignalIncidents(value.db,lease,s)
  const original=value.db.select().from(healthEvents).all().find(row=>row.id.endsWith(':active'))!
  s.observations[0]!.endpointIdentity='new-destination';s.observations[0]!.result='HEALTHY';s.observations[0]!.delivered=100
  expect(persistRuntimeSignalIncidents(value.db,lease,s)).toBe(1)
  const old=value.db.select().from(healthEvents).all().find(row=>row.id===original.id)!
  expect(old.resolvedAt).toBeNull();expect(old.observationEndedAt).not.toBeNull()
  expect(value.db.select().from(integrationDeliveries).all().map(row=>row.event)).toEqual(['output.failed','output.unobserved'])
})
it('nova geração resolve somente após entrega positiva; geração antiga/ausente não prova recuperação',()=>{
  const lease=claim(),s=snapshot('OUTPUT');s.observations[0]!.generation=10;s.observations[0]!.delivered=100000;persistRuntimeSignalIncidents(value.db,lease,s)
  s.observations[0]!.result='HEALTHY';s.observations[0]!.generation=11;s.observations[0]!.delivered=0
  expect(persistRuntimeSignalIncidents(value.db,lease,s)).toBe(0)
  s.observations[0]!.generation=9;s.observations[0]!.delivered=100001;expect(persistRuntimeSignalIncidents(value.db,lease,s)).toBe(0)
  delete s.observations[0]!.generation;expect(persistRuntimeSignalIncidents(value.db,lease,s)).toBe(0)
  s.observations[0]!.generation=11;s.observations[0]!.delivered=1;expect(persistRuntimeSignalIncidents(value.db,lease,s)).toBe(1)
})
it('desaparecimento encerra observação sem resolver; ACK não permite retenção excluir',()=>{
  const lease=claim(),s=snapshot(),old='2026-01-01T00:00:00.000Z';persistRuntimeSignalIncidents(value.db,lease,s,old)
  value.sqlite.prepare('UPDATE health_events SET acknowledged_at=?').run(old)
  s.observations=[];expect(persistRuntimeSignalIncidents(value.db,lease,s,old)).toBe(1)
  expect(value.db.select().from(healthEvents).all()[0]).toMatchObject({resolvedAt:null,observationEndedAt:old})
  expect(readHealthIncidentPage(value.db,['a'],{channelId:'a'}).risk).toEqual({observedUnresolved:0,observationEndedUnresolved:1,withoutContext:0})
  expect(readHealthIncidentPage(value.db,['b'],{channelId:'b'}).risk).toEqual({observedUnresolved:0,observationEndedUnresolved:0,withoutContext:0})
  pruneHealthHistory(value.sqlite,30,Date.parse('2026-10-10T00:00:00.000Z'));expect(value.db.select().from(healthEvents).all().some(row=>row.id.endsWith(':active'))).toBe(true)
})
it('falha de outbox desfaz transição e retry não duplica',()=>{
  const lease=claim(),s=snapshot();value.sqlite.exec("CREATE TRIGGER fail_queue BEFORE INSERT ON integration_deliveries BEGIN SELECT RAISE(ABORT,'queue failed'); END")
  expect(()=>persistRuntimeSignalIncidents(value.db,lease,s)).toThrow('queue failed');expect(value.db.select().from(healthEvents).all()).toHaveLength(0)
  value.sqlite.exec('DROP TRIGGER fail_queue');expect(persistRuntimeSignalIncidents(value.db,lease,s)).toBe(1)
  value.sqlite.exec("CREATE TRIGGER fail_queue BEFORE INSERT ON integration_deliveries BEGIN SELECT RAISE(ABORT,'queue failed'); END")
  s.observations[0]!.result='HEALTHY';expect(()=>persistRuntimeSignalIncidents(value.db,lease,s)).toThrow('queue failed')
  expect(value.db.select().from(healthEvents).all()).toHaveLength(1);expect(value.db.select().from(healthEvents).all()[0]!.resolvedAt).toBeNull()
})
it('admissão de predecessor finalizado encerra antigo sem presumir recuperação nem iniciar nova falha',()=>{
  const lease=claim(),s=snapshot();persistRuntimeSignalIncidents(value.db,lease,s);lease.sealObservation();lease.finalRelease()
  const next=claim();expect(persistRuntimeSignalIncidents(value.db,next,s,undefined,true)).toBe(1)
  expect(value.db.select().from(healthEvents).all()[0]).toMatchObject({resolvedAt:null});expect(value.db.select().from(healthEvents).all()[0]!.observationEndedAt).not.toBeNull()
  expect(persistRuntimeSignalIncidents(value.db,next,s)).toBe(1)
})
it('outro canal, lease encerrado e quarentena não alteram incidentes',()=>{
  const s=snapshot(),other=claim('b');expect(()=>persistRuntimeSignalIncidents(value.db,other,s)).toThrow('não pertence')
  const lease=claim();lease.release();expect(()=>persistRuntimeSignalIncidents(value.db,lease,s)).toThrow('posse')
  value.sqlite.exec('CREATE TABLE ha_recovery_origin(id TEXT)');expect(persistRuntimeSignalIncidents(value.db,lease,s)).toBe(0);expect(value.db.select().from(healthEvents).all()).toHaveLength(0)
})
it('collector exige sinal medido; HMAC não expõe fonte/URL/segredo e engine ausente encerra observação',()=>{
  const source={source:'ndi://secret?token=private',itemId:'live',state:'ON_PGM',busStates:{pgm:'ON_PGM'},busSignals:{pgm:{status:'UNKNOWN',videoRecent:false,audioRecent:false,sampleAgeMs:null as number|null}}}
  const state={channelId:'a',mode:'NATIVE',rundownId:null,onAir:null,liveSources:[source]},health={ready:true},runtime={channel:{id:'a'},transport:{state:()=>state,health:()=>health,processId:()=>123,publishers:()=>[{url:'srt://private?passphrase=secret',health:'failed',delivered:0,error:'password=secret'}]},telemetryIdentity:()=>({revisionId:null,executionId:null})} as unknown as MetricRuntime
  const s=runtimeObservationSnapshot(runtime);expect(s.observations[0]!.result).toBe('UNKNOWN');expect(JSON.stringify(s)).not.toMatch(/ndi:|srt:|password=|passphrase=|token=/)
  const noLabels=runtimeObservationSnapshot(runtime,()=>{throw new Error('storage metadata unavailable')})
  expect(noLabels.observations.find(row=>row.component==='OUTPUT')).toMatchObject({result:'FAILED',name:null})
  expect(noLabels.context.outputs[0]!.name).toBeNull()
  source.busSignals.pgm={status:'SIGNAL_OK',videoRecent:true,audioRecent:true,sampleAgeMs:10000};expect(runtimeObservationSnapshot(runtime).observations[0]!.result).toBe('UNKNOWN')
  source.busSignals.pgm.sampleAgeMs=100;expect(runtimeObservationSnapshot(runtime).observations[0]!.result).toBe('HEALTHY')
  health.ready=false;expect(runtimeObservationSnapshot(runtime).observations).toEqual([])
})
it('mantém aliases de retry/perda/recuperação para assinaturas anteriores, sem endereço privado',()=>{
  value.db.update(integrations).set({events:['output.retrying','output.onAir','source.lost','source.on_pgm']}).run()
  const lease=claim(),s=snapshot('OUTPUT');s.observations[0]!.state='retrying';persistRuntimeSignalIncidents(value.db,lease,s)
  s.observations[0]!.result='HEALTHY';s.observations[0]!.state='onAir';s.observations[0]!.delivered=11;persistRuntimeSignalIncidents(value.db,lease,s)
  s.observations=snapshot().observations;s.observations[0]!.legacyState='LOST';persistRuntimeSignalIncidents(value.db,lease,s)
  s.observations[0]!.legacyState='ON_PGM';s.observations[0]!.result='HEALTHY';persistRuntimeSignalIncidents(value.db,lease,s)
  expect(value.db.select().from(integrationDeliveries).all().map(row=>row.event)).toEqual(['output.retrying','output.onAir','source.lost','source.on_pgm'])
  expect(value.db.select().from(healthEvents).all().filter(row=>row.severity==='CRITICAL')).toHaveLength(2)
})
it('retry conserva snapshot de detecção mesmo quando item, nome e estado já mudaram',()=>{
  const recorder=new RuntimeIncidentRecorder(value.db,claim()),s=snapshot();let captures=0
  const capture=()=>{captures++;return s}
  value.sqlite.exec("CREATE TRIGGER fail_queue BEFORE INSERT ON integration_deliveries BEGIN SELECT RAISE(ABORT,'queue failed'); END")
  expect(()=>recorder.persist(capture)).toThrow('queue failed');s.context.itemId='next-item';s.context.itemName='Item seguinte';s.observations[0]!.result='HEALTHY'
  value.sqlite.exec('DROP TRIGGER fail_queue');expect(recorder.persist(capture)).toBe(1);expect(captures).toBe(1)
  expect(value.db.select().from(healthEvents).all()[0]!.context).toMatchObject({itemId:'item',itemName:'Jornal São José'})
  expect(recorder.persist(capture)).toBe(1);expect(captures).toBe(2)
})
it('eventos rápidos de falha/retorno mantêm ordem e contexto mesmo durante erro de banco',()=>{
  const recorder=new RuntimeIncidentRecorder(value.db,claim()),s=snapshot()
  value.sqlite.exec("CREATE TRIGGER fail_queue BEFORE INSERT ON integration_deliveries BEGIN SELECT RAISE(ABORT,'queue failed'); END")
  expect(()=>recorder.record(()=>s)).toThrow('queue failed')
  s.context.capturedAt='2026-01-01T00:00:00.100Z';s.context.itemId='following';s.observations[0]!.result='HEALTHY'
  expect(()=>recorder.record(()=>s)).toThrow('queue failed')
  value.sqlite.exec('DROP TRIGGER fail_queue');expect(recorder.persist(()=>{throw new Error('Must drain queued snapshots first')})).toBe(2)
  const rows=value.db.select().from(healthEvents).all()
  expect(rows.find(row=>row.id.endsWith(':active'))).toMatchObject({occurredAt:'2026-01-01T00:00:00.000Z',resolvedAt:'2026-01-01T00:00:00.100Z'})
  expect(rows.find(row=>row.id.endsWith(':active'))!.context!.itemId).toBe('item')
  expect(rows.find(row=>row.id.endsWith(':recovered'))!.context!.itemId).toBe('following')
})
it('estados informativos sem falha são persistidos/entregues uma vez, sem resolver nada',()=>{
  value.db.update(integrations).set({events:['source.cueing','source.pvw_ready','source.on_pgm']}).run()
  const lease=claim(),s=snapshot();s.observations[0]!.result='UNKNOWN';s.observations[0]!.legacyState='CUEING'
  persistRuntimeSignalIncidents(value.db,lease,s);persistRuntimeSignalIncidents(value.db,lease,s)
  s.observations[0]!.legacyState='PVW_READY';persistRuntimeSignalIncidents(value.db,lease,s)
  s.observations[0]!.legacyState='ON_PGM';persistRuntimeSignalIncidents(value.db,lease,s)
  const rows=value.db.select().from(healthEvents).all();expect(rows).toHaveLength(3);expect(rows.every(row=>row.resolvedAt===null)).toBe(true)
  expect(value.db.select().from(integrationDeliveries).all().map(row=>row.event)).toEqual(['source.cueing','source.pvw_ready','source.on_pgm'])
  for(const row of value.db.select().from(integrationDeliveries).all())expect(row.payload.payload).toMatchObject({signalRecovered:false})
})
it('fila limitada relata lacuna após storage voltar, sem inventar sucesso nem crescer indefinidamente',()=>{
  const recorder=new RuntimeIncidentRecorder(value.db,claim()),s=snapshot()
  value.sqlite.exec("CREATE TRIGGER fail_queue BEFORE INSERT ON integration_deliveries BEGIN SELECT RAISE(ABORT,'queue failed'); END")
  for(let i=0;i<512;i++)expect(()=>recorder.record(()=>s)).toThrow('queue failed')
  expect(()=>recorder.record(()=>s)).toThrow('Fila de observação cheia')
  value.sqlite.exec('DROP TRIGGER fail_queue');recorder.persist(()=>s)
  const gap=value.db.select().from(healthEvents).all().find(row=>row.state==='observation_gap')
  expect(gap).toMatchObject({severity:'CRITICAL',resolvedAt:null});expect(gap!.message).toContain('1 observações')
  expect(value.db.select().from(healthEvents).all().filter(row=>row.id.endsWith(':active'))).toHaveLength(1)
})
it('liberação de processo não sela fila; admissão registra cobertura desconhecida uma vez',()=>{
  value.db.update(integrations).set({events:['engineering.observation_gap']}).run()
  const previous=claim();previous.finalRelease();const next=claim(),s=snapshot()
  expect(persistRuntimeSignalIncidents(value.db,next,s,undefined,true)).toBe(1)
  expect(persistRuntimeSignalIncidents(value.db,next,s,undefined,true)).toBe(0)
  const gap=value.db.select().from(healthEvents).all()[0]!
  expect(gap).toMatchObject({id:'observation-closure-gap:'+previous.identity.id,component:'ENGINE',state:'observation_gap',severity:'CRITICAL',context:null,resolvedAt:null,acknowledgedAt:null})
  expect(value.db.select().from(integrationDeliveries).all()[0]!.payload.payload).toMatchObject({historyCompleteness:'UNKNOWN',lostObservations:null,signalRecovered:false})
})
it('fila só sela após gravação completa; falha em storage conserva marca aberta',()=>{
  const lease=claim(),recorder=new RuntimeIncidentRecorder(value.db,lease),s=snapshot()
  value.sqlite.exec("CREATE TRIGGER fail_history BEFORE INSERT ON health_events BEGIN SELECT RAISE(ABORT,'storage unavailable'); END")
  expect(()=>recorder.record(()=>s)).toThrow('storage unavailable')
  expect(()=>recorder.drainAndSeal()).toThrow('storage unavailable')
  expect(lease.assertOwned().observationClosed).toBe(false)
  value.sqlite.exec('DROP TRIGGER fail_history');recorder.drainAndSeal()
  expect(lease.assertOwned().observationClosed).toBe(true)
  expect(value.db.select().from(healthEvents).all().find(row=>row.id.endsWith(':active'))!.context!.itemId).toBe('item')
  lease.finalRelease();expect(persistRuntimeSignalIncidents(value.db,claim(),s,undefined,true)).toBe(1) // Retire failure only, no gap.
  expect(value.db.select().from(healthEvents).all().some(row=>row.state==='observation_gap')).toBe(false)
})
it('gap e outbox são atômicos; retry não duplica e não sela outro dono',()=>{
  value.db.update(integrations).set({events:['engineering.observation_gap']}).run()
  const previous=claim();previous.finalRelease();const next=claim(),s=snapshot()
  value.sqlite.exec("CREATE TRIGGER fail_queue BEFORE INSERT ON integration_deliveries BEGIN SELECT RAISE(ABORT,'queue failed'); END")
  expect(()=>persistRuntimeSignalIncidents(value.db,next,s,undefined,true)).toThrow('queue failed')
  expect(value.db.select().from(healthEvents).all()).toEqual([])
  value.sqlite.exec('DROP TRIGGER fail_queue');expect(persistRuntimeSignalIncidents(value.db,next,s,undefined,true)).toBe(1)
  expect(()=>previous.sealObservation()).toThrow('posse')
  expect(next.assertOwned().observationClosed).toBe(false)
})
