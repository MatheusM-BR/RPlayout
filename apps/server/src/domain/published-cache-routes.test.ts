import { afterEach,beforeEach,describe,expect,it } from 'vitest'
import Fastify from 'fastify'
import { createHash } from 'node:crypto'
import { mkdtemp,readFile,rm,writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { createApp,runtimeFor,type App } from '../app.js'
import { registerRoutes } from '../routes.js'
import { channels,mediaAssets,rundowns,rundownItems } from '../db/schema.js'
import { getChannel } from '../db/repo.js'
import { publishOperationalPlaylist } from './operational-playlist.js'

let app:App,server:ReturnType<typeof Fastify>,dir:string
const date = (value:Date)=>`${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}`
beforeEach(async()=>{
  dir=await mkdtemp(join(tmpdir(),'rplayout-future-cache-'))
  const previous=process.env.RPLAYOUT_CACHE
  process.env.RPLAYOUT_CACHE=join(dir,'cache')
  try {app=await createApp(':memory:')} finally { if (previous===undefined) delete process.env.RPLAYOUT_CACHE; else process.env.RPLAYOUT_CACHE=previous }
  const createdAt=new Date().toISOString()
  await app.db.insert(channels).values({id:'ch',name:'Teste',rateNum:25,rateDen:1,width:320,height:180,targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,createdAt})
  for (const [id,days] of [['current',-10],['tomorrow',1],['extended',4]] as const) {
    const scheduled=new Date();scheduled.setDate(scheduled.getDate()+days)
    const path=join(dir,`${id}-AÇÃO.mp4`),content=id.repeat(10)
    await writeFile(path,content)
    await app.db.insert(mediaAssets).values({id,title:id,path,contentHash:createHash('sha256').update(content).digest('hex'),kind:'VIDEO',durationFrames:25000,qcStatus:'APPROVED',createdAt})
    await app.db.insert(rundowns).values({id,channelId:'ch',name:id,date:date(scheduled),plannedStart:12*3600*25,loop:false,createdAt,updatedAt:createdAt})
    await app.db.insert(rundownItems).values({id:`item-${id}`,rundownId:id,sortOrder:0,title:id,type:'VT',mediaId:id,durationOverride:25000,minDuration:0,anchor:{kind:'FLOW'},onOverrun:'PUSH',locked:false,autoNext:true,loop:false})
    await publishOperationalPlaylist(app.db,(await getChannel(app.db,'ch'))!,id,'test')
  }
  const runtime=(await runtimeFor(app,'ch'))!
  await runtime.load('current')
  await runtime.transport.take('current','item-current')
  await runtime.transport.cue({kind:'ITEM',id:'item-current'})
  server=Fastify();registerRoutes(app,server,()=>{});await server.ready()
})
afterEach(async()=>{await server?.close();app?.close();await rm(dir,{recursive:true,force:true})})

describe('cache futuro não é troca de execução',()=>{
  it('prepara grades futuras sem carregar data, publicar edição, alterar PGM/CUE ou prometer 48h',async()=>{
    const runtime=app.runtimes.get('ch')!,state=runtime.transport.state(),revision=runtime.operationalRevision
    const res=await server.inject({method:'POST',url:'/api/v1/continuity/cache/warm?channelId=ch'})
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({cached48h:2,missing48h:0,cached7d:3,missing7d:0,status:{prefetch:{publishedRevisions:2,plannedFiles48h:2,preparedFiles48h:2,plannedFiles7d:3,preparedFiles7d:3}}})
    expect(runtime.view?.rundown.id).toBe('current')
    expect(runtime.operationalRevision).toEqual(revision)
    const after=runtime.transport.state()
    expect(after).toMatchObject({onAir:{itemId:state.onAir!.itemId,startedAt:state.onAir!.startedAt},preview:state.preview})
    expect(after.onAir!.elapsed).toBeGreaterThanOrEqual(state.onAir!.elapsed)
    expect(res.json().status.offlineAutonomyHours).toBeLessThan(1)
    expect(res.json().status.status).not.toBe('AIR_GAP_READY')
    const asset=runtime.cachePins()[0]!
    expect(await readFile(asset.path,'utf8')).toBe('current'.repeat(10))
    expect(asset.path.startsWith(app.continuityCache.root)).toBe(true)
  })
  it('revisão nova substitui proteção futura antiga, sem liberar o arquivo atualmente no PGM',async()=>{
    await server.inject({method:'POST',url:'/api/v1/continuity/cache/warm?channelId=ch'})
    const runtime=app.runtimes.get('ch')!,program=runtime.cachePins()[0]!
    const oldFuture={id:'tomorrow',contentHash:createHash('sha256').update('tomorrow'.repeat(10)).digest('hex'),path:join(dir,'tomorrow-AÇÃO.mp4')}
    expect(app.continuityCache.isProtected(app.continuityCache.pathFor(oldFuture))).toBe(true)
    await app.db.delete(rundownItems).where(eq(rundownItems.rundownId,'tomorrow'))
    await publishOperationalPlaylist(app.db,runtime.channel,'tomorrow','test')
    await server.inject({method:'POST',url:'/api/v1/continuity/cache/warm?channelId=ch'})
    expect(app.continuityCache.isProtected(app.continuityCache.pathFor(oldFuture))).toBe(false)
    expect(app.continuityCache.isProtected(app.continuityCache.pathFor(program))).toBe(true)
    expect(runtime.transport.state().onAir?.itemId).toBe('item-current')
  })
})
