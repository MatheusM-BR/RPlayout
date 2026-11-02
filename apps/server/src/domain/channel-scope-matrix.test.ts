import Fastify,{type FastifyInstance} from 'fastify'
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {randomUUID} from 'node:crypto'
import {createApp,type App} from '../app.js'
import {registerRoutes} from '../routes.js'
import {channels,users,sessions,rundowns,rundownItems} from '../db/schema.js'
import {sessionDigest} from './access.js'
vi.mock('../config.js',async original=>({...await original<Record<string,unknown>>(),ENGINE_BINARY:'',MEDIAMTX_BINARY:'',DEVICES_BINARY:'',AUTH_USER:'',AUTH_PASSWORD:'',DEFAULT_ROLE:'ADMIN'}))
let app:App,server:FastifyInstance,routes:Array<{method:string;url:string}>
const token=randomUUID()
beforeEach(async()=>{
  app=await createApp(':memory:');routes=[]
  const now=new Date().toISOString()
  for(const id of ['A','B'])await app.db.insert(channels).values({id,name:id,rateNum:25,rateDen:1,width:320,height:180,targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,createdAt:now})
  app.db.insert(rundowns).values({id:'rB',channelId:'B',name:'grade B',date:'2026-10-28',plannedStart:0,loop:false,createdAt:now,updatedAt:now}).run()
  app.db.insert(rundownItems).values({id:'iB',rundownId:'rB',sortOrder:0,type:'LIVE',title:'item B',sourceRef:'ndi:X',durationOverride:250,minDuration:0,anchor:{kind:'FLOW'},onOverrun:'PUSH',locked:false,autoNext:false,loop:false}).run()
  await app.db.insert(users).values({id:'u',username:'u',passwordHash:'x',role:'OPERATOR',enabled:true,createdAt:now})
  app.sqlite.prepare('INSERT INTO user_access VALUES(?,?,?,?)').run('u',JSON.stringify(['A']),null,now)
  await app.db.insert(sessions).values({token:sessionDigest(token),userId:'u',expiresAt:new Date(Date.now()+600000).toISOString(),createdAt:now})
  server=Fastify();server.addHook('onRoute',route=>{for(const method of [route.method].flat())if(method!=='HEAD'&&method!=='OPTIONS')routes.push({method,url:route.url})})
  registerRoutes(app,server,()=>{});await server.ready()
})
afterEach(async()=>{await server?.close();app?.close()})
const concrete=(url:string)=>url.replace(/\/rundowns\/:id/,'/rundowns/rB').replace(/\/items\/:id/,'/items/iB').replace(/\/rundowns\/:rundownId/,'/rundowns/rB').replace(/:[A-Za-z]+/g,'B')
describe('conta restrita ao canal A não alcança o canal B',()=>{
  it.each(['OPERATOR','PROGRAMMER','SUPERVISOR','ADMIN'])('papel %s: nenhuma das rotas responde ao canal B',async role=>{
    app.sqlite.prepare('UPDATE users SET role=? WHERE id=?').run(role,'u')
    const leaks:string[]=[]
    const B=(url:string)=>url.includes('/B')||url.includes('rB')||url.includes('iB')
    for(const route of routes){
      if(['/api/auth/login','/api/auth/logout','/ws'].includes(route.url))continue
      const url=concrete(route.url)
      const withQuery=url+(url.includes('?')?'&':'?')+'channelId=B&rundownId=rB'
      const response=await server.inject({method:route.method as 'GET',url:withQuery,payload:route.method==='GET'||route.method==='DELETE'?undefined:{channelId:'B',rundownId:'rB',itemId:'iB'},headers:{cookie:`rplayout_session=${token}`,'if-match':'w/"1"'}})
      if(![401,403,404].includes(response.statusCode))leaks.push(`${route.method} ${route.url} -> ${response.statusCode}${B(url)?' [B na rota]':''} ${response.body.slice(0,120).replace(/\s+/g,' ')}`)
    }
    // Controle: o mesmo pedido no canal A precisa passar da autorização em parte das rotas.
    let passedA=0
    for(const route of routes.filter(r=>r.method==='GET'&&r.url.startsWith('/api/channels/:id'))){
      const response=await server.inject({method:'GET',url:route.url.replace(/:[A-Za-z]+/g,'A'),headers:{cookie:`rplayout_session=${token}`}})
      if(![401,403].includes(response.statusCode))passedA++
    }
    expect(routes.length).toBeGreaterThan(300)
    expect(passedA).toBeGreaterThan(20)
    expect(leaks).toEqual([])
  },300_000)
  it('leituras gerais (sem canal na rota) não trazem dados do canal B',async()=>{
    const found:string[]=[]
    for(const route of routes.filter(r=>r.method==='GET'&&!r.url.includes(':')&&r.url.startsWith('/api/'))){
      const response=await server.inject({method:'GET',url:route.url,headers:{cookie:`rplayout_session=${token}`}})
      if(response.statusCode<300&&/grade B|item B|"rB"|"iB"/.test(response.body))found.push(`${route.url} -> ${response.body.slice(0,160)}`)
    }
    expect(found).toEqual([])
  },120_000)
  it('estado inicial e lista de canais só trazem o canal liberado',async()=>{
    const state=await server.inject({method:'GET',url:'/api/state',headers:{cookie:`rplayout_session=${token}`}})
    expect(state.statusCode).toBe(200)
    expect(state.json().channels.map((channel:{id:string})=>channel.id)).toEqual(['A'])
    expect(state.json().rundowns.map((rundown:{id:string})=>rundown.id)).not.toContain('rB')
  })
})
