import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { openDatabase } from '../db/client.js'
import { channels, rundowns, rundownItems, operationalPlaylistRevisions, graphicTemplates, itemGraphics,secondaryEvents,secondaryEventRuns, mediaAssets } from '../db/schema.js'
import type { MediaWorkflow } from './media-workflow.js'
import { getChannel, listItems } from '../db/repo.js'
import { ChannelRuntime } from '../app.js'
import { activeOperationalPlaylist, adjustPublishedLiveDuration, diffOperationalGraphics, diffOperationalItems, publishOperationalPlaylist, readOperationalPayload, rollbackOperationalPlaylist, simulateOperationalPlaylist,assertOnAirMediaUnchanged, persistRevision, retireOperationalInsert } from './operational-playlist.js'

let database: ReturnType<typeof openDatabase>
let runtime: ChannelRuntime
const now = new Date().toISOString()

beforeEach(async () => {
  database = openDatabase(':memory:')
  const db = database.db
  await db.insert(channels).values({ id: 'ch', name: 'Canal', rateNum: 25, rateDen: 1, width: 320, height: 180, targetLufs: -23, ceilingDbtp: -1, limiterLookaheadMs: 5, createdAt: now })
  await db.insert(rundowns).values({ id: 'rd', channelId: 'ch', name: 'Editorial', plannedStart: 0, loop: false, date: '2026-09-30', createdAt: now, updatedAt: now })
  await db.insert(rundownItems).values({ id: 'live', rundownId: 'rd', sortOrder: 0, type: 'LIVE', title: 'Original', sourceRef: 'ndi:CAM 1', durationOverride: 500, minDuration: 0, anchor: { kind: 'FLOW' }, onOverrun: 'PUSH', locked: false, autoNext: true, loop: false })
  runtime = new ChannelRuntime((await getChannel(db, 'ch'))!, db, ['null'])
  await runtime.load('rd')
})
afterEach(() => { runtime?.transport.close(); database.sqlite.close() })

