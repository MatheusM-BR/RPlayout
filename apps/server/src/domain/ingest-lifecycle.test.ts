import {afterEach,beforeEach,it,expect,vi} from 'vitest'
import {EventEmitter} from 'node:events'
import {PassThrough} from 'node:stream'
import {mkdtempSync,mkdirSync,writeFileSync,utimesSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {spawn} from 'node:child_process'
import {openDatabase} from '../db/client.js'
import {Ingest} from './ingest.js'
vi.mock('node:child_process',async original=>({...await original<Record<string,unknown>>(),spawn:vi.fn()}))
let db:ReturnType<typeof openDatabase>,directory:string,ingest:Ingest
beforeEach(()=>{db=openDatabase(':memory:');directory=mkdtempSync(join(tmpdir(),'RPlayout-ingest-close-'));mkdirSync(join(directory,'media'));ingest=new Ingest(db.db,'probe',join(directory,'thumbs'),undefined,db.sqlite)})
afterEach(async()=>{await ingest.close();db.sqlite.close();vi.restoreAllMocks();rmSync(directory,{recursive:true,force:true})})
it('quadro QC deduplica por índice e exige receita confirmada, sem afetar a fita leve',async()=>{
  const children:Array<ReturnType<typeof spawn>>=[]
  vi.mocked(spawn).mockImplementation(()=>{
    const child=Object.assign(new EventEmitter(),{stdout:new PassThrough(),stderr:new PassThrough(),stdin:new PassThrough(),kill:vi.fn(()=>true),pid:12345}) as unknown as ReturnType<typeof spawn>
    children.push(child);return child
  })
  const prefix=join(directory,'quadros'),first=ingest.strip('own.mkv',24,prefix,1920,5),duplicate=ingest.strip('own.mkv',24,prefix,1920,5),other=ingest.strip('own.mkv',24,prefix,1920,6)
  expect(duplicate).toBe(first);expect(children).toHaveLength(2)
  expect(vi.mocked(spawn).mock.calls[0]![1]).toContain('--only-frame')
  children[0]!.stdout!.emit('data',Buffer.from('{"ok":true,"thumbnail":"1","frameRecipe":"qc-frame-v3"}'));children[0]!.emit('close',0)
  children[1]!.stdout!.emit('data',Buffer.from('{"ok":true,"thumbnail":"1"}'));children[1]!.emit('close',0)
  expect(await first).toBe(1);expect(await other).toBe(0)
  const strip=ingest.strip('own.mkv',24,prefix,320)
  expect(vi.mocked(spawn).mock.calls[2]![1]).not.toContain('--only-frame')
  children[2]!.stdout!.emit('data',Buffer.from('{"ok":true,"thumbnail":"24"}'));children[2]!.emit('close',0)
  expect(await strip).toBe(24)
})
it('encerramento aguarda reconciliação do acervo e não grava falha tardia',async()=>{
  db.sqlite.prepare("INSERT INTO media_assets(id,content_hash,path,title,kind,duration_frames,created_at) VALUES('a','fixture',?,'Video','VIDEO',25,'now')").run(join(directory,'missing.mxf'))
  const checking=ingest.reconcileAvailability();expect(ingest.isDraining).toBe(true)
  await ingest.close();expect(await checking).toBe(false);expect(ingest.isDraining).toBe(false)
  expect(db.sqlite.prepare("SELECT probe_error FROM media_assets WHERE id='a'").get()).toEqual({probe_error:null})
  expect(await ingest.reconcileAvailability()).toBe(false)
})
it('close aguarda processo próprio encerrar antes de liberar lote; sucessor retoma mesmo ID',async()=>{
  const file=join(directory,'media','AÇÃO.mxf');writeFileSync(file,'fixture');utimesSync(file,new Date('2020-01-01'),new Date('2020-01-01'))
  let started!:()=>void;const ready=new Promise<void>(done=>{started=done})
  const child=Object.assign(new EventEmitter(),{stdout:new PassThrough(),stderr:new PassThrough(),stdin:new PassThrough(),kill:vi.fn(()=>true),pid:12345})
  vi.mocked(spawn).mockImplementation(()=>{started();return child as unknown as ReturnType<typeof spawn>})
  expect(ingest.start(join(directory,'media'),false)).toBe(true);await ready
  expect(vi.mocked(spawn).mock.calls[0]![1]).toContain('--parent-pipe')
  const row=db.sqlite.prepare('SELECT id,state FROM ingest_batches').get() as {id:string;state:string}
  const successor=new Ingest(db.db,'probe',join(directory,'thumbs'),undefined,db.sqlite)
  expect(successor.resumePending()).toBe(false)
  let closed=false;const closing=ingest.close().then(()=>{closed=true});await Promise.resolve()
  expect(closed).toBe(false);expect(db.sqlite.prepare('SELECT state FROM ingest_batches').get()).toEqual({state:'RUNNING'});expect(child.kill).toHaveBeenCalledOnce()
  child.emit('close',1);await closing;expect(closed).toBe(true)
  expect(db.sqlite.prepare('SELECT id,state,owner_boot FROM ingest_batches').get()).toEqual({id:row.id,state:'PENDING',owner_boot:null})
  expect(db.sqlite.prepare('SELECT COUNT(*) n FROM media_assets').get()).toEqual({n:0});expect(ingest.start(join(directory,'media'))).toBe(false)
  const start=db.sqlite.prepare('SELECT created_at FROM ingest_batches').get();expect(successor.resumePending()).toBe(true)
  const close=successor.close();child.emit('close',1);await close
  expect(db.sqlite.prepare('SELECT id,created_at FROM ingest_batches').get()).toEqual({id:row.id,...start as object})
})
it('banco indisponível ao fechar o lote não derruba o processo (22/10: servidor e PGM caíram)',async()=>{
  const rejections:unknown[]=[],onRejection=(reason:unknown)=>{rejections.push(reason)}
  process.on('unhandledRejection',onRejection)
  try{
    const ownership=(ingest as unknown as {ownership:{finish:(...args:unknown[])=>void}}).ownership
    vi.spyOn(ownership,'finish').mockImplementation(()=>{throw new Error('Banco indisponível; conexão não será reaberta.')})
    expect(ingest.start(join(directory,'media'),false)).toBe(true)
    await vi.waitFor(()=>expect(ingest.status().running).toBe(false))
    await new Promise(resolve=>setTimeout(resolve,20))
    expect(rejections).toEqual([])
    expect(ingest.status().error).toContain('banco indisponível')
  }finally{process.off('unhandledRejection',onRejection)}
})
