import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {openDatabase} from '../db/client.js'
import {issueLoginSession} from './login-session.js'
import {sessionDigest,AccessControl} from './access.js'
import {CollaborativeEditError} from './collaborative-edit.js'
vi.mock('../config.js',async original=>({...await original<Record<string,unknown>>(),AUTH_USER:'',AUTH_PASSWORD:'',DEFAULT_ROLE:'ADMIN'}))
let database:ReturnType<typeof openDatabase>
const verified={id:'user',username:'user',passwordHash:'verified-password-hash-placeholder-not-a-password'}
beforeEach(()=>{
  database=openDatabase(':memory:')
  database.sqlite.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run(verified.id,verified.username,verified.passwordHash,'ADMIN',1,'2026-10-05')
})
afterEach(()=>{database.sqlite.close();vi.restoreAllMocks()})
const state=()=>({sessions:database.sqlite.prepare('SELECT * FROM sessions').all(),audit:database.sqlite.prepare('SELECT * FROM operator_decisions').all()})
function rejected(status:number){
  const before=state()
  try{issueLoginSession(database.db,verified,'127.0.0.1');throw new Error('Expected rejection')}
  catch(error){expect(error).toBeInstanceOf(CollaborativeEditError);expect((error as CollaborativeEditError).status).toBe(status)}
  expect(state()).toEqual(before)
}
describe('sessão vincula a senha verificada à conta fresca e auditoria atômica',()=>{
  it('grava somente hash de token, auditoria sem segredo e prazo de 12h',()=>{
    const started=Date.now(),issued=issueLoginSession(database.db,verified,'127.0.0.1'),finished=Date.now()
    expect(issued.role).toBe('ADMIN');expect(issued.token.length).toBe(72)
    expect(Date.parse(issued.expiresAt)).toBeGreaterThanOrEqual(started+43_200_000)
    expect(Date.parse(issued.expiresAt)).toBeLessThanOrEqual(finished+43_200_000)
    expect(database.sqlite.prepare('SELECT token FROM sessions').get()).toEqual({token:sessionDigest(issued.token)})
    const recorded=JSON.stringify(state())
    expect(recorded).toContain('SESSION_CREATED');expect(recorded).not.toContain(issued.token);expect(recorded).not.toContain(verified.passwordHash)
    expect(new AccessControl(database.sqlite).identity({headers:{cookie:`rplayout_session=${issued.token}`}})).toMatchObject({id:'user',role:'ADMIN'})
  })
  it.each(['disabled','deleted','renamed','password','invalidRole'])('recusa conta alterada após verificação: %s',change=>{
    if(change==='disabled')database.sqlite.prepare('UPDATE users SET enabled=0').run()
    if(change==='deleted')database.sqlite.prepare('DELETE FROM users').run()
    if(change==='renamed')database.sqlite.prepare("UPDATE users SET username='other'").run()
    if(change==='password')database.sqlite.prepare("UPDATE users SET password_hash='new-not-verified-hash'").run()
    if(change==='invalidRole')database.sqlite.prepare("UPDATE users SET role='VIEWER'").run()
    rejected(401)
  })
  it('autoridade é consultada dentro da transação, não antes de aguardar lock',()=>{
    const transaction=database.db.transaction.bind(database.db)
    vi.spyOn(database.db,'transaction').mockImplementation(((callback:any,config:any)=>{
      database.sqlite.prepare("UPDATE users SET role='VIEWER'").run()
      return transaction(callback,config)
    }) as typeof database.db.transaction)
    rejected(401)
  })
  it('mudança válida de papel concede somente o papel atual',()=>{
    database.sqlite.prepare("UPDATE users SET role='OPERATOR'").run()
    const issued=issueLoginSession(database.db,verified,'127.0.0.1')
    expect(issued.role).toBe('OPERATOR')
    expect(new AccessControl(database.sqlite).identity({headers:{cookie:`rplayout_session=${issued.token}`}})?.role).toBe('OPERATOR')
  })
  it.each(['station','malformed'])('política atual %s impede emissão sem efeitos parciais',change=>{
    database.sqlite.prepare('INSERT INTO user_access VALUES(?,?,?,?)').run('user',null,change==='station'?'["192.0.2.1"]':'{}','now')
    rejected(403)
  })
  it('normaliza IPv4 mapeado para a lista de estações permitidas',()=>{
    database.sqlite.prepare('INSERT INTO user_access VALUES(?,?,?,?)').run('user',null,'["127.0.0.1"]','now')
    expect(issueLoginSession(database.db,verified,'::ffff:127.0.0.1').role).toBe('ADMIN')
  })
  it('falha real na auditoria reverte a sessão recém-inserida',()=>{
    database.sqlite.exec("CREATE TRIGGER login_audit_failure BEFORE INSERT ON operator_decisions WHEN NEW.kind='SESSION_CREATED' BEGIN SELECT RAISE(ABORT,'SESSION_AUDIT_FAILURE'); END")
    const before=state()
    expect(()=>issueLoginSession(database.db,verified,'127.0.0.1')).toThrow('SESSION_AUDIT_FAILURE')
    expect(state()).toEqual(before)
  })
})
