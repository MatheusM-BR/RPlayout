import Fastify,{type FastifyInstance} from 'fastify'
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {createApp,type App} from '../app.js'
import {registerRoutes} from '../routes.js'
import {sessionDigest} from './access.js'
import {operatorDecisions} from '../db/schema.js'
vi.mock('../config.js',async original=>({...await original<Record<string,unknown>>(),ENGINE_BINARY:'',MEDIAMTX_BINARY:'',DEVICES_BINARY:'',AUTH_USER:'',AUTH_PASSWORD:'',DEFAULT_ROLE:'ADMIN'}))
let app:App,server:FastifyInstance
const people:Array<[string,string]>=[['admin','ADMIN'],['gestor','GESTOR'],['gestor2','GESTOR'],['sup','SUPERVISOR'],['prog','PROGRAMMER'],['op','OPERATOR']]
const as=(id:string)=>({cookie:`rplayout_session=TOKEN_${id}`})
beforeEach(async()=>{
  app=await createApp(':memory:')
  for(const [id,role] of people){
    app.sqlite.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run(id,id,'HASH_'+id,role,1,'original')
    app.sqlite.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(sessionDigest('TOKEN_'+id),id,'2099-01-01','original')
  }
  server=Fastify();registerRoutes(app,server,()=>{});await server.ready()
})
afterEach(async()=>{await server.close();app.close();vi.restoreAllMocks()})
const review=async(who:string)=>(await server.inject({url:'/api/users/review',headers:as(who)})).json()
const catalogProof=async(who:string)=>`"accounts:catalog:${(await review(who)).revision}"`
const userProof=async(who:string,id:string)=>{const r=await review(who);return `"accounts:user:${encodeURIComponent(id)}:${r.revision}:${r.users.find((u:any)=>u.id===id).revision}"`}
const roleOf=(id:string)=>(app.sqlite.prepare('SELECT role FROM users WHERE id=? OR username=?').get(id,id) as {role:string}|undefined)?.role
const enabledOf=(id:string)=>(app.sqlite.prepare('SELECT enabled FROM users WHERE id=?').get(id) as {enabled:number}).enabled
const create=async(who:string,role:string,username='novo')=>server.inject({url:'/api/users',method:'POST',headers:{...as(who),'if-match':await catalogProof(who)},payload:{username,password:'PASSWORD123',role}})
const patch=async(who:string,id:string,payload:object)=>server.inject({url:'/api/users/'+id,method:'PATCH',headers:{...as(who),'if-match':await userProof(who,id)},payload})

