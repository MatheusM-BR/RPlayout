import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import {mkdtempSync,mkdirSync,renameSync,rmSync,existsSync,writeFileSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {openDatabase} from '../db/client.js'
import {sessionDigest} from './access.js'
import {rootAuthority,readRootCatalog,readRootAdd,addRootConferred,removeRootConferred} from './root-edit.js'
import {rootAddETag,rootCatalogETag} from '@rplayout/protocol'
import {listRoots} from './roots.js'
vi.mock('../config.js',async original=>({...await original<Record<string,unknown>>(),AUTH_USER:'',AUTH_PASSWORD:'',DEFAULT_ROLE:'ADMIN'}))
let db:ReturnType<typeof openDatabase>,directory:string,path:string
const request={headers:{cookie:'rplayout_session=SESSION'},ip:'127.0.0.1'}
beforeEach(()=>{db=openDatabase(':memory:');directory=mkdtempSync(join(tmpdir(),'RPlayout-roots-review-'));path=join(directory,'Programação Çãó & Ópera');mkdirSync(path);db.sqlite.exec("INSERT INTO users VALUES('u','Admin','NO_LOGIN','ADMIN',1,'now')");db.sqlite.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(sessionDigest('SESSION'),'u','2099-01-01','now')})
afterEach(()=>{db.sqlite.close();rmSync(directory,{recursive:true,force:true})})
const authority=()=>rootAuthority(db.db,request)
const add=(target=path)=>{const review=readRootAdd(db.db,target,authority());return addRootConferred(db.db,{path:target},rootAddETag(review),authority())}
it('consulta não cadastra pasta nem cria fallback; caracteres especiais preservados',async()=>{
  const fallback=join(directory,'não-criar');expect(await listRoots(db.db,fallback)).toEqual([]);expect(existsSync(fallback)).toBe(false)
  const before=readRootCatalog(db.db,authority()),review=readRootAdd(db.db,path,authority());expect(review.roots).toEqual([]);expect(review.revision).toBe(before.revision)
  const result=addRootConferred(db.db,{path,label:'Ao vivo Çãó'},rootAddETag(review),authority());expect(result.root.path).toBe(path);expect(result.root.label).toBe('Ao vivo Çãó')
  expect(db.sqlite.prepare('SELECT COUNT(*) n FROM operator_decisions').get()).toEqual({n:1})
})
it('recusa alteração cega e extras sem gravar',()=>{
  const review=readRootAdd(db.db,path,authority())
  expect(()=>addRootConferred(db.db,{path},undefined,authority())).toThrow('original obrigatória')
  expect(()=>addRootConferred(db.db,{path,enabled:true},rootAddETag(review),authority())).toThrow('extras')
  expect(readRootCatalog(db.db,authority()).roots).toHaveLength(0)
})
it('revisão compartilhada invalida same-value e ABA; prova de outra pasta é recusada',()=>{
  const initial=add(),other=join(directory,'Outra');mkdirSync(other)
  const review=readRootAdd(db.db,other,authority());db.sqlite.exec('UPDATE media_roots SET label=label')
  expect(()=>addRootConferred(db.db,{path:other},rootAddETag(review),authority())).toThrow('mudou')
  const fresh=readRootCatalog(db.db,authority());db.sqlite.exec("UPDATE media_roots SET label='Temp';UPDATE media_roots SET label='Original'")
  expect(()=>removeRootConferred(db.db,initial.root.id,{},rootCatalogETag(fresh),authority())).toThrow('mudou')
  const wrong=readRootAdd(db.db,path,authority());expect(()=>addRootConferred(db.db,{path:other},rootAddETag(wrong),authority())).toThrow('mudou')
})
it('substituição da pasta após conferência invalida identidade; pasta antiga preservada',()=>{
  const review=readRootAdd(db.db,path,authority());renameSync(path,path+' anterior');mkdirSync(path)
  expect(()=>addRootConferred(db.db,{path},rootAddETag(review),authority())).toThrow('mudou');expect(existsSync(path+' anterior')).toBe(true)
})
it('falha da auditoria reverte cadastro e remoção; última pasta e acervo preservados',()=>{
  const first=add(),other=join(directory,'Outra');mkdirSync(other);const second=add(other),asset=join(other,'vídeo.mp4');writeFileSync(asset,'ORIGINAL')
  db.sqlite.prepare("INSERT INTO media_assets(id,content_hash,path,title,kind,duration_frames,created_at) VALUES('a','FIXTURE',?,'Video','VIDEO',25,'now')").run(asset)
  const review=readRootCatalog(db.db,authority());db.sqlite.exec("CREATE TRIGGER root_audit_failure BEFORE INSERT ON operator_decisions WHEN NEW.kind IN('MEDIA_ROOT_ADDED','MEDIA_ROOT_REMOVED') BEGIN SELECT RAISE(ABORT,'AUDIT_FAILED');END")
  expect(()=>removeRootConferred(db.db,second.root.id,{},rootCatalogETag(review),authority())).toThrow('AUDIT_FAILED');expect(readRootCatalog(db.db,authority())).toEqual(review)
  const third=join(directory,'Terceira');mkdirSync(third);const proof=readRootAdd(db.db,third,authority());expect(()=>addRootConferred(db.db,{path:third},rootAddETag(proof),authority())).toThrow('AUDIT_FAILED');expect(readRootCatalog(db.db,authority())).toEqual(review)
  db.sqlite.exec('DROP TRIGGER root_audit_failure');removeRootConferred(db.db,second.root.id,{},rootCatalogETag(review),authority())
  expect(readFileSync(asset,'utf8')).toBe('ORIGINAL');expect(db.sqlite.prepare("SELECT path FROM media_assets WHERE id='a'").get()).toEqual({path:asset})
  expect(()=>removeRootConferred(db.db,first.root.id,{},rootCatalogETag(readRootCatalog(db.db,authority())),authority())).toThrow('pelo menos uma')
})
it('recusa sobreposição com pasta já cadastrada',()=>{add();const child=join(path,'Vinhetas');mkdirSync(child);expect(()=>add(child)).toThrow('sobrepõe')})
it('cadastro com sonda grava um lote dirigido rápido e sua auditoria na mesma transação',()=>{
  const review=readRootAdd(db.db,path,authority()),result=addRootConferred(db.db,{path},rootAddETag(review),authority(),true)
  expect(result.scanBatchId).toBeTruthy()
  expect(db.sqlite.prepare('SELECT id,roots,measure,state,owner_boot FROM ingest_batches').get()).toEqual({id:result.scanBatchId,roots:JSON.stringify([path]),measure:0,state:'PENDING',owner_boot:null})
  expect(db.sqlite.prepare('SELECT kind FROM operator_decisions ORDER BY kind').all()).toEqual([{kind:'MEDIA_ROOT_ADDED'},{kind:'MEDIA_SCAN_QUEUED'}])
  expect(()=>addRootConferred(db.db,{path},rootAddETag(review),authority(),true)).toThrow('mudou')
  expect(db.sqlite.prepare('SELECT COUNT(*) n FROM ingest_batches').get()).toEqual({n:1})
})
it.each(['MEDIA_ROOT_ADDED','MEDIA_SCAN_QUEUED'])('falha de %s reverte raiz, lote, ambas auditorias e contadores',kind=>{
  const review=readRootAdd(db.db,path,authority()),batchRevision=db.sqlite.prepare('SELECT version FROM scan_revision').get()
  db.sqlite.exec(`CREATE TRIGGER audit_failure BEFORE INSERT ON operator_decisions WHEN NEW.kind='${kind}' BEGIN SELECT RAISE(ABORT,'AUDIT_FAILED');END`)
  expect(()=>addRootConferred(db.db,{path},rootAddETag(review),authority(),true)).toThrow('AUDIT_FAILED')
  expect(readRootCatalog(db.db,authority()).revision).toBe(review.revision);expect(db.sqlite.prepare('SELECT version FROM scan_revision').get()).toEqual(batchRevision)
  for(const table of ['media_roots','ingest_batches','operator_decisions'])expect(db.sqlite.prepare(`SELECT COUNT(*) n FROM ${table}`).get()).toEqual({n:0})
})
it('cadastro ocupado preserva lote RUNNING incerto e enfileira somente nova raiz',()=>{
  db.sqlite.prepare("INSERT INTO ingest_batches(id,roots,measure,state,created_at,updated_at) VALUES('legacy','[]',0,'RUNNING','old','old')").run()
  const before=db.sqlite.prepare("SELECT * FROM ingest_batches WHERE id='legacy'").get(),review=readRootAdd(db.db,path,authority())
  const result=addRootConferred(db.db,{path},rootAddETag(review),authority(),true)
  expect(db.sqlite.prepare("SELECT * FROM ingest_batches WHERE id='legacy'").get()).toEqual(before)
  expect(db.sqlite.prepare('SELECT roots,state FROM ingest_batches WHERE id=?').get(result.scanBatchId)).toEqual({roots:JSON.stringify([path]),state:'PENDING'})
})
it.each(['revoke','scope','role','station'] as const)('autorização fresca recusa %s',change=>{
  const actor=authority(),review=readRootAdd(db.db,path,actor)
  if(change==='revoke')db.sqlite.exec('DELETE FROM sessions')
  if(change==='scope')db.sqlite.exec("INSERT INTO user_access VALUES('u','[\"restricted\"]',NULL,'now')")
  if(change==='role')db.sqlite.exec("UPDATE users SET role='INVALID'")
  if(change==='station')db.sqlite.exec("INSERT INTO user_access VALUES('u',NULL,'[\"192.0.2.1\"]','now')")
  expect(()=>addRootConferred(db.db,{path},rootAddETag(review),actor)).toThrow(/sessão|compartilhado/)
  expect(db.sqlite.prepare('SELECT COUNT(*) n FROM media_roots').get()).toEqual({n:0})
})
