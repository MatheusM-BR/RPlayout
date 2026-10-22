import {mkdtempSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {eq} from 'drizzle-orm'
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {assetRemovalETag} from '@rplayout/protocol'
import {openDatabase} from '../db/client.js'
import {mediaAssets,operationalPlaylistRevisions,channelProjectSnapshots,operatorDecisions} from '../db/schema.js'
import {applyAssetRemoval,captureAssetRemovalAuthority,readAssetRemoval} from './asset-removal.js'
import {sessionDigest} from './access.js'
import {validateBackupRestore} from './backup.js'
import {ExecutionOwnership} from './execution-ownership.js'
import {randomUUID} from 'node:crypto'
vi.mock('../config.js',async original=>({...await original<Record<string,unknown>>(),AUTH_USER:'',AUTH_PASSWORD:'',DEFAULT_ROLE:'ADMIN'}))
let value:ReturnType<typeof openDatabase>
const id='asset:ç',request={headers:{cookie:'rplayout_session=PRIVATE_ADMIN'},ip:'127.0.0.1'}
function seed(){
  value.sqlite.exec("INSERT INTO users VALUES('admin','Admin','PRIVATE_HASH','ADMIN',1,'now'); INSERT INTO users VALUES('other','Other','PRIVATE_HASH','ADMIN',1,'now')")
  value.sqlite.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(sessionDigest('PRIVATE_ADMIN'),'admin','2099-01-01','now')
  for(const assetId of [id,'second','image'])value.sqlite.prepare('INSERT INTO media_assets(id,content_hash,path,title,kind,duration_frames,probe_error,qc_notes,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(assetId,'PRIVATE_HASH','C:/PRIVATE_FOLDER/'+assetId+(assetId==='image'?'.png':'.mp4'),'Título Çãó',assetId==='image'?'STILL':'VIDEO',250,'PRIVATE_PROBE_ERROR','PRIVATE_NOTES','now')
  value.sqlite.exec("INSERT INTO channels(id,name,width,height,rate_num,rate_den,target_lufs,ceiling_dbtp,limiter_lookahead_ms,created_at) VALUES('a','Canal A',320,180,25,1,-23,-1,5,'now'); INSERT INTO rundowns(id,channel_id,name,date,planned_start,loop,created_at,updated_at) VALUES('rd','a','Grade','2026-10-06',0,0,'now','now')")
}
beforeEach(()=>{value=openDatabase(':memory:');seed()})
afterEach(()=>{value.sqlite.close();vi.restoreAllMocks()})
const context=()=>({db:value.db,runtimes:new Map()})
const authority=()=>captureAssetRemovalAuthority(value.db,request)
const read=(operation:'REMOVE'|'PRUNE'='REMOVE',target:string|null=id)=>readAssetRemoval(context(),operation,target,authority())
const state=()=>Object.fromEntries(['media_assets','rundown_items','item_graphics','secondary_events','asset_removal_versions','editorial_revision_counters','operator_decisions'].map(table=>[table,value.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]))
const write=(proof=assetRemovalETag(read()),body:unknown={assetIds:[id],removeEditorialUses:true},actor=authority())=>applyAssetRemoval(context(),'REMOVE',id,body,proof,actor)
function item(itemId='vt',fallback=false){value.sqlite.prepare("INSERT INTO rundown_items(id,rundown_id,sort_order,type,title,media_id,live_fallback_media_id,min_duration,anchor,on_overrun,locked,auto_next,loop) VALUES(?,'rd',0,?,?,?, ?,0,'{\"kind\":\"FLOW\"}','PUSH',0,0,0)").run(itemId,fallback?'LIVE':'VT',fallback?'Entrada mantida':'VT',fallback?null:id,fallback?id:null)}
function publish(active=true,frozen=true){value.db.insert(operationalPlaylistRevisions).values({id:'pub',rundownId:'rd',revision:1,state:active?'PUBLISHED':'SUPERSEDED',active,publishedAt:'now',payload:{version:1,rundown:{id:'rd'},items:[{id:'vt',mediaId:id}],schedule:{items:[]},...(frozen?{assets:[{id}]}:{})}}).run()}
describe('remoção conferida, atomicidade e preservação de referências',()=>{
  it('execução estrangeira bloqueia remoção sem revelar identidades; parada vazia explícita libera',()=>{
    const lease=new ExecutionOwnership(value.db,{host:'PRIVATE_HOST',pid:101,boot:randomUUID()},()=>false).claim('a')
    const review=read();expect(review.assets[0]!.blockers.join(' ')).toContain('outra instância');expect(JSON.stringify(review)).not.toContain('PRIVATE_HOST');expect(JSON.stringify(review)).not.toContain(lease.identity.id)
    const before=state();expect(()=>write(assetRemovalETag(review))).toThrow();expect(state()).toEqual(before)
    lease.release();expect(read().assets[0]!.blockers).toEqual([])
  })
  it('liberação sem saída real ainda protege PGM/PVW/preroll estrangeiros',()=>{
    const lease=new ExecutionOwnership(value.db,{host:'fixture',pid:101,boot:randomUUID()},()=>false).claim('a'),token=randomUUID()
    lease.beforeSpawn(token);lease.spawned(501,token);lease.release();expect(read().assets[0]!.blockers.join(' ')).toContain('parada ainda inconclusiva')
    lease.exited(501,token);expect(read().assets[0]!.blockers).toEqual([])
  })
  it('claim/geração de engine invalidam prova original; consulta não renova autorização',()=>{
    const original=assetRemovalETag(read()),manager=new ExecutionOwnership(value.db,{host:'fixture',pid:101,boot:randomUUID()},()=>false),lease=manager.claim('a')
    lease.release();const before=state();expect(()=>write(original)).toThrow('mudaram');expect(state()).toEqual(before)
    const next=manager.claim('a'),pending=assetRemovalETag(read()),token=randomUUID();next.beforeSpawn(token);next.exited(null,token);next.release()
    expect(()=>write(pending)).toThrow('mudaram')
  })
  it('posse adulterada recusa conferência em vez de presumir canal livre',()=>{
    new ExecutionOwnership(value.db,{host:'fixture',pid:101,boot:randomUUID()},()=>false).claim('a');value.sqlite.exec("UPDATE execution_owner_runs SET signature='INVALID'")
    const before=state();expect(()=>read()).toThrow('adulterado');expect(state()).toEqual(before)
  })
  it('GET estável, privado e sem mutação; prune somente vídeos',()=>{
    item();item('fallback',true);const before=state(),original=read();expect(read()).toEqual(original);expect(state()).toEqual(before)
    expect(original.assets[0]?.uses.map(row=>row.action).sort()).toEqual(['CLEAR_FALLBACK','REMOVE_ITEM'])
    for(const secret of ['PRIVATE','contentHash','path','probeError','qcNotes'])expect(JSON.stringify(original)).not.toContain(secret)
    expect(read('PRUNE',null).assets.map(row=>row.assetId)).toEqual([id,'second']);expect(()=>read('REMOVE','missing')).toThrow('não encontrado')
  })
  it('remove item direto e só limpa fallback; não apaga arquivo/ativo ou publicação histórica',()=>{
    item();item('fallback',true);publish(false,true)
    const result=write();expect(result).toMatchObject({applied:true,removed:1,removedItems:1,clearedFallbacks:1,automaticTake:false,filesPreserved:true,historyPreserved:true})
    expect(value.sqlite.prepare("SELECT id,title,live_fallback_media_id FROM rundown_items").all()).toEqual([{id:'fallback',title:'Entrada mantida',live_fallback_media_id:null}])
    expect(value.sqlite.prepare('SELECT ignored,path FROM media_assets WHERE id=?').get(id)).toEqual({ignored:1,path:'C:/PRIVATE_FOLDER/'+id+'.mp4'})
    expect(value.db.select().from(operationalPlaylistRevisions).all()).toHaveLength(1)
  })
  it('prune aplica apenas subconjunto conferido e conserva imagens',()=>{
    const review=read('PRUNE',null)
    expect(applyAssetRemoval(context(),'PRUNE',null,{assetIds:[id],removeEditorialUses:false},assetRemovalETag(review),authority())).toMatchObject({removed:1})
    expect(value.db.select().from(mediaAssets).all().map(row=>row.id).sort()).toEqual(['image','second'])
    const before=state();expect(()=>applyAssetRemoval(context(),'PRUNE',null,{assetIds:['second'],removeEditorialUses:false},assetRemovalETag(review),authority())).toThrow('mudaram');expect(state()).toEqual(before)
  })
  it.each([undefined,'*','"asset-removal:A%3Aother:'+ 'a'.repeat(43)+'"','"asset-metadata:asset:1"','W/"1"',[]])('não aceita prova ausente/estrangeira %s',proof=>{
    const before=state();expect(()=>applyAssetRemoval(context(),'REMOVE',id,{assetIds:[id],removeEditorialUses:false},proof,authority())).toThrow();expect(state()).toEqual(before)
  })
  it.each([{assetIds:[id],removeEditorialUses:true,force:true},{assetIds:[id,id],removeEditorialUses:true},{assetIds:[],removeEditorialUses:true},{assetIds:['second'],removeEditorialUses:true},{assetIds:[id],removeEditorialUses:'yes'}])('recusa seleção/corpo inválido %j',body=>{
    const before=state();expect(()=>write(undefined,body)).toThrow();expect(state()).toEqual(before)
  })
  it('não remove vínculos sem confirmação explícita',()=>{item();const before=state();expect(()=>write(undefined,{assetIds:[id],removeEditorialUses:false})).toThrow('Confirme');expect(state()).toEqual(before)})
  it.each(['asset','direct-ABA','fallback-ABA','same-value','publication-ABA','project-ABA','new-prune-candidate','protection-ABA'])('escritor externo invalida original %s',change=>{
    item();const review=change==='new-prune-candidate'?read('PRUNE',null):read(),proof=assetRemovalETag(review)
    if(change==='asset')value.sqlite.prepare('UPDATE media_assets SET title=title WHERE id=?').run(id)
    if(change==='direct-ABA'){value.sqlite.exec("UPDATE rundown_items SET media_id='second' WHERE id='vt'");value.sqlite.prepare("UPDATE rundown_items SET media_id=? WHERE id='vt'").run(id)}
    if(change==='fallback-ABA'){item('fallback',true);value.sqlite.exec("DELETE FROM rundown_items WHERE id='fallback'")}
    if(change==='same-value')value.sqlite.exec("UPDATE rundown_items SET title=title WHERE id='vt'")
    if(change==='publication-ABA'){publish();value.db.delete(operationalPlaylistRevisions).run()}
    if(change==='project-ABA'){value.db.insert(channelProjectSnapshots).values({id:'snap',channelId:'a',label:'Snap',createdAt:'now',payload:{items:[{mediaId:id}]}}).run();value.db.delete(channelProjectSnapshots).run()}
    if(change==='new-prune-candidate')value.sqlite.exec("INSERT INTO media_assets(id,content_hash,path,title,kind,duration_frames,probe_error,created_at) VALUES('later','H','later.mp4','Later','VIDEO',0,'E','now')")
    if(change==='protection-ABA'){value.db.insert(operatorDecisions).values({id:'slot',rundownId:'@configuration',kind:'CHANNEL_CONFIGURATION_SLOT',payload:{channelId:'a',state:'APPLYING'},createdAt:'now'}).run();value.db.delete(operatorDecisions).where(eq(operatorDecisions.id,'slot')).run()}
    const before=state();expect(()=>applyAssetRemoval(context(),review.operation,review.assetId,{assetIds:[id],removeEditorialUses:true},proof,authority())).toThrow('mudaram');expect(state()).toEqual(before)
  })
  it.each(['active-publication','legacy-publication','saved-project','interrupted','checkpoint','configuration','archived'])('protege referência %s',kind=>{
    item()
    if(kind==='active-publication')publish()
    if(kind==='legacy-publication')publish(false,false)
    if(kind==='saved-project')value.db.insert(channelProjectSnapshots).values({id:'snap',channelId:'a',label:'Snap',createdAt:'now',payload:{items:[{mediaId:id}]}}).run()
    if(kind==='interrupted')value.sqlite.prepare("INSERT INTO interrupted_items(id,channel_id,rundown_id,item_id,title,frames,specification,state,created_at) VALUES('ret','a','rd','vt','VT',1,?,'PENDING','now')").run(JSON.stringify({mediaId:id}))
    if(kind==='checkpoint')value.sqlite.prepare("INSERT INTO channel_checkpoints VALUES('a',?,'now')").run(JSON.stringify({version:1,channelId:'a',rundownId:'rd',revisionId:null,itemId:'vt',elapsed:1,playing:true,realEngine:true}))
    if(kind==='configuration')value.db.insert(operatorDecisions).values({id:'slot',rundownId:'@configuration',kind:'CHANNEL_CONFIGURATION_SLOT',payload:{channelId:'a',state:'APPLYING'},createdAt:'now'}).run()
    if(kind==='archived')value.sqlite.exec("UPDATE channels SET archived_at='now' WHERE id='a'")
    const review=read('PRUNE',null);expect(review.assets.find(row=>row.assetId===id)!.blockers.length).toBeGreaterThan(0)
    const before=state();expect(()=>applyAssetRemoval(context(),'PRUNE',null,{assetIds:[id],removeEditorialUses:true},assetRemovalETag(review),authority())).toThrow('protegida');expect(state()).toEqual(before)
  })
  it.each(['disabled','role','revoked','station','restricted','owner'])('reconfere autoridade sob lock após %s',change=>{
    const original=assetRemovalETag(read()),actor=authority()
    if(change==='disabled')value.sqlite.exec("UPDATE users SET enabled=0 WHERE id='admin'")
    if(change==='role')value.sqlite.exec("UPDATE users SET role='VIEWER' WHERE id='admin'")
    if(change==='revoked')value.sqlite.exec('DELETE FROM sessions')
    if(change==='station')value.sqlite.exec("INSERT INTO user_access VALUES('admin',NULL,'[\"192.168.42.9\"]','now')")
    if(change==='restricted')value.sqlite.exec("INSERT INTO user_access VALUES('admin','[]',NULL,'now')")
    if(change==='owner')value.sqlite.exec("UPDATE sessions SET user_id='other'")
    const before=state();expect(()=>write(original,undefined,actor)).toThrow();expect(state()).toEqual(before)
  })
  it('auditoria falha reverte ativo, vínculos, deixas e counters sem sucesso parcial',()=>{
    item();item('fallback',true);value.sqlite.exec("INSERT INTO graphic_templates(id,name,svg,fields,fade_ms,created_at) VALUES('art','Art','<svg/>','[]',0,'now'); INSERT INTO item_graphics(id,item_id,template_id,at_seconds,field_values,created_at) VALUES('cue','vt','art',0,'{}','now')")
    const before=state();value.sqlite.exec("CREATE TRIGGER removal_audit_failure BEFORE INSERT ON operator_decisions WHEN NEW.kind='ASSET_REMOVAL_APPLIED' BEGIN SELECT RAISE(ABORT,'REMOVAL_FIXTURE'); END")
    expect(()=>write()).toThrow();expect(state()).toEqual(before)
  })
  it('passagem durável protege revisão antiga mesmo sem vínculo na grade atual',()=>{
    publish(false,true)
    value.db.insert(operatorDecisions).values({id:'boundary',rundownId:'rd',kind:'PLAYLIST_BOUNDARY',payload:{state:'QUEUED',plan:{channelId:'a',sourceRevisionId:'other',targetRevisionId:'pub'}},createdAt:'now'}).run()
    const review=read();expect(review.assets[0]!.uses).toEqual([]);expect(review.assets[0]!.blockers.join(' ')).toContain('durável')
    expect(()=>write(assetRemovalETag(review))).toThrow('protegida')
  })
  it('canal/configuração em ABA invalida impacto mesmo voltando ao nome original',()=>{
    item();const proof=assetRemovalETag(read());value.sqlite.exec("UPDATE channels SET name='B' WHERE id='a'; UPDATE channels SET name='Canal A' WHERE id='a'")
    expect(()=>write(proof)).toThrow('mudaram')
  })
  it('sessão revogada/recriada ou outra estação não herda prova antiga',()=>{
    const proof=assetRemovalETag(read())
    const elsewhere={...request,ip:'127.0.0.2'}
    expect(()=>applyAssetRemoval(context(),'REMOVE',id,{assetIds:[id],removeEditorialUses:true},proof,captureAssetRemovalAuthority(value.db,elsewhere))).toThrow('mudaram')
    value.sqlite.exec('DELETE FROM sessions');value.sqlite.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(sessionDigest('PRIVATE_ADMIN'),'admin','2099-01-01','now')
    expect(()=>write(proof)).toThrow('mudaram')
  })
  it.each(['insert','same-value','ABA','delete'])('QC por canal invalida original sem editar media_assets: %s',change=>{
    const insert=()=>value.sqlite.prepare("INSERT INTO qc_decisions(id,asset_id,content_hash,channel_id,status,checks,created_at) VALUES('decision',?,'PRIVATE_HASH','a','BLOCKED','{}','now')").run(id)
    if(change!=='insert')insert()
    const proof=assetRemovalETag(read()),media=value.sqlite.prepare('SELECT * FROM media_assets WHERE id=?').get(id)
    if(change==='insert')insert()
    if(change==='same-value')value.sqlite.exec("UPDATE qc_decisions SET status=status WHERE id='decision'")
    if(change==='ABA')value.sqlite.exec("UPDATE qc_decisions SET status='REJECTED' WHERE id='decision'; UPDATE qc_decisions SET status='BLOCKED' WHERE id='decision'")
    if(change==='delete')value.sqlite.exec("DELETE FROM qc_decisions WHERE id='decision'")
    expect(value.sqlite.prepare('SELECT * FROM media_assets WHERE id=?').get(id)).toEqual(media)
    const before=state();expect(()=>write(proof)).toThrow('mudaram');expect(state()).toEqual(before)
  })
  it.each(['PLAYLIST_BOUNDARY','CHANNEL_CONFIGURATION_SLOT','INTERRUPTION_COMMAND','OPERATIONAL_INSERT_COMMAND'])('não presume canal livre por fase durável inválida %s',kind=>{
    value.db.insert(operatorDecisions).values({id:'bad-phase',rundownId:'rd',kind,payload:{channelId:'a',plan:{channelId:'a'},state:'UNKNOWN_PHASE',phase:'UNKNOWN_PHASE'},createdAt:'now'}).run()
    const before=state();expect(()=>read()).toThrow('inválido');expect(state()).toEqual(before)
  })
  it('auditoria de prune reverte exclusões de vários candidatos juntas',()=>{
    item();const review=read('PRUNE',null),before=state()
    value.sqlite.exec("CREATE TRIGGER removal_prune_failure BEFORE INSERT ON operator_decisions WHEN NEW.kind='ASSET_REMOVAL_APPLIED' BEGIN SELECT RAISE(ABORT,'PRUNE_ROLLBACK_FIXTURE'); END")
    expect(()=>applyAssetRemoval(context(),'PRUNE',null,{assetIds:[id,'second'],removeEditorialUses:true},assetRemovalETag(review),authority())).toThrow();expect(state()).toEqual(before)
  })
  it('duas conexões, tombstones, reinício e backup mantêm prova consumida',async()=>{
    value.sqlite.close();const path=join(mkdtempSync(join(tmpdir(),'RPlayout-removal-')),'qa.db');value=openDatabase(path);seed()
    const peer=openDatabase(path)
    try{const proof=assetRemovalETag(read());applyAssetRemoval({db:peer.db,runtimes:new Map()},'REMOVE',id,{assetIds:[id],removeEditorialUses:false},proof,captureAssetRemovalAuthority(peer.db,request));expect(()=>write(proof)).toThrow('mudaram')}finally{peer.sqlite.close()}
    value.sqlite.close();value=openDatabase(path);expect(value.sqlite.prepare('SELECT ignored FROM media_assets WHERE id=?').get(id)).toEqual({ignored:1});expect(await validateBackupRestore(path)).toMatchObject({integrity:'ok',foreignKeys:'ok'})
  })
})
