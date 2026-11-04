import Fastify,{type FastifyInstance} from 'fastify'
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {randomUUID} from 'node:crypto'
import {createApp,type App} from '../app.js'
import {registerRoutes} from '../routes.js'
import {channels,users,sessions} from '../db/schema.js'
import {sessionDigest} from './access.js'
vi.mock('../config.js',async original=>({...await original<Record<string,unknown>>(),ENGINE_BINARY:'',MEDIAMTX_BINARY:'',DEVICES_BINARY:'',AUTH_USER:'',AUTH_PASSWORD:'',DEFAULT_ROLE:'ADMIN'}))
const storage=vi.hoisted(()=>({down:false}))
vi.mock('../db/process-database.js',async original=>{const real=await original<typeof import('../db/process-database.js')>();return {...real,databaseStorageStatus:(sqlite:Parameters<typeof real.databaseStorageStatus>[0])=>storage.down?{...real.databaseStorageStatus(sqlite),connected:false}:real.databaseStorageStatus(sqlite)}})
let app:App,server:FastifyInstance,routes:Array<{method:string;url:string}>
const token=randomUUID()
beforeEach(async()=>{
  app=await createApp(':memory:');routes=[]
  const now=new Date().toISOString()
  await app.db.insert(channels).values({id:'ch',name:'ch',rateNum:25,rateDen:1,width:320,height:180,targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,createdAt:now})
  await app.db.insert(users).values({id:'op',username:'op',passwordHash:'not-used',role:'OPERATOR',enabled:true,createdAt:now})
  await app.db.insert(sessions).values({token:sessionDigest(token),userId:'op',expiresAt:new Date(Date.now()+600000).toISOString(),createdAt:now})
  server=Fastify();server.addHook('onRoute',route=>{for(const method of [route.method].flat())if(['POST','PUT','PATCH','DELETE'].includes(method))routes.push({method,url:route.url})})
  registerRoutes(app,server,()=>{});await server.ready()
})
afterEach(async()=>{await server.close();app.close()})
const concrete=(url:string)=>url.replace(/:[A-Za-z]+/g,'x')
describe('matriz de autorização das rotas que alteram estado',()=>{
  it('sem sessão, nenhuma rota de alteração executa (somente login/logout e pareamento HA com credencial própria)',async()=>{
    const ownAuth=new Set(['/api/auth/login','/api/auth/logout'])
    const accepted:string[]=[]
    expect(routes.length).toBeGreaterThan(100)
    for(const route of routes){
      if(ownAuth.has(route.url))continue
      const response=await server.inject({method:route.method as 'POST',url:concrete(route.url),payload:{}})
      if(![401,403].includes(response.statusCode))accepted.push(`${route.method} ${route.url} -> ${response.statusCode}`)
    }
    expect(accepted).toEqual([])
  },120_000)
  it('operador não administra contas, integrações, backup de atualização, canais, saídas, o watchdog das entradas nem o nível do multiview',async()=>{
    const cookie={cookie:`rplayout_session=${token}`}
    const cases:Array<[string,string,object]>=[
      ['POST','/api/users',{username:'intruso',password:'senha-muito-forte',role:'ADMIN'}],
      ['PUT','/api/users/op/access',{channelIds:null,stationIps:null}],
      ['POST','/api/integrations',{name:'x',url:'https://example.com/hook',events:['source.failed'],channelId:null}],
      ['POST','/api/backups/upgrade',{requestId:randomUUID()}],
      ['POST','/api/channels',{name:'novo'}],
      ['DELETE','/api/channels/ch',{}],
      ['POST','/api/channels/ch/outputs',{name:'x',kind:'SRT',target:'srt://127.0.0.1:9000'}],
      ['PUT','/api/channels/ch/live-watchdog',{revision:0,policy:{}}],
      // Nível do multiview composto muda o custo de codificação no ar.
      ['PUT','/api/channels/ch/multiview/composite',{layout:'MV_2X2',quality:'REFERENCIA'}],
      // Senha de recuperação do cofre: só administrador.
      ['PUT','/api/engineering/vault-recovery',{password:'senha-de-recuperacao',confirmation:'senha-de-recuperacao',currentPassword:'x'}],
    ]
    const results=[]
    for(const [method,url,payload] of cases){const response=await server.inject({method:method as 'POST',url,payload,headers:{...cookie,'if-match':'w/"1"'}});results.push(`${method} ${url} -> ${response.statusCode}${response.statusCode===403?"":" "+response.body.slice(0,200)}`)}
    // Backup de atualização recusa com 409 genérico (não revela se o UUID existe).
    expect(results.filter(row=>!/-> 403/.test(row)&&!/^POST \/api\/backups\/upgrade -> 409/.test(row))).toEqual([])
    expect(app.sqlite.prepare('SELECT count(*) AS n FROM backup_upgrade_requests').get()).toEqual({n:0})
    expect(app.sqlite.prepare("SELECT count(*) AS n FROM users").get()).toEqual({n:1})
    expect(app.sqlite.prepare('SELECT count(*) AS n FROM vault_recovery').get()).toEqual({n:0})
  })
  it('banco caído: toda rota da API responde 503 sem executar nada',async()=>{
    // Mesmo sinal de conexão perdida que o processo de banco expõe, sem
    // fechar o SQLite de teste por baixo do encerramento do app.
    storage.down=true
    try{for(const [method,url] of [['GET','/api/health'],['POST','/api/channels/ch/take'],['POST','/api/auth/login'],['GET','/api/channels']] as const){
      const response=await server.inject({method,url,payload:method==='POST'?{}:undefined,headers:{cookie:`rplayout_session=${token}`}})
      expect(response.statusCode,`${method} ${url}`).toBe(503)
      expect(response.json().error).toBe('STORAGE_UNAVAILABLE')
    }}finally{storage.down=false}
  })
  it('logs técnicos (leitura): sem sessão 401, operador 403, supervisor lê com severidade e busca',async()=>{
    const {technicalLog}=await import('./technical-log.js')
    technicalLog.ingest('[engine ch] encerrado: sinal SIGKILL; relatório em /tmp/engine-crashes/engine-crash-x.txt')
    expect((await server.inject({method:'GET',url:'/api/engineering/logs'})).statusCode).toBe(401)
    expect((await server.inject({method:'GET',url:'/api/engineering/logs',headers:{cookie:`rplayout_session=${token}`}})).statusCode).toBe(403)
    const now=new Date().toISOString(),supervisor=randomUUID()
    await app.db.insert(users).values({id:'sup',username:'sup',passwordHash:'not-used',role:'SUPERVISOR',enabled:true,createdAt:now})
    await app.db.insert(sessions).values({token:sessionDigest(supervisor),userId:'sup',expiresAt:new Date(Date.now()+600000).toISOString(),createdAt:now})
    const read=await server.inject({method:'GET',url:'/api/engineering/logs?level=ERROR&q=SIGKILL&channelId=ch',headers:{cookie:`rplayout_session=${supervisor}`}})
    expect(read.statusCode).toBe(200)
    expect(read.json().entries.at(-1)).toMatchObject({level:'ERROR',source:'ENGINE',channel:'ch',crashReport:'/tmp/engine-crashes/engine-crash-x.txt'})
    expect((await server.inject({method:'GET',url:'/api/engineering/logs?level=XYZ',headers:{cookie:`rplayout_session=${supervisor}`}})).statusCode).toBe(400)
  })
})

