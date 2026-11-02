import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import {openDatabase} from '../db/client.js'
import {integrations,integrationDeliveries,channels} from '../db/schema.js'
import {integrationAuthority,readIntegrationDeliveries} from './integration-edit.js'
import {sessionDigest} from './access.js'
import {executionHostIdentity} from './execution-host.js'
vi.mock('../config.js',async original=>({...await original<Record<string,unknown>>(),AUTH_USER:'',AUTH_PASSWORD:'',DEFAULT_ROLE:'ADMIN'}))
let db:ReturnType<typeof openDatabase>
const request={headers:{cookie:'rplayout_session=SESSION'},ip:'127.0.0.1'}
beforeEach(()=>{
 db=openDatabase(':memory:');db.sqlite.exec("INSERT INTO users VALUES('u','Admin','NO_LOGIN','ADMIN',1,'now')");db.sqlite.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(sessionDigest('SESSION'),'u','2099-01-01','now')
 for(const id of ['a','b'])db.db.insert(channels).values({id,name:id,rateNum:25,rateDen:1,width:320,height:180,targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,createdAt:'now'}).run()
 for(const [id,channelId] of [['global',null],['ga','a'],['gb','b']] as const)db.db.insert(integrations).values({id,channelId,name:id,url:'https://example.test/PRIVATE?token=SECRET',events:['source.lost'],enabled:true,createdAt:'now'}).run()
})
afterEach(()=>{vi.restoreAllMocks();db.sqlite.close()})
const authority=()=>integrationAuthority(db.db,request)
function seed(id:string,integrationId='ga',channelId:string|null='a',state:'SENDING'|'FAILED'='SENDING',ownerHost:string|null=null,ownerPid:number|null=null,ownerBoot:string|null=null){db.db.insert(integrationDeliveries).values({id,integrationId,channelId,event:'source.lost',target:'https://example.test/PRIVATE?token=SECRET',payload:{private:'PAYLOADSECRET'},state,attempts:1,nextAttemptAt:'2099-01-01',createdAt:'now',ownerHost,ownerPid,ownerBoot,lastError:state==='FAILED'?'Envio legado sem responsável identificável. https://example.test/PRIVATE?token=SECRET':null}).run()}
it('coleção privada é read-only, explícita e não revela cofre/coordenadas; redige erro legado',()=>{
 seed('unknown');seed('alive','ga','a','SENDING',executionHostIdentity(),process.pid,'boot');seed('legacy','ga','a','FAILED')
 const rows=db.sqlite.prepare('SELECT * FROM integration_deliveries').all(),versions=db.sqlite.prepare('SELECT * FROM integration_delivery_versions').all(),result=readIntegrationDeliveries(db.db,'a',authority())
 expect(result.deliveries).toHaveLength(3);expect(JSON.stringify(result)).not.toMatch(/PRIVATE|SECRET|target|payload|ownerHost|ownerPid|ownerBoot/)
 expect(result.deliveries.find(row=>row.id==='unknown')!.diagnostic.ownership).toBe('UNKNOWN');expect(result.deliveries.find(row=>row.id==='alive')!.diagnostic.ownership).toBe('LOCAL_ALIVE');expect(result.deliveries.find(row=>row.id==='legacy')!.diagnostic.ownership).toBe('UNKNOWN')
 expect(db.sqlite.prepare('SELECT * FROM integration_deliveries').all()).toEqual(rows);expect(db.sqlite.prepare('SELECT * FROM integration_delivery_versions').all()).toEqual(versions)
})
it('canal da entrega e da configuração devem coincidir; restrito não consulta órfão/global sem canal',()=>{
 seed('allowed');seed('global-for-a','global');seed('foreign-delivery','gb','b');seed('wrong-owner','gb','a');seed('orphan','missing','a');seed('global-event','global',null)
 db.sqlite.exec("INSERT INTO user_access VALUES('u','[\"a\"]',NULL,'now')")
 expect(readIntegrationDeliveries(db.db,'a',authority()).deliveries.map(row=>row.id).sort()).toEqual(['allowed','global-for-a'])
 expect(()=>readIntegrationDeliveries(db.db,'b',authority())).toThrow('canal');expect(()=>readIntegrationDeliveries(db.db,null,authority())).toThrow('Escolha')
 db.sqlite.exec('DELETE FROM user_access');expect(readIntegrationDeliveries(db.db,null,authority()).deliveries).toHaveLength(6)
})
it.each(['revoke','role','station'] as const)('consulta revalida autoridade %s',change=>{
 seed('allowed');const actor=authority()
 if(change==='revoke')db.sqlite.exec('DELETE FROM sessions')
 if(change==='role')db.sqlite.exec("UPDATE users SET role='OPERATOR'")
 if(change==='station')db.sqlite.exec("INSERT INTO user_access VALUES('u',NULL,'[\"192.0.2.1\"]','now')")
 expect(()=>readIntegrationDeliveries(db.db,'a',actor)).toThrow('permissão')
})