describe('playlist operacional separada da grade editorial', () => {
  it.each(['sourceType','sourceEndpoint','fallbackMediaId'] as const)('protege %s de liveConfig sem impedir ajustar apenas duração',async field=>{
    const base=await simulateOperationalPlaylist(database.db,runtime.channel,'rd'),item=base.items[0]!
    const old={...base,items:[{...item,sourceRef:null,liveConfig:{sourceType:'NDI' as const,sourceEndpoint:'ndi:CAM',fallbackMediaId:null,estimatedDuration:500,maxDuration:null,autoFollowOnEnd:false}}]}
    const changed={...old,items:[{...old.items[0]!,liveConfig:{...old.items[0]!.liveConfig,[field]:field==='sourceType'?'OMT':field==='sourceEndpoint'?'ndi:OTHER':'other-fallback'}}]}
    expect(()=>assertOnAirMediaUnchanged(old,changed as typeof old,'live')).toThrow('fonte ou fallback')
    const durationOnly={...old,items:[{...old.items[0]!,liveConfig:{...old.items[0]!.liveConfig,estimatedDuration:2000}}]}
    expect(()=>assertOnAirMediaUnchanged(old,durationOnly,'live')).not.toThrow()
  })
  async function delayedArchiveRuntime() {
    await database.db.insert(mediaAssets).values({ id: 'slow-asset', contentHash: 'a'.repeat(64), path: 'C:/original.mkv', title: 'VT', kind: 'VIDEO', durationFrames: 250, rateNum: 25, rateDen: 1, createdAt: now })
    await database.db.update(rundownItems).set({ type: 'VT', sourceRef: null, mediaId: 'slow-asset', durationOverride: null }).where(eq(rundownItems.id, 'live'))
    await database.db.insert(rundowns).values({ id: 'other', channelId: 'ch', name: 'Outra', plannedStart: 0, loop: false, date: '2026-10-01', createdAt: now, updatedAt: now })
    await publishOperationalPlaylist(database.db, runtime.channel, 'rd', 'editor')
    let release!: () => void, hold = false
    const gate = new Promise<void>(resolve => { release = resolve })
    const archived = vi.fn(async () => { if (hold) await gate; return null })
    runtime.close()
    runtime = new ChannelRuntime(runtime.channel, database.db, ['null'], null, new Set(), new Map(), null, null, { archived } as unknown as MediaWorkflow)
    return { archived, release, block: () => { hold = true } }
  }
  it('ativação revalida PGM após leitura demorada e não instala grade diferente', async () => {
    const delayed = await delayedArchiveRuntime()
    await runtime.load('other'); delayed.block()
    const before = runtime.transport.state()
    let pgm = false
    const state = vi.spyOn(runtime.transport, 'state').mockImplementation(() => ({ ...before, onAir: pgm ? { itemId: 'other-item', startedAt: 0, elapsed: 0 } : null }))
    try {
      const activation = runtime.activateRundown('rd')
      const refused = expect(activation).rejects.toThrow('Há um item em PGM')
      await vi.waitFor(() => expect(delayed.archived).toHaveBeenCalledTimes(1))
      pgm = true; delayed.release(); await refused
      expect(runtime.executionView?.rundown.id).toBe('other')
      expect(runtime.operationalRevision).toBeNull()
    } finally { state.mockRestore(); delayed.release() }
  })
  it('ativação superada por outra seleção não devolve sucesso para a grade não instalada', async () => {
    const delayed = await delayedArchiveRuntime()
    await runtime.load('other'); delayed.block()
    const activation = runtime.activateRundown('rd')
    const refused = expect(activation).rejects.toThrow('Outra seleção substituiu')
    await vi.waitFor(() => expect(delayed.archived).toHaveBeenCalledTimes(1))
    await runtime.load('other'); delayed.release(); await refused
    expect(runtime.executionView?.rundown.id).toBe('other')
  })
  it('load antigo aguardando arquivo não reinstala a grade após uma seleção mais recente', async () => {
    const delayed = await delayedArchiveRuntime()
    await runtime.load('other'); delayed.block()
    const old = runtime.load('rd')
    await vi.waitFor(() => expect(delayed.archived).toHaveBeenCalledTimes(1))
    expect(runtime.executionView?.rundown.id).toBe('other')
    expect(runtime.operationalRevision).toBeNull()
    await runtime.load('other')
    delayed.release(); await old
    expect(runtime.executionView?.rundown.id).toBe('other')
    expect(runtime.operationalRevision).toBeNull()
  })
  it('telemetria compartilha uma única atualização lenta sem impedir um load explícito', async () => {
    const delayed = await delayedArchiveRuntime()
    await runtime.load('rd'); delayed.archived.mockClear(); delayed.block()
    const first = runtime.refreshForTelemetry(), second = runtime.refreshForTelemetry(), third = runtime.refreshForTelemetry()
    expect(second).toBe(first); expect(third).toBe(first)
    await vi.waitFor(() => expect(delayed.archived).toHaveBeenCalledTimes(1))
    await runtime.load('other')
    delayed.release(); await first
    expect(runtime.executionView?.rundown.id).toBe('other')
    expect(delayed.archived).toHaveBeenCalledTimes(1)
  })
  it('alteração somente no SVG de evento secundário aparece no diff de publicação',async()=>{
    await database.db.insert(graphicTemplates).values({id:'svg-only',name:'Arte',svg:'<svg>ORIGINAL</svg>',fields:[],fadeMs:0,createdAt:now})
    const definition={id:'event-only',rundownItemId:'live',targetLayer:'LOWER_THIRD' as const,triggerMode:'MANUAL' as const,offsetFrames:0,templateId:'svg-only',payload:{},enabled:true,type:'GRAPHICS_OVERLAY' as const}
    await database.db.insert(secondaryEvents).values({id:definition.id,channelId:'ch',itemId:'live',definition,createdAt:now,updatedAt:now})
    const first=await simulateOperationalPlaylist(database.db,runtime.channel,'rd')
    await database.db.update(graphicTemplates).set({svg:'<svg>ALTERADO</svg>'}).where(eq(graphicTemplates.id,'svg-only'))
    expect(diffOperationalGraphics(first,await simulateOperationalPlaylist(database.db,runtime.channel,'rd'))).toEqual(['live'])
  })
  it('congela eventos secundários e seu SVG; remoção editorial não altera disparo publicado',async()=>{
    await database.db.insert(graphicTemplates).values({id:'cg',name:'Publicado',svg:'<svg><text>{{nome}}</text></svg>',fields:[],fadeMs:0,createdAt:now})
    const event={id:'secondary',channelId:'ch',rundownItemId:'live',name:'Crédito',targetLayer:'LOWER_THIRD' as const,triggerMode:'OFFSET_FROM_START' as const,offsetFrames:0,durationFrames:200,templateId:'cg',payload:{nome:'PUBLICADO'},enabled:true,type:'GRAPHICS_OVERLAY' as const}
    await database.db.insert(secondaryEvents).values({id:event.id,channelId:'ch',itemId:'live',definition:event,createdAt:now,updatedAt:now})
    const published=await publishOperationalPlaylist(database.db,runtime.channel,'rd','editor')
    await database.db.delete(secondaryEvents)
    await database.db.update(graphicTemplates).set({svg:'<svg>EDITADO</svg>'}).where(eq(graphicTemplates.id,'cg'))
    await runtime.refresh()
    expect(readOperationalPayload(published.payload).secondaryEvents).toEqual([event])
    expect(diffOperationalGraphics(readOperationalPayload(published.payload),await simulateOperationalPlaylist(database.db,runtime.channel,'rd'))).toEqual(['live'])
    const trigger=vi.spyOn(runtime.graphics,'triggerLayerConfirmed')
    await runtime.transport.take('rd','live');runtime.fireDueGraphics()
    await vi.waitFor(()=>expect(trigger).toHaveBeenCalledWith('LOWER_THIRD','SHOW',expect.objectContaining({template:expect.objectContaining({svg:'<svg><text>{{nome}}</text></svg>'}),values:{nome:'PUBLICADO'}}),expect.any(Function),expect.any(Function)))
    runtime.fireDueGraphics()
    await vi.waitFor(async()=>expect((await database.db.select().from(secondaryEventRuns)).filter(row=>row.mode==='FIRE')).toHaveLength(1))
  })
  it('congela SVG, campos e deixas; edição/remoção não muda grafismo publicado e rollback restaura', async () => {
    await database.db.insert(graphicTemplates).values({ id: 'gc', name: 'Nome original', svg: '<svg><text>{{nome}}</text></svg>', fields: [{ key: 'nome', label: 'Nome', defaultValue: 'ORIGINAL' }], fadeMs: 100, holdSeconds: 5, createdAt: now })
    await database.db.insert(itemGraphics).values({ id: 'cue', itemId: 'live', templateId: 'gc', values: { nome: 'PUBLICADO' }, atSeconds: 0, createdAt: now })
    const first = await publishOperationalPlaylist(database.db, runtime.channel, 'rd', 'editor')
    await runtime.refresh()
    await database.db.update(graphicTemplates).set({ svg: '<svg>EDITADO</svg>' }).where(eq(graphicTemplates.id, 'gc'))
    await database.db.delete(itemGraphics).where(eq(itemGraphics.id, 'cue'))
    await runtime.refresh()
    expect(runtime.cuesOf('live')).toEqual([])
    const show = vi.spyOn(runtime.graphics, 'showConfirmed')
    await runtime.transport.take('rd', 'live')
    expect(runtime.fireDueGraphics()).toBe(true)
    await vi.waitFor(()=>expect(show).toHaveBeenCalledWith(expect.objectContaining({ svg: '<svg><text>{{nome}}</text></svg>', name: 'Nome original' }), { nome: 'PUBLICADO' },expect.any(Function),expect.any(Function)))
    const edited = await simulateOperationalPlaylist(database.db, runtime.channel, 'rd')
    expect(diffOperationalGraphics(readOperationalPayload(first.payload), edited)).toEqual(['live'])
    const second = await publishOperationalPlaylist(database.db, runtime.channel, 'rd', 'editor')
    expect(readOperationalPayload(second.payload).graphics?.cues).toEqual([])
    const restored = await rollbackOperationalPlaylist(database.db, 'rd', first.id, 'operator')
    expect(readOperationalPayload(restored.payload).graphics).toEqual(readOperationalPayload(first.payload).graphics)
  })
  it('ajusta a live publicada sem publicar mudanças editoriais nem perder ajustes sucessivos', async () => {
    await publishOperationalPlaylist(database.db, runtime.channel, 'rd', 'a')
    await database.db.update(rundownItems).set({ sourceRef: 'omt:NAO_PUBLICADA', title: 'Editada' }).where(eq(rundownItems.id, 'live'))
    const first = adjustPublishedLiveDuration(database.db, runtime.channel, 'rd', 'live', 250, 100, 'operator')
    expect(readOperationalPayload(first.payload)).toMatchObject({ items: [{ durationOverride: 750, sourceRef: 'ndi:CAM 1', title: 'Original' }], operation: { previousFrames: 500, newFrames: 750, deltaFrames: 250 } })
    const next = adjustPublishedLiveDuration(database.db, runtime.channel, 'rd', 'live', 250, 100, 'operator')
    expect(readOperationalPayload(next.payload).items[0]?.durationOverride).toBe(1000)
    const reduced = adjustPublishedLiveDuration(database.db, runtime.channel, 'rd', 'live', -1000, 900, 'operator')
    expect(readOperationalPayload(reduced.payload).items[0]?.durationOverride).toBe(925)
    expect((await listItems(database.db, 'rd'))[0]?.title).toBe('Editada')
    await expect(Promise.resolve().then(() => adjustPublishedLiveDuration(database.db, runtime.channel, 'rd', 'missing', 25, 0, 'operator'))).rejects.toThrow('ao vivo')
  })
  it('inserção pontual sai da revisão depois de exibida ou recusada; nada além dela muda (A6)', async () => {
    const first = await publishOperationalPlaylist(database.db, runtime.channel, 'rd', 'editor')
    const payload = readOperationalPayload(first.payload)
    const urgent = { ...payload.items[0]!, id: 'urgent:req-1', title: 'Leilao Ao Vivo', order: 1 }
    persistRevision(database.db, 'rd', { ...payload, items: [...payload.items, urgent] }, 'operador')
    // Ainda no ar: não retira.
    expect(retireOperationalInsert(database.db, runtime.channel, 'rd', 'urgent:req-1', 'urgent:req-1', 'AIRED')).toBeNull()
    // Item comum nunca é retirado por este caminho.
    expect(retireOperationalInsert(database.db, runtime.channel, 'rd', 'live', null, 'AIRED')).toBeNull()
    const retired = retireOperationalInsert(database.db, runtime.channel, 'rd', 'urgent:req-1', 'live', 'REFUSED')!
    const next = readOperationalPayload(retired.payload)
    expect(next.items.map(item => item.id)).toEqual(['live'])
    expect(next.schedule.items.map(item => item.id)).toEqual(['live'])
    expect(next.operation).toMatchObject({ kind: 'INSERT_RETIRED', itemId: 'urgent:req-1', reason: 'REFUSED' })
    expect((await activeOperationalPlaylist(database.db, 'rd'))?.id).toBe(retired.id)
    // Idempotente: já retirada.
    expect(retireOperationalInsert(database.db, runtime.channel, 'rd', 'urgent:req-1', null, 'AIRED')).toBeNull()
  })
  it('a execução continua com fonte/nome/duração publicados após edição editorial', async () => {
    await publishOperationalPlaylist(database.db, runtime.channel, 'rd', 'editor')
    await database.db.update(rundownItems).set({ title: 'Novo', sourceRef: 'ndi:CAM 2', durationOverride: 900 }).where(eq(rundownItems.id, 'live'))
    await runtime.refresh()
    expect(runtime.view?.items[0]?.item).toMatchObject({ title: 'Novo', sourceRef: 'ndi:CAM 2', durationOverride: 900 })
    expect(runtime.executionView?.items[0]?.item).toMatchObject({ title: 'Original', sourceRef: 'ndi:CAM 1', durationOverride: 500 })
    expect(runtime.operationalRevision?.revision).toBe(1)
  })
  it('simulação não publica nem muda o estado operacional', async () => {
    const first = await simulateOperationalPlaylist(database.db, runtime.channel, 'rd')
    const second = await simulateOperationalPlaylist(database.db, runtime.channel, 'rd')
    expect(first).toEqual(second)
    expect(await activeOperationalPlaylist(database.db, 'rd')).toBeNull()
  })
  it('publicações concorrentes alocam revisões únicas e somente uma fica ativa', async () => {
    const attempts = await Promise.allSettled([publishOperationalPlaylist(database.db, runtime.channel, 'rd', 'a'), publishOperationalPlaylist(database.db, runtime.channel, 'rd', 'b')])
    expect(attempts.map(row=>row.status).sort()).toEqual(['fulfilled','rejected'])
    const fresh=await publishOperationalPlaylist(database.db,runtime.channel,'rd','new review')
    expect(fresh.revision).toBe(2)
    const saved = await database.db.select().from(operationalPlaylistRevisions)
    expect(saved.filter((row) => row.active)).toHaveLength(1)
    await database.db.update(operationalPlaylistRevisions).set({ active: false })
    expect(await activeOperationalPlaylist(database.db, 'rd')).toBeNull()
  })
  it('rollback cria uma revisão nova sem apagar a edição ou o histórico', async () => {
    const first = await publishOperationalPlaylist(database.db, runtime.channel, 'rd', 'a')
    await database.db.update(rundownItems).set({ title: 'Editada' }).where(eq(rundownItems.id, 'live'))
    await publishOperationalPlaylist(database.db, runtime.channel, 'rd', 'a')
    const restored = await rollbackOperationalPlaylist(database.db, 'rd', first.id, 'operator', 'live')
    expect(restored.revision).toBe(3)
    expect(readOperationalPayload(restored.payload)).toMatchObject({ restoredFrom: { id: first.id, revision: 1 }, items: [{ title: 'Original' }] })
    expect((await listItems(database.db, 'rd'))[0]?.title).toBe('Editada')
    expect(await database.db.select().from(operationalPlaylistRevisions)).toHaveLength(3)
  })
  it('bloqueia rollback que removeria o item no ar e lista campos alterados', async () => {
    const revision = await publishOperationalPlaylist(database.db, runtime.channel, 'rd', 'a')
    await expect(rollbackOperationalPlaylist(database.db, 'rd', revision.id, 'a', 'item-que-nao-existe')).rejects.toThrow('item no ar')
    const old = readOperationalPayload(revision.payload).items
    const modified = [{ ...old[0]!, title: 'Novo', sourceRef: 'omt:HOST (PGM)' }]
    expect(diffOperationalItems(old, modified).changed[0]).toEqual({ itemId: 'live', fields: ['title', 'sourceRef'] })
  })
  it('protege a fonte em PGM, permitindo ajustes editoriais que não trocam decoder', async () => {
    await publishOperationalPlaylist(database.db, runtime.channel, 'rd', 'a')
    await database.db.update(rundownItems).set({ title: 'Título corrigido' }).where(eq(rundownItems.id, 'live'))
    await expect(publishOperationalPlaylist(database.db, runtime.channel, 'rd', 'a', 'live')).resolves.toMatchObject({ revision: 2 })
    await database.db.update(rundownItems).set({ sourceRef: 'omt:OUTRA' }).where(eq(rundownItems.id, 'live'))
    await expect(publishOperationalPlaylist(database.db, runtime.channel, 'rd', 'a', 'live')).rejects.toThrow('fonte')
    expect((await activeOperationalPlaylist(database.db, 'rd'))?.revision).toBe(2)
  })
})
