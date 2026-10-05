import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, type App } from '../app.js'
import { registerRoutes } from '../routes.js'
import { AccessControl, sessionDigest, trustedOrigin } from './access.js'
import { hashPassword } from './auth.js'
import { operatorDecisions } from '../db/schema.js'

vi.mock('../config.js', async importOriginal => ({ ...await importOriginal<Record<string, unknown>>(), ENGINE_BINARY: '', MEDIAMTX_BINARY: '', DEVICES_BINARY: '', AUTH_USER: '', AUTH_PASSWORD: '', DEFAULT_ROLE: 'OPERATOR' }))
let app: App, server: FastifyInstance
let cookie: string
beforeEach(async () => {
  app = await createApp(':memory:')
  app.sqlite.prepare('INSERT INTO users VALUES (?,?,?,?,?,?)').run('admin', 'admin', await hashPassword('testing-password'), 'ADMIN', 1, new Date().toISOString())
  server = Fastify()
  registerRoutes(app, server, () => {})
  await server.ready()
  await app.sources.list()
  const login = await server.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: 'testing-password' } })
  expect(login.statusCode).toBe(200)
  cookie = String(login.headers['set-cookie']).split(';')[0]!
})
afterEach(async () => { await server.close(); app.close() })

describe('controle de acesso e sessão', () => {
  it('restringe estação pelo IP real e restringe comandos/leituras por canal', async () => {
    const now = new Date().toISOString()
    for (const id of ['allowed', 'denied']) {
      app.sqlite.prepare('INSERT INTO channels (id,name,rate_num,rate_den,width,height,target_lufs,ceiling_dbtp,limiter_lookahead_ms,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(id, id, 25, 1, 320, 180, -23, -1, 5, now)
      app.sqlite.prepare('INSERT INTO rundowns (id,channel_id,name,planned_start,loop,date,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(`rd-${id}`, id, id, 0, 0, '2026-09-30', now, now)
    }
    app.sqlite.prepare('INSERT INTO users VALUES (?,?,?,?,?,?)').run('operator', 'operator', await hashPassword('test-operator-password'), 'OPERATOR', 1, now)
    const policy = await server.inject({ method: 'PUT', url: '/api/users/operator/access', headers: { cookie }, payload: { channelIds: ['allowed'], stationIps: ['192.168.42.10'] } })
    expect(policy.statusCode).toBe(200)
    const credentials = { username: 'operator', password: 'test-operator-password' }
    expect((await server.inject({ method: 'POST', url: '/api/auth/login', payload: credentials, remoteAddress: '192.168.42.11' })).statusCode).toBe(403)
    const login = await server.inject({ method: 'POST', url: '/api/auth/login', payload: credentials, remoteAddress: '192.168.42.10' })
    expect(login.statusCode).toBe(200)
    const headers = { cookie: String(login.headers['set-cookie']).split(';')[0]! }, remoteAddress = '192.168.42.10'
    expect((await server.inject({ url: '/api/state', headers, remoteAddress })).json().channels.map((row: { id: string }) => row.id)).toEqual(['allowed'])
    expect((await server.inject({ url: '/api/state', headers, remoteAddress: '192.168.42.11' })).statusCode).toBe(401)
    expect((await server.inject({ url: '/api/rundowns/rd-denied/operational-simulation', headers, remoteAddress })).statusCode).toBe(403)
    expect((await server.inject({ url: '/api/v1/engineering/pgm-probe/contingency-loop?channelId=denied', headers, remoteAddress })).statusCode).toBe(403)
    expect((await server.inject({ method: 'POST', url: '/api/v1/engineering/pgm-probe/contingency-loop', headers, remoteAddress, payload: { channelId: 'denied', action: 'ENTER' } })).statusCode).toBe(403)
    expect((await server.inject({ method: 'POST', url: '/api/v1/engineering/pgm-probe/contingency-loop', headers, remoteAddress, payload: { channelId: 'allowed', action: 'CONFIGURE', revisionId: null } })).statusCode).toBe(403)
    expect((await server.inject({ url: '/api/rundowns/rd-allowed/operational-simulation', headers, remoteAddress })).statusCode).toBe(200)
    for(const id of ['allowed','denied'])await app.db.insert(operatorDecisions).values({id:`private-${id}`,rundownId:`rd-${id}`,kind:'QA_SCOPE',payload:{marker:id},createdAt:now})
    const scopedAudit=await server.inject({url:'/api/audit?channelId=allowed',headers,remoteAddress})
    expect(scopedAudit.statusCode).toBe(200)
    expect(scopedAudit.json().entries.map((row:any)=>row.id)).toContain('private-allowed')
    expect(JSON.stringify(scopedAudit.json())).not.toContain('private-denied')
    const implicitAudit=(await server.inject({url:'/api/audit',headers,remoteAddress})).json()
    expect(implicitAudit.entries.map((row:any)=>row.id)).toContain('private-allowed')
    expect(JSON.stringify(implicitAudit)).not.toContain('private-denied')
    expect(JSON.stringify(implicitAudit)).not.toContain('SESSION_CREATED')
    expect((await server.inject({ url: '/api/audit?channelId=denied', headers, remoteAddress })).statusCode).toBe(403)
    expect((await server.inject({ method: 'POST', url: '/api/channels/allowed/rundowns', headers, remoteAddress, payload: { date: '2026-10-01', copyFromRundownId: 'rd-denied' } })).statusCode).toBe(403)
  })
  it('conta cadastrada exige login mesmo sem variáveis de ambiente; header não concede acesso', async () => {
    const session = await server.inject({ url: '/api/session' })
    expect(session.json()).toMatchObject({ required: true, authenticated: false })
    expect((await server.inject({ url: '/api/state', headers: { 'x-rplayout-role': 'ADMIN' } })).statusCode).toBe(401)
    expect((await server.inject({ method: 'POST', url: '/api/channels', headers: { 'x-rplayout-role': 'ADMIN' }, payload: { name: 'intruso' } })).statusCode).toBe(401)
    expect((await server.inject({ url: '/api/state', headers: { cookie } })).statusCode).toBe(200)
  })
  it('armazena só o hash do token, recusa tokens expirados e logout revoga imediatamente', async () => {
    const rawToken = cookie.slice('rplayout_session='.length)
    expect(app.sqlite.prepare('SELECT token FROM sessions').get()).toEqual({ token: sessionDigest(rawToken) })
    expect((await server.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie } })).statusCode).toBe(200)
    expect((await server.inject({ url: '/api/state', headers: { cookie } })).statusCode).toBe(401)
    app.sqlite.prepare('INSERT INTO sessions VALUES (?,?,?,?)').run(sessionDigest(rawToken), 'admin', '2000-01-01', '1999-01-01')
    expect(new AccessControl(app.sqlite).identity({ headers: { cookie } })).toBeNull()
  })
  it('origem externa não recebe autorização nem com cookie válido', async () => {
    expect((await server.inject({ url: '/api/state', headers: { cookie, origin: 'https://intruso.example' } })).statusCode).toBe(403)
    expect(trustedOrigin('http://playout:4041', 'playout:4041')).toBe(true)
    expect(trustedOrigin('null', 'playout:4041')).toBe(false)
    expect(trustedOrigin('http://playout:4041.intruso.example', 'playout:4041')).toBe(false)
    expect(trustedOrigin('http://localhost:5173', 'localhost:4041', ['http://localhost:5173'])).toBe(true)
  })
  it('revogação administrativa encerra sessão sem desativar conta e deixa auditoria sem token/senha', async () => {
    const res = await server.inject({ method: 'DELETE', url: '/api/users/admin/sessions', headers: { cookie } })
    expect(res.statusCode).toBe(200)
    expect((await server.inject({ url: '/api/state', headers: { cookie } })).statusCode).toBe(401)
    expect(app.sqlite.prepare('SELECT enabled FROM users WHERE id=?').get('admin')).toEqual({ enabled: 1 })
    const audit = JSON.stringify(app.sqlite.prepare('SELECT kind,payload FROM operator_decisions').all())
    expect(audit).toContain('SESSIONS_REVOKED')
    expect(audit).not.toContain('testing-password')
    expect(audit).not.toContain(cookie.slice(17))
  })
  it('recusa desativar o último administrador e não reabre modo anônimo com contas inativas', async () => {
    const result = await server.inject({ method: 'PATCH', url: '/api/users/admin', headers: { cookie }, payload: { enabled: false } })
    expect(result.statusCode).toBe(409)
    app.sqlite.prepare('UPDATE users SET enabled=0').run()
    expect(new AccessControl(app.sqlite).required()).toBe(true)
    expect((await server.inject({ url: '/api/state' })).statusCode).toBe(401)
  })
  it('troca de papel invalida sessões e um header não eleva o papel local', async () => {
    app.sqlite.prepare('INSERT INTO users VALUES (?,?,?,?,?,?)').run('second', 'second', 'none', 'ADMIN', 1, new Date().toISOString())
    expect((await server.inject({ method: 'PATCH', url: '/api/users/admin', headers: { cookie }, payload: { role: 'OPERATOR' } })).statusCode).toBe(200)
    expect((await server.inject({ url: '/api/state', headers: { cookie } })).statusCode).toBe(401)
    app.sqlite.prepare('DELETE FROM users').run()
    expect(new AccessControl(app.sqlite).role({ headers: { 'x-rplayout-role': 'ADMIN' } })).toBe('OPERATOR')
  })
  it('limita tentativas repetidas de senha incorreta', async () => {
    for (let i=0; i<10; i++) expect((await server.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: 'wrong' } })).statusCode).toBe(401)
    const blocked = await server.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: 'testing-password' } })
    expect(blocked.statusCode).toBe(429)
    expect(blocked.headers['retry-after']).toBeDefined()
  })
})
