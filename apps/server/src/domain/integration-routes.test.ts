import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { createApp, type App } from '../app.js'
import { registerRoutes } from '../routes.js'
import { channels, integrationDeliveries, integrations } from '../db/schema.js'
import { emitIntegrationEvent } from './integrations.js'

vi.mock('../config.js', async original => ({ ...await original<Record<string,unknown>>(), ENGINE_BINARY: '', MEDIAMTX_BINARY: '', DEVICES_BINARY: '', DEFAULT_ROLE: 'ADMIN' }))
let app: App, server: FastifyInstance
beforeEach(async () => {
  app = await createApp(':memory:')
  await app.db.insert(channels).values({id:'ch',name:'Canal',rateNum:25,rateDen:1,width:320,height:180,targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,createdAt:'now'})
  server = Fastify(); registerRoutes(app,server,()=>{}); await server.ready()
})
afterEach(async () => {await server.close();app.close();vi.unstubAllGlobals()})

describe('fila externa na API sem vazamento de credenciais', () => {
  it('mascara caminho privado na criação/consulta e conserva destino real ao ativar', async () => {
    const catalog=await server.inject('/api/integrations/review?channelId=ch')
    const response = await server.inject({method:'POST',url:'/api/integrations',headers:{'if-match':catalog.headers.etag!},payload:{channelId:'ch',name:'QA',url:'https://example.test/webhook/SECRET?token=PRIVATE',events:['source.lost']}})
    expect(response.statusCode).toBe(200)
    const row = response.json().integration
    expect(row).toMatchObject({url:'https://example.test/REDACTED',enabled:false})
    expect((await server.inject({url:'/api/integrations?channelId=ch'})).body).not.toMatch(/SECRET|PRIVATE/)
    const review=await server.inject(`/api/integrations/${row.id}/review`)
    expect((await server.inject({method:'PATCH',url:`/api/integrations/${row.id}`,headers:{'if-match':review.headers.etag!},payload:{enabled:true}})).statusCode).toBe(200)
    expect((await app.db.select().from(integrations))[0]!.url).toContain('SECRET?token=PRIVATE')
    expect(JSON.stringify(app.sqlite.prepare('SELECT url FROM integrations').all())).not.toMatch(/SECRET|PRIVATE/)
    await emitIntegrationEvent(app.db,'source.lost',{private:'PAYLOADSECRET'},'ch')
    const listing = await server.inject({url:'/api/integration-deliveries?channelId=ch'})
    expect(listing.statusCode).toBe(200)
    expect(listing.body).not.toMatch(/PAYLOADSECRET|SECRET|PRIVATE|target|payload/)
    expect(listing.json().deliveries[0].state).toBe('QUEUED')
  })
  it('reenvio mantém ID e não duplica entregas confirmadas/em andamento', async () => {
    await app.db.insert(integrations).values({id:'gw',channelId:'ch',name:'QA',url:'https://example.test/',events:['source.lost'],enabled:true,createdAt:'now'})
    await emitIntegrationEvent(app.db,'source.lost',{},'ch')
    const row = (await app.db.select().from(integrationDeliveries))[0]!
    const request = {method:'POST' as const,url:`/api/integration-deliveries/${row.id}/retry`,payload:{}}
    for (const state of ['QUEUED','SENDING','DELIVERED'] as const) {
      await app.db.update(integrationDeliveries).set({state}).where(eq(integrationDeliveries.id,row.id))
      const review=await server.inject(`/api/integration-deliveries/${row.id}/review`)
      expect((await server.inject({...request,headers:{'if-match':review.headers.etag!}})).statusCode).toBe(409)
    }
    await app.db.update(integrationDeliveries).set({state:'FAILED',attempts:8,lastError:'Falhou'}).where(eq(integrationDeliveries.id,row.id))
    const review=await server.inject(`/api/integration-deliveries/${row.id}/review`)
    expect((await server.inject({...request,headers:{'if-match':review.headers.etag!}})).statusCode).toBe(200)
    expect(await app.db.select().from(integrationDeliveries)).toEqual([expect.objectContaining({id:row.id,state:'QUEUED',attempts:0,lastError:null})])
    expect(app.sqlite.prepare("SELECT kind FROM operator_decisions WHERE kind='INTEGRATION_RETRY'").get()).toBeTruthy()
  })
  it('recusa URL com credencial embutida ou protocolo inadequado', async () => {
    for (const url of ['https://user:password@example.test/','file:///C:/private']) {
      expect((await server.inject({method:'POST',url:'/api/integrations',payload:{name:'QA',url,events:['source.lost']}})).statusCode).toBe(400)
    }
  })
})
