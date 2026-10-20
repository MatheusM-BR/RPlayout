import { afterEach,describe,expect,it,vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { openDatabase } from '../db/client.js'
import { integrations,integrationDeliveries,operatorDecisions } from '../db/schema.js'
import { emitIntegrationEvent } from './integrations.js'
import { IntegrationOutbox } from './integration-outbox.js'
import {executionHostIdentity} from './execution-host.js'

const owned: Array<{database:ReturnType<typeof openDatabase>;outbox:IntegrationOutbox}> = []
afterEach(async() => { for (const value of owned.splice(0)) {value.outbox.close();await value.outbox.settled();value.database.sqlite.close()} vi.unstubAllGlobals();vi.restoreAllMocks() })
async function setup() {
  const database = openDatabase(':memory:')
  await database.db.insert(integrations).values({id:'gateway',name:'Gateway',url:'https://example.test/hook/SEGREDO?token=SECRET',events:['source.lost'],enabled:true,createdAt:'now'})
  const outbox = new IntegrationOutbox(database.db);owned.push({database,outbox})
  return {database,outbox}
}
describe('entregas externas duráveis e isoladas do PGM',() => {
  it('ensaio restaurado preserva fila, revisões e auditoria sem recuperação ou POST, inclusive no construtor',async()=>{
    const {database,outbox}=await setup(),send=vi.fn();vi.stubGlobal('fetch',send)
    await emitIntegrationEvent(database.db,'source.lost',{private:'SECRET'},'ch')
    await database.db.update(integrationDeliveries).set({state:'SENDING',attempts:1,ownerHost:executionHostIdentity(),ownerPid:2147483647,ownerBoot:'dead'})
    database.sqlite.exec('CREATE TABLE ha_recovery_origin(id INTEGER PRIMARY KEY,payload TEXT)')
    vi.spyOn(process,'kill').mockImplementation(()=>{throw Object.assign(new Error('dead'),{code:'ESRCH'})})
    const before=database.sqlite.prepare('SELECT * FROM integration_deliveries').all(),versions=database.sqlite.prepare('SELECT * FROM integration_delivery_versions').all()
    const restored=new IntegrationOutbox(database.db)
    try{restored.start();await restored.tick();await outbox.tick()}finally{restored.close();await restored.settled()}
    expect(database.sqlite.prepare('SELECT * FROM integration_deliveries').all()).toEqual(before)
    expect(database.sqlite.prepare('SELECT * FROM integration_delivery_versions').all()).toEqual(versions)
    expect(database.db.select().from(operatorDecisions).all()).toHaveLength(0);expect(send).not.toHaveBeenCalled()
  })
  it.each(['unknown','remote','uncertain'] as const)('envio %s mantém posse/estado/revisão e não emite POST',async mode=>{
    const {database,outbox}=await setup(),send=vi.fn();vi.stubGlobal('fetch',send)
    await emitIntegrationEvent(database.db,'source.lost',{},'ch')
    await database.db.update(integrationDeliveries).set({state:'SENDING',ownerHost:mode==='unknown'?null:mode==='remote'?'remote':executionHostIdentity(),ownerPid:mode==='unknown'?null:process.pid,ownerBoot:mode==='unknown'?null:'old'})
    if(mode==='uncertain')vi.spyOn(process,'kill').mockImplementation(()=>{throw Object.assign(new Error('denied'),{code:'EPERM'})})
    const before=database.sqlite.prepare('SELECT * FROM integration_deliveries').get(),version=database.sqlite.prepare('SELECT * FROM integration_delivery_versions').all()
    await outbox.tick();expect(database.sqlite.prepare('SELECT * FROM integration_deliveries').get()).toEqual(before);expect(database.sqlite.prepare('SELECT * FROM integration_delivery_versions').all()).toEqual(version)
    expect(send).not.toHaveBeenCalled();expect(database.db.select().from(operatorDecisions).all()).toHaveLength(0)
  })
  it('falha de audit reverte retomada e impede POST; recuperação válida mantém ID/destino/payload e audita uma vez',async()=>{
    const {database,outbox}=await setup(),send=vi.fn().mockResolvedValue(new Response(null,{status:204}));vi.stubGlobal('fetch',send)
    await emitIntegrationEvent(database.db,'source.lost',{private:'SECRET'},'ch')
    await database.db.update(integrationDeliveries).set({state:'SENDING',attempts:1,ownerHost:executionHostIdentity(),ownerPid:2147483647,ownerBoot:'dead',nextAttemptAt:'2000-01-01'})
    vi.spyOn(process,'kill').mockImplementation(()=>{throw Object.assign(new Error('dead'),{code:'ESRCH'})})
    const before=database.sqlite.prepare('SELECT * FROM integration_deliveries').get(),version=database.sqlite.prepare('SELECT * FROM integration_delivery_versions').all()
    database.sqlite.exec("CREATE TRIGGER recovery_audit_failure BEFORE INSERT ON operator_decisions WHEN NEW.kind='INTEGRATION_DELIVERY_AUTO_RECOVERED' BEGIN SELECT RAISE(ABORT,'AUDIT_FAILED'); END")
    await outbox.tick();expect(database.sqlite.prepare('SELECT * FROM integration_deliveries').get()).toEqual(before);expect(database.sqlite.prepare('SELECT * FROM integration_delivery_versions').all()).toEqual(version);expect(send).not.toHaveBeenCalled()
    database.sqlite.exec('DROP TRIGGER recovery_audit_failure');await outbox.tick();await outbox.tick()
    const audits=database.db.select().from(operatorDecisions).all();expect(audits).toHaveLength(1);expect(audits[0]!.kind).toBe('INTEGRATION_DELIVERY_AUTO_RECOVERED')
    const delivery=database.db.select().from(integrationDeliveries).get()!;expect(delivery.state).toBe('DELIVERED');expect(delivery.attempts).toBe(2)
    expect(audits[0]!.payload).toMatchObject({deliveryId:delivery.id,proof:'LOCAL_PROCESS_ABSENT',originalTargetAndPayloadPreserved:true,deliverySemantics:'at-least-once',processKilled:false,automaticTake:false})
    expect(JSON.stringify(audits[0]!.payload)).not.toMatch(/SEGREDO|SECRET|owner_pid|owner_host|owner_boot/)
    expect(database.sqlite.prepare('SELECT target,payload FROM integration_deliveries').get()).toEqual({target:(before as any).target,payload:(before as any).payload})
    expect(send).toHaveBeenCalledOnce();expect(send.mock.calls[0]![1].headers['idempotency-key']).toBe(delivery.id)
  })
  it('close aguarda HTTP abortado antes de permitir o fechamento de SQLite',async()=>{
    const {database,outbox}=await setup();let started=false
    vi.stubGlobal('fetch',vi.fn().mockImplementation((_url,options)=>new Promise<Response>((_resolve,reject)=>{started=true;options.signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true})})))
    await emitIntegrationEvent(database.db,'source.lost',{},'ch');const working=outbox.tick()
    while(!started)await new Promise(resolve=>setTimeout(resolve,5))
    outbox.close();await outbox.settled();await working
    expect(outbox.isDraining).toBe(false);expect((await database.db.select().from(integrationDeliveries))[0]?.state).toBe('QUEUED')
  })
  it('segunda instância não reabre envio vivo e não transmite o mesmo claim',async()=>{
    const {database,outbox}=await setup();let finish!:(response:Response)=>void
    const send=vi.fn().mockImplementation(()=>new Promise<Response>(resolve=>{finish=resolve}));vi.stubGlobal('fetch',send)
    await emitIntegrationEvent(database.db,'source.lost',{},'ch');const working=outbox.tick()
    while(!finish)await new Promise(resolve=>setTimeout(resolve,5))
    const other=new IntegrationOutbox(database.db);try{await other.tick();expect(send).toHaveBeenCalledOnce();expect((await database.db.select().from(integrationDeliveries))[0]?.state).toBe('SENDING')}finally{other.close();await other.settled()}
    finish(new Response(null,{status:204}));await working
    expect((await database.db.select().from(integrationDeliveries))[0]?.state).toBe('DELIVERED')
  })
  it('resposta tardia não publica confirmação de claim substituído',async()=>{
    const {database,outbox}=await setup();let finish!:(response:Response)=>void
    vi.stubGlobal('fetch',vi.fn().mockImplementation(()=>new Promise<Response>(resolve=>{finish=resolve})))
    await emitIntegrationEvent(database.db,'source.lost',{},'ch');const working=outbox.tick()
    while(!finish)await new Promise(resolve=>setTimeout(resolve,5))
    database.sqlite.exec("UPDATE integration_deliveries SET owner_boot='other'")
    finish(new Response(null,{status:204}));await working
    expect((await database.db.select().from(integrationDeliveries))[0]).toMatchObject({state:'SENDING',deliveredAt:null,ownerBoot:'other'})
  })
  it('destino alterado cancela evento pendente sem enviar URL antiga',async()=>{
    const {database,outbox}=await setup(),send=vi.fn();vi.stubGlobal('fetch',send)
    await emitIntegrationEvent(database.db,'source.lost',{},'ch');await database.db.update(integrations).set({url:'https://different.test/'})
    await outbox.tick();expect(send).not.toHaveBeenCalled();expect((await database.db.select().from(integrationDeliveries))[0]?.state).toBe('CANCELLED')
  })
  it('persiste antes de enviar, confirma HTTP e protege URL/payload em repouso',async () => {
    const {database,outbox}=await setup()
    const send=vi.fn().mockResolvedValue(new Response(null,{status:204}));vi.stubGlobal('fetch',send)
    await emitIntegrationEvent(database.db,'source.lost',{message:'PAYLOAD-SECRET'},'ch')
    expect(send).not.toHaveBeenCalled()
    expect(JSON.stringify(database.sqlite.prepare('SELECT target,payload FROM integration_deliveries').all())).not.toMatch(/SEGREDO|PAYLOAD-SECRET/)
    await outbox.tick()
    expect(send).toHaveBeenCalledTimes(1)
    const rows=await database.db.select().from(integrationDeliveries)
    expect(rows[0]).toMatchObject({state:'DELIVERED',attempts:1,lastError:null})
    expect(send.mock.calls[0]![1]).toMatchObject({redirect:'error',headers:{'idempotency-key':rows[0]!.id}})
  })
  it('reenvia após falha e reinício com o mesmo identificador, sem perder o evento',async () => {
    const {database,outbox}=await setup()
    const send=vi.fn().mockResolvedValueOnce(new Response('',{status:503})).mockResolvedValue(new Response('',{status:200}));vi.stubGlobal('fetch',send)
    await emitIntegrationEvent(database.db,'source.lost',{message:'sem sinal'},'ch')
    await outbox.tick()
    const [row]=await database.db.select().from(integrationDeliveries)
    expect(row).toMatchObject({state:'QUEUED',attempts:1,lastError:'Destino respondeu HTTP 503.'})
    expect(Date.parse(row!.nextAttemptAt)).toBeGreaterThan(Date.now())
    outbox.close()
    await database.db.update(integrationDeliveries).set({state:'SENDING',nextAttemptAt:'2000-01-01',ownerHost:executionHostIdentity(),ownerPid:2147483647,ownerBoot:'dead-process'}).where(eq(integrationDeliveries.id,row!.id))
    const restarted=new IntegrationOutbox(database.db);owned[owned.length-1]!.outbox=restarted
    await restarted.tick()
    expect((await database.db.select().from(integrationDeliveries))[0]).toMatchObject({id:row!.id,state:'DELIVERED',attempts:2})
    expect(send.mock.calls[1]![1].headers['idempotency-key']).toBe(row!.id)
    expect(database.sqlite.prepare("SELECT state FROM health_events WHERE component='INTEGRATION' ORDER BY rowid").all()).toEqual([{state:'retrying'},{state:'recovered'}])
  })
  it('para em oito falhas, e configuração desativada cancela sem fazer chamada externa',async () => {
    const {database,outbox}=await setup()
    const send=vi.fn().mockResolvedValue(new Response('',{status:500}));vi.stubGlobal('fetch',send)
    await emitIntegrationEvent(database.db,'source.lost',{},'ch')
    await database.db.update(integrationDeliveries).set({attempts:7})
    await outbox.tick()
    expect((await database.db.select().from(integrationDeliveries))[0]).toMatchObject({state:'FAILED',attempts:8})
    await emitIntegrationEvent(database.db,'source.lost',{},'ch')
    await database.db.update(integrations).set({enabled:false})
    await outbox.tick()
    expect(send).toHaveBeenCalledTimes(1)
    expect((await database.db.select().from(integrationDeliveries)).some(row=>row.state==='CANCELLED')).toBe(true)
  })
  it('limita histórico confirmado a 30 dias sem descartar alertas pendentes ou falhos', async () => {
    const {database,outbox} = await setup()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null,{status:204})))
    for (const state of ['DELIVERED','CANCELLED','FAILED','QUEUED'] as const) {
      await emitIntegrationEvent(database.db,'source.lost',{},'ch')
      const row = (await database.db.select().from(integrationDeliveries)).find(value => value.createdAt !== '2000-01-01')!
      await database.db.update(integrationDeliveries).set({state,createdAt:'2000-01-01',nextAttemptAt:'2099-01-01'}).where(eq(integrationDeliveries.id,row.id))
    }
    await outbox.tick()
    expect((await database.db.select().from(integrationDeliveries)).map(row=>row.state).sort()).toEqual(['FAILED','QUEUED'])
  })
  it('registra incidente local quando não consegue reter uma entrega', async () => {
    const {database} = await setup()
    database.sqlite.exec('DROP TABLE integration_deliveries')
    await emitIntegrationEvent(database.db,'source.lost',{},'ch')
    expect(database.sqlite.prepare("SELECT state,severity FROM health_events WHERE state='queue_failed'").get()).toEqual({state:'queue_failed',severity:'CRITICAL'})
  })
})
