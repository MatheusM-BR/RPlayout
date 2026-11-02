import { randomUUID } from 'node:crypto'
import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, runtimeFor, type App } from '../app.js'
import { registerRoutes } from '../routes.js'
import { globalStudioAutomationGateway } from './external-control.js'
import { sessionDigest } from './access.js'
import { rundownItems } from '../db/schema.js'

vi.mock('../config.js', async original => ({ ...await original<Record<string, unknown>>(), ENGINE_BINARY: '', MEDIAMTX_BINARY: '', DEVICES_BINARY: '', AUTH_USER: '', AUTH_PASSWORD: '', DEFAULT_ROLE: 'ADMIN', EXTERNAL_CONTROL_TOKEN: 'PRIVATE_INTERNAL_SERVICE_TOKEN' }))
let app: App, server: FastifyInstance
beforeEach(async () => {
  app = await createApp(':memory:'); server = Fastify(); registerRoutes(app, server, () => {}); await server.ready()
  for (const [id, kind] of [['a', 'VIDEOHUB_ROUTER'], ['b', 'VIDEOHUB_ROUTER'], ['atem', 'ATEM_SWITCHER'], ['gpio', 'GPIO_RELAY']] as const) app.sqlite.prepare('INSERT INTO external_devices VALUES (?,?,?,?,?,?,?)').run(id, id, kind, '127.0.0.1', 9990, 1, new Date().toISOString())
})
afterEach(async () => { vi.restoreAllMocks(); await server.close(); app.close() })
describe('controle manual autenticado pela página, separado do token de serviço', () => {
  it('TAKE de serviço sem item segue CUE, nunca Próximo; simulação não confirma programa nativo', async () => {
    const now = new Date().toISOString()
    app.sqlite.prepare('INSERT INTO channels (id,name,rate_num,rate_den,width,height,target_lufs,ceiling_dbtp,limiter_lookahead_ms,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run('take-ch','QA',25,1,320,180,-23,-1,5,now)
    app.sqlite.prepare('INSERT INTO rundowns (id,channel_id,name,planned_start,date,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run('take-rd','take-ch','QA',0,'2026-10-01',now,now)
    for (const [index,id] of ['first','next','cued'].entries()) await app.db.insert(rundownItems).values({id,rundownId:'take-rd',sortOrder:index,title:id,type:'LIVE',sourceRef:'ndi:'+id,durationOverride:2500,anchor:{kind:'FLOW'},onOverrun:'PUSH',minDuration:0,autoNext:false,loop:false,locked:false})
    const runtime = (await runtimeFor(app,'take-ch'))!; await runtime.load('take-rd'); await runtime.transport.take('take-rd','first')
    const headers = { 'x-rplayout-control-token': 'PRIVATE_INTERNAL_SERVICE_TOKEN' }
    const service = (payload: object) => server.inject({method:'POST',url:'/api/external/control',headers,payload:{channelId:'take-ch',...payload}})
    expect((await service({action:'take'})).statusCode).toBe(409)
    expect(runtime.transport.state().onAir?.itemId).toBe('first')
    await runtime.transport.cue({kind:'ITEM',id:'cued'})
    const accepted = await service({action:'take'})
    expect(accepted.statusCode).toBe(200)
    expect(accepted.json()).toMatchObject({accepted:true,itemId:'cued',transport:'SIMULATED',nativeProgramConfirmed:false,physicalOutputValidated:false})
    expect(accepted.body).not.toContain('PRIVATE_INTERNAL_SERVICE_TOKEN')
    expect(runtime.transport.state().onAir?.itemId).toBe('cued')
    const park = await service({action:'park'})
    expect(park.statusCode).toBe(409)
    expect(runtime.transport.state().onAir?.itemId).toBe('cued')
    expect((await service({action:'take',itemId:'editorial-only'})).statusCode).toBe(409)
  })
  it('rota de serviço usa o mesmo ledger e não contorna incerteza manual/programada', async () => {
    const execute = vi.spyOn(globalStudioAutomationGateway, 'execute').mockResolvedValue({ success: true, targetDevice: 'VIDEOHUB_ROUTER', action: 'ROUTE_CROSSPOINT', latencyMs: 3, status: 'SUCCESS', details: { routeStatusConfirmed: true, physicalExecutionConfirmed: false } })
    const payload = { requestId: randomUUID(), deviceId: 'b', targetDevice: 'VIDEOHUB_ROUTER', action: 'ROUTE_CROSSPOINT', params: { source: 2, destination: 4 } }
    const headers = { 'x-rplayout-control-token': 'PRIVATE_INTERNAL_SERVICE_TOKEN' }
    const service = (body: object) => server.inject({ method: 'POST', url: '/api/v1/external/control', headers, payload: body })
    expect((await service({ ...payload, requestId: undefined })).statusCode).toBe(400)
    const first = await service(payload)
    expect(first.statusCode).toBe(200); expect(first.body).not.toContain('PRIVATE_INTERNAL_SERVICE_TOKEN')
    expect((await service(payload)).json().deduplicated).toBe(true)
    expect(execute).toHaveBeenCalledTimes(1)
    const manual = { requestId: randomUUID(), action: 'ROUTE_CROSSPOINT', source: 3, destination: 4 }
    execute.mockRejectedValueOnce(new Error('queda depois do envio'))
    expect((await server.inject({ method: 'POST', url: '/api/external/devices/b/control', payload: manual })).statusCode).toBe(409)
    expect((await service({ ...payload, requestId: randomUUID() })).statusCode).toBe(409)
    expect(execute).toHaveBeenCalledTimes(2)
    const runs = (await server.inject('/api/external/commands')).json().runs
    expect(runs).toHaveLength(2)
    expect(runs.find((run: any) => run.requestId === payload.requestId).actor).toBe('service:external-control')
  })
  it('opera ID explícito e repetição após reconstruir rotas não envia novo comando', async () => {
    const execute = vi.spyOn(globalStudioAutomationGateway, 'execute').mockResolvedValue({ success: true, targetDevice: 'VIDEOHUB_ROUTER', action: 'ROUTE_CROSSPOINT', latencyMs: 3, status: 'SUCCESS', details: { routeStatusConfirmed: true, physicalExecutionConfirmed: false } })
    const payload = { requestId: randomUUID(), action: 'ROUTE_CROSSPOINT', source: 2, destination: 4 }
    const first = await server.inject({ method: 'POST', url: '/api/external/devices/b/control', payload })
    expect(first.statusCode).toBe(200); expect(first.json().run.command.deviceId).toBe('b')
    expect(first.body).not.toContain('PRIVATE_INTERNAL_SERVICE_TOKEN')
    expect(execute.mock.calls[0]?.[0]).toMatchObject({ deviceId: 'b', targetDevice: 'VIDEOHUB_ROUTER', params: { source: 2, destination: 4 } })
    await server.close(); server = Fastify(); registerRoutes(app, server, () => {}); await server.ready()
    const duplicate = await server.inject({ method: 'POST', url: '/api/external/devices/b/control', payload })
    expect(duplicate.statusCode).toBe(200); expect(duplicate.json().deduplicated).toBe(true); expect(execute).toHaveBeenCalledTimes(1)
    const history = (await server.inject('/api/external/commands')).json()
    expect(history.runs).toHaveLength(1); expect(history.runs[0].state).toBe('EXECUTED')
  })
  it('incerto e falha são conflito, não sucesso nem reenvio automático', async () => {
    const execute = vi.spyOn(globalStudioAutomationGateway, 'execute').mockRejectedValueOnce(new Error('Processo caiu depois de enviar'))
    const payload = { requestId: randomUUID(), action: 'PING' }
    expect((await server.inject({ method: 'POST', url: '/api/external/devices/a/control', payload })).statusCode).toBe(409)
    const duplicate = await server.inject({ method: 'POST', url: '/api/external/devices/a/control', payload })
    expect(duplicate.statusCode).toBe(409); expect(duplicate.json().run.state).toBe('FIRING'); expect(execute).toHaveBeenCalledTimes(1)
    execute.mockResolvedValueOnce({ success: false, targetDevice: 'VIDEOHUB_ROUTER', action: 'PING', latencyMs: 10, status: 'FAILED', error: 'NAK' })
    const failed = await server.inject({ method: 'POST', url: '/api/external/devices/a/control', payload: { ...payload, requestId: randomUUID() } })
    expect(failed.statusCode).toBe(409); expect(failed.json().run.state).toBe('FAILED')
  })
  it('não opera dispositivo inexistente, ATEM/GPIO ou parâmetro incompleto', async () => {
    const execute = vi.spyOn(globalStudioAutomationGateway, 'execute')
    for (const id of ['atem', 'gpio', 'absent']) expect((await server.inject({ method: 'POST', url: `/api/external/devices/${id}/control`, payload: { requestId: randomUUID(), action: 'PING' } })).statusCode).toBe(id === 'absent' ? 404 : 409)
    expect((await server.inject({ method: 'POST', url: '/api/external/devices/a/control', payload: { requestId: randomUUID(), action: 'ROUTE_CROSSPOINT', source: 2 } })).statusCode).toBe(400)
    expect(execute).not.toHaveBeenCalled()
    expect((await server.inject({ method: 'PATCH', url: '/api/external/devices/absent', payload: { enabled: false } })).statusCode).toBe(404)
    expect((await server.inject({ method: 'PATCH', url: '/api/external/devices/a', payload: {} })).statusCode).toBe(400)
    expect((await server.inject({ method: 'PATCH', url: '/api/external/devices/a', payload: { enabled: false } })).statusCode).toBe(200)
    expect((await server.inject({ method: 'POST', url: '/api/external/devices/a/control', payload: { requestId: randomUUID(), action: 'PING' } })).statusCode).toBe(409)
    expect(execute).not.toHaveBeenCalled()
  })
  it('novo roteamento incerto é bloqueado e reconhecimento exige nota sem reenvio', async () => {
    const execute = vi.spyOn(globalStudioAutomationGateway, 'execute').mockRejectedValueOnce(new Error('Crash'))
    const requestId = randomUUID(), payload = { requestId, action: 'ROUTE_CROSSPOINT', source: 2, destination: 4 }
    expect((await server.inject({ method: 'POST', url: '/api/external/devices/a/control', payload })).statusCode).toBe(409)
    expect((await server.inject({ method: 'POST', url: '/api/external/devices/a/control', payload: { ...payload, requestId: randomUUID() } })).statusCode).toBe(409)
    expect(execute).toHaveBeenCalledTimes(1)
    const acknowledge = `/api/external/commands/${requestId}/acknowledge`
    expect((await server.inject({ method: 'POST', url: acknowledge, payload: { note: 'ok' } })).statusCode).toBe(400)
    expect((await server.inject({ method: 'POST', url: acknowledge, payload: { note: 'Conferência física do destino pelo operador' } })).statusCode).toBe(200)
    const history = (await server.inject('/api/external/commands')).json()
    expect(history.runs[0]).toMatchObject({ requestId, state: 'CLOSED_UNCERTAIN', acknowledgement: 'Conferência física do destino pelo operador' })
    expect(execute).toHaveBeenCalledTimes(1)
  })
  it('sessão e permissão são obrigatórias; header de serviço não autoriza a rota da página', async () => {
    const now = new Date().toISOString(), token = 'readonly-session'
      // OPERATOR is valid but has no OUTPUT_CONTROL grant; VIEWER is not an
      // assignable role and now correctly fails authentication with HTTP 401.
      app.sqlite.prepare('INSERT INTO users VALUES (?,?,?,?,?,?)').run('viewer', 'viewer', 'not-a-login-hash', 'OPERATOR', 1, now)
    app.sqlite.prepare('INSERT INTO sessions VALUES (?,?,?,?)').run(sessionDigest(token), 'viewer', '2099-01-01', now)
    const execute = vi.spyOn(globalStudioAutomationGateway, 'execute'), payload = { requestId: randomUUID(), action: 'PING' }
    expect((await server.inject({ method: 'POST', url: '/api/external/devices/a/control', payload })).statusCode).toBe(401)
    expect((await server.inject({ method: 'POST', url: '/api/external/devices/a/control', headers: { authorization: 'Bearer PRIVATE_INTERNAL_SERVICE_TOKEN' }, payload })).statusCode).toBe(401)
    expect((await server.inject({ method: 'POST', url: '/api/external/devices/a/control', headers: { cookie: `rplayout_session=${token}` }, payload })).statusCode).toBe(403)
    expect((await server.inject({ url: '/api/external/commands', headers: { cookie: `rplayout_session=${token}` } })).statusCode).toBe(403)
    expect((await server.inject({ method: 'POST', url: `/api/external/commands/${randomUUID()}/acknowledge`, headers: { cookie: `rplayout_session=${token}` }, payload: { note: 'Conferência sem permissão' } })).statusCode).toBe(403)
    expect(execute).not.toHaveBeenCalled()
  })
    it('papel inválido não autentica nem usa token de serviço para comandar pela página',async()=>{
      const now=new Date().toISOString(),token='invalid-role-session'
      app.sqlite.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run('invalid','invalid','not-a-login-hash','VIEWER',1,now)
      app.sqlite.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(sessionDigest(token),'invalid','2099-01-01',now)
      const execute=vi.spyOn(globalStudioAutomationGateway,'execute'),headers={cookie:`rplayout_session=${token}`,authorization:'Bearer PRIVATE_INTERNAL_SERVICE_TOKEN','x-rplayout-role':'ADMIN'}
      for(const url of ['/api/external/devices/a/control',`/api/external/commands/${randomUUID()}/acknowledge`]){
        expect((await server.inject({method:'POST',url,headers,payload:{requestId:randomUUID(),action:'PING',note:'Sem acesso'}})).statusCode).toBe(401)
      }
      expect((await server.inject({url:'/api/external/commands',headers})).statusCode).toBe(401)
      expect(execute).not.toHaveBeenCalled()
    })
})
