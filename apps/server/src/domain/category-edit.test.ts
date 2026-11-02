import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import {openDatabase} from '../db/client.js'
import {categoryAuthority,readCategory,editCategory} from './category-edit.js'
import {categoryETag} from '@rplayout/protocol'
import {sessionDigest} from './access.js'
vi.mock('../config.js',async original=>({...await original<Record<string,unknown>>(),AUTH_USER:'',AUTH_PASSWORD:'',DEFAULT_ROLE:'ADMIN'}))
let db:ReturnType<typeof openDatabase>
const request={headers:{cookie:'rplayout_session=SESSION'},ip:'127.0.0.1'},id='AÇÃO Çãó'
beforeEach(()=>{
  db=openDatabase(':memory:')
  db.sqlite.exec("INSERT INTO users VALUES('u','Admin','NO_LOGIN','ADMIN',1,'now')")
  db.sqlite.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(sessionDigest('SESSION'),'u','2099-01-01','now')
  db.sqlite.prepare("INSERT INTO media_assets(id,content_hash,path,title,kind,duration_frames,category_id,created_at) VALUES('a','PRIVATE_HASH','PRIVATE_PATH','PRIVATE_TITLE','VIDEO',25,?,'now')").run(id)
})
afterEach(()=>db.sqlite.close())
const authority=()=>categoryAuthority(db.db,request)
const review=()=>readCategory(db.db,id,authority())
const set=(tag:unknown,color='#112233')=>editCategory(db.db,id,'SET',{color},tag,authority())
it('conferência somente pública sem criar categoria e cor padrão para vínculo implícito',()=>{
  const before=db.sqlite.prepare('SELECT * FROM category_revision').get(),value=review()
  expect(value).toMatchObject({id,color:'#5570ab',items:1,stored:false,canEdit:true})
  expect(JSON.stringify(value)).not.toContain('PRIVATE');expect(db.sqlite.prepare('SELECT * FROM category_revision').get()).toEqual(before)
  expect(db.sqlite.prepare('SELECT COUNT(*) n FROM categories').get()).toEqual({n:0})
})
it('recusa alteração cega e prova de outra categoria/operação',()=>{
  expect(()=>set(undefined)).toThrow('original obrigatória')
  for(const proof of ['"category:outro:1"','"asset-metadata:a:1"'])expect(()=>set(proof)).toThrow('Conferência inválida')
  expect(db.sqlite.prepare('SELECT COUNT(*) n FROM categories').get()).toEqual({n:0})
})
it('gravação, same-value, ABA e vínculo de mídia invalidam a prova antiga',()=>{
  let value=review();set(categoryETag(value));expect(()=>set(categoryETag(value))).toThrow('mudaram')
  value=review();db.sqlite.prepare('UPDATE categories SET color=color').run();expect(()=>set(categoryETag(value))).toThrow('mudaram')
  value=review();db.sqlite.exec("UPDATE categories SET color='#ffffff';UPDATE categories SET color='#112233'");expect(()=>set(categoryETag(value))).toThrow('mudaram')
  value=review();db.sqlite.prepare('UPDATE media_assets SET category_id=category_id').run();expect(()=>set(categoryETag(value))).toThrow('mudaram')
})
it('remoção implícita libera só seus vínculos e audita atomicamente sem apagar arquivos',()=>{
  const value=review(),result=editCategory(db.db,id,'DELETE',{},categoryETag(value),authority())
  expect(result).toMatchObject({applied:true,soltos:1,items:0,stored:false,automaticTake:false})
  expect(db.sqlite.prepare('SELECT path,category_id FROM media_assets').get()).toEqual({path:'PRIVATE_PATH',category_id:null})
  expect(db.sqlite.prepare("SELECT COUNT(*) n FROM operator_decisions WHERE kind='CATEGORY_REMOVED'").get()).toEqual({n:1})
})
it('falha de auditoria reverte cor, vínculo e contador',()=>{
  const value=review();set(categoryETag(value));const before=review()
  db.sqlite.exec("CREATE TRIGGER fail_category_audit BEFORE INSERT ON operator_decisions WHEN NEW.kind='CATEGORY_REMOVED' BEGIN SELECT RAISE(ABORT,'AUDIT_FAILURE');END")
  expect(()=>editCategory(db.db,id,'DELETE',{},categoryETag(before),authority())).toThrow('AUDIT_FAILURE')
  expect(review()).toEqual(before);expect(db.sqlite.prepare('SELECT category_id FROM media_assets').get()).toEqual({category_id:id})
})
it.each(['revoke','role','channels','station'] as const)('autorização fresca recusa %s após capturar prova',change=>{
  const actor=authority(),value=readCategory(db.db,id,actor)
  if(change==='revoke')db.sqlite.exec('DELETE FROM sessions')
  if(change==='role')db.sqlite.exec("UPDATE users SET role='UNRECOGNIZED'")
  if(change==='channels')db.sqlite.exec("INSERT INTO user_access VALUES('u','[\"a\"]',NULL,'now')")
  if(change==='station')db.sqlite.exec("INSERT INTO user_access VALUES('u',NULL,'[\"192.0.2.1\"]','now')")
  expect(()=>editCategory(db.db,id,'SET',{color:'#112233'},categoryETag(value),actor)).toThrow(/sessão|compartilhadas/)
  expect(db.sqlite.prepare('SELECT COUNT(*) n FROM categories').get()).toEqual({n:0})
})
it('campos extras, cor inválida e force não alteram categorias',()=>{
  const tag=categoryETag(review())
  for(const body of [{color:'#ffffff',force:true},{color:'red'},{color:'#ffffff',id:'other'}])expect(()=>editCategory(db.db,id,'SET',body,tag,authority())).toThrow('somente')
})
