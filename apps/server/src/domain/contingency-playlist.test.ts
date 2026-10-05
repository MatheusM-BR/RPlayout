import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { openDatabase } from '../db/client.js'
import { channels, mediaAssets, operationalPlaylistRevisions, qcDecisions, rundownItems, rundowns } from '../db/schema.js'
import { getChannel } from '../db/repo.js'
import { publishOperationalPlaylist, readOperationalPayload, type OperationalPayload } from './operational-playlist.js'
import { configuredContingencyAssets, prepareContingencyPlaylist } from './contingency-playlist.js'

let database: ReturnType<typeof openDatabase>, revisionId: string
const now = new Date().toISOString(), hash = 'a'.repeat(64)
beforeEach(async () => {
  database = openDatabase(':memory:')
  for (const id of ['ch', 'other']) await database.db.insert(channels).values({ id, name: id, rateNum: 25, rateDen: 1, width: 320, height: 180, targetLufs: -23, ceilingDbtp: -1, limiterLookaheadMs: 5, createdAt: now })
  await database.db.insert(rundowns).values({ id: 'reserve', channelId: 'ch', name: 'Reserva — ação', plannedStart: 0, loop: true, date: '2026-10-01', createdAt: now, updatedAt: now })
  await database.db.insert(mediaAssets).values({ id: 'asset', contentHash: hash, path: '//server/original.mkv', title: 'Publicado', kind: 'VIDEO', durationFrames: 250, durationNs: 10_000_000_000, rateNum: 25, rateDen: 1, width: 320, height: 180, qcStatus: 'APPROVED', createdAt: now })
  await database.db.insert(rundownItems).values({ id: 'vt', rundownId: 'reserve', mediaId: 'asset', sortOrder: 0, type: 'VT', title: 'VT aprovado', anchor: { kind: 'FLOW' }, minDuration: 0, onOverrun: 'PUSH', autoNext: true, loop: false, locked: false })
  revisionId = (await publishOperationalPlaylist(database.db, (await getChannel(database.db, 'ch'))!, 'reserve', 'editor')).id
})
afterEach(() => database.sqlite.close())
const copy = async () => 'C:/verified-cache/ação.media'
async function prepare(loop = true) { return prepareContingencyPlaylist(database.db, (await getChannel(database.db, 'ch'))!, revisionId, copy, loop) }
async function rewrite(change: (payload: OperationalPayload) => OperationalPayload) {
  const row = database.db.select().from(operationalPlaylistRevisions).where(eq(operationalPlaylistRevisions.id, revisionId)).get()!
  await database.db.update(operationalPlaylistRevisions).set({ payload: change(readOperationalPayload(row.payload)) as unknown as Record<string, unknown> }).where(eq(operationalPlaylistRevisions.id, revisionId))
}
describe('playlist de contingência publicada e independente', () => {
  it('proteção de quota usa hashes da publicação e não consulta arquivos nem outros canais', async () => {
    await database.db.update(mediaAssets).set({ contentHash: 'b'.repeat(64) }).where(eq(mediaAssets.id, 'asset'))
    expect(configuredContingencyAssets(database.db, 'ch', revisionId)).toEqual([expect.objectContaining({ id: 'asset', contentHash: hash })])
    expect(configuredContingencyAssets(database.db, 'other', revisionId)).toEqual([])
    expect(configuredContingencyAssets(database.db, 'ch', 'missing')).toEqual([])
  })
  it('usa fotografia publicada e cópia verificada, não alterações editoriais posteriores', async () => {
    await database.db.update(rundowns).set({ loop: false, name: 'NÃO PUBLICADO' }).where(eq(rundowns.id, 'reserve'))
    await database.db.update(rundownItems).set({ title: 'EDITADO', autoNext: false, sourceRef: 'ndi:NÃO PUBLICADO' }).where(eq(rundownItems.id, 'vt'))
    await database.db.update(mediaAssets).set({ path: 'C:/alterado.mkv', contentHash: 'b'.repeat(64) }).where(eq(mediaAssets.id, 'asset'))
    const result = await prepare()
    expect(result.view.rundown).toMatchObject({ name: 'Reserva — ação', loop: true })
    expect(result.view.items[0]).toMatchObject({ item: { title: 'VT aprovado', autoNext: true, sourceRef: null }, asset: { contentHash: hash, path: 'C:/verified-cache/ação.media' } })
    expect(result.isCurrent()).toBe(true)
    expect(database.sqlite.prepare('SELECT count(*) n FROM channel_checkpoints').get()).toEqual({ n: 0 })
    expect(database.sqlite.prepare('SELECT count(*) n FROM as_run').get()).toEqual({ n: 0 })
  })
  it('não autoriza presença do original/rede como prova de cópia local da edição', async () => {
    await expect(prepareContingencyPlaylist(database.db, (await getChannel(database.db, 'ch'))!, revisionId, async () => null)).rejects.toThrow('cópia local verificada')
    await rewrite(payload => ({ ...payload, assets: payload.assets!.map(asset => ({ ...asset, contentHash: 'legacy' })) }))
    await expect(prepare()).rejects.toThrow('cópia local verificada')
  })
  it('exige loop contínuo sem live, horário obrigatório, hold ou SCTE externo', async () => {
    const original = readOperationalPayload(database.db.select().from(operationalPlaylistRevisions).where(eq(operationalPlaylistRevisions.id, revisionId)).get()!.payload)
    const variants: OperationalPayload[] = [
      { ...original, rundown: { ...original.rundown, loop: false } },
      { ...original, items: [] },
      { ...original, items: original.items.map(item => ({ ...item, type: 'LIVE', sourceRef: 'ndi:CAM' })) },
      { ...original, items: original.items.map(item => ({ ...item, autoNext: false })) },
      { ...original, items: original.items.map(item => ({ ...item, anchor: { kind: 'HARD_TIME', at: 2500 } })) },
      { ...original, rundown: { ...original.rundown, protectedZones: [{ id: 'z', label: 'Horário', from: 0, to: 250, priority: 5 }] } },
      { ...original, secondaryEvents: [{ id: 'scte', targetLayer: 'LOWER_THIRD', triggerMode: 'MANUAL', offsetFrames: 0, type: 'SCTE_TRIGGER', enabled: true, templateId: '', payload: {} }] },
    ]
    for (const variant of variants) { await rewrite(() => variant); await expect(prepare()).rejects.toThrow() }
  })
  it('rejeição de QC por canal/hash impede configuração e mudança posterior invalida preparação', async () => {
    const prepared = await prepare()
    await database.db.insert(qcDecisions).values({ id: 'block', channelId: 'ch', assetId: 'asset', contentHash: hash, status: 'BLOCKED', notes: 'Sem liberação', checks: { playable: false, errors: ['Bloqueado'], warnings: [] }, createdAt: now })
    expect(prepared.isCurrent()).toBe(false)
    await expect(prepare()).rejects.toThrow('aprovação QC')
    await database.db.delete(qcDecisions)
    const another = await prepare()
    await database.db.update(operationalPlaylistRevisions).set({ active: false, state: 'SUPERSEDED' }).where(eq(operationalPlaylistRevisions.id, revisionId))
    expect(another.isCurrent()).toBe(false)
    await expect(prepare()).rejects.toThrow('substituída')
  })
  it('revisão ausente ou pertencente a outro canal não prepara nada', async () => {
    await expect(prepareContingencyPlaylist(database.db, (await getChannel(database.db, 'other'))!, revisionId, copy)).rejects.toThrow('neste canal')
    await expect(prepareContingencyPlaylist(database.db, (await getChannel(database.db, 'ch'))!, 'missing', copy)).rejects.toThrow('neste canal')
  })
  it('retorno pode preparar a publicação normal, sem transformá-la em loop', async () => {
    await rewrite(payload => ({ ...payload, rundown: { ...payload.rundown, loop: false }, items: payload.items.map(item => ({ ...item, autoNext: false })) }))
    const prepared = await prepare(false)
    expect(prepared.view.rundown.loop).toBe(false)
    expect(prepared.view.items[0]!.item.autoNext).toBe(false)
  })
})
