import Fastify,{type FastifyInstance} from 'fastify'
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {mkdtemp,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createApp,type App} from '../app.js'
import {registerRoutes} from '../routes.js'
import {mediaAssets} from '../db/schema.js'
import {createHash} from 'node:crypto'
import {eq} from 'drizzle-orm'

vi.mock('../config.js',async original=>({...await original<Record<string,unknown>>(),ENGINE_BINARY:'',MEDIAMTX_BINARY:'',DEVICES_BINARY:'',AUTH_USER:'',AUTH_PASSWORD:'',DEFAULT_ROLE:'ADMIN'}))
let app:App,server:FastifyInstance,directory:string,proxy:string
beforeEach(async()=>{
  directory=await mkdtemp(join(tmpdir(),'RPlayout-light-preview-'))
  const original=join(directory,'Ação-original.mxf');proxy=join(directory,'low.proxy.mp4')
  await writeFile(original,'FULL_ORIGINAL_MUST_NOT_BE_PREVIEW')
  await writeFile(proxy,'LOW_PROXY_ONLY')
  app=await createApp(':memory:')
  app.db.insert(mediaAssets).values({id:'asset',contentHash:'hash',path:original,title:'Vídeo',kind:'VIDEO',durationFrames:250,createdAt:new Date().toISOString()}).run()
  server=Fastify();registerRoutes(app,server,()=>{});await server.ready()
})
afterEach(async()=>{vi.restoreAllMocks();await server.close();app.close();await rm(directory,{recursive:true,force:true})})
describe('preview não cai silenciosamente no vídeo original',()=>{
  it('proxy pronto serve apenas arquivo leve, incluindo range',async()=>{
    const lookup=vi.spyOn(app.mediaWorkflow,'preview').mockResolvedValue(proxy)
    const response=await server.inject({url:'/api/assets/asset/media?preview=1&hash=hash'})
    expect(response.statusCode,response.body).toBe(200);expect(response.body).toBe('LOW_PROXY_ONLY')
    expect(lookup).toHaveBeenCalledWith('asset','hash')
    const range=await server.inject({url:'/api/assets/asset/media?preview=1&hash=hash',headers:{range:'bytes=0-2'}})
    expect(range.statusCode).toBe(206);expect(range.body).toBe('LOW')
  })
  it('proxy ausente recusa 425 em vez de baixar original',async()=>{
    vi.spyOn(app.mediaWorkflow,'preview').mockResolvedValue(null)
    const response=await server.inject({url:'/api/assets/asset/media?preview=1&hash=hash'})
    expect(response.statusCode).toBe(425);expect(response.body).not.toContain('FULL_ORIGINAL')
  })
  it('identidade antiga é recusada antes de consultar/servir outro proxy',async()=>{
    const lookup=vi.spyOn(app.mediaWorkflow,'preview').mockResolvedValue(proxy)
    const response=await server.inject({url:'/api/assets/asset/media?preview=1&hash=previous'})
    expect(response.statusCode).toBe(409);expect(lookup).not.toHaveBeenCalled();expect(response.body).not.toContain('LOW_PROXY_ONLY')
  })
  it('acesso explícito ao original permanece separado do preview',async()=>{
    const response=await server.inject({url:'/api/assets/asset/media'})
    expect(response.statusCode).toBe(200);expect(response.body).toBe('FULL_ORIGINAL_MUST_NOT_BE_PREVIEW')
  })
  it('inspeção em qualidade serve original e range somente na versão selecionada',async()=>{
    const hash=createHash('sha256').update('FULL_ORIGINAL_MUST_NOT_BE_PREVIEW').digest('hex')
    app.db.update(mediaAssets).set({contentHash:hash}).where(eq(mediaAssets.id,'asset')).run()
    const lookup=vi.spyOn(app.mediaWorkflow,'preview').mockResolvedValue(proxy)
    const response=await server.inject(`/api/assets/asset/media?quality=original&hash=${hash}`)
    expect(response.statusCode).toBe(200);expect(response.body).toBe('FULL_ORIGINAL_MUST_NOT_BE_PREVIEW')
    expect(response.headers['x-rplayout-rendition']).toBe('original')
    expect(response.headers['cache-control']).toBe('private, no-store');expect(lookup).not.toHaveBeenCalled()
    const range=await server.inject({url:`/api/assets/asset/media?quality=original&hash=${hash}`,headers:{range:'bytes=0-3'}})
    expect(range.statusCode).toBe(206);expect(range.body).toBe('FULL')
    for(const [url,status] of [
      ['/api/assets/asset/media?quality=original',428],
      ['/api/assets/asset/media?quality=original&hash=old',409],
      ['/api/assets/asset/media?quality=original&preview=1&hash=hash',400],
    ] as const){const denied=await server.inject(url);expect(denied.statusCode).toBe(status);expect(denied.body).not.toContain('FULL_ORIGINAL')}
  })
  it('quadros de qualidade não se passam por miniaturas quando a extração falha',async()=>{
    vi.spyOn(app.mediaWorkflow,'inspectionOriginal').mockResolvedValue('verified-original')
    const extract=vi.spyOn(app.ingest,'strip').mockResolvedValue(0)
    expect((await server.inject('/api/assets/asset/frame/0.jpg?total=24&quality=original')).statusCode).toBe(428)
    expect((await server.inject('/api/assets/asset/frame/0.jpg?total=24&quality=original&hash=old')).statusCode).toBe(409)
    expect(extract).not.toHaveBeenCalled()
    const response=await server.inject('/api/assets/asset/frame/0.jpg?total=24&quality=original&hash=hash')
    expect(response.statusCode).toBe(425);expect(response.headers.location).toBeUndefined()
    expect(extract).toHaveBeenCalledWith(expect.any(String),24,expect.stringContaining('hash-24-qc-1920'),1920)
  })
  it('original substituído no mesmo caminho é recusado sem servir nem extrair a nova edição',async()=>{
    const hash=createHash('sha256').update('FULL_ORIGINAL_MUST_NOT_BE_PREVIEW').digest('hex')
    app.db.update(mediaAssets).set({contentHash:hash}).where(eq(mediaAssets.id,'asset')).run()
    expect((await server.inject(`/api/assets/asset/media?quality=original&hash=${hash}`)).statusCode).toBe(200)
    await writeFile(app.db.select().from(mediaAssets).get()!.path,'ALTERED_BYTES_AFTER_SCAN')
    const extract=vi.spyOn(app.ingest,'strip').mockResolvedValue(0)
    for(const path of [`media?quality=original&hash=${hash}`,`frame/0.jpg?total=24&quality=original&hash=${hash}`]){
      const response=await server.inject(`/api/assets/asset/${path}`)
      expect(response.statusCode).toBe(409);expect(response.body).not.toContain('ALTERED_BYTES')
    }
    expect(extract).not.toHaveBeenCalled()
  })
  it('workflow conserva hash na URL e não substitui a versão selecionada por outra',async()=>{
    const lookup=vi.spyOn(app.mediaWorkflow,'preview').mockResolvedValue(proxy)
    const response=await server.inject({url:'/api/assets/asset/workflow?hash=hash'})
    expect(response.statusCode).toBe(200);expect(response.json().previewUrl).toBe('/api/assets/asset/media?preview=1&hash=hash')
    lookup.mockClear()
    expect((await server.inject({url:'/api/assets/asset/workflow?hash=previous'})).statusCode).toBe(409)
    expect(lookup).not.toHaveBeenCalled()
  })
})
