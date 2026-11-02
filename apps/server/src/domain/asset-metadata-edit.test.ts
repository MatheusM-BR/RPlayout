import {mkdtempSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {assetMetadataETag,qcAssetETag} from '@rplayout/protocol'
import {openDatabase} from '../db/client.js'
import {captureAssetMetadataAuthority,readAssetMetadata,editAssetMetadata} from './asset-metadata-edit.js'
import {sessionDigest} from './access.js'
vi.mock('../config.js',async original=>({...await original<Record<string,unknown>>(),AUTH_USER:'',AUTH_PASSWORD:'',DEFAULT_ROLE:'ADMIN'}))
let value:ReturnType<typeof openDatabase>
const id='asset:ç',request={headers:{cookie:'rplayout_session=PRIVATE_ADMIN'},ip:'127.0.0.1'}
function seed(){
  value.sqlite.exec("INSERT INTO users VALUES('admin','Admin','PRIVATE_HASH','ADMIN',1,'now'); INSERT INTO users VALUES('other-admin','Other','HASH','ADMIN',1,'now')")
  value.sqlite.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(sessionDigest('PRIVATE_ADMIN'),'admin','2099-01-01','now')
  for(const assetId of [id,'other'])value.sqlite.prepare('INSERT INTO media_assets(id,content_hash,path,title,kind,duration_frames,category_id,qc_status,qc_notes,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(assetId,'PRIVATE_CONTENT_HASH',assetId===id?'C:/PRIVATE_FOLDER/test.mp4':'C:/PRIVATE_FOLDER/other.mp4','Título Çãó','VIDEO',250,'Notícias','BLOCKED','PRIVATE_QC_NOTES','now')
}
beforeEach(()=>{value=openDatabase(':memory:');seed()})
afterEach(()=>{value.sqlite.close();vi.restoreAllMocks()})
const authority=()=>captureAssetMetadataAuthority(value.db,request)
const read=(assetId=id)=>readAssetMetadata(value.db,assetId,authority())
const header=()=>assetMetadataETag(read())
const state=()=>Object.fromEntries(['media_assets','qc_review_versions','qc_decisions','editorial_revision_counters','channel_project_versions','operator_decisions'].map(table=>[table,value.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]))
const write=(body:unknown={title:'Edição nova'},proof:unknown=header(),actor=authority())=>editAssetMetadata(value.db,id,body,proof,actor)

describe('metadata usa counter real do ativo, com prova distinta do QC',()=>{
  it('consulta estável não grava nem expõe arquivo/hash/notas de QC',()=>{
    const before=state(),original=read();expect(read()).toEqual(original);expect(state()).toEqual(before)
    expect(original).toMatchObject({assetId:id,title:'Título Çãó',categoryId:'Notícias',canEdit:true})
    for(const secret of ['PRIVATE','path','contentHash','qcNotes'])expect(JSON.stringify(original)).not.toContain(secret)
  })
  it.each([undefined,'*','W/"1"','"asset-metadata:other:1"','"asset-metadata:asset%3A%C3%A7:0"','"asset-metadata:asset%3A%C3%A7:01"','"asset-metadata:asset%3A%C3%A7:9007199254740992"','"asset-metadata:%XX:1"',[]])('recusa prova ausente/malformada %s',proof=>{
    const before=state();expect(()=>editAssetMetadata(value.db,id,{title:'Nunca'},proof,authority())).toThrow();expect(state()).toEqual(before)
  })
  it('prova de QC não autoriza metadata nem metadata aprova conteúdo',()=>{
    const original=read(),before=state();expect(()=>write({title:'Nunca'},qcAssetETag(id,original.revision))).toThrow('outro');expect(state()).toEqual(before)
    const result=write({title:'  AÇÃO Çãó  ',categoryId:'  Esportes  '});expect(result).toMatchObject({title:'AÇÃO Çãó',categoryId:'Esportes',applied:true,automaticTake:false})
    expect(result.revision).toBe(original.revision+1);expect(result.eTag).toBe(assetMetadataETag(result))
    expect(value.sqlite.prepare('SELECT qc_status,ignored,content_hash,path FROM media_assets WHERE id=?').get(id)).toEqual({qc_status:'BLOCKED',ignored:0,content_hash:'PRIVATE_CONTENT_HASH',path:'C:/PRIVATE_FOLDER/test.mp4'});expect(value.sqlite.prepare('SELECT * FROM qc_decisions').all()).toEqual([])
  })
  it('PATCH parcial preserva metadata não enviada; remover categoria é explícito',()=>{
    expect(write({categoryId:null})).toMatchObject({title:'Título Çãó',categoryId:null});expect(write({title:'Título final'})).toMatchObject({title:'Título final',categoryId:null})
  })
  it.each([{}, {title:'   '},{categoryId:''},{title:'a'.repeat(513)},{categoryId:'a'.repeat(129)},{ignored:true},{title:'X',qcStatus:'APPROVED'},{title:'X',path:'forged'},{title:'X',contentHash:'forged'},{title:'X',channelId:'spoof'}])('recusa campo extra, mix QC ou corpo inválido %j',body=>{
    const before=state();expect(()=>write(body)).toThrow('válidos');expect(state()).toEqual(before)
  })
  it.each(['title','category','same-value','ABA','hash','QC','delete-reinsert'])('escritor externo invalida prova: %s',change=>{
    const original=header()
    if(change==='title')value.sqlite.prepare('UPDATE media_assets SET title=? WHERE id=?').run('Other',id)
    if(change==='category')value.sqlite.prepare('UPDATE media_assets SET category_id=NULL WHERE id=?').run(id)
    if(change==='same-value')value.sqlite.prepare('UPDATE media_assets SET title=title WHERE id=?').run(id)
    if(change==='ABA')for(const title of ['Changed','Título Çãó'])value.sqlite.prepare('UPDATE media_assets SET title=? WHERE id=?').run(title,id)
    if(change==='hash')value.sqlite.prepare('UPDATE media_assets SET content_hash=? WHERE id=?').run('OTHER_HASH',id)
    if(change==='QC')value.sqlite.prepare("INSERT INTO qc_decisions(id,asset_id,content_hash,channel_id,status,checks,created_at) VALUES('decision',?,'PRIVATE_CONTENT_HASH','@all','BLOCKED','{}','now')").run(id)
    if(change==='delete-reinsert'){value.sqlite.prepare('DELETE FROM media_assets WHERE id=?').run(id);value.sqlite.prepare('INSERT INTO media_assets(id,content_hash,path,title,kind,duration_frames,created_at) VALUES(?,?,?,?,?,?,?)').run(id,'PRIVATE_CONTENT_HASH','test.mp4','Título Çãó','VIDEO',250,'now')}
    const before=state();expect(()=>write({title:'Old'},original)).toThrow('mudou');expect(state()).toEqual(before)
  })
  it('duas edições na mesma prova têm um vencedor; igual também consome prova',()=>{
    const original=header();write({title:'Título Çãó'},original);const before=state();expect(()=>write({title:'Second'},original)).toThrow('mudou');expect(state()).toEqual(before)
    expect(value.sqlite.prepare("SELECT count(*) n FROM operator_decisions WHERE kind='ASSET_METADATA_CHANGED'").get()).toEqual({n:1})
  })
  it('outro ativo não invalida edição; inexistente não é catálogo vazio',()=>{
    const original=header();value.sqlite.exec("UPDATE media_assets SET title='Other' WHERE id='other'");expect(write({title:'Local'},original).title).toBe('Local');expect(()=>read('missing')).toThrow('não encontrado')
  })
  it('auditoria SQL falha e reverte metadata/QC/counters sem sucesso parcial',()=>{
    const before=state();value.sqlite.exec("CREATE TRIGGER metadata_audit_failure BEFORE INSERT ON operator_decisions WHEN NEW.kind='ASSET_METADATA_CHANGED' BEGIN SELECT RAISE(ABORT,'METADATA_AUDIT_FIXTURE'); END")
    expect(()=>write()).toThrow();expect(state()).toEqual(before)
  })
  it.each(['disabled','role','revoked','station','restricted','owner'])('reconfere sessão sob lock após %s',change=>{
    const original=header(),actor=authority()
    if(change==='disabled')value.sqlite.exec("UPDATE users SET enabled=0 WHERE id='admin'")
    if(change==='role')value.sqlite.exec("UPDATE users SET role='constructor' WHERE id='admin'")
    if(change==='revoked')value.sqlite.exec("DELETE FROM sessions WHERE user_id='admin'")
    if(change==='station')value.sqlite.exec("INSERT INTO user_access VALUES('admin',NULL,'[\"192.168.42.9\"]','now')")
    if(change==='restricted')value.sqlite.exec("INSERT INTO user_access VALUES('admin','[]',NULL,'now')")
    if(change==='owner')value.sqlite.exec("UPDATE sessions SET user_id='other-admin'")
    const before=state();expect(()=>write({title:'Not authorized'},original,actor)).toThrow();expect(state()).toEqual(before)
  })
  it('conta restrita lê apenas metadata pública com canEdit=false',()=>{
    value.sqlite.exec("INSERT INTO user_access VALUES('admin','[]',NULL,'now')");expect(read().canEdit).toBe(false);expect(()=>write()).toThrow('compartilhado')
  })
  it('segunda conexão vê revisão durável; writer lock antecede autorização',()=>{
    value.sqlite.close();value=openDatabase(join(mkdtempSync(join(tmpdir(),'RPlayout-metadata-review-')),'qa.db'));seed()
    const peer=openDatabase(value.sqlite.name)
    try{
      peer.sqlite.pragma('busy_timeout=0')
      const original=header(),actor=authority();peer.sqlite.prepare('UPDATE media_assets SET title=title WHERE id=?').run(id)
      const before=state();expect(()=>write({title:'Old'},original,actor)).toThrow('mudou');expect(state()).toEqual(before)
      const prepare=value.sqlite.prepare.bind(value.sqlite);let lockChecked=false
      vi.spyOn(value.sqlite,'prepare').mockImplementation(((sql:string)=>{
        if(sql.includes('FROM sessions s')){expect(value.sqlite.inTransaction).toBe(true);expect(()=>peer.sqlite.exec("UPDATE media_assets SET title=title WHERE id='other'")).toThrow('locked');lockChecked=true}
        return prepare(sql)
      }) as typeof value.sqlite.prepare)
      // Capture proof/actor before instrumenting authorization under the write.
      editAssetMetadata(value.db,id,{title:'Fresh'},assetMetadataETag(readAssetMetadata(peer.db,id,captureAssetMetadataAuthority(peer.db,request))),actor)
      expect(lockChecked).toBe(true)
    }finally{peer.sqlite.close()}
  })
})
