import { randomUUID } from 'node:crypto'
import { asc, eq, isNotNull } from 'drizzle-orm'
import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import {
  durationIn,
  fieldsUsedIn,
  formatVideoFormat,
  framesSinceMidnight,
  isStill,
  secondsToFrames,
  STILL_DEFAULT_SECONDS,
  trimDuration,
  type Anchor,
  type Frames,
  type MediaAsset,
  type PreviewTarget,
} from '@rplayout/protocol'
import { networkInterfaces } from 'node:os'
import {
  runtimeFor,
  runtimeForItem,
  runtimeForRundown,
  type App,
  type ChannelRuntime,
} from './app.js'
import { getChannel, listAssets, listChannels, listRundowns } from './db/repo.js'
import { listAsRun } from './domain/asrun.js'
import { buildCandidates, planFill } from './domain/autofill.js'
import { backupDatabase, listBackups } from './domain/backup.js'
import { syncDistribution } from './app.js'
import { PORTS } from './domain/mediamtx.js'
import {
  channels,
  destinations,
  rundowns,
  graphicTemplates,
  guestKeys,
  itemGraphics,
  mediaAssets,
  rundownItems,
  scheduleRules,
} from './db/schema.js'
import { operatorDecisions } from './db/schema.js'
import { applyAudio, applyTrim, targetItemIds } from './domain/scopes.js'
import { createReadStream, existsSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'
import {
  createOutput,
  deleteOutput,
  listOutputs,
  targetOf,
  updateOutput,
} from './domain/outputs.js'
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

const snapshot = (app: App, runtime: ChannelRuntime) => ({
  view: runtime.view,
  live: runtime.live(),
  history: app.history.state(runtime.view?.rundown.id ?? ''),
  monitors: monitors(app, runtime.channel.id),
})

/**
 * Onde a interface vai buscar a imagem dos monitores.
 *
 * Vai só a porta e o caminho, nunca a máquina: quem abre a interface sabe por
 * qual endereço chegou até aqui, e o servidor não sabe. Deduzir o IP daqui é
 * como o monitor fica preto quando alguém acessa por outro nome.
 */
function monitors(app: App, channelId: string) {
  const path = app.paths.find((entry) => entry.channelId === channelId)
  if (!app.mediamtx?.running || !path) return null
  return { port: PORTS.webrtc, program: path.program, preview: path.preview }
}

/**
 * Itens que andam junto com este. Um item de bloco nunca se move sozinho: o
 * bloco comercial que se parte no meio é o pesadelo clássico do playout.
 */
function blockCompanions(runtime: ChannelRuntime, itemId: string): string[] {
  const items = runtime.view?.items ?? []
  const found = items.find((entry) => entry.item.id === itemId)
  const blockId = found?.item.blockId
  if (!blockId) return [itemId]
  return items.filter((entry) => entry.item.blockId === blockId).map((entry) => entry.item.id)
}

export function registerRoutes(app: App, server: FastifyInstance, onChange: () => void): void {
  server.get('/api/health', async () => ({ ok: true }))

  server.get('/api/state', async () => {
    const channels = await listChannels(app.db)
    const rundowns = await listRundowns(app.db)
    return { channels, rundowns }
  })

  const channelSchema = z.object({
    name: z.string().min(1),
    width: z.number().int().min(160).max(7680).optional(),
    height: z.number().int().min(120).max(4320).optional(),
    rateNum: z.number().int().min(1).optional(),
    rateDen: z.number().int().min(1).optional(),
    scan: z.enum(['PROGRESSIVE', 'INTERLACED']).optional(),
    fieldOrder: z.enum(['TFF', 'BFF']).optional(),
  })

  server.post('/api/channels', async (request, reply) => {
    const body = channelSchema.safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    // O canal novo nasce igual ao primeiro: numa emissora, o segundo canal é
    // quase sempre o mesmo formato do primeiro, e copiar poupa o operador de
    // redigitar geometria e cadência.
    const [reference] = await listChannels(app.db)
    const id = randomUUID()
    await app.db.insert(channels).values({
      id,
      name: body.data.name,
      rateNum: body.data.rateNum ?? reference?.rate.num ?? 50,
      rateDen: body.data.rateDen ?? reference?.rate.den ?? 1,
      width: body.data.width ?? reference?.width ?? 1920,
      height: body.data.height ?? reference?.height ?? 1080,
      scan: body.data.scan ?? reference?.scan ?? 'PROGRESSIVE',
      fieldOrder: body.data.fieldOrder ?? reference?.fieldOrder ?? 'TFF',
      targetLufs: reference?.targetLufs ?? -23,
      ceilingDbtp: reference?.ceilingDbtp ?? -1,
      limiterLookaheadMs: reference?.limiterLookaheadMs ?? 5,
      programSdiDeviceId: null,
      slateTemplateId: null,
      createdAt: new Date().toISOString(),
    })

    // Canal sem grade não tem o que operar: ele nasce com uma, começando agora.
    const rundownId = randomUUID()
    const rate = { num: body.data.rateNum ?? reference?.rate.num ?? 50, den: body.data.rateDen ?? reference?.rate.den ?? 1 }
    await app.db.insert(rundowns).values({
      id: rundownId,
      channelId: id,
      name: `Grade — ${body.data.name}`,
      plannedStart: framesSinceMidnight(new Date(), rate),
      loop: true,
      date: new Date().toISOString().slice(0, 10),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    // O servidor de mídia ganha o caminho do canal novo, e o canal ganha suas
    // saídas gerenciadas: sem isto ele existiria na tela e em lugar nenhum.
    await syncDistribution(app)
    await runtimeFor(app, id)
    onChange()
    return { channelId: id, rundownId }
  })

  const channelPatch = z.object({
    name: z.string().min(1).optional(),
    width: z.number().int().min(160).max(7680).optional(),
    height: z.number().int().min(120).max(4320).optional(),
    rateNum: z.number().int().min(1).optional(),
    rateDen: z.number().int().min(1).optional(),
    scan: z.enum(['PROGRESSIVE', 'INTERLACED']).optional(),
    fieldOrder: z.enum(['TFF', 'BFF']).optional(),
    targetLufs: z.number().min(-40).max(0).optional(),
    ceilingDbtp: z.number().min(-20).max(0).optional(),
  })

  /**
   * Muda o formato do canal.
   *
   * Geometria, cadência e varredura são a espinha do pipeline: o engine é
   * construído em volta delas e não há como trocá-las com ele de pé. Então o
   * canal é derrubado e reconstruído -- alguns segundos de preto, e é honesto
   * dizer isso na interface em vez de fingir que a troca é instantânea.
   */
  server.patch('/api/channels/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = channelPatch.safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const current = await getChannel(app.db, id)
    if (!current) return reply.code(404).send({ error: 'Canal não encontrado.' })

    await app.db.update(channels).set(body.data).where(eq(channels.id, id))

    // Formato mudou: o engine tem de nascer de novo. Trocar só o registro
    // deixaria o banco dizendo uma coisa e o ar fazendo outra.
    const antes = {
      width: current.width,
      height: current.height,
      rateNum: current.rate.num,
      rateDen: current.rate.den,
      scan: current.scan,
      fieldOrder: current.fieldOrder,
    }
    const formatChanged = Object.entries(antes).some(
      ([field, valor]) =>
        body.data[field as keyof typeof antes] !== undefined &&
        body.data[field as keyof typeof antes] !== valor,
    )

    const previous = app.runtimes.get(id)
    const rundownId = previous?.view?.rundown.id ?? null
    if (previous) {
      previous.transport.close()
      app.runtimes.delete(id)
    }

    // Nome mudou, caminho no servidor de mídia muda junto.
    if (body.data.name && body.data.name !== current.name) await syncDistribution(app)

    const runtime = await runtimeFor(app, id)
    if (runtime && rundownId) await runtime.load(rundownId)
    onChange()
    return { ok: true, restarted: previous !== undefined, formatChanged }
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

  /**
   * Miniatura do arquivo. O quadro de verdade quando a sonda conseguiu tirar
   * um; o cartão desenhado quando não -- arquivo que não abriu também precisa
   * aparecer no explorador, e sem miniatura ele sumiria de vista.
   */
  server.get('/api/assets/:id/thumbnail.svg', async (request, reply) => {
    const { id } = request.params as { id: string }
    const assets = await listAssets(app.db)
    const asset = assets.find((candidate) => candidate.id === id)
    if (!asset) return reply.code(404).send({ error: 'Arquivo não encontrado.' })

    const frame = resolvePath(app.thumbnailDir, `${asset.contentHash}.jpg`)
    if (existsSync(frame)) {
      return reply
        .type('image/jpeg')
        // O nome do arquivo é o hash do conteúdo, então conteúdo novo é
        // endereço novo e o cache nunca serve a miniatura errada.
        .header('cache-control', 'public, max-age=604800, immutable')
        .send(createReadStream(frame))
    }

    const [channel] = await listChannels(app.db)
    const rate = channel?.rate ?? { num: 50, den: 1 }
    return reply
      .type('image/svg+xml')
      .header('cache-control', 'public, max-age=3600')
      .send(thumbnailSvg(asset, rate))
  })

  // ---- acervo -----------------------------------------------------------

  const assetPatch = z.object({
    title: z.string().min(1).optional(),
    categoryId: z.string().min(1).nullable().optional(),
  })

  server.patch('/api/assets/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = assetPatch.safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    await app.db.update(mediaAssets).set(body.data).where(eq(mediaAssets.id, id))
    for (const runtime of app.runtimes.values()) await runtime.refresh()
    onChange()
    return { ok: true }
  })

  /**
   * Tira o arquivo do acervo. O arquivo em disco não é tocado.
   *
   * Arquivo em uso não sai calado: a grade que aponta para ele perderia a
   * referência e o operador descobriria no ar. A resposta diz quantos itens o
   * usam, e quem decide é ele.
   */
  server.delete('/api/assets/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const { force } = request.query as { force?: string }

    const usos = await app.db.select().from(rundownItems).where(eq(rundownItems.mediaId, id))
    if (usos.length > 0 && force !== '1') {
      return reply.code(409).send({
        error: `Este arquivo está em ${usos.length} item${usos.length > 1 ? 's' : ''} da grade.`,
        items: usos.length,
      })
    }

    if (usos.length > 0) {
      await app.db.delete(rundownItems).where(eq(rundownItems.mediaId, id))
    }
    await app.db.delete(mediaAssets).where(eq(mediaAssets.id, id))
    for (const runtime of app.runtimes.values()) await runtime.refresh()
    onChange()
    return { ok: true, removedItems: usos.length }
  })

  /**
   * Limpa do acervo tudo que não abriu.
   *
   * Arquivo que não abre fica na lista com o motivo à vista -- é informação
   * acionável enquanto alguém pode agir. Depois que o operador viu e decidiu
   * que não vai agir, a mesma lista vira ruído, e limpar é o que devolve a
   * tela para o material que serve.
   */
  server.post('/api/assets/prune', async () => {
    const quebrados = await app.db
      .select()
      .from(mediaAssets)
      .where(isNotNull(mediaAssets.probeError))

    let itensRemovidos = 0
    for (const asset of quebrados) {
      const usos = await app.db.select().from(rundownItems).where(eq(rundownItems.mediaId, asset.id))
      itensRemovidos += usos.length
      if (usos.length > 0) {
        await app.db.delete(rundownItems).where(eq(rundownItems.mediaId, asset.id))
      }
      await app.db.delete(mediaAssets).where(eq(mediaAssets.id, asset.id))
    }

    for (const runtime of app.runtimes.values()) await runtime.refresh()
    onChange()
    return { removed: quebrados.length, removedItems: itensRemovidos }
  })

  /** As categorias que existem no acervo, para a interface oferecer. */
  server.get('/api/categories', async () => {
    const assets = await listAssets(app.db)
    const found = new Set<string>()
    for (const asset of assets) if (asset.categoryId) found.add(asset.categoryId)
    return { categories: [...found].sort() }
  })

  /**
   * Apaga um canal inteiro.
   *
   * O último não sai: um playout sem canal nenhum não tem o que operar, e a
   * tela de primeira vez existe para o caso de banco vazio, não para o
   * operador cair nela por engano.
   */
  server.delete('/api/channels/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const todos = await listChannels(app.db)
    if (todos.length <= 1) {
      return reply.code(409).send({ error: 'Este é o único canal. Crie outro antes de apagar.' })
    }
    if (!todos.some((channel) => channel.id === id)) {
      return reply.code(404).send({ error: 'Canal não encontrado.' })
    }

    const runtime = app.runtimes.get(id)
    if (runtime) {
      runtime.transport.close()
      app.runtimes.delete(id)
    }

    await app.db.delete(channels).where(eq(channels.id, id))
    await syncDistribution(app)
    onChange()
    return { ok: true }
  })


  server.get('/api/library/scan', async () => ({
    ...app.ingest.status(),
    available: app.ingest.available,
    root: app.ingest.status().root ?? app.mediaRoot,
  }))

  server.post('/api/library/scan', async (request, reply) => {
    if (!app.ingest.available) {
      return reply.code(409).send({ error: 'A sonda de mídia não está configurada.' })
    }
    const body = z
      .object({ root: z.string().min(1).optional(), measure: z.boolean().optional() })
      .safeParse(request.body ?? {})
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    // Medir loudness é o que demora numa varredura. Poder ler sem medir é o
    // que torna um acervo grande utilizável no mesmo dia.
    app.ingest.measure = body.data.measure ?? true

    if (!app.ingest.start(body.data.root ?? app.mediaRoot)) {
      return reply.code(409).send({ error: 'A varredura já está em andamento.' })
    }
    return app.ingest.status()
  })

  server.get('/api/rundowns/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const runtime = await runtimeForRundown(app, id)
    if (!runtime) return reply.code(404).send({ error: 'Rundown não encontrado.' })
    return snapshot(app, runtime)
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

    // Imagem parada não traz duração: quem diz quanto ela fica é a grade, e
    // sem um valor o item entraria com zero quadro.
    const stillDefault =
      asset && isStill(asset)
        ? secondsToFrames(STILL_DEFAULT_SECONDS, runtime.channel.rate)
        : null

    const duration =
      body.data.durationOverride ??
      stillDefault ??
      (asset
        ? trimDuration(asset.defaultTrim ?? { in: 0, out: durationIn(asset, runtime.channel.rate) })
        : 0)

    const anchor = body.data.anchor ?? { kind: 'FLOW' as const }
    const index =
      body.data.atIndex ??
      (anchor.kind === 'FIXED'
        ? insertionIndexForTime(runtime.view, anchor.at)
        : anchor.kind === 'SOFT'
          ? insertionIndexForTime(runtime.view, anchor.at)
          : runtime.view.items.length)

    await app.history.capture(app.db, id, 'inserir item', { wholeRundown: true })

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
      durationOverride: body.data.durationOverride ?? stillDefault,
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

    // O arquivo vai no registro, não só o item: é o arquivo que volta a ser
    // oferecido na próxima montagem automática, e é sobre ele que se aprende.
    await logDecision(app, id, itemId, 'ITEM_ADDED', {
      anchor,
      index,
      mediaId: body.data.mediaId ?? null,
    })
    await runtime.refresh()
    onChange()
    return snapshot(app, runtime)
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
    fit: z.enum(['PILLARBOX', 'CROP']).optional(),
    audioTrack: z.number().int().min(0).nullable().optional(),
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

    await app.history.capture(app.db, runtime.view.rundown.id, 'editar item', { itemIds: [id] })
    await app.db.update(rundownItems).set(body.data).where(eq(rundownItems.id, id))
    await logDecision(app, runtime.view.rundown.id, id, 'ITEM_EDITED', body.data)
    await runtime.refresh()
    onChange()
    return snapshot(app, runtime)
  })

  server.delete('/api/items/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const runtime = await runtimeForItem(app, id)
    if (!runtime?.view) return reply.code(404).send({ error: 'Item não encontrado.' })

    await app.history.capture(app.db, runtime.view.rundown.id, 'remover item', {
      wholeRundown: true,
    })
    const removed = runtime.view.items.find((entry) => entry.item.id === id)
    await app.db.delete(rundownItems).where(eq(rundownItems.id, id))
    await logDecision(app, runtime.view.rundown.id, id, 'ITEM_REMOVED', {
      mediaId: removed?.item.mediaId ?? null,
    })
    await runtime.refresh()
    onChange()
    return snapshot(app, runtime)
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

    await app.history.capture(app.db, runtime.view.rundown.id, 'mover item', {
      wholeRundown: true,
    })

    // O bloco inteiro viaja com o item arrastado, na ordem em que estava.
    const moving = blockCompanions(runtime, id)
    const movingSet = new Set(moving)
    const anchorId = ids[Math.min(body.data.toIndex, ids.length - 1)]
    const rest = ids.filter((candidate) => !movingSet.has(candidate))
    const target =
      anchorId && !movingSet.has(anchorId) ? rest.indexOf(anchorId) : Math.min(body.data.toIndex, rest.length)

    rest.splice(target < 0 ? rest.length : target, 0, ...moving)
    ids.length = 0
    ids.push(...rest)

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
    return snapshot(app, runtime)
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

    const targets = await targetItemIds(app.db, id, body.data.scope)
    await app.history.capture(app.db, runtime.view.rundown.id, 'marcar entrada e saída', {
      itemIds: body.data.scope === 'ASSET_DEFAULT' ? [id] : targets.ids,
      assetIds: body.data.scope === 'ASSET_DEFAULT' && targets.mediaId ? [targets.mediaId] : [],
    })

    const result = await applyTrim(app.db, id, body.data.trim, body.data.scope)
    await logDecision(app, runtime.view.rundown.id, id, 'TRIM_APPLIED', {
      ...body.data,
      itemsAffected: result.itemsAffected,
    })
    await runtime.refresh()
    onChange()
    return { ...snapshot(app, runtime), result }
  })

  server.post('/api/items/:id/audio', async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = z.object({ audio: audioSchema, scope: scopeSchema }).safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const runtime = await runtimeForItem(app, id)
    if (!runtime?.view) return reply.code(404).send({ error: 'Item não encontrado.' })

    const targets = await targetItemIds(app.db, id, body.data.scope)
    await app.history.capture(app.db, runtime.view.rundown.id, 'nivelar áudio', {
      itemIds: body.data.scope === 'ASSET_DEFAULT' ? [id] : targets.ids,
      assetIds: body.data.scope === 'ASSET_DEFAULT' && targets.mediaId ? [targets.mediaId] : [],
    })

    const result = await applyAudio(app.db, id, body.data.audio, body.data.scope)
    await logDecision(app, runtime.view.rundown.id, id, 'AUDIO_APPLIED', {
      ...body.data,
      itemsAffected: result.itemsAffected,
    })
    await runtime.refresh()
    onChange()
    return { ...snapshot(app, runtime), result }
  })

  // ---- distribuição ----------------------------------------------------

  server.get('/api/distribution', async () => {
    const host = lanAddress()
    const channelsByPath = new Map((await listChannels(app.db)).map((row) => [row.id, row]))
    const [guests, targets, status] = await Promise.all([
      app.db.select().from(guestKeys),
      app.db.select().from(destinations),
      app.mediamtx?.status() ?? Promise.resolve([]),
    ])

    return {
      server: {
        running: app.mediamtx?.running ?? false,
        // Exposto a todas as interfaces é decisão consciente, e a interface
        // precisa poder avisar em vermelho quando for o caso.
        exposed: app.mediamtx?.exposed ?? false,
        host,
        ports: PORTS,
      },
      channels: app.paths.map((path) => ({
        channelId: path.channelId,
        // O formato que o canal promete ao destino. Num canal entrelaçado a
        // saída de rede continua progressiva -- o FLV não declara
        // entrelaçamento e a maior parte dos destinos assume progressivo --,
        // então os dois nomes aparecem.
        format: (() => {
          const channel = channelsByPath.get(path.channelId)
          if (!channel) return null
          return {
            channel: formatVideoFormat(channel),
            network: formatVideoFormat({ ...channel, scan: 'PROGRESSIVE' }),
          }
        })(),
        program: path.program,
        clean: path.clean,
        preview: path.preview,
        urls: app.mediamtx?.urls(path.program, host) ?? null,
        // Saídas do engine deste canal. Caminho declarado no servidor não é
        // prova de nada: só a entrega do engine diz que o canal está saindo.
        publishers: app.runtimes.get(path.channelId)?.transport.publishers() ?? [],
      })),
      guests: guests.map((guest) => ({
        ...guest,
        publishUrl: `rtmp://${host}:${PORTS.rtmp}/guest/${guest.streamKey}`,
      })),
      destinations: targets,
      relays: app.relays.status(),
      paths: status,
    }
  })

  /**
   * Fontes ao vivo que dá para pôr na grade.
   *
   * Família sem nada traz o motivo: placa sem driver e NDI sem plugin são
   * situações diferentes, e dizer qual é poupa o operador de procurar no lugar
   * errado.
   */
  server.get('/api/sources', async (request) => {
    const { refresh } = request.query as { refresh?: string }
    return app.sources.list(refresh === '1')
  })

  server.patch('/api/channels/:id/slate', async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = z
      .object({ templateId: z.string().nullable() })
      .safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    await app.db
      .update(channels)
      .set({ slateTemplateId: body.data.templateId })
      .where(eq(channels.id, id))

    // O canal que está no ar recebe a escolha em memória. Recriar o runtime
    // aqui subiria um segundo engine no mesmo destino.
    const runtime = app.runtimes.get(id)
    runtime?.setSlate(body.data.templateId)
    onChange()
    return { ok: true }
  })

  // ---- pauta ---------------------------------------------------------------

  server.get('/api/channels/:id/rules', async (request) => {
    const { id } = request.params as { id: string }
    const rules = await app.db
      .select()
      .from(scheduleRules)
      .where(eq(scheduleRules.channelId, id))
      .orderBy(asc(scheduleRules.startMinute))
    return { rules }
  })

  const ruleSchema = z.object({
    name: z.string().min(1),
    weekdays: z.string().regex(/^[0-6]{1,7}$/),
    startMinute: z.number().int().min(0).max(1439),
    endMinute: z.number().int().min(1).max(1440),
    categories: z.array(z.string()),
    avoidHours: z.number().int().min(0).max(240).optional(),
  })

  server.post('/api/channels/:id/rules', async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = ruleSchema.safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })
    if (body.data.endMinute <= body.data.startMinute) {
      return reply.code(400).send({ error: 'A faixa termina antes de começar.' })
    }

    const row = {
      id: randomUUID(),
      channelId: id,
      ...body.data,
      avoidHours: body.data.avoidHours ?? 6,
      createdAt: new Date().toISOString(),
    }
    await app.db.insert(scheduleRules).values(row)
    return { rule: row }
  })

  server.delete('/api/rules/:id', async (request) => {
    const { id } = request.params as { id: string }
    await app.db.delete(scheduleRules).where(eq(scheduleRules.id, id))
    return { ok: true }
  })

  /**
   * Monta o dia inteiro pela pauta.
   *
   * Cada faixa vira um bloco que começa na hora dela: o primeiro item entra com
   * âncora de hora fixa e o resto vai no fluxo. Sem a âncora, um atraso na
   * faixa da manhã empurraria a noite inteira -- que é exatamente o que a pauta
   * existe para evitar.
   */
  server.post('/api/rundowns/:id/autofill-day', async (request, reply) => {
    const { id } = request.params as { id: string }
    const runtime = await runtimeForRundown(app, id)
    if (!runtime?.view) return reply.code(404).send({ error: 'Rundown não encontrado.' })

    const weekday = String(new Date(`${runtime.view.rundown.date}T12:00:00`).getDay())
    const rules = (
      await app.db
        .select()
        .from(scheduleRules)
        .where(eq(scheduleRules.channelId, runtime.channel.id))
        .orderBy(asc(scheduleRules.startMinute))
    ).filter((rule) => rule.weekdays.includes(weekday))

    if (rules.length === 0) {
      return reply.code(400).send({ error: 'Nenhuma faixa da pauta vale para este dia.' })
    }

    const assets = await listAssets(app.db)
    const byId = new Map(assets.map((asset) => [asset.id, asset]))
    const candidates = await buildCandidates(app.db, runtime.channel, assets)

    await app.history.capture(app.db, id, 'montar o dia pela pauta', { wholeRundown: true })

    const bands: { rule: string; items: number; leftover: number }[] = []
    // O que uma faixa usou não volta na seguinte: o dia inteiro montado com o
    // mesmo VT em todas as faixas seria pior do que não montar.
    const used = new Set<string>()
    /** Ordem final da grade: o que já existia mais as faixas, no lugar delas. */
    const ordered = runtime.view.items.map((entry) => entry.item.id)
    const inserts: { id: string; mediaId: string; title: string; duration: Frames; anchor: Anchor }[] =
      []

    for (const rule of rules) {
      const plan = planFill(
        candidates.filter((candidate) => !used.has(candidate.id)),
        runtime.channel,
        secondsToFrames((rule.endMinute - rule.startMinute) * 60, runtime.channel.rate),
        rule.categories,
        rule.avoidHours * 60,
      )

      // A faixa entra onde a hora dela cai, não no fim da grade: pendurada no
      // fim, a âncora das seis da manhã fica atrás do que já estava marcado
      // para as seis da tarde, e o scheduler não tem como puxá-la de volta.
      const startFrames = secondsToFrames(rule.startMinute * 60, runtime.channel.rate)
      let at = insertionIndexForTime(runtime.view, startFrames)
      at += inserts.filter((entry) => ordered.indexOf(entry.id) < at).length

      let first = true
      for (const item of plan.items) {
        const asset = byId.get(item.id)
        if (!asset) continue
        used.add(item.id)

        const itemId = randomUUID()
        inserts.push({
          id: itemId,
          mediaId: asset.id,
          title: asset.title,
          duration: item.durationFrames,
          anchor: first ? { kind: 'FIXED', at: startFrames } : { kind: 'FLOW' },
        })
        ordered.splice(at, 0, itemId)
        at += 1
        first = false
      }
      bands.push({ rule: rule.name, items: plan.items.length, leftover: plan.leftover })
    }

    for (const entry of inserts) {
      await app.db.insert(rundownItems).values({
        id: entry.id,
        rundownId: id,
        sortOrder: 0,
        type: 'VT',
        title: entry.title,
        mediaId: entry.mediaId,
        sourceRef: null,
        trim: null,
        audio: null,
        durationOverride: null,
        minDuration: entry.duration,
        anchor: entry.anchor,
        onOverrun: 'PUSH',
        elastic: null,
        locked: false,
        autoNext: true,
        loop: false,
        notes: null,
      })
      await logDecision(app, id, entry.id, 'AUTO_FILLED', { mediaId: entry.mediaId })
    }

    for (const [position, itemId] of ordered.entries()) {
      await app.db
        .update(rundownItems)
        .set({ sortOrder: (position + 1) * 10 })
        .where(eq(rundownItems.id, itemId))
    }

    await runtime.refresh()
    onChange()
    return { bands, ...snapshot(app, runtime) }
  })

  /**
   * As-run em CSV.
   *
   * Formato feio de propósito: é o que abre em qualquer planilha do mundo, que
   * é onde o relatório de veiculação acaba indo parar.
   */
  server.get('/api/channels/:id/asrun.csv', async (request, reply) => {
    const { id } = request.params as { id: string }
    const { since } = request.query as { since?: string }
    const channel = await getChannel(app.db, id)
    if (!channel) return reply.code(404).send({ error: 'Canal não encontrado.' })

    const start = since ?? new Date(new Date().setHours(0, 0, 0, 0)).toISOString()
    const entries = await listAsRun(app.db, id, start, 5000)

    const head = 'entrou;saiu;item;tipo;previsto_frames;no_ar_frames;diferenca_frames;saiu_por'
    const lines = entries.map((entry) => {
      const drift =
        entry.airedFrames !== null && entry.plannedFrames !== null
          ? entry.airedFrames - entry.plannedFrames
          : ''
      return [
        entry.startedAt,
        entry.endedAt ?? '',
        // Ponto e vírgula no título quebraria a coluna: vira vírgula.
        entry.title.replace(/;/g, ','),
        entry.type,
        entry.plannedFrames ?? '',
        entry.airedFrames ?? '',
        drift,
        entry.endedBy ?? '',
      ].join(';')
    })

    void reply.header('content-type', 'text/csv; charset=utf-8')
    void reply.header(
      'content-disposition',
      `attachment; filename="asrun-${channel.name.replace(/\W+/g, '-')}-${start.slice(0, 10)}.csv"`,
    )
    return [head, ...lines].join('\n')
  })

  // ---- cópia de segurança --------------------------------------------------

  server.get('/api/backups', async () => ({
    directory: app.backupDir,
    files: await listBackups(app.backupDir),
  }))

  server.post('/api/backups', async () => {
    const result = await backupDatabase(app.sqlite, app.backupDir)
    return { ...result, files: await listBackups(app.backupDir) }
  })

  // ---- montagem automática -----------------------------------------------

  const fillSchema = z.object({
    /** Quanto tempo preencher, em minutos. */
    minutes: z.number().int().min(1).max(720),
    categories: z.array(z.string()).optional(),
    /** Não repetir o que foi ao ar nas últimas N horas. */
    avoidHours: z.number().min(0).max(720).optional(),
    /** Só planejar, sem gravar. É o que a interface mostra antes de aplicar. */
    preview: z.boolean().optional(),
  })

  server.post('/api/rundowns/:id/autofill', async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = fillSchema.safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const runtime = await runtimeForRundown(app, id)
    if (!runtime?.view) return reply.code(404).send({ error: 'Rundown não encontrado.' })

    const assets = await listAssets(app.db)
    const candidates = await buildCandidates(app.db, runtime.channel, assets)
    const plan = planFill(
      candidates,
      runtime.channel,
      secondsToFrames(body.data.minutes * 60, runtime.channel.rate),
      body.data.categories ?? [],
      (body.data.avoidHours ?? 6) * 60,
    )

    const byId = new Map(assets.map((asset) => [asset.id, asset]))
    const chosen = plan.items.map((item) => ({
      mediaId: item.id,
      title: byId.get(item.id)?.title ?? 'arquivo',
      durationFrames: item.durationFrames,
    }))

    // Planejar é de graça; aplicar mexe na grade, e por isso é pedido à parte.
    if (body.data.preview) {
      return { plan: { ...plan, items: chosen } }
    }

    await app.history.capture(app.db, id, 'montagem automática', { wholeRundown: true })

    let order = (runtime.view.items.at(-1)?.item.order ?? 0) + 10
    for (const item of plan.items) {
      const asset = byId.get(item.id)
      if (!asset) continue
      const itemId = randomUUID()
      await app.db.insert(rundownItems).values({
        id: itemId,
        rundownId: id,
        sortOrder: order,
        type: 'VT',
        title: asset.title,
        mediaId: asset.id,
        sourceRef: null,
        trim: null,
        audio: null,
        durationOverride: null,
        minDuration: item.durationFrames,
        anchor: { kind: 'FLOW' },
        onOverrun: 'PUSH',
        elastic: null,
        locked: false,
        autoNext: true,
        loop: false,
        notes: null,
      })
      // A montagem automática também vira decisão: o que ela propôs e o
      // operador manteve é aprendizado tanto quanto o que ele inseriu na mão.
      await logDecision(app, id, itemId, 'AUTO_FILLED', { mediaId: asset.id })
      order += 10
    }

    await runtime.refresh()
    onChange()
    return { plan: { ...plan, items: chosen }, ...snapshot(app, runtime) }
  })

  // ---- as-run ------------------------------------------------------------

  server.get('/api/channels/:id/asrun', async (request, reply) => {
    const { id } = request.params as { id: string }
    const { since } = request.query as { since?: string }
    const channel = await getChannel(app.db, id)
    if (!channel) return reply.code(404).send({ error: 'Canal não encontrado.' })

    // Sem `since`, o dia de hoje: é o recorte que o operador quer ver, e um
    // as-run inteiro de meses não cabe numa tela nem numa resposta.
    const start = since ?? new Date(new Date().setHours(0, 0, 0, 0)).toISOString()
    const entries = await listAsRun(app.db, id, start)
    return { since: start, entries }
  })

  // ---- grafismo ----------------------------------------------------------

  server.get('/api/graphics', async (request) => {
    const { channelId } = request.query as { channelId?: string }
    const rows = await app.db.select().from(graphicTemplates).orderBy(asc(graphicTemplates.name))
    // Template sem canal vale para todos; com canal, só para o dele.
    return {
      templates: rows.filter(
        (row) => !channelId || row.channelId === null || row.channelId === channelId,
      ),
    }
  })

  const templateSchema = z.object({
    name: z.string().min(1),
    svg: z.string().min(1),
    channelId: z.string().nullable().optional(),
    fields: z
      .array(
        z.object({
          key: z.string().min(1),
          label: z.string().min(1),
          defaultValue: z.string(),
        }),
      )
      .optional(),
    fadeMs: z.number().int().min(0).max(5000).optional(),
    holdSeconds: z.number().int().min(1).max(3600).nullable().optional(),
  })

  server.post('/api/graphics', async (request, reply) => {
    const body = templateSchema.safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    // Campo que o SVG usa e ninguém declarou entra com o próprio nome: é
    // melhor um rótulo feio do que um campo que não dá para preencher.
    const declared = body.data.fields ?? []
    const fields = fieldsUsedIn(body.data.svg).map(
      (key) =>
        declared.find((field) => field.key === key) ?? {
          key,
          label: key,
          defaultValue: '',
        },
    )

    const row = {
      id: randomUUID(),
      channelId: body.data.channelId ?? null,
      name: body.data.name,
      svg: body.data.svg,
      fields,
      fadeMs: body.data.fadeMs ?? 300,
      holdSeconds: body.data.holdSeconds ?? null,
      createdAt: new Date().toISOString(),
    }
    await app.db.insert(graphicTemplates).values(row)
    return { template: row }
  })

  server.patch('/api/graphics/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = templateSchema.partial().safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const [existing] = await app.db
      .select()
      .from(graphicTemplates)
      .where(eq(graphicTemplates.id, id))
    if (!existing) return reply.code(404).send({ error: 'Template não existe.' })

    const svg = body.data.svg ?? existing.svg
    const declared = body.data.fields ?? existing.fields
    const fields = fieldsUsedIn(svg).map(
      (key) =>
        declared.find((field) => field.key === key) ?? { key, label: key, defaultValue: '' },
    )

    await app.db
      .update(graphicTemplates)
      .set({ ...body.data, svg, fields })
      .where(eq(graphicTemplates.id, id))
    return { ok: true }
  })

  server.delete('/api/graphics/:id', async (request) => {
    const { id } = request.params as { id: string }
    await app.db.delete(graphicTemplates).where(eq(graphicTemplates.id, id))
    return { ok: true }
  })

  const fireSchema = z.object({
    templateId: z.string(),
    values: z.record(z.string(), z.string()).optional(),
  })

  server.post('/api/channels/:id/graphic', async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = fireSchema.safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const runtime = await runtimeFor(app, id)
    if (!runtime) return reply.code(404).send({ error: 'Canal não encontrado.' })

    const [template] = await app.db
      .select()
      .from(graphicTemplates)
      .where(eq(graphicTemplates.id, body.data.templateId))
    if (!template) return reply.code(404).send({ error: 'Template não existe.' })

    runtime.graphics.show(template, body.data.values ?? {})
    onChange()
    return snapshot(app, runtime)
  })

  server.delete('/api/channels/:id/graphic', async (request, reply) => {
    const { id } = request.params as { id: string }
    const runtime = await runtimeFor(app, id)
    if (!runtime) return reply.code(404).send({ error: 'Canal não encontrado.' })
    runtime.graphics.hide()
    onChange()
    return snapshot(app, runtime)
  })

  server.get('/api/items/:id/graphics', async (request, reply) => {
    const { id } = request.params as { id: string }
    const runtime = await runtimeForItem(app, id)
    if (!runtime) return reply.code(404).send({ error: 'Item não encontrado.' })
    return { cues: runtime.cuesOf(id) }
  })

  const cueSchema = z.object({
    templateId: z.string(),
    values: z.record(z.string(), z.string()).optional(),
    atSeconds: z.number().int().min(0).max(86_400),
  })

  server.post('/api/items/:id/graphics', async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = cueSchema.safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const runtime = await runtimeForItem(app, id)
    if (!runtime) return reply.code(404).send({ error: 'Item não encontrado.' })

    await app.db.insert(itemGraphics).values({
      id: randomUUID(),
      itemId: id,
      templateId: body.data.templateId,
      values: body.data.values ?? {},
      atSeconds: body.data.atSeconds,
      createdAt: new Date().toISOString(),
    })
    await runtime.refresh()
    onChange()
    return { cues: runtime.cuesOf(id) }
  })

  server.delete('/api/item-graphics/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const [cue] = await app.db.select().from(itemGraphics).where(eq(itemGraphics.id, id))
    if (!cue) return reply.code(404).send({ error: 'Deixa não existe.' })

    await app.db.delete(itemGraphics).where(eq(itemGraphics.id, id))
    const runtime = await runtimeForItem(app, cue.itemId)
    if (runtime) await runtime.refresh()
    onChange()
    return { cues: runtime?.cuesOf(cue.itemId) ?? [] }
  })

  // ---- perfis de saída ---------------------------------------------------

  server.get('/api/channels/:id/outputs', async (request) => {
    const { id } = request.params as { id: string }
    const path = app.paths.find((entry) => entry.channelId === id)
    const rows = await listOutputs(app.db, id)
    return {
      outputs: rows.map((row) => ({
        ...row,
        // Destino efetivo: derivado nos gerenciados, guardado nos demais.
        resolvedTarget: targetOf(row, path),
      })),
    }
  })

  server.post('/api/channels/:id/outputs', async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = z
      .object({
        name: z.string().min(1),
        kind: z.enum(['RTMP', 'SRT', 'FILE']),
        target: z.string().min(1),
      })
      .safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: 'Dê um nome e um destino.' })

    const row = await createOutput(app.db, id, body.data)
    // Saída nova só existe no engine no próximo start do canal: mexer no
    // conjunto de saídas de um pipeline que está no ar é o tipo de cirurgia
    // que este projeto já pagou caro para evitar.
    return { output: row, restartRequired: true }
  })

  server.patch('/api/outputs/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = z
      .object({
        name: z.string().min(1).optional(),
        target: z.string().min(1).optional(),
        kind: z.enum(['RTMP', 'SRT', 'FILE']).optional(),
        width: z.number().int().positive().nullable().optional(),
        height: z.number().int().positive().nullable().optional(),
        rateNum: z.number().int().positive().nullable().optional(),
        rateDen: z.number().int().positive().nullable().optional(),
        scan: z.enum(['PROGRESSIVE', 'INTERLACED']).nullable().optional(),
        bitrateKbps: z.number().int().positive().nullable().optional(),
        enabled: z.boolean().optional(),
      })
      .safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    await updateOutput(app.db, id, body.data)
    return { ok: true, restartRequired: true }
  })

  server.delete('/api/outputs/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    if (!(await deleteOutput(app.db, id))) {
      return reply.code(409).send({ error: 'Programa e preview não podem ser removidos.' })
    }
    return { ok: true, restartRequired: true }
  })

  server.post('/api/channels/:id/guests', async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = z.object({ label: z.string().min(1) }).safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: 'Dê um nome ao convidado.' })

    const streamKey = randomUUID().replace(/-/g, '').slice(0, 20)
    await app.db.insert(guestKeys).values({
      id: randomUUID(),
      channelId: id,
      label: body.data.label,
      streamKey,
      enabled: true,
      createdAt: new Date().toISOString(),
    })

    await syncDistribution(app)
    return {
      streamKey,
      publishUrl: `rtmp://${lanAddress()}:${PORTS.rtmp}/guest/${streamKey}`,
    }
  })

  server.delete('/api/guests/:id', async (request) => {
    const { id } = request.params as { id: string }
    // Revogar é sumir com o caminho: quem tinha a chave passa a publicar no
    // vazio, sem derrubar quem está no ar.
    await app.db.delete(guestKeys).where(eq(guestKeys.id, id))
    await syncDistribution(app)
    return { ok: true }
  })

  server.post('/api/channels/:id/destinations', async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = z
      .object({ name: z.string().min(1), url: z.string().min(1) })
      .safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: 'Informe nome e endereço.' })

    await app.db.insert(destinations).values({
      id: randomUUID(),
      channelId: id,
      name: body.data.name,
      url: body.data.url,
      enabled: true,
      createdAt: new Date().toISOString(),
    })

    await syncDistribution(app)
    return { ok: true }
  })

  server.patch('/api/destinations/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = z
      .object({
        name: z.string().min(1).optional(),
        url: z.string().min(1).optional(),
        enabled: z.boolean().optional(),
      })
      .safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    await app.db.update(destinations).set(body.data).where(eq(destinations.id, id))
    await syncDistribution(app)
    return { ok: true }
  })

  server.delete('/api/destinations/:id', async (request) => {
    const { id } = request.params as { id: string }
    await app.db.delete(destinations).where(eq(destinations.id, id))
    await syncDistribution(app)
    return { ok: true }
  })

  // ---- desfazer e refazer ----------------------------------------------

  const step = (kind: 'undo' | 'redo') =>
    async (request: { params: unknown }, reply: { code: (n: number) => { send: (b: unknown) => unknown } }) => {
      const { id } = request.params as { id: string }
      const runtime = await runtimeForRundown(app, id)
      if (!runtime?.view) return reply.code(404).send({ error: 'Rundown não encontrado.' })

      const label = await (kind === 'undo'
        ? app.history.undo(app.db, id)
        : app.history.redo(app.db, id))
      if (!label) {
        return reply
          .code(400)
          .send({ error: kind === 'undo' ? 'Nada para desfazer.' : 'Nada para refazer.' })
      }

      await runtime.refresh()
      onChange()
      return { ...snapshot(app, runtime), label }
    }

  server.post('/api/rundowns/:id/undo', step('undo'))
  server.post('/api/rundowns/:id/redo', step('redo'))

  // ---- blocos ----------------------------------------------------------

  server.post('/api/rundowns/:id/blocks', async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = z
      .object({ itemIds: z.array(z.string()).min(2) })
      .safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: 'Selecione pelo menos dois itens.' })

    const runtime = await runtimeForRundown(app, id)
    if (!runtime?.view) return reply.code(404).send({ error: 'Rundown não encontrado.' })

    const ids = runtime.view.items.map((entry) => entry.item.id)
    const chosen = body.data.itemIds.filter((candidate) => ids.includes(candidate))
    if (chosen.length < 2) {
      return reply.code(400).send({ error: 'Os itens não são todos desta grade.' })
    }

    await app.history.capture(app.db, id, 'agrupar em bloco', { wholeRundown: true })

    // O bloco fica contíguo na posição do primeiro escolhido: um bloco com
    // buracos no meio não é um bloco.
    const chosenSet = new Set(chosen)
    const ordered = chosen.slice().sort((a, b) => ids.indexOf(a) - ids.indexOf(b))
    const rest = ids.filter((candidate) => !chosenSet.has(candidate))
    const at = Math.min(...ordered.map((candidate) => ids.indexOf(candidate)))
    const before = ids.slice(0, at).filter((candidate) => !chosenSet.has(candidate))
    rest.splice(0, rest.length, ...before, ...rest.slice(before.length))
    rest.splice(before.length, 0, ...ordered)

    const blockId = randomUUID()
    for (const [position, itemId] of rest.entries()) {
      await app.db
        .update(rundownItems)
        .set({
          sortOrder: (position + 1) * 10,
          ...(chosenSet.has(itemId) ? { blockId } : {}),
        })
        .where(eq(rundownItems.id, itemId))
    }

    await logDecision(app, id, null, 'BLOCK_CREATED', { blockId, itemIds: ordered })
    await runtime.refresh()
    onChange()
    return snapshot(app, runtime)
  })

  server.post('/api/blocks/:blockId/ungroup', async (request, reply) => {
    const { blockId } = request.params as { blockId: string }
    const [row] = await app.db
      .select({ rundownId: rundownItems.rundownId })
      .from(rundownItems)
      .where(eq(rundownItems.blockId, blockId))
    if (!row) return reply.code(404).send({ error: 'Bloco não encontrado.' })

    const runtime = await runtimeForRundown(app, row.rundownId)
    if (!runtime?.view) return reply.code(404).send({ error: 'Rundown não encontrado.' })

    await app.history.capture(app.db, row.rundownId, 'desfazer bloco', { wholeRundown: true })
    await app.db
      .update(rundownItems)
      .set({ blockId: null })
      .where(eq(rundownItems.blockId, blockId))

    await logDecision(app, row.rundownId, null, 'BLOCK_REMOVED', { blockId })
    await runtime.refresh()
    onChange()
    return snapshot(app, runtime)
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
    return snapshot(app, runtime)
  })
}

/**
 * Endereço da máquina na rede local, para os endereços que o operador copia.
 * Sem uma interface externa, sobra o loopback -- que é honesto: se não há rede,
 * não há como um convidado chegar.
 */
function lanAddress(): string {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && !address.internal) return address.address
    }
  }
  return '127.0.0.1'
}
