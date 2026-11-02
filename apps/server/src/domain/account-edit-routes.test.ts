import Fastify,{type FastifyInstance} from 'fastify'
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {createApp,type App} from '../app.js'
import {registerRoutes} from '../routes.js'
import {sessionDigest} from './access.js'
import * as auth from './auth.js'
import {operatorDecisions} from '../db/schema.js'
vi.mock('../config.js',async original=>({...await original<Record<string,unknown>>(),ENGINE_BINARY:'',MEDIAMTX_BINARY:'',DEVICES_BINARY:'',AUTH_USER:'',AUTH_PASSWORD:'',DEFAULT_ROLE:'ADMIN'}))
let app:App,server:FastifyInstance
const cookie='rplayout_session=PRIVATE_ADMIN_TOKEN',headers={cookie}
beforeEach(async()=>{
  app=await createApp(':memory:');for(const [id,role]of [['admin','ADMIN'],['target:ç','OPERATOR']])app.sqlite.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run(id,id,'PRIVATE_HASH_'+id,role,1,'original')
  app.sqlite.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(sessionDigest('PRIVATE_ADMIN_TOKEN'),'admin','2099-01-01','original')
  app.sqlite.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(sessionDigest('PRIVATE_TARGET_TOKEN'),'target:ç','2099-01-01','original')
  server=Fastify();registerRoutes(app,server,()=>{});await server.ready()
})
afterEach(async()=>{await server.close();app.close();vi.restoreAllMocks()})
const catalog=()=>server.inject({url:'/api/users/review',headers})
// Refused HTTP requests deliberately retain API_MUTATION with their status.
// Assert atomic successful domain decisions, without suppressing attempt logs.
const state=()=>Object.fromEntries(['users','user_access','sessions','account_versions','operator_decisions'].map(table=>[table,app.sqlite.prepare(`SELECT * FROM ${table}${table==='operator_decisions'?" WHERE kind<>'API_MUTATION'":''} ORDER BY rowid`).all()]))
const targetPath='/api/users/'+encodeURIComponent('target:ç')
const profileProof=async(id='target:ç')=>{const review=(await catalog()).json();return `"accounts:user:${encodeURIComponent(id)}:${review.revision}:${review.users.find((user:any)=>user.id===id).revision}"`}
describe('HTTP de contas tem revisão e autoria real, não comando de playout',()=>{
  it('catálogo e sessões privados/estáveis não retornam identificadores ou segredos',async()=>{
    const before=state(),review=await catalog(),second=await catalog();expect(review.statusCode).toBe(200);expect(second.json()).toEqual(review.json());expect(second.headers.etag).toBe(review.headers.etag);expect(review.headers['cache-control']).toBe('private, no-store')
    const sessions=await server.inject({url:targetPath+'/sessions',headers});expect(sessions.statusCode).toBe(200);expect(sessions.headers['cache-control']).toBe('private, no-store');expect(state()).toEqual(before)
    const text=JSON.stringify({review:review.json(),sessions:sessions.json()});for(const secret of ['PRIVATE',sessionDigest('PRIVATE_TARGET_TOKEN'),'passwordHash','token'])expect(text).not.toContain(secret)
    expect(sessions.json().sessions).toEqual([{createdAt:'original',expiresAt:'2099-01-01'}])
  })
  it.each(['CREATE','UPDATE','ACCESS','REVOKE'])('%s sem revisão retorna 428 sem efeito',async operation=>{
    const before=state(),path=operation==='CREATE'?'/api/users':operation==='REVOKE'?targetPath+'/sessions':operation==='ACCESS'?targetPath+'/access':targetPath
    const method=operation==='CREATE'?'POST':operation==='REVOKE'?'DELETE':operation==='ACCESS'?'PUT':'PATCH'
    const payload=operation==='CREATE'?{username:'New',password:'PASSWORD',role:'OPERATOR'}:operation==='UPDATE'?{enabled:false}:operation==='ACCESS'?{channelIds:null,stationIps:null}:undefined
    expect((await server.inject({url:path,method,headers,payload})).statusCode).toBe(428);expect(state()).toEqual(before)
    expect(app.db.select().from(operatorDecisions).all().filter(row=>row.kind==='API_MUTATION').at(-1)?.payload).toMatchObject({status:428})
  })
  it('duas criações com hash assíncrono e mesma prova têm um vencedor',async()=>{
    const proof=(await catalog()).headers.etag as string
    const results=await Promise.all(['First','Second'].map(username=>server.inject({url:'/api/users',method:'POST',headers:{...headers,'if-match':proof},payload:{username,password:'PASSWORD',role:'OPERATOR'}})))
    expect(results.map(row=>row.statusCode).sort()).toEqual([200,409]);expect(app.sqlite.prepare("SELECT count(*) n FROM operator_decisions WHERE kind='USER_CREATED'").get()).toEqual({n:1})
    expect(JSON.stringify(results.find(row=>row.statusCode===200)!.json())).not.toContain('PASSWORD')
  })
  it.each(['disabled','station','revoked','target-aba'])('hash da senha não renova autoridade ou prova após %s',async change=>{
    const proof=await profileProof(),originalHash=auth.hashPassword
    vi.spyOn(auth,'hashPassword').mockImplementation(async password=>{
      const hash=await originalHash(password)
      app.sqlite.exec(change==='disabled'?"UPDATE users SET enabled=0 WHERE id='admin'":change==='station'?"INSERT INTO user_access VALUES('admin',NULL,'[\"192.168.42.9\"]','now')":change==='revoked'?"DELETE FROM sessions WHERE user_id='admin'":"UPDATE users SET role='SUPERVISOR' WHERE id='target:ç';UPDATE users SET role='OPERATOR' WHERE id='target:ç'")
      return hash
    })
    const beforeTarget=app.sqlite.prepare("SELECT * FROM users WHERE id='target:ç'").get()
    const result=await server.inject({url:targetPath,method:'PATCH',headers:{...headers,'if-match':proof},payload:{password:'NEW_PRIVATE_PASSWORD'}})
    expect(result.statusCode).toBe(change==='target-aba'?409:403);expect(app.sqlite.prepare("SELECT * FROM users WHERE id='target:ç'").get()).toEqual(beforeTarget);expect(app.sqlite.prepare("SELECT 1 FROM operator_decisions WHERE kind='USER_UPDATED_SESSIONS_REVOKED'").get()).toBeUndefined()
  })
  it('sessão nova invalida confirmação e repetição não encerra outra lista',async()=>{
    const original=await server.inject({url:targetPath+'/sessions',headers});app.sqlite.exec("INSERT INTO sessions VALUES('new-private-hash','target:ç','2099-01-01','new')");const before=state()
    expect((await server.inject({url:targetPath+'/sessions',method:'DELETE',headers:{...headers,'if-match':original.headers.etag as string}})).statusCode).toBe(409);expect(state()).toEqual(before)
    const fresh=await server.inject({url:targetPath+'/sessions',headers}),result=await server.inject({url:targetPath+'/sessions',method:'DELETE',headers:{...headers,'if-match':fresh.headers.etag as string}})
    expect(result.statusCode).toBe(200);expect(result.json()).toMatchObject({revokedCount:2,requiresLogin:false})
    expect((await server.inject({url:targetPath+'/sessions',method:'DELETE',headers:{...headers,'if-match':fresh.headers.etag as string}})).statusCode).toBe(409)
  })
  it.each(['CREATE','UPDATE','ACCESS','REVOKE','LOGOUT'])('erro SQL na auditoria %s não deixa sucesso parcial nem cookie de logout',async operation=>{
    const proof=operation==='CREATE'?(await catalog()).headers.etag:operation==='REVOKE'?(await server.inject({url:targetPath+'/sessions',headers})).headers.etag:await profileProof()
    const before=state();app.sqlite.exec("CREATE TRIGGER http_account_audit_failure BEFORE INSERT ON operator_decisions BEGIN SELECT RAISE(ABORT,'HTTP_ACCOUNT_AUDIT_FIXTURE'); END")
    const path=operation==='CREATE'?'/api/users':operation==='REVOKE'?targetPath+'/sessions':operation==='ACCESS'?targetPath+'/access':operation==='LOGOUT'?'/api/auth/logout':targetPath
    const method=operation==='CREATE'||operation==='LOGOUT'?'POST':operation==='REVOKE'?'DELETE':operation==='ACCESS'?'PUT':'PATCH'
    const payload=operation==='CREATE'?{username:'New',password:'PRIVATE_PASSWORD',role:'OPERATOR'}:operation==='UPDATE'?{enabled:false}:operation==='ACCESS'?{channelIds:null,stationIps:null}:operation==='LOGOUT'?{}:undefined
    const result=await server.inject({url:path,method,headers:{...headers,'if-match':proof as string},payload});expect(result.statusCode).toBe(500);expect(result.headers['set-cookie']).toBeUndefined();expect(JSON.stringify(result.json())).not.toContain('PRIVATE_PASSWORD');expect(state()).toEqual(before)
  })
  it.each([{channelId:'spoof'},{passwordHash:'HASH'},{role:'constructor'},{}])('PATCH rejeita campos extras/inválidos %j',async payload=>{
    const proof=await profileProof(),before=state();expect((await server.inject({url:targetPath,method:'PATCH',headers:{...headers,'if-match':proof},payload})).statusCode).toBe(400);expect(state()).toEqual(before)
  })
  it('primeira conta é ADMIN/local e a concorrente não aproveita prova anterior ao hash',async()=>{
    app.sqlite.exec('DELETE FROM users')
    const review=await server.inject({url:'/api/users/review'});expect(review.json()).toMatchObject({users:[],bootstrapAllowed:true})
    expect((await server.inject({url:'/api/users',method:'POST',remoteAddress:'192.168.42.9',headers:{'if-match':review.headers.etag as string},payload:{username:'remote',password:'PASSWORD',role:'ADMIN'}})).statusCode).toBe(403)
    const originalHash=auth.hashPassword;let inserted=false
    vi.spyOn(auth,'hashPassword').mockImplementation(async password=>{const hash=await originalHash(password);if(!inserted){inserted=true;app.sqlite.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run('other','other',hash,'ADMIN',1,'now')}return hash})
    const result=await server.inject({url:'/api/users',method:'POST',headers:{'if-match':review.headers.etag as string},payload:{username:'local',password:'PASSWORD',role:'ADMIN'}})
    expect(result.statusCode).toBe(403);expect(app.sqlite.prepare('SELECT username FROM users').all()).toEqual([{username:'other'}]);expect(app.sqlite.prepare("SELECT 1 FROM operator_decisions WHERE kind='USER_CREATED'").get()).toBeUndefined()
  })
})
