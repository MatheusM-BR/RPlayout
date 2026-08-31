import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import { trimDuration, type Frames, type MediaAsset, type PreviewTarget } from '@rplayout/protocol'
import {
  runtimeFor,
  runtimeForItem,
  runtimeForRundown,
  type App,
  type ChannelRuntime,
} from './app.js'
import { listAssets, listChannels, listRundowns } from './db/repo.js'
import { operatorDecisions, rundownItems } from './db/schema.js'
import { applyAudio, applyTrim } from './domain/scopes.js'
import { thumbnailSvg } from './domain/thumbnail.js'
import type { RundownView } from './domain/plan.js'

const trimSchema = z.object({ in: z.number().int().min(0), out: z.number().int().min(0) })

const audioSchema = z.object({
  mode: z.enum(['AUTO', 'MANUAL', 'OFF']),
  gainDb: z.number().min(-40).max(20),
  measured: z
    .object({
      integratedLufs: z.number(),
      lra: z.number(),
      truePeakDbtp: z.number(),
      scope: z.enum(['FILE', 'TRIM']),
      measuredAt: z.string(),
    })
    .nullable(),
})

/** Prioridade é 1..5, não "um número" — o tipo do domínio precisa da literal. */
const prioritySchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
])

const anchorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('FLOW') }),
  z.object({ kind: z.literal('FIXED'), at: z.number().int().min(0) }),
  z.object({
    kind: z.literal('SOFT'),
    at: z.number().int().min(0),
    tolerance: z.number().int().min(0),
    priority: prioritySchema,
  }),
  z.object({
    kind: z.literal('WINDOW'),
    from: z.number().int().min(0),
    to: z.number().int().min(0),
    priority: prioritySchema,
  }),
])

const scopeSchema = z.enum(['ITEM', 'RUNDOWN', 'ALL_RUNDOWNS', 'ASSET_DEFAULT'])

/**
 * Onde entra um item que tem hora marcada.
 *
 * Procura a primeira linha que já começaria depois daquela hora e entra antes
 * dela. O scheduler cuida do resto: a grade se reorganiza sozinha em volta.
 */
function insertionIndexForTime(view: RundownView, at: Frames): number {
  const index = view.schedule.items.findIndex((item) => item.start >= at)
  return index < 0 ? view.items.length : index
}

async function logDecision(
  app: App,
  rundownId: string,
  itemId: string | null,
  kind: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await app.db.insert(operatorDecisions).values({
    id: randomUUID(),
    rundownId,
    itemId,
    kind,
    payload,
    createdAt: new Date().toISOString(),
  })
}

const snapshot = (runtime: ChannelRuntime) => ({
  view: runtime.view,
  live: runtime.live(),
})

