import {afterEach,beforeEach,expect,it} from 'vitest'
import {mkdtemp,mkdir,writeFile,readFile,rm,utimes,symlink,link} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {randomUUID} from 'node:crypto'
import {openDatabase} from '../db/client.js'
import {cleanupMediaPartials} from './media-partial-cleanup.js'
let db:ReturnType<typeof openDatabase>,directory:string,root:string,job:string
const hash='a'.repeat(64),now=Date.now(),old=new Date(now-25*60*60_000)
beforeEach(async()=>{
  directory=await mkdtemp(join(tmpdir(),'rplayout-partial-cleanup-'));root=join(directory,'versions');await mkdir(root)
  db=openDatabase(':memory:');job=randomUUID()
  db.sqlite.prepare("INSERT INTO media_assets(id,content_hash,path,title,kind,duration_frames,created_at) VALUES('a',?,'original.mp4','Original','VIDEO',25,'now')").run(hash)
  db.sqlite.prepare("INSERT INTO media_versions(id,asset_id,revision,content_hash,metadata,created_at) VALUES('v','a',1,?,?,'now')").run(hash,JSON.stringify({path:'original.mp4'}))
  db.sqlite.prepare("INSERT INTO media_jobs(id,version_id,kind,state,created_at,updated_at) VALUES(?,'v','PROXY','FAILED','now','now')").run(job)
})
afterEach(async()=>{db.sqlite.close();await rm(directory,{recursive:true,force:true})})
async function partial(aged=true,id=job){const path=join(root,`${hash}.proxy.mp4.${id}.${randomUUID()}.part`);await writeFile(path,'partial');if(aged)await utimes(path,old,old);return path}
it('remove só parcial velho conhecido; preserva recente, nome desconhecido, original e proxy publicado',async()=>{
  const stale=await partial(),fresh=await partial(false),unknown=join(root,'unknown.part'),original=join(root,'original.mp4'),proxy=join(root,hash+'.proxy.mp4')
  for(const path of [unknown,original,proxy])await writeFile(path,'keep')
  const result=await cleanupMediaPartials(db.sqlite,root,now)
  expect(result).toMatchObject({removed:1,preserved:2,errors:0});await expect(readFile(stale)).rejects.toMatchObject({code:'ENOENT'})
  for(const path of [fresh,unknown,original,proxy])expect(await readFile(path,'utf8')).toBe(path===fresh?'partial':'keep')
})
it.each(['RUNNING','UNCERTAIN'] as const)('preserva temporário de trabalho %s mesmo velho',async state=>{
  const path=await partial()
  db.sqlite.prepare('UPDATE media_jobs SET state=?,error=?').run(state==='RUNNING'?'RUNNING':'FAILED',state==='UNCERTAIN'?'Trabalho sem responsável identificável; confira o encerramento anterior antes de tentar novamente.':null)
  expect((await cleanupMediaPartials(db.sqlite,root,now)).removed).toBe(0);expect(await readFile(path,'utf8')).toBe('partial')
})
it('protege caminho reconhecido que foi catalogado como original ou arquivo de versão',async()=>{
  const source=await partial(),archive=await partial()
  db.sqlite.prepare('UPDATE media_assets SET path=?').run(source.replaceAll('\\','/'))
  db.sqlite.prepare('UPDATE media_versions SET archive_path=?').run(archive)
  expect((await cleanupMediaPartials(db.sqlite,root,now)).removed).toBe(0)
  expect(await readFile(source,'utf8')).toBe('partial');expect(await readFile(archive,'utf8')).toBe('partial')
})
it('preserva job desconhecido, metadados inválidos e múltiplos hardlinks',async()=>{
  const unknown=await partial(true,randomUUID()),invalid=await partial(),linked=await partial()
  await link(linked,join(directory,'outside-original.mp4'))
  db.sqlite.exec("UPDATE media_versions SET metadata='broken'")
  expect((await cleanupMediaPartials(db.sqlite,root,now)).removed).toBe(0)
  for(const path of [unknown,invalid,linked])expect(await readFile(path,'utf8')).toBe('partial')
})
it('não atravessa diretório ou raiz redirecionada',async()=>{
  const name=`${hash}.proxy.mp4.${job}.${randomUUID()}.part`,folder=join(root,name);await mkdir(folder)
  const redirected=join(directory,'redirected');await symlink(root,redirected,process.platform==='win32'?'junction':'dir')
  await expect(cleanupMediaPartials(db.sqlite,redirected,now)).rejects.toThrow('redirecionada')
  expect((await cleanupMediaPartials(db.sqlite,root,now)).removed).toBe(0)
})
it('não remove hardlink reconhecido mesmo com metadata válida e job parado',async()=>{
  const path=await partial(),other=join(directory,'other-copy.mp4');await link(path,other)
  expect((await cleanupMediaPartials(db.sqlite,root,now)).removed).toBe(0)
  expect(await readFile(path,'utf8')).toBe('partial');expect(await readFile(other,'utf8')).toBe('partial')
})
it('continua depois de 200 desconhecidos sem deixar órfãos válidos eternamente atrás deles',async()=>{
  for(let index=0;index<200;index++)await writeFile(join(root,`0-unknown-${String(index).padStart(3,'0')}.part`),'keep')
  const stale=await partial(),first=await cleanupMediaPartials(db.sqlite,root,now)
  expect(first.removed).toBe(0);expect(first.cursor).toBeTruthy()
  const second=await cleanupMediaPartials(db.sqlite,root,now,first.cursor)
  expect(second.removed).toBe(1);expect(second.cursor).toBeNull()
  await expect(readFile(stale)).rejects.toMatchObject({code:'ENOENT'})
  expect(await readFile(join(root,'0-unknown-000.part'),'utf8')).toBe('keep')
})
