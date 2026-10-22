import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { createApp, type App } from '../app.js'
import { registerRoutes } from '../routes.js'
import { applyQcDecisions } from './qc-workflow.js'
import { assetMap } from '../db/repo.js'
import { DEFAULT_QC_PROFILE } from '@rplayout/protocol'
import {qcAssetETag} from '@rplayout/protocol'
vi.mock('../config.js', async importOriginal => ({ ...await importOriginal<Record<string, unknown>>(), ENGINE_BINARY: '', MEDIAMTX_BINARY: '', DEVICES_BINARY: '', DEFAULT_ROLE: 'ADMIN' }))
let app: App, server: FastifyInstance
beforeEach(async () => {
  app = await createApp(':memory:')
  const now = new Date().toISOString()
  for (const id of ['ch', 'other']) app.sqlite.prepare('INSERT INTO channels (id,name,rate_num,rate_den,width,height,target_lufs,ceiling_dbtp,limiter_lookahead_ms,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(id,id,25,1,320,180,-23,-1,5,now)
  app.sqlite.prepare("INSERT INTO media_assets (id,content_hash,path,title,kind,duration_frames,duration_ns,width,height,rate_num,rate_den,interlace_mode,has_audio,qc_status,created_at) VALUES ('a','original','test.mp4','AÇÃO','VIDEO',250,10000000000,320,180,25,1,'progressive',1,'PENDING',?)").run(now)
  server = Fastify(); registerRoutes(app, server, () => {}); await server.ready(); await app.sources.list()
})
afterEach(async () => { await server.close(); app.close() })
const review=()=>server.inject({url:'/api/assets/a/qc?channelId=ch'})
const decide = async(status: string, notes?: string, contentHash = 'original') => server.inject({ method: 'POST', url: '/api/assets/a/qc',headers:{'if-match':(await review()).headers.etag!}, payload: { channelId: 'ch', contentHash, status, notes } })
const profile=async(payload:object)=>server.inject({method:'PUT',url:'/api/channels/ch/qc-profile',headers:{'if-match':(await server.inject({url:'/api/channels/ch/qc-profile'})).headers.etag!},payload})
describe('decisões de QC por hash/canal', () => {
  it('inserção respeita a aprovação do canal, sem liberar o outro canal', async () => {
    const now = new Date().toISOString()
    for (const channel of ['ch', 'other']) app.sqlite.prepare('INSERT INTO rundowns (id,channel_id,name,planned_start,date,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run(`rd-${channel}`, channel, 'Grade', 0, now.slice(0,10), now, now)
    expect((await decide('APPROVED_WITH_NOTES', 'Conferido')).statusCode).toBe(200)
    const insert = (channel: string) => server.inject({ method: 'POST', url: `/api/rundowns/rd-${channel}/items`, headers:{'if-match':app.concurrency.generateETag(`rd-${channel}`)},payload: { mediaId: 'a', type: 'VT' } })
    expect((await insert('ch')).statusCode).toBe(200)
    expect((await insert('other')).statusCode).toBe(400)
    expect((await server.inject({ url: '/api/library?channelId=ch' })).json().folders.flatMap((folder: { assets: unknown[] }) => folder.assets).find((asset: { id: string }) => asset.id === 'a')?.qcStatus).toBe('APPROVED_WITH_NOTES')
    // A profile change must invalidate eligibility even with an older approval.
    await profile({ ...DEFAULT_QC_PROFILE, requireLoudness: true })
    expect((await insert('ch')).statusCode).toBe(409)
  })
  it('decisão global e quarentena são atômicas e recusam a versão antiga', async () => {
    expect((await server.inject({ method: 'PATCH', url: '/api/assets/a', payload: { ignored: true, expectedContentHash: 'old' } })).statusCode).toBe(409)
    expect(app.sqlite.prepare('SELECT COUNT(*) AS count FROM qc_decisions').get()).toEqual({ count: 0 })
    const current=(await review()).json().review
    expect((await server.inject({ method: 'PATCH', url: '/api/assets/a',headers:{'if-match':qcAssetETag('a',current.assetRevision)}, payload: { ignored: true, expectedContentHash: 'original' } })).statusCode).toBe(200)
    expect(app.sqlite.prepare("SELECT ignored, qc_status AS status FROM media_assets WHERE id='a'").get()).toEqual({ ignored: 1, status: 'REJECTED' })
    expect(app.sqlite.prepare('SELECT content_hash AS hash, channel_id AS channel, status FROM qc_decisions').get()).toEqual({ hash: 'original', channel: '@all', status: 'REJECTED' })
  })
  it('aprova apenas o canal avaliado, exige ressalva e não transfere aprovação para arquivo alterado', async () => {
    expect((await decide('APPROVED_WITH_NOTES')).statusCode).toBe(400)
    expect((await decide('APPROVED_WITH_NOTES', 'Áudio conferido')).statusCode).toBe(200)
    const assets = await assetMap(app.db)
    expect((await applyQcDecisions(app.db, assets, 'ch')).get('a')?.qcStatus).toBe('APPROVED_WITH_NOTES')
    expect((await applyQcDecisions(app.db, assets, 'other')).get('a')?.qcStatus).toBe('PENDING')
    app.sqlite.prepare("UPDATE media_assets SET content_hash='new', qc_status='PENDING' WHERE id='a'").run()
    expect((await decide('APPROVED')).statusCode).toBe(409)
    expect((await applyQcDecisions(app.db, assets, 'ch')).get('a')?.qcStatus).toBe('APPROVED_WITH_NOTES')
    expect((await applyQcDecisions(app.db, await assetMap(app.db), 'ch')).get('a')?.qcStatus).toBe('PENDING')
  })
  it('perfil persiste e bloqueia aprovação com áudio/loudness obrigatório ausente; decisão BLOCKED auditada', async () => {
    const result = await profile({ ...DEFAULT_QC_PROFILE, requireAudio: true, requireLoudness: true })
    expect(result.statusCode).toBe(200)
    expect((await server.inject({ url: '/api/channels/ch/qc-profile' })).json().profile.requireLoudness).toBe(true)
    expect((await decide('APPROVED')).statusCode).toBe(409)
    expect((await decide('BLOCKED', 'Aguardar nova mixagem')).statusCode).toBe(200)
    expect(app.sqlite.prepare("SELECT kind FROM operator_decisions WHERE kind='QC_DECISION'").get()).toEqual({ kind: 'QC_DECISION' })
    expect((await applyQcDecisions(app.db, await assetMap(app.db), 'ch')).get('a')?.qcStatus).toBe('BLOCKED')
  })
})