export function registerRoutes(app: App, server: FastifyInstance, onChange: () => void): void {
  server.get('/api/health', async () => ({ ok: true }))

  server.get('/api/state', async () => {
    const channels = await listChannels(app.db)
    const rundowns = await listRundowns(app.db)
    return { channels, rundowns }
  })

  server.get('/api/assets', async () => ({ assets: await listAssets(app.db) }))

  /**
   * Explorador de arquivos. A árvore sai do próprio caminho do arquivo, então
   * a organização em disco é a organização que o operador vê.
   */
  server.get('/api/library', async () => {
    const assets = await listAssets(app.db)
    const folders = new Map<string, MediaAsset[]>()

    for (const asset of assets) {
      const parts = asset.path.replace(/\\/g, '/').split('/')
      const folder = parts.slice(0, -1).slice(-1)[0] ?? 'Raiz'
      const bucket = folders.get(folder)
      if (bucket) bucket.push(asset)
      else folders.set(folder, [asset])
    }

    return {
      folders: [...folders.entries()]
        .sort(([a], [b]) => a.localeCompare(b, 'pt-BR'))
        .map(([name, items]) => ({
          name,
          assets: items.map((asset) => ({
            ...asset,
            fileName: asset.path.replace(/\\/g, '/').split('/').pop() ?? asset.path,
            thumbnailUrl: `/api/assets/${asset.id}/thumbnail.svg`,
          })),
        })),
    }
  })

  server.get('/api/assets/:id/thumbnail.svg', async (request, reply) => {
    const { id } = request.params as { id: string }
    const assets = await listAssets(app.db)
    const asset = assets.find((candidate) => candidate.id === id)
    if (!asset) return reply.code(404).send({ error: 'Arquivo não encontrado.' })

    const [channel] = await listChannels(app.db)
    const rate = channel?.rate ?? { num: 50, den: 1 }
    return reply
      .type('image/svg+xml')
      .header('cache-control', 'public, max-age=3600')
      .send(thumbnailSvg(asset, rate))
  })

  server.get('/api/rundowns/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const runtime = await runtimeForRundown(app, id)
    if (!runtime) return reply.code(404).send({ error: 'Rundown não encontrado.' })
    return snapshot(runtime)
  })

  // ---- itens -----------------------------------------------------------

  const addItemSchema = z.object({
    mediaId: z.string().nullable().optional(),
    sourceRef: z.string().nullable().optional(),
    type: z.enum(['VT', 'LIVE', 'GFX', 'SLATE', 'COMMERCIAL', 'FILLER']),
    title: z.string().min(1).optional(),
    anchor: anchorSchema.optional(),
    durationOverride: z.number().int().min(0).nullable().optional(),
    atIndex: z.number().int().min(0).optional(),
  })

  server.post('/api/rundowns/:id/items', async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = addItemSchema.safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const runtime = await runtimeForRundown(app, id)
    if (!runtime?.view) return reply.code(404).send({ error: 'Rundown não encontrado.' })

    const assets = await listAssets(app.db)
    const asset = body.data.mediaId ? assets.find((a) => a.id === body.data.mediaId) : undefined
    if (body.data.mediaId && !asset) {
      return reply.code(400).send({ error: 'Arquivo não existe no acervo.' })
    }

    const duration =
      body.data.durationOverride ??
      (asset
        ? trimDuration(asset.defaultTrim ?? { in: 0, out: asset.durationFrames })
        : 0)

    const anchor = body.data.anchor ?? { kind: 'FLOW' as const }
    const index =
      body.data.atIndex ??
      (anchor.kind === 'FIXED'
        ? insertionIndexForTime(runtime.view, anchor.at)
        : anchor.kind === 'SOFT'
          ? insertionIndexForTime(runtime.view, anchor.at)
          : runtime.view.items.length)

    const itemId = randomUUID()
    const ordered = runtime.view.items.map((v) => v.item.id)
    ordered.splice(index, 0, itemId)

    await app.db.insert(rundownItems).values({
      id: itemId,
      rundownId: id,
      sortOrder: 0,
      type: body.data.type,
      title: body.data.title ?? asset?.title ?? 'Novo item',
      mediaId: body.data.mediaId ?? null,
      sourceRef: body.data.sourceRef ?? null,
      trim: null,
      audio: null,
      durationOverride: body.data.durationOverride ?? null,
      minDuration: duration,
      anchor,
      onOverrun: body.data.type === 'FILLER' ? 'DROP_FILLER' : 'PUSH',
      elastic: null,
      locked: false,
      autoNext: true,
      loop: false,
      notes: null,
    })

    for (const [position, existingId] of ordered.entries()) {
      await app.db
        .update(rundownItems)
        .set({ sortOrder: (position + 1) * 10 })
        .where(eq(rundownItems.id, existingId))
    }

    await logDecision(app, id, itemId, 'ITEM_ADDED', { anchor, index })
    await runtime.refresh()
    onChange()
    return snapshot(runtime)
  })

  const patchSchema = z.object({
    title: z.string().min(1).optional(),
    anchor: anchorSchema.optional(),
    onOverrun: z.enum(['TRIM_PREV', 'DROP_FILLER', 'PUSH', 'SKIP']).optional(),
    minDuration: z.number().int().min(0).optional(),
    durationOverride: z.number().int().min(0).nullable().optional(),
    elastic: z
      .object({ min: z.number().int().min(0), max: z.number().int().min(0) })
      .nullable()
      .optional(),
    locked: z.boolean().optional(),
    autoNext: z.boolean().optional(),
    loop: z.boolean().optional(),
    notes: z.string().nullable().optional(),
  })

  server.patch('/api/items/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = patchSchema.safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const runtime = await runtimeForItem(app, id)
    if (!runtime?.view) return reply.code(404).send({ error: 'Item não encontrado.' })

    await app.db.update(rundownItems).set(body.data).where(eq(rundownItems.id, id))
    await logDecision(app, runtime.view.rundown.id, id, 'ITEM_EDITED', body.data)
    await runtime.refresh()
    onChange()
    return snapshot(runtime)
  })

  server.delete('/api/items/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const runtime = await runtimeForItem(app, id)
    if (!runtime?.view) return reply.code(404).send({ error: 'Item não encontrado.' })

    await app.db.delete(rundownItems).where(eq(rundownItems.id, id))
    await logDecision(app, runtime.view.rundown.id, id, 'ITEM_REMOVED', {})
    await runtime.refresh()
    onChange()
    return snapshot(runtime)
  })

  server.post('/api/items/:id/move', async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = z.object({ toIndex: z.number().int().min(0) }).safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const runtime = await runtimeForItem(app, id)
    if (!runtime?.view) return reply.code(404).send({ error: 'Item não encontrado.' })

    const ids = runtime.view.items.map((v) => v.item.id)
    const from = ids.indexOf(id)
    if (from < 0) return reply.code(404).send({ error: 'Item não está nesta grade.' })

    ids.splice(from, 1)
    ids.splice(Math.min(body.data.toIndex, ids.length), 0, id)

    for (const [position, itemId] of ids.entries()) {
      await app.db
        .update(rundownItems)
        .set({ sortOrder: (position + 1) * 10 })
        .where(eq(rundownItems.id, itemId))
    }

    await logDecision(app, runtime.view.rundown.id, id, 'ITEM_MOVED', {
      from,
      to: body.data.toIndex,
    })
    await runtime.refresh()
    onChange()
    return snapshot(runtime)
  })

  // ---- corte e nível, com escopo ---------------------------------------

  server.post('/api/items/:id/trim', async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = z.object({ trim: trimSchema, scope: scopeSchema }).safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })
    if (body.data.trim.out <= body.data.trim.in) {
      return reply.code(400).send({ error: 'A saída tem de vir depois da entrada.' })
    }

    const runtime = await runtimeForItem(app, id)
    if (!runtime?.view) return reply.code(404).send({ error: 'Item não encontrado.' })

    const result = await applyTrim(app.db, id, body.data.trim, body.data.scope)
    await logDecision(app, runtime.view.rundown.id, id, 'TRIM_APPLIED', {
      ...body.data,
      itemsAffected: result.itemsAffected,
    })
    await runtime.refresh()
    onChange()
    return { ...snapshot(runtime), result }
  })

  server.post('/api/items/:id/audio', async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = z.object({ audio: audioSchema, scope: scopeSchema }).safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const runtime = await runtimeForItem(app, id)
    if (!runtime?.view) return reply.code(404).send({ error: 'Item não encontrado.' })

    const result = await applyAudio(app.db, id, body.data.audio, body.data.scope)
    await logDecision(app, runtime.view.rundown.id, id, 'AUDIO_APPLIED', {
      ...body.data,
      itemsAffected: result.itemsAffected,
    })
    await runtime.refresh()
    onChange()
    return { ...snapshot(runtime), result }
  })

  // ---- transporte ------------------------------------------------------

  server.post('/api/channels/:id/transport', async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = z
      .object({
        action: z.enum(['take', 'cue', 'stop', 'park']),
        itemId: z.string().nullable().optional(),
        /** Arquivo aberto direto do explorador, sem entrar na grade. */
        assetId: z.string().nullable().optional(),
      })
      .safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const runtime = await runtimeFor(app, id)
    if (!runtime?.view) return reply.code(404).send({ error: 'Canal sem grade carregada.' })

    switch (body.data.action) {
      case 'take': {
        const armed = runtime.transport.state().preview
        const itemId = body.data.itemId ?? (armed?.kind === 'ITEM' ? armed.id : null)
        if (!itemId) return reply.code(400).send({ error: 'Nada armado para entrar no ar.' })
        runtime.transport.take(runtime.view.rundown.id, itemId)
        break
      }
      case 'cue': {
        const target: PreviewTarget | null = body.data.assetId
          ? { kind: 'ASSET', id: body.data.assetId }
          : body.data.itemId
            ? { kind: 'ITEM', id: body.data.itemId }
            : null
        runtime.transport.cue(target)
        break
      }
      case 'park': {
        const first = runtime.view.items[0]
        if (!first) return reply.code(400).send({ error: 'Grade vazia.' })
        runtime.transport.park(first.item.id)
        break
      }
      case 'stop':
        runtime.transport.stop()
        break
    }

    await runtime.refresh()
    onChange()
    return snapshot(runtime)
  })
}
