import {afterEach,beforeEach,it,expect,vi} from 'vitest'
import {randomUUID} from 'node:crypto'
import {openDatabase} from '../db/client.js'
import {integrationAuthority,readIntegrationCatalog,readIntegration,createIntegration,updateIntegration,queueIntegrationTest,readIntegrationDelivery,retryIntegrationDelivery} from './integration-edit.js'
import {integrationCatalogETag,integrationETag,integrationDeliveryETag} from '@rplayout/protocol'
import {sessionDigest} from './access.js'
vi.mock('../config.js',async original=>({...await original<Record<string,unknown>>(),AUTH_USER:'',AUTH_PASSWORD:'',DEFAULT_ROLE:'ADMIN'}))
let db:ReturnType<typeof openDatabase>
const request={headers:{cookie:'rplayout_session=SESSION'},ip:'127.0.0.1'},input={channelId:null,name:'Gateway',url:'https://example.test/PRIVATE?token=SECRET',events:['source.lost']}
beforeEach(()=>{db=openDatabase(':memory:');db.sqlite.exec("INSERT INTO users VALUES('u','Admin','NO_LOGIN','ADMIN',1,'now')");db.sqlite.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(sessionDigest('SESSION'),'u','2099-01-01','now')})
afterEach(()=>db.sqlite.close())
const authority=()=>integrationAuthority(db.db,request)
const create=()=>{const review=readIntegrationCatalog(db.db,null,authority());return createIntegration(db.db,input,integrationCatalogETag(review),authority()).integration.id}
it('conferência privada não grava e mutadores cegos/extras recusam sem segredos na auditoria',()=>{
  const review=readIntegrationCatalog(db.db,null,authority());expect(db.sqlite.prepare('SELECT COUNT(*) n FROM integrations').get()).toEqual({n:0})
  expect(()=>createIntegration(db.db,input,undefined,authority())).toThrow('original obrigatória')
  expect(()=>createIntegration(db.db,{...input,enabled:true},integrationCatalogETag(review),authority())).toThrow('extras')
  const id=create(),details=readIntegration(db.db,id,authority());expect(details.url).toBe('https://example.test/REDACTED')
  expect(JSON.stringify(db.sqlite.prepare('SELECT payload FROM operator_decisions').all())).not.toMatch(/PRIVATE|SECRET/)
  expect(()=>updateIntegration(db.db,id,{enabled:true},undefined,authority())).toThrow('original obrigatória')
})
it('same-value e ABA invalidam a edição original; URL vazia não substitui segredo',()=>{
  const id=create(),review=readIntegration(db.db,id,authority())
  db.sqlite.exec('UPDATE integrations SET enabled=enabled')
  expect(()=>updateIntegration(db.db,id,{enabled:true},integrationETag(review),authority())).toThrow('mudou')
  const current=readIntegration(db.db,id,authority());db.sqlite.exec('UPDATE integrations SET enabled=1;UPDATE integrations SET enabled=0')
  expect(()=>updateIntegration(db.db,id,{name:'Novo'},integrationETag(current),authority())).toThrow('mudou')
})
it('teste é durável, deduplicado e audita sem enviar rede ou mudar configuração',()=>{
  const id=create(),review=readIntegration(db.db,id,authority()),actor=authority(),body={requestId:randomUUID()},fetchMock=vi.fn();vi.stubGlobal('fetch',fetchMock)
  try{
    const first=queueIntegrationTest(db.db,id,body,integrationETag(review),actor),again=queueIntegrationTest(db.db,id,body,integrationETag(review),actor)
    expect(again.deliveryId).toBe(first.deliveryId);expect(again.deduplicated).toBe(true);expect(fetchMock).not.toHaveBeenCalled()
    expect(db.sqlite.prepare('SELECT state,manual_test FROM integration_deliveries').all()).toEqual([{state:'QUEUED',manual_test:1}]);expect(readIntegration(db.db,id,actor).revision).toBe(review.revision)
    expect(JSON.stringify(db.sqlite.prepare('SELECT target,payload FROM integration_deliveries').all())).not.toMatch(/PRIVATE|SECRET/)
    expect(()=>queueIntegrationTest(db.db,id,{...body,target:'http://elsewhere'},integrationETag(review),actor)).toThrow('extras')
  }finally{vi.unstubAllGlobals()}
})
it('falha de auditoria reverte configuração e teste antes de qualquer rede',()=>{
  const id=create(),review=readIntegration(db.db,id,authority())
  db.sqlite.exec("CREATE TRIGGER fail_integration_audit BEFORE INSERT ON operator_decisions WHEN NEW.kind IN('INTEGRATION_CHANGED','INTEGRATION_TEST_QUEUED') BEGIN SELECT RAISE(ABORT,'AUDIT_FAILED'); END")
  expect(()=>updateIntegration(db.db,id,{enabled:true},integrationETag(review),authority())).toThrow('AUDIT_FAILED');expect(readIntegration(db.db,id,authority())).toEqual(review)
  expect(()=>queueIntegrationTest(db.db,id,{requestId:randomUUID()},integrationETag(review),authority())).toThrow('AUDIT_FAILED');expect(db.sqlite.prepare('SELECT COUNT(*) n FROM integration_deliveries').get()).toEqual({n:0})
})
it('reenvio exige prova, estado terminal e destino original sem tomar SENDING',()=>{
  const id=create(),config=readIntegration(db.db,id,authority()),queued=queueIntegrationTest(db.db,id,{requestId:randomUUID()},integrationETag(config),authority())
  db.sqlite.prepare("UPDATE integration_deliveries SET state='FAILED',last_error='Envio legado sem responsável identificável. Confirme o encerramento anterior antes de solicitar reenvio.'").run()
  const review=readIntegrationDelivery(db.db,queued.deliveryId,authority())
  expect(review.canRetry).toBe(false);expect(review.diagnostic.ownership).toBe('UNKNOWN')
  expect(()=>retryIntegrationDelivery(db.db,queued.deliveryId,{},integrationDeliveryETag(review),authority())).toThrow('encerramento')
  expect(()=>retryIntegrationDelivery(db.db,queued.deliveryId,{confirmedPreviousStopped:true},integrationDeliveryETag(review),authority())).toThrow('inconclusiva')
  db.sqlite.exec("UPDATE integration_deliveries SET last_error='Destino respondeu HTTP 503.'")
  const terminal=readIntegrationDelivery(db.db,queued.deliveryId,authority())
  retryIntegrationDelivery(db.db,queued.deliveryId,{},integrationDeliveryETag(terminal),authority())
  expect(()=>retryIntegrationDelivery(db.db,queued.deliveryId,{},integrationDeliveryETag(review),authority())).toThrow('mudou')
  db.sqlite.prepare("UPDATE integration_deliveries SET state='SENDING'").run()
  const running=readIntegrationDelivery(db.db,queued.deliveryId,authority());expect(running.canRetry).toBe(false)
  expect(()=>retryIntegrationDelivery(db.db,queued.deliveryId,{confirmedPreviousStopped:true},integrationDeliveryETag(running),authority())).toThrow('ativa')
})
it.each(['revoke','scope','role','station'] as const)('autorização fresca recusa %s e não duplica teste aceito',change=>{
  const id=create(),review=readIntegration(db.db,id,authority()),actor=authority(),body={requestId:randomUUID()}
  queueIntegrationTest(db.db,id,body,integrationETag(review),actor)
  if(change==='revoke')db.sqlite.exec('DELETE FROM sessions')
  if(change==='scope')db.sqlite.exec("INSERT INTO user_access VALUES('u','[\"restricted\"]',NULL,'now')")
  if(change==='role')db.sqlite.exec("UPDATE users SET role='OPERATOR'")
  if(change==='station')db.sqlite.exec("INSERT INTO user_access VALUES('u',NULL,'[\"192.0.2.1\"]','now')")
  expect(()=>queueIntegrationTest(db.db,id,body,integrationETag(review),actor)).toThrow(/permissão|escopo/)
  expect(db.sqlite.prepare('SELECT COUNT(*) n FROM integration_deliveries').get()).toEqual({n:1})
})
