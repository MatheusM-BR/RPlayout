import Fastify,{type FastifyInstance} from 'fastify'
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {createApp,type App} from '../app.js'
import {registerRoutes} from '../routes.js'
import {bootstrapConfiguredAccount} from './account-edit.js'
import * as auth from './auth.js'
vi.mock('../config.js',async original=>({...await original<Record<string,unknown>>(),ENGINE_BINARY:'',MEDIAMTX_BINARY:'',DEVICES_BINARY:'',AUTH_USER:'env-admin',AUTH_PASSWORD:'ENV_PRIVATE_PASSWORD',DEFAULT_ROLE:'OPERATOR'}))
let app:App,server:FastifyInstance
beforeEach(async()=>{app=await createApp(':memory:');server=Fastify();registerRoutes(app,server,()=>{});await server.ready()})
afterEach(async()=>{await server.close();app.close();vi.restoreAllMocks()})
const login=()=>server.inject({url:'/api/auth/login',method:'POST',payload:{username:'env-admin',password:'ENV_PRIVATE_PASSWORD'}})
const state=()=>Object.fromEntries(['users','sessions','account_versions','operator_decisions'].map(table=>[table,app.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]))
describe('credenciais configuradas inicializam admin somente quando instalação ainda não tem contas',()=>{
  it('primeiro login configurado cria admin/auditoria e sessão sem expor credencial',async()=>{
    const result=await login();expect(result.statusCode).toBe(200);expect(result.headers['set-cookie']).toContain('HttpOnly');expect(result.json()).toMatchObject({role:'ADMIN'})
    expect(app.sqlite.prepare("SELECT username,role,enabled FROM users").all()).toEqual([{username:'env-admin',role:'ADMIN',enabled:1}]);expect(app.sqlite.prepare('SELECT kind FROM operator_decisions ORDER BY rowid').all()).toEqual([{kind:'USER_BOOTSTRAPPED'},{kind:'SESSION_CREATED'}])
    expect(JSON.stringify(app.sqlite.prepare('SELECT payload FROM operator_decisions').all())).not.toContain('PRIVATE')
  })
  it.each(['ADMIN','OPERATOR','constructor'])('não acrescenta admin a instalação com conta existente %s/inativa',async role=>{
    app.sqlite.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run('existing','existing','PRIVATE_HASH',role,0,'original');const before=state()
    expect((await login()).statusCode).toBe(401);expect(state()).toEqual(before)
  })
  it('concorrrência após hashing reconfere ausência de contas antes de elevar',async()=>{
    const originalHash=auth.hashPassword
    vi.spyOn(auth,'hashPassword').mockImplementation(async password=>{const hash=await originalHash(password);app.sqlite.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run('other','other',hash,'ADMIN',1,'now');return hash})
    const result=await login();expect(result.statusCode).toBe(401);expect(result.headers['set-cookie']).toBeUndefined();expect(app.sqlite.prepare('SELECT username FROM users').all()).toEqual([{username:'other'}]);expect(app.sqlite.prepare('SELECT * FROM sessions').all()).toEqual([])
  })
  it('falha da auditoria bootstrap reverte conta/counters e nunca responde com cookie',async()=>{
    const before=state();app.sqlite.exec("CREATE TRIGGER bootstrap_audit_failure BEFORE INSERT ON operator_decisions WHEN NEW.kind='USER_BOOTSTRAPPED' BEGIN SELECT RAISE(ABORT,'BOOTSTRAP_AUDIT_FIXTURE'); END")
    const result=await login();expect(result.statusCode).toBe(500);expect(result.headers['set-cookie']).toBeUndefined();expect(state()).toEqual(before)
  })
  it('não aceita outra identidade de configuração nem reaproveita inicialização',()=>{
    expect(()=>bootstrapConfiguredAccount(app.db,'other','hash','127.0.0.1')).toThrow()
    bootstrapConfiguredAccount(app.db,'env-admin','hash','127.0.0.1');const before=state();expect(()=>bootstrapConfiguredAccount(app.db,'env-admin','hash','127.0.0.1')).toThrow();expect(state()).toEqual(before)
  })
})
