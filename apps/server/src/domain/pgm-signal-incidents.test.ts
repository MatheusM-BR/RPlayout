import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {openDatabase} from '../db/client.js'
import {healthEvents,integrations,integrationDeliveries} from '../db/schema.js'
import {PgmProbe} from './pgm-probe.js'
import {persistPgmSignalIncidents} from './pgm-signal-incidents.js'
import {IntegrationOutbox} from './integration-outbox.js'
let value:ReturnType<typeof openDatabase>
beforeEach(()=>{value=openDatabase(':memory:');value.db.insert(integrations).values({id:'gateway',channelId:'a',name:'Gateway próprio',url:'http://127.0.0.1:1/fixture',events:['signal.black','signal.black_recovered','signal.black_unobserved'],enabled:true,createdAt:'now'}).run()})
afterEach(()=>{value.sqlite.close();vi.restoreAllMocks()})
it('incidente e outbox têm identidade correlacionada, sem duplicar por nova amostra',()=>{
  const probe=new PgmProbe();probe.feedMetrics({isBlack:true,deltaMs:2100})
  expect(persistPgmSignalIncidents(value.db,'a',probe)).toBe(1)
  probe.feedMetrics({isBlack:true,deltaMs:100});expect(persistPgmSignalIncidents(value.db,'a',probe)).toBe(0)
  const health=value.db.select().from(healthEvents).all(),deliveries=value.db.select().from(integrationDeliveries).all()
  expect(health).toHaveLength(1);expect(deliveries).toHaveLength(1)
  expect(deliveries[0]!.payload.payload).toMatchObject({incidentId:health[0]!.id,kind:'black',thresholdMs:2000,signalRecovered:false})
  expect(deliveries[0]!.state).toBe('QUEUED')
})
it('erro de fila desfaz incidente e retém transição para retry, sem sucesso parcial',()=>{
  value.sqlite.exec("CREATE TRIGGER deny_queue BEFORE INSERT ON integration_deliveries BEGIN SELECT RAISE(ABORT,'queue fixture failure'); END")
  const probe=new PgmProbe();probe.feedMetrics({isBlack:true,deltaMs:2100})
  expect(()=>persistPgmSignalIncidents(value.db,'a',probe)).toThrow('queue fixture failure')
  expect(value.db.select().from(healthEvents).all()).toEqual([]);expect(probe.pendingTransitions()).toHaveLength(1)
  value.sqlite.exec('DROP TRIGGER deny_queue');expect(persistPgmSignalIncidents(value.db,'a',probe)).toBe(1)
  expect(probe.pendingTransitions()).toEqual([])
})
it('pausa e recuperação têm eventos distintos e mantêm incidente histórico reconhecível',()=>{
  const probe=new PgmProbe();probe.feedMetrics({isBlack:true,deltaMs:2100});probe.idle()
  expect(persistPgmSignalIncidents(value.db,'a',probe)).toBe(2)
  expect(value.db.select().from(healthEvents).all().map(row=>row.state)).toEqual(['black','black_unobserved'])
  const first=value.db.select().from(healthEvents).all()[0]!
  expect(first.resolvedAt).toBeNull();expect(first.observationEndedAt).not.toBeNull()
  probe.feedMetrics({isBlack:true,deltaMs:2100});probe.feedMetrics({isBlack:false,deltaMs:100})
  persistPgmSignalIncidents(value.db,'a',probe)
  expect(value.db.select().from(healthEvents).all().map(row=>row.state)).toEqual(['black','black_unobserved','black','black_recovered'])
  expect(value.db.select().from(healthEvents).all()[2]!.resolvedAt).not.toBeNull()
  expect(value.db.select().from(healthEvents).all().every(row=>row.acknowledgedAt===null)).toBe(true)
})
it('destino de outro canal não recebe incidente; sem destino mantém histórico local',()=>{
  const probe=new PgmProbe();probe.feedMetrics({isBlack:true,deltaMs:2100});persistPgmSignalIncidents(value.db,'b',probe)
  expect(value.db.select().from(healthEvents).all()).toHaveLength(1);expect(value.db.select().from(integrationDeliveries).all()).toHaveLength(0)
})
it('quarentena de restauração não grava nem entrega e conserva transição pendente',()=>{
  value.sqlite.exec('CREATE TABLE ha_recovery_origin (id TEXT)')
  const probe=new PgmProbe();probe.feedMetrics({isBlack:true,deltaMs:2100})
  expect(persistPgmSignalIncidents(value.db,'a',probe)).toBe(0)
  expect(probe.pendingTransitions()).toHaveLength(1);expect(value.db.select().from(healthEvents).all()).toHaveLength(0)
  expect(value.db.select().from(integrationDeliveries).all()).toHaveLength(0)
})
it('conserva assinatura signal.recovered existente para recuperação de silêncio',()=>{
  value.db.insert(integrations).values({id:'legacy',channelId:'a',name:'Assinatura anterior',url:'http://127.0.0.1:1/legacy',events:['signal.recovered'],enabled:true,createdAt:'now'}).run()
  const probe=new PgmProbe();probe.feedMetrics({audioDbfs:-70,deltaMs:3100});persistPgmSignalIncidents(value.db,'a',probe)
  probe.feedMetrics({audioDbfs:-20,deltaMs:100});persistPgmSignalIncidents(value.db,'a',probe)
  const rows=value.db.select().from(integrationDeliveries).all();expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({event:'signal.recovered',integrationId:'legacy',payload:{payload:{kind:'silence',state:'silence_recovered',signalRecovered:true}}})
})
it('outbox entrega payload persistido e chave estável, sem chamar automação de PGM',async()=>{
  const fetcher=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(null,{status:204}))
  const probe=new PgmProbe();probe.feedMetrics({isBlack:true,deltaMs:2100});persistPgmSignalIncidents(value.db,'a',probe)
  const delivery=value.db.select().from(integrationDeliveries).all()[0]!,outbox=new IntegrationOutbox(value.db)
  try{await outbox.tick();expect(fetcher).toHaveBeenCalledTimes(1);const options=fetcher.mock.calls[0]![1]!
    expect(options.headers).toMatchObject({'idempotency-key':delivery.id});expect(JSON.parse(options.body as string)).toEqual(delivery.payload)
    expect(value.db.select().from(integrationDeliveries).all()[0]!.state).toBe('DELIVERED');expect(probe.getStatus().automaticActionsEnabled).toBe(false)
  }finally{outbox.close()}
})
