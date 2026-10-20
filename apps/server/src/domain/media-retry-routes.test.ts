import Fastify,{type FastifyInstance} from 'fastify'
import {afterEach,beforeEach,it,expect,vi} from 'vitest'
import {createApp,type App} from '../app.js'
import {registerRoutes} from '../routes.js'
import {operatorDecisions} from '../db/schema.js'
import {readAudit} from './audit.js'
vi.mock('../config.js',async original=>({...await original<Record<string,unknown>>(),ENGINE_BINARY:'',MEDIAMTX_BINARY:'',DEVICES_BINARY:'',AUTH_USER:'',AUTH_PASSWORD:'',DEFAULT_ROLE:'ADMIN'}))
let app:App,server:FastifyInstance
beforeEach(async()=>{
  app=await createApp(':memory:')
  // This suite checks HTTP/DB admission, not native worker completion.
  vi.spyOn(app.mediaWorkflow,'tick').mockResolvedValue(undefined)
  app.sqlite.exec(`INSERT INTO media_assets(id,content_hash,path,title,kind,duration_frames,created_at) VALUES('a','hash','test','QA','VIDEO',25,'now');
    INSERT INTO media_versions(id,asset_id,revision,content_hash,metadata,created_at) VALUES('v','a',1,'hash','{}','now');
    INSERT INTO media_jobs(id,version_id,kind,state,attempts,error,created_at,updated_at) VALUES('j','v','PROXY','FAILED',3,'Trabalho sem responsável identificável; confira encerramento.','now','now');`)
  server=Fastify();registerRoutes(app,server,()=>{});await server.ready()
})
afterEach(async()=>{await server.close();await app.close();vi.restoreAllMocks()})
const row=()=>app.sqlite.prepare('SELECT * FROM media_jobs WHERE id=?').get('j')
const retry=(payload:Record<string,unknown>={})=>server.inject({method:'POST',url:'/api/media/jobs/j/retry',payload})
it('unknown owner requires explicit boolean confirmation and refusal leaves DB intact',async()=>{
  const before=row()
  expect((await retry()).statusCode).toBe(409)
  expect(row()).toEqual(before)
  expect((await retry({confirmedPreviousStopped:true})).statusCode).toBe(200)
  expect(row()).toMatchObject({state:'PENDING',attempts:0,error:null})
  const audit=app.db.select().from(operatorDecisions).all().filter(entry=>entry.kind==='MEDIA_JOB_RETRY_REQUESTED')
  expect(audit).toHaveLength(1)
  expect(audit[0]!.payload).toMatchObject({jobId:'j',versionId:'v',previousAttempts:3,ownerConfirmationRequired:true,confirmedPreviousStopped:true,automaticTake:false})
})
it('confirmation cannot take a RUNNING job even with unknown owner',async()=>{
  app.sqlite.exec("UPDATE media_jobs SET state='RUNNING'")
  const before=row()
  expect((await retry({confirmedPreviousStopped:true})).statusCode).toBe(409)
  expect(row()).toEqual(before)
})
it('concurrent retries admit only one transition',async()=>{
  const responses=await Promise.all([retry({confirmedPreviousStopped:true}),retry({confirmedPreviousStopped:true})])
  expect(responses.map(response=>response.statusCode).sort()).toEqual([200,409])
  expect(row()).toMatchObject({state:'PENDING',attempts:0})
  expect(app.sqlite.prepare("SELECT count(*) AS count FROM operator_decisions WHERE kind='MEDIA_JOB_RETRY_REQUESTED'").get()).toEqual({count:1})
})
it('audit failure rolls back queue admission and does not start worker',async()=>{
  app.sqlite.exec("CREATE TRIGGER refuse_retry_audit BEFORE INSERT ON operator_decisions WHEN NEW.kind='MEDIA_JOB_RETRY_REQUESTED' BEGIN SELECT RAISE(ABORT,'audit unavailable'); END")
  const before=row()
  vi.mocked(app.mediaWorkflow.tick).mockClear()
  expect((await retry({confirmedPreviousStopped:true})).statusCode).toBe(500)
  expect(row()).toEqual(before)
  expect(app.mediaWorkflow.tick).not.toHaveBeenCalled()
})
it('malformed confirmations never mutate the job',async()=>{
  const before=row()
  for(const payload of [{confirmedPreviousStopped:'true'},{confirmedPreviousStopped:1},{confirmedPreviousStopped:true,force:true}]){
    expect((await retry(payload)).statusCode).toBe(400)
    expect(row()).toEqual(before)
  }
})
it('retry audit is global administration, excludes internal paths and is never HTTP-cached',async()=>{
  app.sqlite.exec("UPDATE media_jobs SET error='Trabalho sem responsável identificável; C:/PRIVATE_PATH token=PRIVATE_TOKEN',owner_host='PRIVATE_HOST',owner_pid=123,owner_boot='PRIVATE_BOOT'")
  expect((await retry({confirmedPreviousStopped:true})).statusCode).toBe(200)
  const response=await server.inject({url:'/api/audit'})
  expect(response.statusCode).toBe(200)
  expect(response.headers['cache-control']).toBe('private, no-store')
  const entries=response.json().entries.filter((entry:{kind:string})=>entry.kind==='MEDIA_JOB_RETRY_REQUESTED')
  expect(entries).toHaveLength(1)
  expect(JSON.stringify(entries)).not.toContain('PRIVATE_')
  const restricted=await readAudit(app.db,{channelIds:['channel-a'],globalAdmin:false},100)
  expect(restricted.some(entry=>entry.kind==='MEDIA_JOB_RETRY_REQUESTED')).toBe(false)
})
