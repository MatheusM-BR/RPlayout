import {beforeEach,afterEach,expect,it,vi} from 'vitest'
import {openDatabase} from '../db/client.js'
import {sessions,operatorDecisions} from '../db/schema.js'
import {expireSessions} from './session-expiry.js'
import {AccessControl,sessionDigest} from './access.js'
vi.mock('../config.js',async original=>({...await original<Record<string,unknown>>(),AUTH_USER:'',AUTH_PASSWORD:'',DEFAULT_ROLE:'ADMIN'}))
let value:ReturnType<typeof openDatabase>
const at='2026-10-10T12:00:00.000Z'
beforeEach(()=>{
  value=openDatabase(':memory:');vi.useFakeTimers();vi.setSystemTime(new Date(at))
  value.sqlite.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run('u','Usuário Çãó','NO_LOGIN','ADMIN',1,'2026-10-10T00:00:00.000Z')
})
afterEach(()=>{vi.useRealTimers();value.sqlite.close()})
function session(token:string,expiry:string){value.db.insert(sessions).values({token:sessionDigest(token),userId:'u',expiresAt:expiry,createdAt:'2026-10-10T00:00:00.000Z'}).run()}
const identity=(token:string)=>new AccessControl(value.sqlite).identity({headers:{cookie:'rplayout_session='+token},ip:'127.0.0.1'})
it.each(['zzz','2026-10-10T12:00:00.000Z','2026-10-10T13:00:00+02:00'])('sessão %s é recusada sem escrever durante consulta',expiry=>{
  session('expired-token',expiry);expect(identity('expired-token')).toBeNull()
  expect(value.db.select().from(sessions).all()).toHaveLength(1)
  expect(value.db.select().from(operatorDecisions).all()).toEqual([])
})
it('validade com fuso não é recusada por ordenação textual; nunca amplia papel ou canal',()=>{
  session('valid','2026-10-10T11:30:00-02:00')
  value.sqlite.prepare('INSERT INTO user_access VALUES(?,?,?,?)').run('u','["a"]','["127.0.0.1"]',at)
  expect(identity('valid')).toMatchObject({role:'ADMIN',channelIds:['a'],stationIps:['127.0.0.1']})
  expect(new AccessControl(value.sqlite).channelAllowed({headers:{cookie:'rplayout_session=valid'},ip:'127.0.0.1'},'b')).toBe(false)
})
it('expiração audita uma vez e preserva válidas, sem token ou digest no payload',()=>{
  session('expired','2026-10-10T11:00:00.000Z');session('invalid','zzz');session('valid','2026-10-10T11:30:00-02:00')
  expect(expireSessions(value.db,at)).toBe(2);expect(expireSessions(value.db,at)).toBe(0)
  expect(value.db.select().from(sessions).all()).toHaveLength(1)
  const audit=value.db.select().from(operatorDecisions).all()
  expect(audit).toHaveLength(2);expect(audit.every(row=>row.kind==='SESSION_EXPIRED'&&row.actorUsername==='Usuário Çãó')).toBe(true)
  expect(audit.some(row=>(row.payload as any).invalidExpiration)).toBe(true)
  for(const token of ['expired','invalid','valid'])expect(JSON.stringify(audit)).not.toContain(sessionDigest(token))
})
it('falha de auditoria reverte limpeza; retry e outra conexão não duplicam sessão expirada',()=>{
  session('expired','2026-10-10T11:00:00.000Z')
  value.sqlite.exec("CREATE TRIGGER expiry_audit_failure BEFORE INSERT ON operator_decisions WHEN NEW.kind='SESSION_EXPIRED' BEGIN SELECT RAISE(ABORT,'AUDIT_UNAVAILABLE'); END")
  expect(()=>expireSessions(value.db,at)).toThrow('AUDIT_UNAVAILABLE')
  expect(value.db.select().from(sessions).all()).toHaveLength(1)
  value.sqlite.exec('DROP TRIGGER expiry_audit_failure');expect(expireSessions(value.db,at)).toBe(1);expect(expireSessions(value.db,at)).toBe(0)
  expect(value.db.select().from(operatorDecisions).all()).toHaveLength(1)
})
it('lote limitado drena sem bloquear limpeza indefinidamente',()=>{
  for(let i=0;i<3;i++)session('expired-'+i,'2026-10-10T11:00:00.000Z')
  expect(expireSessions(value.db,at,2)).toBe(2);expect(expireSessions(value.db,at,2)).toBe(1)
  expect(()=>expireSessions(value.db,'zzz')).toThrow('inválidos')
  expect(()=>expireSessions(value.db,at,1001)).toThrow('inválidos')
})
