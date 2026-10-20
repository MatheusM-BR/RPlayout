import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {spawn} from 'node:child_process'
import {EventEmitter} from 'node:events'
import {PassThrough} from 'node:stream'
import {createReadStream} from 'node:fs'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import {hostname} from 'node:os'
import {executionHostIdentity} from './execution-host.js'
import { join } from 'node:path'
import { openDatabase } from '../db/client.js'
import { MediaWorkflow } from './media-workflow.js'
vi.mock('node:child_process',()=>({spawn:vi.fn()}))
vi.mock('node:fs',async importOriginal=>{
  const original=await importOriginal<typeof import('node:fs')>()
  return {...original,createReadStream:vi.fn(original.createReadStream)}
})

let database: ReturnType<typeof openDatabase>, root: string, workflow: MediaWorkflow
beforeEach(async () => {
  vi.mocked(spawn).mockReset()
  vi.mocked(createReadStream).mockClear()
  root = await mkdtemp(join(tmpdir(), 'rplayout-workflow-'))
  database = openDatabase(join(root, 'workflow.db'))
  database.sqlite.exec("INSERT INTO media_assets (id,content_hash,path,title,kind,duration_frames,created_at) VALUES ('a','old','test','AÇÃO','VIDEO',25,'now')")
  workflow = new MediaWorkflow(database.sqlite, join(root, 'versions'), '')
})
afterEach(async () => { await workflow.close(); database.sqlite.close(); await rm(root, { recursive: true, force: true }) })
const hash = (content: string) => createHash('sha256').update(content).digest('hex')
async function wait() {
  for (let attempt = 0; attempt < 100; attempt++) {
    const jobs = workflow.jobs() as Array<{ state: string }>
    if (jobs.every(job => !['PENDING', 'RUNNING'].includes(job.state))) return
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error('worker did not finish')
}
describe('ingestão durável e versões', () => {
  it('segunda instância não reabre job vivo e fechar outro worker não libera seu claim',async()=>{
    const source=join(root,'owned.mp4');await writeFile(source,'first')
    const blocked=new PassThrough();vi.mocked(createReadStream).mockReturnValueOnce(blocked as unknown as ReturnType<typeof createReadStream>)
    workflow.record('a',{contentHash:hash('first'),kind:'VIDEO',path:source})
    while(!(workflow.jobs() as Array<{kind:string;state:string}>).some(job=>job.kind==='ARCHIVE'&&job.state==='RUNNING'))await new Promise(resolve=>setTimeout(resolve,5))
    const otherDatabase=openDatabase(join(root,'workflow.db')),other=new MediaWorkflow(otherDatabase.sqlite,join(root,'versions'),'')
    try{
      await other.tick();expect(other.jobs()).toEqual(expect.arrayContaining([expect.objectContaining({kind:'ARCHIVE',state:'RUNNING',attempts:1})]))
      await other.close();expect(workflow.jobs()).toEqual(expect.arrayContaining([expect.objectContaining({kind:'ARCHIVE',state:'RUNNING',attempts:1})]))
    }finally{await other.close();otherDatabase.sqlite.close()}
    await workflow.close();workflow=new MediaWorkflow(database.sqlite,join(root,'versions'),'');await workflow.tick()
    expect(workflow.jobs()).toEqual(expect.arrayContaining([expect.objectContaining({kind:'ARCHIVE',state:'READY',attempts:2})]))
  })
  it('responsável remoto ou PID vivo não é presumido morto',async()=>{
    const source=join(root,'remote.mp4');await writeFile(source,'first');workflow.record('a',{contentHash:hash('first'),kind:'VIDEO',path:source});await wait();await workflow.close()
    const job=(workflow.jobs() as Array<{id:string;kind:string}>).find(job=>job.kind==='PROXY')!
    for(const owner of [{host:'OTHER_HOST',pid:2147483647},{host:executionHostIdentity(),pid:process.pid},{host:hostname(),pid:2147483647}]){
      database.sqlite.prepare("UPDATE media_jobs SET state='RUNNING',owner_host=?,owner_pid=?,owner_boot='unknown-live' WHERE id=?").run(owner.host,owner.pid,job.id)
      workflow=new MediaWorkflow(database.sqlite,join(root,'versions'),'');await workflow.tick();await workflow.close()
      expect(database.sqlite.prepare('SELECT state,owner_boot FROM media_jobs WHERE id=?').get(job.id)).toEqual({state:'RUNNING',owner_boot:'unknown-live'})
    }
  })
  it('morte local comprovada retoma o mesmo job sem zerar orçamento',async()=>{
    const source=join(root,'dead.mp4');await writeFile(source,'first');workflow.record('a',{contentHash:hash('first'),kind:'VIDEO',path:source});await wait();await workflow.close()
    const job=(workflow.jobs() as Array<{id:string;kind:string}>).find(job=>job.kind==='PROXY')!
    database.sqlite.prepare("UPDATE media_jobs SET state='RUNNING',attempts=1,owner_host=?,owner_pid=2147483647,owner_boot='dead' WHERE id=?").run(executionHostIdentity(),job.id)
    workflow=new MediaWorkflow(database.sqlite,join(root,'versions'),'')
    expect(workflow.jobs()).toEqual(expect.arrayContaining([expect.objectContaining({id:job.id,state:'PENDING',attempts:1})]))
    await workflow.tick();expect(workflow.jobs()).toEqual(expect.arrayContaining([expect.objectContaining({id:job.id,state:'FAILED',attempts:2})]))
  })
  it('RUNNING sem responsável vira diagnóstico, não retomada automática',async()=>{
    const source=join(root,'legacy.mp4');await writeFile(source,'first');workflow.record('a',{contentHash:hash('first'),kind:'VIDEO',path:source});await wait();await workflow.close()
    const job=(workflow.jobs() as Array<{id:string;kind:string}>).find(job=>job.kind==='PROXY')!
    database.sqlite.prepare("UPDATE media_jobs SET state='RUNNING',owner_host=NULL,owner_pid=NULL,owner_boot=NULL WHERE id=?").run(job.id)
    workflow=new MediaWorkflow(database.sqlite,join(root,'versions'),'')
    expect(workflow.jobs()).toEqual(expect.arrayContaining([expect.objectContaining({id:job.id,state:'FAILED',error:expect.stringContaining('responsável')})]))
    expect(workflow.retry(job.id)).toBe(false)
    expect(workflow.retry(job.id,true)).toBe(true)
    await workflow.tick()
  })
  it('conclusão atrasada não publica READY nem altera claim substituído',async()=>{
    await workflow.close();workflow=new MediaWorkflow(database.sqlite,join(root,'versions'),'fake-proxy')
    let finish!:()=>void
    mockProxy(async(_source,target)=>{await new Promise<void>(resolve=>{finish=resolve});await writeFile(target,'proxy')})
    const source=join(root,'changed-owner.mp4');await writeFile(source,'first');workflow.record('a',{contentHash:hash('first'),kind:'VIDEO',path:source})
    while(!finish)await new Promise(resolve=>setTimeout(resolve,5))
    database.sqlite.exec("UPDATE media_jobs SET owner_boot='different' WHERE kind='PROXY' AND state='RUNNING'")
    finish();await workflow.tick()
    expect(database.sqlite.prepare("SELECT state,output_hash,owner_boot FROM media_jobs WHERE kind='PROXY'").get()).toEqual({state:'RUNNING',output_hash:null,owner_boot:'different'})
  })
  it('retry usa parcial próprio sem reutilizar ou apagar saída da tentativa anterior',async()=>{
    const source=join(root,'attempts.mp4');await writeFile(source,'first')
    await workflow.close();workflow=new MediaWorkflow(database.sqlite,join(root,'versions'),'fake-proxy')
    let calls=0
    mockProxy(async(_source,target)=>{await writeFile(target,'proxy bytes');if(++calls===1)throw new Error('interrupted')})
    workflow.record('a',{contentHash:hash('first'),kind:'VIDEO',path:source});await wait()
    const job=(workflow.jobs() as Array<{id:string;kind:string}>).find(j=>j.kind==='PROXY')!
    await workflow.tick() // Let the predecessor finish its own cleanup first.
    const first=String(vi.mocked(spawn).mock.calls[0]?.[1]?.[1])
    await writeFile(first,'previous attempt still unwinding')
    expect(workflow.retry(job.id)).toBe(true);await wait()
    const second=String(vi.mocked(spawn).mock.calls[1]?.[1]?.[1])
    expect(second).not.toBe(first);expect(first).toContain(job.id);expect(second).toContain(job.id)
    expect(await readFile(first,'utf8')).toBe('previous attempt still unwinding')
    expect(await workflow.preview('a',hash('first'))).toBeTruthy()
  })
  it('aborta cópia incompleta, remove parcial e retoma job sem disponibilizar bytes truncados',async()=>{
    const source=join(root,'copy.mp4');await writeFile(source,'first')
    const blocked=new PassThrough()
    vi.mocked(createReadStream).mockReturnValueOnce(blocked as unknown as ReturnType<typeof createReadStream>)
    const id=workflow.record('a',{contentHash:hash('first'),kind:'VIDEO',path:source})
    while(!(workflow.jobs() as Array<{kind:string;state:string}>).some(job=>job.kind==='ARCHIVE'&&job.state==='RUNNING'))await new Promise(resolve=>setTimeout(resolve,5))
    blocked.write('fi')
    await workflow.close()
    expect(await workflow.archived('a',hash('first'))).toBeNull()
    expect(blocked.destroyed).toBe(true)
    expect(workflow.versions('a')[0]?.id).toBe(id)
    workflow=new MediaWorkflow(database.sqlite,join(root,'versions'),'')
    await workflow.tick()
    const path=await workflow.archived('a',hash('first'));expect(path).toBeTruthy()
    expect(await readFile(path!,'utf8')).toBe('first')
    expect(workflow.jobs()).toEqual(expect.arrayContaining([expect.objectContaining({kind:'ARCHIVE',state:'READY',attempts:2})]))
  })
  it('tick concorrente aguarda a mesma execução e close espera o child antes de liberar banco',async()=>{
    const source=join(root,'shutdown.mp4');await writeFile(source,'first')
    await workflow.close();workflow=new MediaWorkflow(database.sqlite,join(root,'versions'),'blocked-proxy')
    let entered!:()=>void
    const ready=new Promise<void>(resolve=>{entered=resolve})
    const child=Object.assign(new EventEmitter(),{stdout:new PassThrough(),stderr:new PassThrough(),kill:vi.fn(),pid:undefined})
    vi.mocked(spawn).mockImplementation(()=>{entered();return child as unknown as ReturnType<typeof spawn>})
    workflow.record('a',{contentHash:hash('first'),kind:'VIDEO',path:source})
    await ready
    expect(vi.mocked(spawn).mock.calls[0]?.[1]).toContain('--parent-pipe')
    const one=workflow.tick(),two=workflow.tick();expect(one).toBe(two)
    let drained=false
    const closing=workflow.close().then(()=>{drained=true})
    await Promise.resolve();expect(drained).toBe(false);expect(child.kill).toHaveBeenCalledOnce()
    expect(workflow.record('a',{contentHash:hash('second'),kind:'VIDEO',path:source})).toBeNull()
    child.emit('close',1);await closing
    expect(drained).toBe(true)
    expect(workflow.jobs()).toEqual(expect.arrayContaining([expect.objectContaining({kind:'PROXY',state:'PENDING',attempts:1})]))
    workflow=new MediaWorkflow(database.sqlite,join(root,'versions'),'')
    await workflow.tick()
    expect(workflow.jobs()).toEqual(expect.arrayContaining([expect.objectContaining({kind:'PROXY',state:'FAILED',attempts:2})]))
  })
  it.each(['changed','missing','unverified'] as const)('bloqueia cache %s e regenera mediante retry sem alterar edição',async mode=>{
    const source=join(root,'cache.mp4');await writeFile(source,'first')
    workflow.close();workflow=new MediaWorkflow(database.sqlite,join(root,'versions'),'fake-proxy')
    mockProxy(async(_source,target)=>{await writeFile(target,'proxy bytes')})
    const id=workflow.record('a',{contentHash:hash('first'),kind:'VIDEO',path:source});await wait()
    const path=await workflow.preview('a',hash('first'));expect(path).toBeTruthy()
    const proxy=(workflow.jobs() as Array<{id:string;kind:string}>).find(j=>j.kind==='PROXY')!
    expect(database.sqlite.prepare('SELECT output_hash FROM media_jobs WHERE id=?').get(proxy.id)).toEqual({output_hash:hash('proxy bytes')})
    if(mode==='changed')await writeFile(path!,'wrong bytes')
    if(mode==='missing')await rm(path!)
    if(mode==='unverified')database.sqlite.prepare('UPDATE media_jobs SET output_hash=NULL WHERE id=?').run(proxy.id)
    expect(await workflow.preview('a',hash('first'))).toBeNull()
    expect(workflow.jobs()).toEqual(expect.arrayContaining([expect.objectContaining({id:proxy.id,state:'FAILED'})]))
    expect(workflow.retry(proxy.id)).toBe(true);await wait()
    expect(await workflow.preview('a',hash('first'))).toBe(path)
    expect(workflow.versions('a')).toHaveLength(1)
    expect(workflow.versions('a')[0]?.id).toBe(id)
    expect(await workflow.archived('a',hash('first'))).toBeTruthy()
  })
  it('não cria jobs sem caminho e normaliza SHA sem duplicar versão',async()=>{
    expect(workflow.record('a',{contentHash:hash('first'),kind:'VIDEO'})).toBeNull()
    expect(workflow.record('a',{contentHash:hash('first'),kind:'VIDEO',path:' '})).toBeNull()
    const source=join(root,'canonical.mp4');await writeFile(source,'first')
    const id=workflow.record('a',{contentHash:hash('first').toUpperCase(),kind:'VIDEO',path:source})
    expect(workflow.record('a',{contentHash:hash('first'),kind:'VIDEO',path:source})).toBe(id)
    await wait();expect(workflow.versions('a')).toHaveLength(1)
    expect(workflow.versions('a')[0]?.content_hash).toBe(hash('first'))
  })
  it('interrupção na terceira tentativa vira falha recuperável, não pending eterno',async()=>{
    const source=join(root,'attempt.mp4');await writeFile(source,'first')
    workflow.record('a',{contentHash:hash('first'),kind:'VIDEO',path:source});await wait()
    const job=(workflow.jobs() as Array<{id:string;kind:string}>).find(j=>j.kind==='PROXY')!
    database.sqlite.prepare("UPDATE media_jobs SET state='RUNNING',attempts=3 WHERE id=?").run(job.id)
    workflow.close();workflow=new MediaWorkflow(database.sqlite,join(root,'versions'),'')
    expect(workflow.jobs()).toEqual(expect.arrayContaining([expect.objectContaining({id:job.id,state:'FAILED',attempts:3,error:expect.stringContaining('limite')})]))
    expect(workflow.retry(job.id)).toBe(true);await wait()
    expect(workflow.jobs()).toEqual(expect.arrayContaining([expect.objectContaining({id:job.id,state:'FAILED',attempts:1})]))
  })
  it('metadados corrompidos falham só naquela versão e deixam a próxima copiar',async()=>{
    const source=join(root,'bad.mp4');await writeFile(source,'first')
    const id=workflow.record('a',{contentHash:hash('first'),kind:'VIDEO',path:source});await wait()
    database.sqlite.prepare('UPDATE media_versions SET metadata=? WHERE id=?').run('{bad',id)
    database.sqlite.prepare("UPDATE media_jobs SET state='PENDING',attempts=0 WHERE version_id=?").run(id)
    await writeFile(source,'second')
    const next=workflow.record('a',{contentHash:hash('second'),kind:'VIDEO',path:source});await wait()
    expect(database.sqlite.prepare("SELECT state FROM media_jobs WHERE version_id=? AND kind='ARCHIVE'").get(next)).toEqual({state:'READY'})
    expect(database.sqlite.prepare("SELECT state FROM media_jobs WHERE version_id=? AND kind='ARCHIVE'").get(id)).toEqual({state:'FAILED'})
  })
  it('restaurar arquivo e repetir cópia libera automaticamente só o proxy dependente',async()=>{
    const source=join(root,'retry.mp4');await writeFile(source,'wrong')
    workflow.record('a',{contentHash:hash('first'),kind:'VIDEO',path:source});await wait()
    const archive=(workflow.jobs() as Array<{id:string;kind:string}>).find(j=>j.kind==='ARCHIVE')!
    workflow.close();workflow=new MediaWorkflow(database.sqlite,join(root,'versions'),'fake-proxy')
    mockProxy(async(_source,target)=>{await writeFile(target,'proxy')})
    await writeFile(source,'first');expect(workflow.retry(archive.id)).toBe(true);await wait()
    expect(workflow.jobs()).toEqual(expect.arrayContaining([expect.objectContaining({kind:'ARCHIVE',state:'READY'}),expect.objectContaining({kind:'PROXY',state:'READY'})]))
    expect(await workflow.preview('a',hash('first'))).toBeTruthy()
  })
  it.each(['before','during','empty'] as const)('proxy recusa versão alterada ou saída vazia: %s',async mode=>{
    const source=join(root,'proxy.mp4');await writeFile(source,'first')
    workflow.record('a',{contentHash:hash('first'),kind:'VIDEO',path:source});await wait()
    const archive=await workflow.archived('a',hash('first'))
    const proxy=(workflow.jobs() as Array<{id:string;kind:string}>).find(j=>j.kind==='PROXY')!
    workflow.close();workflow=new MediaWorkflow(database.sqlite,join(root,'versions'),'fake-proxy')
    mockProxy(async(path,target)=>{
      if(mode==='during')await writeFile(path,'changed during proxy')
      await writeFile(target,mode==='empty'?'':'proxy')
    })
    if(mode==='before')await writeFile(archive!,'changed before proxy')
    expect(workflow.retry(proxy.id)).toBe(true);await wait()
    expect(workflow.jobs()).toEqual(expect.arrayContaining([expect.objectContaining({id:proxy.id,state:'FAILED'})]))
    expect(await workflow.preview('a',hash('first'))).toBeNull()
    expect(vi.mocked(spawn)).toHaveBeenCalledTimes(mode==='before'?0:1)
  })
  it('preserva cópia e metadata por hash sem duplicar a mesma versão', async () => {
    const source = join(root, 'ÇÃO.mp4'); await writeFile(source, 'first')
    const metadata = { contentHash: hash('first'), kind: 'VIDEO', path: source, title: 'AÇÃO' }
    const firstId = workflow.record('a', metadata)
    expect(workflow.record('a', metadata)).toBe(firstId)
    await wait()
    const archived = await workflow.archived('a', hash('first'))
    expect(archived).toBeTruthy()
    await writeFile(source, 'second')
    workflow.record('a', { ...metadata, contentHash: hash('second') }); await wait()
    expect(await workflow.inspectionOriginal('a',hash('first'),source)).toBe(archived)
    expect(await readFile(archived!, 'utf8')).toBe('first')
    expect(workflow.versions('a').map(version => version.revision)).toEqual([2, 1])
    expect(await workflow.preview('a', hash('first'))).toBeNull()
    expect((workflow.jobs() as Array<{ kind: string; state: string; error: string }>).filter(job => job.kind === 'PROXY')).toEqual(expect.arrayContaining([expect.objectContaining({ state: 'FAILED', error: expect.stringContaining('Gerador de proxy') })]))
    await writeFile(archived!, 'corrupted')
    expect(await workflow.archived('a', hash('first'))).toBeNull()
    expect(await workflow.inspectionOriginal('a',hash('first'),source)).toBeNull()
  })
  it('recusa arquivar uma versão quando o arquivo foi substituído', async () => {
    const source = join(root, 'alterado.mp4'); await writeFile(source, 'new')
    workflow.record('a', { contentHash: hash('old'), kind: 'VIDEO', path: source }); await wait()
    expect(await workflow.archived('a', hash('old'))).toBeNull()
    expect(workflow.jobs()).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'ARCHIVE', state: 'FAILED', error: expect.stringContaining('arquivo mudou') })]))
    expect(workflow.record('a', { contentHash: hash('old'), kind: 'AUDIO', path: source })).toBeNull()
  })
  it('retoma trabalho interrompido com o mesmo ID, sem perder tentativas', async () => {
    const source = join(root, 'retomar.mp4'); await writeFile(source, 'resume')
    workflow.record('a', { contentHash: hash('resume'), kind: 'VIDEO', path: source }); await wait()
    const proxy = (workflow.jobs() as Array<{ id: string; kind: string }>).find(job => job.kind === 'PROXY')!
    database.sqlite.prepare("UPDATE media_jobs SET state='RUNNING', attempts=1 WHERE id=?").run(proxy.id)
    workflow.close()
    workflow = new MediaWorkflow(database.sqlite, join(root, 'versions'), '')
    expect(workflow.jobs()).toEqual(expect.arrayContaining([expect.objectContaining({ id: proxy.id, state: 'PENDING', attempts: 1 })]))
    await workflow.tick(); await wait()
    expect(workflow.jobs()).toEqual(expect.arrayContaining([expect.objectContaining({ id: proxy.id, state: 'FAILED', attempts: 2 })]))
    expect(workflow.retry(proxy.id)).toBe(true); await wait()
    expect(workflow.jobs()).toEqual(expect.arrayContaining([expect.objectContaining({ id: proxy.id, attempts: 1 })]))
  })
})

