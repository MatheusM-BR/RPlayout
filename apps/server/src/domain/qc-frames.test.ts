import Fastify,{type FastifyInstance} from 'fastify'
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {mkdtemp,writeFile,rm,readdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {gunzipSync} from 'node:zlib'
import {createApp,type App} from '../app.js'
import {registerRoutes} from '../routes.js'
import {mediaAssets} from '../db/schema.js'
import {qcFramePositionNs,qcLastFrame} from './qc-frames.js'

vi.mock('../config.js',async original=>({...await original<Record<string,unknown>>(),ENGINE_BINARY:'',MEDIAMTX_BINARY:'',DEVICES_BINARY:'',AUTH_USER:'',AUTH_PASSWORD:'',DEFAULT_ROLE:'ADMIN'}))

describe('posição do quadro exato do QC',()=>{
  it('mira o meio do quadro na cadência do arquivo',()=>{
    expect(qcFramePositionNs(0,{num:30000,den:1001})).toBe(16683333)
    expect(qcFramePositionNs(150,{num:30000,den:1001})).toBe(5021683333)
    expect(qcFramePositionNs(10,{num:25,den:1})).toBe(420000000)
  })
  it('último quadro de um arquivo de 300 quadros em 29,97 é 299',()=>{
    expect(qcLastFrame(10_010_000_000,{num:30000,den:1001})).toBe(299)
    expect(qcLastFrame(null,{num:25,den:1})).toBeNull()
  })
})

let app:App,server:FastifyInstance,directory:string
beforeEach(async()=>{
  directory=await mkdtemp(join(tmpdir(),'RPlayout-qc-frame-'))
  const original=join(directory,'barras.mov');await writeFile(original,'X')
  app={...await createApp(':memory:'),thumbnailDir:directory}
  app.db.insert(mediaAssets).values({id:'asset',contentHash:'hash',path:original,title:'Barras',kind:'VIDEO',durationFrames:300,durationNs:10_010_000_000,
    width:1920,height:1080,rateNum:30000,rateDen:1001,interlaceMode:'progressive',hasAudio:true,audioChannels:2,createdAt:new Date().toISOString()}).run()
  vi.spyOn(app.mediaWorkflow,'inspectionOriginal').mockResolvedValue(original)
  server=Fastify();registerRoutes(app,server,()=>{});await server.ready()
})
afterEach(async()=>{vi.restoreAllMocks();await server.close();app.close();await rm(directory,{recursive:true,force:true})})

describe('rota de quadro exato do QC',()=>{
  it('uma extração serve JPEG e Y\'CbCr, no quadro pedido, e não deixa arquivo no disco',async()=>{
    const extract=vi.spyOn(app.ingest,'qcFrame').mockImplementation(async(_path,_position,prefixo)=>{
      await writeFile(`${prefixo}.jpg`,'JPEG');await writeFile(`${prefixo}.ycc`,Buffer.from('RPYC-dados'))
      return {ptsNs:5005005000}
    })
    const jpg=await server.inject('/api/assets/asset/qc-frame/150.jpg?hash=hash')
    expect(jpg.statusCode,jpg.body).toBe(200)
    expect(jpg.headers['content-type']).toBe('image/jpeg')
    expect(jpg.headers['x-rplayout-frame-index']).toBe('150')
    const ycc=await server.inject({url:'/api/assets/asset/qc-frame/150.ycc?hash=hash',headers:{'accept-encoding':'gzip'}})
    expect(ycc.headers['content-encoding']).toBe('gzip')
    expect(gunzipSync(ycc.rawPayload).toString()).toBe('RPYC-dados')
    expect(extract).toHaveBeenCalledTimes(1)
    expect(extract).toHaveBeenCalledWith(expect.any(String),5021683333,expect.any(String),1920,960)
    expect((await readdir(join(directory,'qc-tmp')).catch(()=>[])).length).toBe(0)
  })
  it('quadro além do fim cai no último; sem hash ou com hash velho não decodifica',async()=>{
    const extract=vi.spyOn(app.ingest,'qcFrame').mockResolvedValue(null)
    expect((await server.inject('/api/assets/asset/qc-frame/1.jpg')).statusCode).toBe(428)
    expect((await server.inject('/api/assets/asset/qc-frame/1.jpg?hash=old')).statusCode).toBe(409)
    expect(extract).not.toHaveBeenCalled()
    expect((await server.inject('/api/assets/asset/qc-frame/99999.jpg?hash=hash')).statusCode).toBe(425)
    expect(extract).toHaveBeenCalledWith(expect.any(String),qcFramePositionNs(299,{num:30000,den:1001}),expect.any(String),1920,960)
  })
})