describe('GESTOR gere contas só de papéis abaixo dele (servidor decide)',()=>{
  it.each(['OPERATOR','PROGRAMMER','SUPERVISOR'])('gestor cria conta %s',async role=>{
    const result=await create('gestor',role);expect(result.statusCode).toBe(200);expect(roleOf('novo')).toBe(role)
  })
  it.each(['GESTOR','ADMIN'])('gestor NÃO cria conta %s (negado, nada gravado)',async role=>{
    const result=await create('gestor',role);expect(result.statusCode).toBe(403);expect(roleOf('novo')).toBeUndefined()
    expect(app.sqlite.prepare("SELECT count(*) n FROM operator_decisions WHERE kind='USER_CREATED'").get()).toEqual({n:0})
  })
  it('gestor edita e desativa contas abaixo dele e a mudança de papel é auditada com roleFrom/roleTo',async()=>{
    expect((await patch('gestor','op',{role:'SUPERVISOR'})).statusCode).toBe(200);expect(roleOf('op')).toBe('SUPERVISOR')
    expect((await patch('gestor','prog',{enabled:false})).statusCode).toBe(200);expect(enabledOf('prog')).toBe(0)
    const audit=app.db.select().from(operatorDecisions).all().filter(row=>row.kind==='USER_UPDATED_SESSIONS_REVOKED').map(row=>row.payload as Record<string,unknown>)
    expect(audit[0]).toMatchObject({userId:'op',roleFrom:'OPERATOR',roleTo:'SUPERVISOR'})
  })
  it.each(['GESTOR','ADMIN'])('gestor NÃO promove conta abaixo dele a %s',async role=>{
    const result=await patch('gestor','op',{role});expect(result.statusCode).toBe(403);expect(roleOf('op')).toBe('OPERATOR')
  })
  it('gestor NÃO edita, rebaixa, desativa nem troca senha de ADMIN ou outro GESTOR (nem a si mesmo)',async()=>{
    for(const id of ['admin','gestor2','gestor']){
      for(const payload of [{role:'OPERATOR'},{enabled:false},{password:'OUTRA_SENHA_123'},{role:'SUPERVISOR',enabled:false}]){
        const result=await patch('gestor',id,payload);expect(result.statusCode,`${id} ${JSON.stringify(payload)}`).toBe(403)
      }
    }
    expect(roleOf('admin')).toBe('ADMIN');expect(roleOf('gestor2')).toBe('GESTOR');expect(roleOf('gestor')).toBe('GESTOR')
    expect(enabledOf('admin')).toBe(1);expect(enabledOf('gestor2')).toBe(1);expect(enabledOf('gestor')).toBe(1)
    expect(app.sqlite.prepare('SELECT password_hash h FROM users WHERE id=?').get('admin')).toEqual({h:'HASH_admin'})
  })
  it('gestor NÃO altera acesso nem confere/revoga sessões de ADMIN ou GESTOR, mas faz isso em contas abaixo',async()=>{
    const access={channelIds:null,stationIps:null}
    for(const id of ['admin','gestor2']){
      expect((await server.inject({url:`/api/users/${id}/access`,method:'PUT',headers:{...as('gestor'),'if-match':await userProof('gestor',id)},payload:access})).statusCode).toBe(403)
      expect((await server.inject({url:`/api/users/${id}/sessions`,headers:as('gestor')})).statusCode).toBe(403)
      expect((await server.inject({url:`/api/users/${id}/sessions`,method:'DELETE',headers:{...as('gestor'),'if-match':'"accounts:sessions:x:1:1"'}})).statusCode).toBe(403)
    }
    expect(app.sqlite.prepare("SELECT count(*) n FROM sessions WHERE user_id IN ('admin','gestor2')").get()).toEqual({n:2})
    expect((await server.inject({url:'/api/users/op/access',method:'PUT',headers:{...as('gestor'),'if-match':await userProof('gestor','op')},payload:access})).statusCode).toBe(200)
    expect((await server.inject({url:'/api/users/op/sessions',headers:as('gestor')})).statusCode).toBe(200)
  })
  it('ADMIN continua podendo tudo, inclusive criar e promover a GESTOR e editar GESTOR',async()=>{
    expect((await create('admin','GESTOR','g3')).statusCode).toBe(200);expect(roleOf('g3')).toBe('GESTOR')
    expect((await patch('admin','op',{role:'GESTOR'})).statusCode).toBe(200);expect(roleOf('op')).toBe('GESTOR')
    expect((await patch('admin','gestor2',{role:'OPERATOR'})).statusCode).toBe(200)
  })
  it.each(['sup','prog','op'])('papel %s (abaixo de gestor) não gere contas',async who=>{
    expect((await server.inject({url:'/api/users/review',headers:as(who)})).statusCode).toBe(403)
    expect((await create(who,'OPERATOR','x')).statusCode).toBe(403)
  })
  it('integridade da auditoria e demais ações USER_MANAGE continuam só do ADMIN',async()=>{
    expect((await server.inject({url:'/api/audit/integrity',headers:as('gestor')})).statusCode).toBe(403)
    expect((await server.inject({url:'/api/audit/integrity',headers:as('admin')})).statusCode).not.toBe(403)
  })
  it('contas existentes mantêm o papel: migração não promove ninguém',()=>{
    expect(people.map(([id])=>roleOf(id))).toEqual(people.map(([,role])=>role))
  })
})