it('receita legada não é servida; preserva edição, bytes e arquivo mestre até regeneração explícita',async()=>{
  const source=join(root,'legacy.mp4');await writeFile(source,'first')
  await workflow.close();workflow=new MediaWorkflow(database.sqlite,join(root,'versions'),'fake-proxy')
  mockProxy(async(_source,target)=>{await writeFile(target,'proxy bytes')})
  workflow.record('a',{contentHash:hash('first'),kind:'VIDEO',path:source});await wait()
  const old=await workflow.preview('a',hash('first'));expect(old).toBeTruthy()
  const versions=workflow.versions('a'),job=workflow.jobs().find(row=>row.kind==='PROXY')!
  database.sqlite.prepare('UPDATE media_jobs SET proxy_recipe=NULL WHERE id=?').run(job.id)
  expect(await workflow.preview('a',hash('first'))).toBeNull()
  expect(await readFile(old!,'utf8')).toBe('proxy bytes')
  expect(await workflow.archived('a',hash('first'))).toBeTruthy()
  expect(workflow.versions('a')[0]?.id).toBe(versions[0]?.id)
  expect(workflow.retry(job.id)).toBe(true);await wait()
  expect(await workflow.preview('a',hash('first'))).toBe(old)
})
it('binário antigo não confirma a receita atual e não publica cache READY',async()=>{
  const source=join(root,'old-bin.mp4');await writeFile(source,'first')
  await workflow.close();workflow=new MediaWorkflow(database.sqlite,join(root,'versions'),'fake-old-proxy')
  mockProxy(async(_source,target)=>{await writeFile(target,'proxy bytes')},'old')
  workflow.record('a',{contentHash:hash('first'),kind:'VIDEO',path:source});await wait()
  expect(await workflow.preview('a',hash('first'))).toBeNull()
  expect(workflow.jobs()).toEqual(expect.arrayContaining([expect.objectContaining({kind:'PROXY',state:'FAILED',error:expect.stringContaining('não confirmou a receita')})]))
  expect(await workflow.archived('a',hash('first'))).toBeTruthy()
})

function mockProxy(work:(source:string,target:string)=>Promise<void>,recipe='picture-raster-v2'){
  vi.mocked(spawn).mockImplementation((_binary,args)=>{
    const child=Object.assign(new EventEmitter(),{stdout:new PassThrough(),stderr:new PassThrough(),kill:vi.fn(),pid:undefined})
    void work(String(args?.[0]),String(args?.[1])).then(()=>{child.stdout.write(JSON.stringify({ok:true,recipe})+'\n');child.emit('close',0)},()=>child.emit('close',1))
    return child as unknown as ReturnType<typeof spawn>
  })
}