describe('senha de recuperação do cofre (rotas)',()=>{
  const RECOVERY='senha-de-recuperacao-forte'
  const admin=async(password:string)=>{
    const {hashPassword}=await import('./auth.js')
    const now=new Date().toISOString(),session=randomUUID()
    await app.db.insert(users).values({id:'adm',username:'adm',passwordHash:await hashPassword(password),role:'ADMIN',enabled:true,createdAt:now})
    await app.db.insert(sessions).values({token:sessionDigest(session),userId:'adm',expiresAt:new Date(Date.now()+600000).toISOString(),createdAt:now})
    return {cookie:`rplayout_session=${session}`}
  }
  it('status sem segredo; definir exige ADMIN, If-Match atual e a senha da conta; nada da senha vaza',async()=>{
    const headers=await admin('senha-da-conta-admin')
    expect((await server.inject({method:'GET',url:'/api/engineering/vault-recovery'})).statusCode).toBe(401)
    expect((await server.inject({method:'GET',url:'/api/engineering/vault-recovery',headers:{cookie:`rplayout_session=${token}`}})).statusCode).toBe(403)
    const status=await server.inject({method:'GET',url:'/api/engineering/vault-recovery',headers})
    expect(status.statusCode).toBe(200)
    expect(status.headers.etag).toBe('"vault-recovery:0"')
    expect(status.json()).toMatchObject({configured:false,restorableElsewhere:false,warning:expect.stringContaining('não restaurável em outra máquina')})
    const body={password:RECOVERY,confirmation:RECOVERY,currentPassword:'senha-da-conta-admin'}
    const put=(extra:Record<string,string>,payload:object=body)=>server.inject({method:'PUT',url:'/api/engineering/vault-recovery',headers:{...headers,...extra},payload})
    expect((await put({})).statusCode).toBe(412)
    expect((await put({'if-match':'"vault-recovery:7"'})).statusCode).toBe(412)
    expect((await put({'if-match':'"vault-recovery:0"'},{...body,currentPassword:'errada'})).statusCode).toBe(403)
    expect((await put({'if-match':'"vault-recovery:0"'},{...body,confirmation:'outra-coisa-qualquer'})).statusCode).toBe(400)
    expect((await put({'if-match':'"vault-recovery:0"'},{password:'curta',confirmation:'curta',currentPassword:'senha-da-conta-admin'})).statusCode).toBe(400)
    const done=await put({'if-match':'"vault-recovery:0"'})
    expect(done.statusCode,done.body).toBe(200)
    expect(done.headers.etag).toBe('"vault-recovery:1"')
    expect(done.json()).toMatchObject({configured:true,restorableElsewhere:true,warning:null,revision:1})
    // A senha não aparece na resposta, no banco nem na auditoria.
    for(const text of [done.body,JSON.stringify(app.sqlite.prepare('SELECT * FROM vault_recovery').all()),JSON.stringify(app.sqlite.prepare('SELECT payload FROM operator_decisions').all())]){
      expect(text).not.toContain(RECOVERY);expect(text).not.toContain('senha-da-conta-admin')
    }
    expect(app.sqlite.prepare("SELECT count(*) AS n FROM operator_decisions WHERE rundown_id='@security' AND kind='VAULT_RECOVERY_PASSWORD_SET' AND actor_username='adm'").get()).toEqual({n:1})
    // Revisão velha não troca a senha (duas abas, dois administradores).
    expect((await put({'if-match':'"vault-recovery:0"'})).statusCode).toBe(412)
    expect((await put({'if-match':'"vault-recovery:1"'})).statusCode).toBe(200)
  },60_000)
})
