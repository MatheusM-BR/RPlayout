import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import Database from 'better-sqlite3'
import {mkdtempSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {accountCatalogETag,accountETag,accountSessionsETag} from '@rplayout/protocol'
import {openDatabase} from '../db/client.js'
import {captureAccountAuthority,changeAccountAccess,createAccount,logoutAccount,readAccountCatalog,readAccountSessions,revokeAccountSessions,updateAccount} from './account-edit.js'
import {sessionDigest} from './access.js'
import {CollaborativeEditError} from './collaborative-edit.js'
vi.mock('../config.js',async original=>({...await original<Record<string,unknown>>(),AUTH_USER:'',AUTH_PASSWORD:'',DEFAULT_ROLE:'ADMIN'}))
let value:ReturnType<typeof openDatabase>,file:string
const connections:Database.Database[]=[]
const request={headers:{cookie:'rplayout_session=ADMIN_PRIVATE_TOKEN'},ip:'127.0.0.1'}
beforeEach(()=>{
  file=join(mkdtempSync(join(tmpdir(),'RPlayout-account-edits-')),'qa.db');value=openDatabase(file);connections.push(value.sqlite)
  for(const [id,role]of [['admin','ADMIN'],['second','ADMIN'],['target:ç','OPERATOR']])value.sqlite.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run(id,id,'HASH_PRIVATE_'+id,role,1,'original')
  value.sqlite.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(sessionDigest('ADMIN_PRIVATE_TOKEN'),'admin','2099-01-01','original')
  value.sqlite.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(sessionDigest('TARGET_PRIVATE_TOKEN'),'target:ç','2099-01-01','original')
  value.sqlite.exec("INSERT INTO channels(id,name,width,height,rate_num,rate_den,target_lufs,ceiling_dbtp,limiter_lookahead_ms,created_at) VALUES('channel','Canal',320,180,25,1,-23,-1,5,'now')")
})
afterEach(()=>{vi.restoreAllMocks();for(const db of connections.splice(0))if(db.open)db.close()})
const authority=()=>captureAccountAuthority(value.db,request)
const catalog=()=>readAccountCatalog(value.db,authority())
const sessionReview=()=>readAccountSessions(value.db,'target:ç',authority())
const state=()=>Object.fromEntries(['users','user_access','sessions','account_versions','operator_decisions','channels'].map(table=>[table,value.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]))
function status(work:()=>unknown,code:number){try{work();throw new Error('Mutation unexpectedly accepted')}catch(error){expect(error).toBeInstanceOf(CollaborativeEditError);expect((error as CollaborativeEditError).status).toBe(code)}}
const create=(proof:unknown=accountCatalogETag(catalog()))=>createAccount(value.db,{username:'Nova Çãó',password:'PRIVATE_PASSWORD',role:'OPERATOR'},'NEW_PRIVATE_HASH',proof,authority())
const update=(proof:unknown=accountETag(catalog(),'target:ç'))=>updateAccount(value.db,'target:ç',{enabled:false},undefined,proof,authority())
const access=(proof:unknown=accountETag(catalog(),'target:ç'))=>changeAccountAccess(value.db,'target:ç',{channelIds:['channel'],stationIps:['::ffff:192.168.42.10','192.168.42.10']},proof,authority())
const revoke=(proof:unknown=accountSessionsETag(sessionReview()))=>revokeAccountSessions(value.db,'target:ç',proof,authority())

describe('administração confere original e grava com auditoria atômica',()=>{
  it('consulta estável readonly não contém senha, hash ou identificador de sessão',()=>{
    const before=state(),review=catalog(),sessions=sessionReview();expect(catalog()).toEqual(review);expect(sessionReview()).toEqual(sessions);expect(state()).toEqual(before)
    const text=JSON.stringify({review,sessions});for(const secret of ['HASH_PRIVATE','PRIVATE_TOKEN',sessionDigest('TARGET_PRIVATE_TOKEN'),'passwordHash','token'])expect(text).not.toContain(secret)
    expect(sessions.sessions).toEqual([{createdAt:'original',expiresAt:'2099-01-01'}]);expect(review.canCreate).toBe(true)
  })
  it.each(['CREATE','UPDATE','ACCESS','REVOKE'])('%s recusa gravação cega',kind=>{
    const before=state(),captured=authority();status(()=>kind==='CREATE'?createAccount(value.db,{username:'Blind',password:'PASSWORD',role:'OPERATOR'},'hash',undefined,captured):kind==='UPDATE'?updateAccount(value.db,'target:ç',{enabled:false},undefined,undefined,captured):kind==='ACCESS'?changeAccountAccess(value.db,'target:ç',{channelIds:null,stationIps:null},undefined,captured):revokeAccountSessions(value.db,'target:ç',undefined,captured),428);expect(state()).toEqual(before)
  })
  it.each(['*','W/"1"','"accounts:user:target%3A%C3%A7:0:1"','"accounts:user:target%3A%C3%A7:1:9007199254740992"','"accounts:user:%GG:1:1"','"accounts:user:other:1:1"'])('prova parcial/estrangeira/insegura %s não autoriza edição',proof=>{const before=state();status(()=>update(proof),400);expect(state()).toEqual(before)})
  it('uma conferência tem vencedor único, nome Unicode e resposta não contém segredos',()=>{
    const proof=accountCatalogETag(catalog()),saved=create(proof),after=state();status(()=>create(proof),409);expect(state()).toEqual(after)
    expect(saved).toMatchObject({applied:true,canCreate:true,requiresLogin:false,user:{username:'Nova Çãó'}});expect(JSON.stringify(saved)).not.toContain('PRIVATE')
    expect(value.sqlite.prepare("SELECT count(*) n FROM operator_decisions WHERE kind='USER_CREATED'").get()).toEqual({n:1})
  })
  it.each(['users-same','users-aba','policy-same','policy-aba'])('prova original é invalidada por %s',change=>{
    if(change.startsWith('policy'))value.sqlite.exec("INSERT INTO user_access VALUES('target:ç',NULL,NULL,'original')")
    const proof=accountETag(catalog(),'target:ç')
    value.sqlite.exec(change==='users-same'?"UPDATE users SET role=role WHERE id='target:ç'":change==='users-aba'?"UPDATE users SET role='SUPERVISOR' WHERE id='target:ç';UPDATE users SET role='OPERATOR' WHERE id='target:ç'":change==='policy-same'?"UPDATE user_access SET channel_ids=channel_ids WHERE user_id='target:ç'":"UPDATE user_access SET channel_ids='[]' WHERE user_id='target:ç';UPDATE user_access SET channel_ids=NULL WHERE user_id='target:ç'")
    const before=state();status(()=>update(proof),409);expect(state()).toEqual(before)
  })
  it('mudança em outro admin invalida prova de último admin; login não invalida rascunho de conta',()=>{
    const original=catalog();value.sqlite.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run('another-login','target:ç','2099-01-01','now')
    expect(accountETag(catalog(),'target:ç')).toBe(accountETag(original,'target:ç'))
    value.sqlite.exec("UPDATE users SET enabled=0 WHERE id='second'");const before=state()
    status(()=>updateAccount(value.db,'admin',{enabled:false},undefined,accountETag(original,'admin'),authority()),409);expect(state()).toEqual(before)
  })
  it.each(['new-session','same-session','session-aba','account-aba'])('conferência de sessões detecta %s sem revogar a lista nova',change=>{
    const proof=accountSessionsETag(sessionReview())
    value.sqlite.exec(change==='new-session'?"INSERT INTO sessions VALUES('another','target:ç','2099-01-01','now')":change==='same-session'?"UPDATE sessions SET expires_at=expires_at WHERE user_id='target:ç'":change==='session-aba'?"UPDATE sessions SET expires_at='2000-01-01' WHERE user_id='target:ç';UPDATE sessions SET expires_at='2099-01-01' WHERE user_id='target:ç'":"UPDATE users SET role='SUPERVISOR' WHERE id='target:ç';UPDATE users SET role='OPERATOR' WHERE id='target:ç'")
    const before=state();status(()=>revoke(proof),409);expect(state()).toEqual(before)
  })
  it('revogação vazia consome prova sem fingir sessões ativas; preserva conta',()=>{
    value.sqlite.exec("DELETE FROM sessions WHERE user_id='target:ç'");const proof=accountSessionsETag(sessionReview()),user=value.sqlite.prepare("SELECT * FROM users WHERE id='target:ç'").get()
    expect(revoke(proof)).toMatchObject({applied:true,revokedCount:0});const before=state();status(()=>revoke(proof),409);expect(state()).toEqual(before);expect(value.sqlite.prepare("SELECT * FROM users WHERE id='target:ç'").get()).toEqual(user)
  })
  it('edição de perfil e acesso revogam só sessões do alvo; endereço é normalizado explicitamente',()=>{
    const saved=access();expect(saved.users.find(user=>user.id==='target:ç')).toMatchObject({channelIds:['channel'],stationIps:['192.168.42.10']});expect(value.sqlite.prepare('SELECT user_id FROM sessions').all()).toEqual([{user_id:'admin'}])
    updateAccount(value.db,'target:ç',{password:'PRIVATE_PASSWORD'},'REPLACED_PRIVATE_HASH',accountETag(catalog(),'target:ç'),authority())
    const account=value.sqlite.prepare("SELECT password_hash,role,enabled FROM users WHERE id='target:ç'").get();expect(account).toEqual({password_hash:'REPLACED_PRIVATE_HASH',role:'OPERATOR',enabled:1})
    expect(JSON.stringify(value.sqlite.prepare('SELECT payload FROM operator_decisions').all())).not.toContain('PRIVATE')
  })
  it.each(['CREATE','UPDATE','ACCESS','REVOKE','LOGOUT'])('falha na auditoria %s reverte dados/sessões/revisões',kind=>{
    const proof=kind==='CREATE'?accountCatalogETag(catalog()):kind==='REVOKE'?accountSessionsETag(sessionReview()):accountETag(catalog(),'target:ç'),before=state()
    value.sqlite.exec("CREATE TRIGGER account_audit_failure BEFORE INSERT ON operator_decisions BEGIN SELECT RAISE(ABORT,'ACCOUNT_AUDIT_FIXTURE'); END")
    expect(()=>kind==='CREATE'?create(proof):kind==='UPDATE'?update(proof):kind==='ACCESS'?access(proof):kind==='REVOKE'?revoke(proof):logoutAccount(value.db,request)).toThrow();expect(state()).toEqual(before)
    value.sqlite.exec('DROP TRIGGER account_audit_failure')
    if(kind==='CREATE')create(proof);else if(kind==='UPDATE')update(proof);else if(kind==='ACCESS')access(proof);else if(kind==='REVOKE')revoke(proof);else logoutAccount(value.db,request)
  })
  it.each(['disabled','role','station','channel','revoked'])('autoridade capturada é reconferida no commit: %s',change=>{
    const captured=authority(),proof=accountCatalogETag(catalog())
    value.sqlite.exec(change==='disabled'?"UPDATE users SET enabled=0 WHERE id='admin'":change==='role'?"UPDATE users SET role='OPERATOR' WHERE id='admin'":change==='station'?"INSERT INTO user_access VALUES('admin',NULL,'[\"192.168.42.50\"]','now')":change==='channel'?"INSERT INTO user_access VALUES('admin','[]',NULL,'now')":"DELETE FROM sessions WHERE user_id='admin'")
    const before=state();status(()=>createAccount(value.db,{username:'Denied',password:'PASSWORD',role:'ADMIN'},'hash',proof,captured),403);expect(state()).toEqual(before)
  })
  it.each(['empty','invalid-ip','restricted-channel','disabled'])('outro admin %s não justifica remover o último acessível',kind=>{
    if(kind==='disabled')value.sqlite.exec("UPDATE users SET enabled=0 WHERE id='second'")
    else value.sqlite.prepare('INSERT INTO user_access VALUES(?,?,?,?)').run('second',kind==='restricted-channel'?'[]':null,kind==='empty'?'[]':kind==='invalid-ip'?'["not-an-ip"]':null,'now')
    const before=state();status(()=>updateAccount(value.db,'admin',{enabled:false},undefined,accountETag(catalog(),'admin'),authority()),409);expect(state()).toEqual(before)
  })
  it('não promove conta restrita nem permite autoremover estação; valida canais dentro do lock',()=>{
    access();const before=state();status(()=>updateAccount(value.db,'target:ç',{role:'ADMIN'},undefined,accountETag(catalog(),'target:ç'),authority()),409)
    status(()=>changeAccountAccess(value.db,'admin',{channelIds:null,stationIps:['192.168.42.99']},accountETag(catalog(),'admin'),authority()),409)
    status(()=>changeAccountAccess(value.db,'target:ç',{channelIds:['gone'],stationIps:null},accountETag(catalog(),'target:ç'),authority()),400);expect(state()).toEqual(before)
  })
  it('logout idempotente só remove sua sessão e não registra segredo',()=>{
    logoutAccount(value.db,request);const after=state();logoutAccount(value.db,request);expect(state()).toEqual(after)
    expect(value.sqlite.prepare('SELECT user_id FROM sessions').all()).toEqual([{user_id:'target:ç'}]);expect(JSON.stringify(value.sqlite.prepare('SELECT payload FROM operator_decisions').all())).not.toContain('PRIVATE_TOKEN')
  })
  it('IMMEDIATE precede primeira leitura de autoridade; segundo escritor está bloqueado',()=>{
    const captured=authority(),proof=accountCatalogETag(catalog()),second=new Database(file,{timeout:0});connections.push(second)
    const prepare=value.sqlite.prepare.bind(value.sqlite);let locked=false
    vi.spyOn(value.sqlite,'prepare').mockImplementation(((query:string)=>{
      if(query.includes('FROM sessions s')&&!locked){expect(value.sqlite.inTransaction).toBe(true);expect(()=>second.exec("UPDATE users SET role=role WHERE id='admin'")).toThrow(/locked/);locked=true}
      return prepare(query)
    }) as typeof value.sqlite.prepare)
    createAccount(value.db,{username:'Lock',password:'PASSWORD',role:'OPERATOR'},'hash',proof,captured);expect(locked).toBe(true)
  })
})
