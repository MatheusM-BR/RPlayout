import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import Fastify,{type FastifyInstance} from 'fastify'
import {randomUUID} from 'node:crypto'
import {createApp,type App} from '../app.js'
import {registerRoutes} from '../routes.js'
import {users,sessions,operatorDecisions} from '../db/schema.js'
import {sessionDigest} from './access.js'

vi.mock('../config.js',async original=>({...await original<Record<string,unknown>>(),ENGINE_BINARY:'',MEDIAMTX_BINARY:'',DEVICES_BINARY:'',AUTH_USER:'',AUTH_PASSWORD:'',DEFAULT_ROLE:'ADMIN'}))
let app:App,server:FastifyInstance,prefix:string
const headers=()=>({cookie:`rplayout_session=${prefix}-admin`})

beforeEach(async()=>{
  prefix=randomUUID();app=await createApp(':memory:')
  const now=new Date().toISOString()
  await app.db.insert(users).values({id:'admin',username:'admin',passwordHash:'x',role:'ADMIN',enabled:true,createdAt:now})
  await app.db.insert(sessions).values({token:sessionDigest(`${prefix}-admin`),userId:'admin',expiresAt:new Date(Date.now()+60000).toISOString(),createdAt:now})
  server=Fastify();registerRoutes(app,server,()=>{});await server.ready();await app.sources.list()
})
afterEach(async()=>{await server.close();app.close()})

describe('auditoria do administrador',()=>{
  it('filtra por tipo/usuário e pagina por cursor sem repetir linhas',async()=>{
    for(let i=0;i<7;i++)await app.db.insert(operatorDecisions).values({id:`d${i}`,rundownId:'@security',itemId:null,kind:i%2?'USER_UPDATED_SESSIONS_REVOKED':'LOGIN_FAILED',payload:{n:i},actorUsername:i<4?'ana':'bia',createdAt:`2026-10-01T00:00:0${i}.000Z`})
    const first=(await server.inject({url:'/api/audit?limit=3&kind=LOGIN_FAILED',headers:headers()})).json()
    expect(first.entries.map((e:any)=>e.id)).toEqual(['d2','d4','d6'])
    expect(first.entries.every((e:any)=>e.kind==='LOGIN_FAILED')).toBe(true)
    const page1=(await server.inject({url:'/api/audit?limit=2&kind=LOGIN_FAILED',headers:headers()})).json()
    expect(page1.entries).toHaveLength(2);expect(page1.nextBefore).toBeTruthy()
    const page2=(await server.inject({url:`/api/audit?limit=2&kind=LOGIN_FAILED&before=${encodeURIComponent(page1.nextBefore)}`,headers:headers()})).json()
    const ids=[...page1.entries,...page2.entries].map((e:any)=>e.id)
    expect(new Set(ids).size).toBe(ids.length)
    const byActor=(await server.inject({url:'/api/audit?actor=BIA&kind=LOGIN_FAILED',headers:headers()})).json()
    expect(byActor.entries.every((e:any)=>e.actorUsername==='bia')).toBe(true)
  })
  it('exportar registra AUDIT_EXPORTED com o autor',async()=>{
    expect((await server.inject({method:'POST',url:'/api/audit/exported',headers:headers(),payload:{rows:12}})).statusCode).toBe(204)
    const rows=(await server.inject({url:'/api/audit?kind=AUDIT_EXPORTED',headers:headers()})).json().entries
    expect(rows).toHaveLength(1);expect(rows[0].actorUsername).toBe('admin');expect(rows[0].payload.rows).toBe(12)
  })
})
