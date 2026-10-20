import {afterEach,expect,it,vi} from 'vitest'
import {openDatabase} from '../db/client.js'
import {MediaWorkflow} from './media-workflow.js'
import {AudioMixAnalysis} from './audio-mix-analysis.js'
import {IngestOwnership} from './ingest-ownership.js'
import {Ingest} from './ingest.js'
import {emitIntegrationEvent} from './integrations.js'
import {integrations,operatorDecisions} from '../db/schema.js'
import {isRecoveryRehearsal,rehearsalRequestAllowed} from './recovery-rehearsal.js'
import {hostname} from 'node:os'
const databases:ReturnType<typeof openDatabase>[]=[],workers:MediaWorkflow[]=[],mixes:AudioMixAnalysis[]=[]
afterEach(async()=>{for(const w of workers.splice(0))await w.close();for(const w of mixes.splice(0))w.close();for(const db of databases.splice(0))db.sqlite.close();vi.restoreAllMocks()})
function setup(){const db=openDatabase(':memory:');databases.push(db);db.sqlite.exec('CREATE TABLE ha_recovery_origin(id INTEGER PRIMARY KEY,payload TEXT)');return db}
const rows=(sqlite:ReturnType<typeof openDatabase>['sqlite'],tables:string[])=>tables.map(table=>sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all())
it('marker mesmo incompleto bloqueia, sem interpretar ausência de provenance como autorização',()=>{const db=setup();expect(isRecoveryRehearsal(db.sqlite)).toBe(true);expect(db.sqlite.prepare('SELECT * FROM ha_recovery_origin').all()).toEqual([])})
it.each([
  {method:'GET',path:'/api/assets',allowed:true},{method:'HEAD',path:'/api/assets/a/media',allowed:true},
  {method:'OPTIONS',path:'/api/channels/c/take',allowed:true},{method:'POST',path:'/api/auth/login',allowed:true},
  {method:'POST',path:'/api/auth/logout',allowed:true},{method:'POST',path:'/api/backups',allowed:true},
  {method:'POST',path:'/api/channels/c/take',allowed:false},{method:'POST',path:'/api/library/scan',allowed:false},
  {method:'PATCH',path:'/api/items/i',allowed:false},{method:'DELETE',path:'/api/backups',allowed:false},
  {method:'POST',path:'/api/ha/replica',allowed:false},
])('limite de conferência $method $path',({method,path,allowed})=>{expect(rehearsalRequestAllowed(method,path)).toBe(allowed)})
it('construtor/tick/retry/record e leitura de proxy não alteram jobs da cópia recuperada',async()=>{
  const db=setup(),sqlite=db.sqlite,kill=vi.spyOn(process,'kill')
  sqlite.exec(`INSERT INTO media_assets(id,content_hash,path,title,kind,duration_frames,created_at) VALUES('a','${'a'.repeat(64)}','/fixture','Fixture','VIDEO',25,'now');
    INSERT INTO media_versions(id,asset_id,revision,content_hash,metadata,created_at) VALUES('v','a',1,'${'a'.repeat(64)}','{}','now');
    INSERT INTO media_versions(id,asset_id,revision,content_hash,metadata,created_at) VALUES('v2','a',2,'${'c'.repeat(64)}','{}','now');
    INSERT INTO media_jobs(id,version_id,kind,state,attempts,created_at,updated_at) VALUES('dead','v','ARCHIVE','RUNNING',1,'now','now');
    INSERT INTO media_jobs(id,version_id,kind,state,attempts,created_at,updated_at) VALUES('max','v2','ARCHIVE','PENDING',3,'now','now');
    INSERT INTO media_jobs(id,version_id,kind,state,attempts,created_at,updated_at,output_path,output_hash) VALUES('proxy','v','PROXY','READY',1,'now','now','/rplayout-missing-rehearsal-proxy','${'b'.repeat(64)}');`)
  const before=rows(sqlite,['media_jobs','media_versions']),worker=new MediaWorkflow(sqlite,'/never-create-rehearsal-output','unused');workers.push(worker)
  await worker.tick();expect(worker.retry('dead',true)).toBe(false);expect(worker.record('a',{contentHash:'a'.repeat(64),kind:'VIDEO',path:'/fixture'})).toBeNull()
  expect(await worker.preview('a','a'.repeat(64))).toBeNull();expect(rows(sqlite,['media_jobs','media_versions'])).toEqual(before);expect(kill).not.toHaveBeenCalled();expect(worker.cleanup).toBeNull()
})
it('mix interrompido não é reclassificado e nenhuma nova análise é admitida',async()=>{
  const db=setup(),kill=vi.spyOn(process,'kill'),runner=vi.fn(),authorize=vi.fn()
  db.db.insert(operatorDecisions).values({id:'mix',rundownId:'rd',kind:'AUDIO_MIX_ANALYSIS',createdAt:'now',payload:{id:'mix',state:'RUNNING',worker:{host:hostname(),pid:2147483647,boot:'old'}}}).run()
  const before=rows(db.sqlite,['operator_decisions']),mix=new AudioMixAnalysis(db.db,'unused',async()=>'/fixture',runner);mixes.push(mix)
  await mix.tick();expect(()=>mix.queue('i','a'.repeat(64),0,{mode:'STEREO_1_2'},null,authorize)).toThrow('conferência')
  expect(rows(db.sqlite,['operator_decisions'])).toEqual(before);expect(kill).not.toHaveBeenCalled();expect(runner).not.toHaveBeenCalled();expect(authorize).not.toHaveBeenCalled()
})
it('scanner preserva lotes e revisão, sem recuperar, reclamar ou reconciliar catálogo',async()=>{
  const db=setup(),kill=vi.spyOn(process,'kill')
  db.sqlite.prepare("INSERT INTO ingest_batches(id,roots,measure,state,created_at,updated_at,owner_host,owner_pid,owner_boot) VALUES('scan',?,0,'RUNNING','now','now',?,2147483647,'old')").run(JSON.stringify(['C:/ação']),hostname())
  const before=rows(db.sqlite,['ingest_batches','scan_revision','operator_decisions','media_assets']),owner=new IngestOwnership(db.sqlite)
  expect(owner.pending()).toBeNull();expect(owner.claim(['C:/ação'],false)).toBeNull()
  const scanner=new Ingest(db.db,'unused','/never-create',undefined,db.sqlite)
  expect(scanner.start('C:/ação')).toBe(false);expect(scanner.resumePending()).toBe(false);expect(await scanner.reconcileAvailability()).toBe(false);await scanner.close()
  expect(rows(db.sqlite,['ingest_batches','scan_revision','operator_decisions','media_assets'])).toEqual(before);expect(kill).not.toHaveBeenCalled()
})
it('eventos de telemetria em ensaio não criam novas entregas externas',async()=>{
  const db=setup();db.db.insert(integrations).values({id:'g',name:'G',url:'https://example.test',events:['test'],enabled:true,createdAt:'now'}).run()
  const before=rows(db.sqlite,['integration_deliveries','integration_delivery_versions']);await emitIntegrationEvent(db.db,'test',{},null)
  expect(rows(db.sqlite,['integration_deliveries','integration_delivery_versions'])).toEqual(before)
})
