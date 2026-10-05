import { afterEach,describe,expect,it,vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { openDatabase } from '../db/client.js'
import { integrations,integrationDeliveries } from '../db/schema.js'
import { emitIntegrationEvent } from './integrations.js'
import { IntegrationOutbox } from './integration-outbox.js'

const owned: Array<{database:ReturnType<typeof openDatabase>;outbox:IntegrationOutbox}> = []
afterEach(() => { for (const value of owned.splice(0)) {value.outbox.close();value.database.sqlite.close()} vi.unstubAllGlobals() })
async function setup() {
  const database = openDatabase(':memory:')
  await database.db.insert(integrations).values({id:'gateway',name:'Gateway',url:'https://example.test/hook/SEGREDO?token=SECRET',events:['source.lost'],enabled:true,createdAt:'now'})
  const outbox = new IntegrationOutbox(database.db);owned.push({database,outbox})
  return {database,outbox}
}
describe('entregas externas duráveis e isoladas do PGM',() => {
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
    await database.db.update(integrationDeliveries).set({state:'SENDING',nextAttemptAt:'2000-01-01'}).where(eq(integrationDeliveries.id,row!.id))
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
