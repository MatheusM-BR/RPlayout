import {afterEach,expect,it,vi} from 'vitest'
import {EventEmitter} from 'node:events'
import {PassThrough} from 'node:stream'
import {mkdtemp,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
import {spawn} from 'node:child_process'
import {createApp,type App} from '../app.js'

vi.mock('node:child_process',async original=>({...await original<Record<string,unknown>>(),spawn:vi.fn()}))
vi.mock('../config.js',async original=>({...await original<Record<string,unknown>>(),ENGINE_BINARY:'',MEDIAMTX_BINARY:'',RELAY_BINARY:'',DEVICES_BINARY:'',PROXY_BINARY:'blocked-proxy'}))
let app:App|undefined,root:string|undefined
afterEach(async()=>{
  if(app){await app.mediaWorkflow.close();app.close()}
  vi.unstubAllEnvs();vi.restoreAllMocks()
  if(root)await rm(root,{recursive:true,force:true})
})
it('close sem flush mantém SQLite aberto até o child encerrar e liberar seu claim',async()=>{
  root=await mkdtemp(join(tmpdir(),'rplayout-media-close-'))
  vi.stubEnv('RPLAYOUT_MEDIA_VERSIONS',join(root,'versions'))
  app=await createApp(':memory:')
  const source=join(root,'source.mp4');await writeFile(source,'fixture')
  const hash=createHash('sha256').update('fixture').digest('hex')
  app.sqlite.prepare("INSERT INTO media_assets(id,content_hash,path,title,kind,duration_frames,created_at) VALUES('a',?,?,'Fixture','VIDEO',25,'now')").run(hash,source)
  let started!:()=>void
  const ready=new Promise<void>(resolve=>{started=resolve})
  const child=Object.assign(new EventEmitter(),{stdout:new PassThrough(),stderr:new PassThrough(),kill:vi.fn(),pid:undefined})
  vi.mocked(spawn).mockImplementation(()=>{started();return child as unknown as ReturnType<typeof spawn>})
  app.mediaWorkflow.record('a',{contentHash:hash,kind:'VIDEO',path:source})
  await ready
  const closing=app.close()
  expect(app.sqlite.open).toBe(true)
  expect(child.kill).toHaveBeenCalledOnce()
  expect(app.sqlite.prepare("SELECT state FROM media_jobs WHERE kind='PROXY'").get()).toEqual({state:'RUNNING'})
  child.emit('close',1)
  await closing
  expect(app.sqlite.open).toBe(false)
})
