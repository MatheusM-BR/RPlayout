import { randomUUID } from 'node:crypto'
import { and, asc, desc, eq, gt, isNotNull } from 'drizzle-orm'
import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import {
  durationIn,
  fieldsUsedIn,
  dateInName,
  formatVideoFormat,
  formatTimecode,
  type GraphicsLayer,
  type Scte35Message,
  type ExternalDeviceCommand,
  framesSinceMidnight,
  isStill,
  RATE_PADRAO,
  secondsToFrames,
  suggestedBitrateKbps,
  STILL_DEFAULT_SECONDS,
  trimDuration,
  type Anchor,
  type Frames,
  type MediaAsset,
  type PreviewTarget,
} from '@rplayout/protocol'
import { networkInterfaces } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  runtimeFor,
  runtimeForItem,
  runtimeForRundown,
  type App,
  type ChannelRuntime,
} from './app.js'
import {
  assetMap,
  getChannel,
  getItem,
  getRundown,
  listAssets,
  listChannels,
  listItems,
  listRundowns,
  renumber,
} from './db/repo.js'
import {
  listAsRun,
  exportAsRunBxf,
  exportAsRunCsv,
  getAncineComplianceSummary,
} from './domain/asrun.js'
import { buildCandidates, planFill } from './domain/autofill.js'
import { backupDatabase, listBackups } from './domain/backup.js'
import { syncDistribution } from './app.js'
import { MediaMtx, PORTS } from './domain/mediamtx.js'
import { can, parseRole, roleLabel, type Action } from './domain/permissions.js'
import { hashPassword, verifyPassword } from './domain/auth.js'
import { emitIntegrationEvent } from './domain/integrations.js'
import { redactUrl } from './domain/relays.js'
import { probeN1Peer } from './domain/n1.js'
import { conflictsWithScheduleRule } from './domain/schedule-rules.js'
import { activeHorizonRule } from './domain/continuous.js'
import { DEFAULT_ROLE, AUTH_PASSWORD, AUTH_USER, EXTERNAL_CONTROL_TOKEN, N1_PEER_URL } from './config.js'

const execFileAsync = promisify(execFile)
import * as Roots from './domain/roots.js'
import {
  categories,
  channels,
  destinations,
  rundowns,
  graphicTemplates,
  guestKeys,
  itemGraphics,
  mediaAssets,
  rundownItems,
  scheduleRules,
  outputProfiles,
  playlistVersions,
  users,
  sessions,
  healthEvents,
  integrations,
  liveSources,
  multiviewConfigs,
} from './db/schema.js'
import {
  globalSrtManager,
  listLiveSources,
  getLiveSource,
  createLiveSource,
  updateLiveSource,
  deleteLiveSource,
  getMultiviewConfig,
  saveMultiviewConfig,
  type MultiviewCell,
  type MultiviewLayout,
} from './domain/srt.js'
import { globalScteDispatcher } from './domain/scte.js'
import { globalStudioAutomationGateway } from './domain/external-control.js'
import { asRun, operatorDecisions } from './db/schema.js'
import { applyAudio, applyTrim, targetItemIds } from './domain/scopes.js'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { extname, resolve as resolvePath } from 'node:path'
import {
  createOutput,
  deleteOutput,
  listOutputs,
  targetOf,
  updateOutput,
} from './domain/outputs.js'
import { thumbnailSvg } from './domain/thumbnail.js'
import * as Playlists from './domain/playlists.js'
import { buildView, type RundownView } from './domain/plan.js'
import { generateTimelineMultiTrack } from './domain/timeline.js'
import { globalConcurrencyManager } from './domain/concurrency.js'
import type { TimelineZoomLevel, ConflictResolutionDecision } from '@rplayout/protocol'

/**
 * Só o que um navegador tem chance de tocar. O resto sai como octet-stream e o
 * `<video>` recusa na hora, que é o sinal para a interface cair na régua de
 * quadros em vez de fingir que vai tocar.
 */
/**
 * Cor de categoria que ninguém escolheu ainda.
 *
 * Cinza-azulado do próprio painel: não chama atenção, e é o que faz a cor
 * escolhida significar alguma coisa quando aparece ao lado.
 */
const COR_PADRAO = '#5570ab'

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.ogv': 'video/ogg',
  // Contêineres de broadcast. Nem todos o navegador decodifica, mas mandar o
  // tipo certo faz a recusa dele ser honesta: com `octet-stream` ele recusa
  // até o que decodificaria, e o operador vê imagem parada num arquivo que
  // tocaria sem problema.
  '.ts': 'video/mp2t',
  '.m2ts': 'video/mp2t',
  '.mts': 'video/mp2t',
  '.mpg': 'video/mpeg',
  '.mpeg': 'video/mpeg',
  '.avi': 'video/x-msvideo',
  '.wmv': 'video/x-ms-wmv',
  '.mxf': 'application/mxf',
  '.3gp': 'video/3gpp',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
}

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
  z.object({ kind: z.literal('HARD_TIME'), at: z.number().int().min(0) }),
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
  actorUsername: string | null = null,
): Promise<void> {
  await app.db.insert(operatorDecisions).values({
    id: randomUUID(),
    rundownId,
    itemId,
    kind,
    payload,
    actorUsername,
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
/**
 * O caminho está dentro da pasta do acervo?
 *
 * A lista vem por parâmetro, e parâmetro é de quem chama. Sem esta trava,
 * pedir `../../../etc/passwd` faria o servidor ler e devolver qualquer arquivo
 * da máquina -- a rota existe para ler listas da pasta configurada, e é só
 * isso que ela vai ler.
 */
/**
 * O caminho está dentro de alguma pasta do acervo?
 *
 * É a guarda que impede um caminho vindo de fora de virar leitura de qualquer
 * arquivo da máquina. Com mais de uma pasta ela passou a perguntar a todas.
 */
async function dentroDoAcervo(app: App, candidato: string): Promise<boolean> {
  const roots = await Roots.listRoots(app.db, app.mediaRoot)
  return Roots.dentroDasPastas(roots, candidato)
}

function monitors(app: App, channelId: string) {
  const path = app.paths.find((entry) => entry.channelId === channelId)
  if (!app.mediamtx?.running || !path) return null
  // O fluxo `pgm` é a fonte de verdade do programa e já carrega a trilha de
  // áudio. O antigo `mon` era uma cópia reduzida que podia chegar sem áudio
  // quando o encoder Opus não estava disponível; isso deixava o painel mudo
  // apesar de /pgm funcionar no navegador. O MediaMTX entrega o mesmo fluxo
  // por WHEP, sem uma segunda codificação no engine.
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
  const roleOf = async (request: { headers: Record<string, string | string[] | undefined> }) => {
    const cookie = typeof request.headers.cookie === 'string' ? request.headers.cookie : ''
    const token = cookie.split(';').map((part: string) => part.trim()).find((part: string) => part.startsWith('rplayout_session='))?.slice(17)
    if (token) {
      const [row] = await app.db.select({ role: users.role }).from(sessions).innerJoin(users, eq(sessions.userId, users.id)).where(and(eq(sessions.token, token), gt(sessions.expiresAt, new Date().toISOString()), eq(users.enabled, true))).limit(1)
      if (row) return parseRole(row.role)
    }
    // Com autenticação configurada, cabeçalho nunca pode elevar privilégio.
    if (AUTH_USER && AUTH_PASSWORD) return 'OPERATOR'
    return parseRole(request.headers['x-rplayout-role'] ?? DEFAULT_ROLE)
  }
  const usernameOf = async (request: { headers: Record<string, string | string[] | undefined> }): Promise<string | null> => {
    const cookie = typeof request.headers.cookie === 'string' ? request.headers.cookie : ''
    const token = cookie.split(';').map((part: string) => part.trim()).find((part: string) => part.startsWith('rplayout_session='))?.slice(17)
    if (!token) return null
    const [row] = await app.db.select({ username: users.username }).from(sessions).innerJoin(users, eq(sessions.userId, users.id)).where(and(eq(sessions.token, token), gt(sessions.expiresAt, new Date().toISOString()), eq(users.enabled, true))).limit(1)
    return row?.username ?? null
  }
  const allowed = async (request: { headers: Record<string, string | string[] | undefined> }, action: Action): Promise<boolean> =>
    can(await roleOf(request), action)

  server.get('/api/session', async (request) => {
    const role = await roleOf(request)
    const authenticated = (await usernameOf(request)) !== null
    return { role, label: roleLabel(role), authenticated, required: Boolean(AUTH_USER && AUTH_PASSWORD) }
  })
  server.post('/api/auth/login', async (request, reply) => {
    const body = z.object({ username: z.string().min(1), password: z.string().min(1) }).safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: 'Informe usuário e senha.' })
    let [user] = await app.db.select().from(users).where(eq(users.username, body.data.username)).limit(1)
    if (!user && AUTH_USER && AUTH_PASSWORD && body.data.username === AUTH_USER && body.data.password === AUTH_PASSWORD) {
      const created = { id: randomUUID(), username: AUTH_USER, passwordHash: await hashPassword(AUTH_PASSWORD), role: 'ADMIN' as const, enabled: true, createdAt: new Date().toISOString() }
      await app.db.insert(users).values(created)
      user = created
    }
    if (!user || !user.enabled || !(await verifyPassword(body.data.password, user.passwordHash))) return reply.code(401).send({ error: 'Usuário ou senha inválidos.' })
    const token = randomUUID() + randomUUID()
    await app.db.insert(sessions).values({ token, userId: user.id, expiresAt: new Date(Date.now() + 43_200_000).toISOString(), createdAt: new Date().toISOString() })
    return reply.header('set-cookie', `rplayout_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200`).send({ role: user.role, label: roleLabel(parseRole(user.role)) })
  })
  server.post('/api/auth/logout', async (request, reply) => {
    const cookie = typeof request.headers.cookie === 'string' ? request.headers.cookie : ''
    const token = cookie.split(';').map((part: string) => part.trim()).find((part: string) => part.startsWith('rplayout_session='))?.slice(17)
    if (token) await app.db.delete(sessions).where(eq(sessions.token, token))
    return reply.header('set-cookie', 'rplayout_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0').send({ ok: true })
  })
  server.get('/api/users', async (request, reply) => {
    if (!(await allowed(request, 'USER_MANAGE'))) return reply.code(403).send({ error: 'Apenas administradores podem gerenciar usuários.' })
    return { users: await app.db.select({ id: users.id, username: users.username, role: users.role, enabled: users.enabled, createdAt: users.createdAt }).from(users) }
  })
  server.get('/api/audit', async (request, reply) => {
    if (!(await allowed(request, 'REPORT_EXPORT'))) return reply.code(403).send({ error: 'Sem permissão para consultar auditoria.' })
    const query = request.query as { limit?: string }
    const limit = Math.min(1000, Math.max(1, Number(query.limit ?? 200) || 200))
    const rows = await app.db.select().from(operatorDecisions).orderBy(desc(operatorDecisions.createdAt)).limit(limit)
    return { entries: rows.reverse() }
  })
  server.get('/api/health-events', async (request, reply) => {
    if (!(await allowed(request, 'REPORT_EXPORT'))) return reply.code(403).send({ error: 'Sem permissão para consultar saúde.' })
    const query = request.query as { channelId?: string; limit?: string }
    const limit = Math.min(2000, Math.max(1, Number(query.limit ?? 500) || 500))
    const rows = await app.db
      .select()
      .from(healthEvents)
      .where(query.channelId ? eq(healthEvents.channelId, query.channelId) : undefined)
      .orderBy(desc(healthEvents.occurredAt))
      .limit(limit)
    return { events: rows.reverse() }
  })
  server.get('/api/health-events.csv', async (request, reply) => {
    if (!(await allowed(request, 'REPORT_EXPORT'))) return reply.code(403).send({ error: 'Sem permissão para exportar saúde.' })
    const query = request.query as { channelId?: string; since?: string }
    const rows = await app.db
      .select()
      .from(healthEvents)
      .where(query.channelId ? eq(healthEvents.channelId, query.channelId) : undefined)
      .orderBy(desc(healthEvents.occurredAt))
      .limit(10_000)
    const filtered = (query.since ? rows.filter((row) => row.occurredAt >= query.since!) : rows).reverse()
    const quote = (value: unknown): string => `"${String(value ?? '').replace(/"/g, '""')}"`
    const csv = ['horário;canal;componente;estado;severidade;mensagem;reconhecido', ...filtered.map((row) => [row.occurredAt, row.channelId, row.component, row.state, row.severity, row.message, row.acknowledgedAt].map(quote).join(';'))].join('\n')
    void reply.header('content-type', 'text/csv; charset=utf-8')
    void reply.header('content-disposition', 'attachment; filename="rplayout-saude.csv"')
    return csv
  })
  server.post('/api/health-events/:id/ack', async (request, reply) => {
    if (!(await allowed(request, 'CHANNEL_STOP'))) return reply.code(403).send({ error: 'Supervisor precisa reconhecer alertas.' })
    const { id } = request.params as { id: string }
    await app.db.update(healthEvents).set({ acknowledgedAt: new Date().toISOString() }).where(eq(healthEvents.id, id))
    return { ok: true }
  })
  server.get('/api/integrations', async (request, reply) => {
    if (!(await allowed(request, 'OUTPUT_CONTROL'))) return reply.code(403).send({ error: 'Sem permissão para integrações.' })
    const { channelId } = request.query as { channelId?: string }
    const rows = await app.db.select().from(integrations)
    return { integrations: channelId ? rows.filter((row) => row.channelId === channelId || row.channelId === null) : rows }
  })
  server.post('/api/integrations', async (request, reply) => {
    if (!(await allowed(request, 'OUTPUT_CONTROL'))) return reply.code(403).send({ error: 'Sem permissão para integrações.' })
    const body = z.object({ channelId: z.string().nullable().optional(), name: z.string().min(1), url: z.string().url(), events: z.array(z.string()).min(1) }).safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: 'Informe nome, URL válida e pelo menos um evento.' })
    const row = { id: randomUUID(), channelId: body.data.channelId ?? null, name: body.data.name, url: body.data.url, events: body.data.events, enabled: false, createdAt: new Date().toISOString() }
    await app.db.insert(integrations).values(row)
    return { integration: row }
  })
  server.patch('/api/integrations/:id', async (request, reply) => {
    if (!(await allowed(request, 'OUTPUT_CONTROL'))) return reply.code(403).send({ error: 'Sem permissão para integrações.' })
    const body = z.object({ name: z.string().min(1).optional(), url: z.string().url().optional(), events: z.array(z.string()).min(1).optional(), enabled: z.boolean().optional() }).safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: 'Alteração inválida.' })
    const { id } = request.params as { id: string }
    await app.db.update(integrations).set(body.data).where(eq(integrations.id, id))
    return { ok: true }
  })
  server.post('/api/integrations/:id/test', async (request, reply) => {
    if (!(await allowed(request, 'OUTPUT_CONTROL'))) return reply.code(403).send({ error: 'Sem permissão para integrações.' })
    const { id } = request.params as { id: string }
    const [integration] = await app.db.select().from(integrations).where(eq(integrations.id, id)).limit(1)
    if (!integration) return reply.code(404).send({ error: 'Integração não encontrada.' })
    try {
      const response = await fetch(integration.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'rplayout.test', sentAt: new Date().toISOString() }) })
      return { ok: response.ok, status: response.status }
    } catch (error) { return { ok: false, error: error instanceof Error ? error.message : 'falha de rede' } }
  })
  // Entrada normalizada para automação SCTE-35/104. O playout registra a
  // intenção e distribui para os gateways configurados; a inserção física no
  // encoder permanece responsabilidade do perfil de saída selecionado.
  server.post('/api/cues/scte', async (request, reply) => {
    if (!(await allowed(request, 'OUTPUT_CONTROL'))) return reply.code(403).send({ error: 'Sem permissão para SCTE.' })
    const body = z.object({
      channelId: z.string().min(1),
      eventId: z.string().min(1),
      command: z.enum(['splice_insert', 'time_signal', 'splice_null']),
      ptsTime: z.number().nonnegative().optional(),
      durationMs: z.number().positive().optional(),
      segmentationTypeId: z.number().int().min(0).max(255).optional(),
      autoReturn: z.boolean().optional(),
      source: z.enum(['SCTE35', 'SCTE104', 'OPERATOR']).default('OPERATOR'),
    }).safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: 'Cue SCTE inválido.' })
    const payload = body.data
    const message = `Cue ${payload.command} recebido (${payload.source}), evento ${payload.eventId}.`
    await app.db.insert(healthEvents).values({ id: randomUUID(), channelId: payload.channelId, component: 'SCTE', state: 'received', severity: 'INFO', message, occurredAt: new Date().toISOString() }).run()
    await emitIntegrationEvent(app.db, 'scte.cue', payload, payload.channelId)
    return { ok: true, acceptedAt: new Date().toISOString(), payload }
  })
  server.get('/api/cues/scte', async (request) => {
    const { channelId, limit } = request.query as { channelId?: string; limit?: string }
    const rows = await app.db.select().from(healthEvents)
      .where(eq(healthEvents.component, 'SCTE'))
      .orderBy(desc(healthEvents.occurredAt))
      .limit(Math.min(500, Math.max(1, Number(limit ?? 100))))
    return { cues: rows.filter((row) => !channelId || row.channelId === channelId) }
  })
  server.get('/api/cues/scte.csv', async (request, reply) => {
    const { channelId } = request.query as { channelId?: string }
    const rows = await app.db.select().from(healthEvents).where(eq(healthEvents.component, 'SCTE')).orderBy(asc(healthEvents.occurredAt))
    const quote = (value: unknown): string => `"${String(value ?? '').replace(/"/g, '""')}"`
    const filtered = rows.filter((row) => !channelId || row.channelId === channelId)
    const csv = ['horário;canal;estado;mensagem;reconhecido', ...filtered.map((row) => [row.occurredAt, row.channelId, row.state, row.message, row.acknowledgedAt].map(quote).join(';'))].join('\n')
    void reply.header('content-type', 'text/csv; charset=utf-8')
    void reply.header('content-disposition', 'attachment; filename="rplayout-scte.csv"')
    return csv
  })
  server.post('/api/users', async (request, reply) => {
    if (!(await allowed(request, 'USER_MANAGE'))) return reply.code(403).send({ error: 'Apenas administradores podem gerenciar usuários.' })
    const body = z.object({ username: z.string().min(1).max(80), password: z.string().min(8), role: z.enum(['OPERATOR', 'PROGRAMMER', 'SUPERVISOR', 'ADMIN']) }).safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: 'Informe usuário, senha com 8 caracteres e papel.' })
    try {
      const row = { id: randomUUID(), username: body.data.username, passwordHash: await hashPassword(body.data.password), role: body.data.role, enabled: true, createdAt: new Date().toISOString() }
      await app.db.insert(users).values(row)
      return { user: { id: row.id, username: row.username, role: row.role, enabled: true } }
    } catch { return reply.code(409).send({ error: 'Esse usuário já existe.' }) }
  })
  server.patch('/api/users/:id', async (request, reply) => {
    if (!(await allowed(request, 'USER_MANAGE'))) return reply.code(403).send({ error: 'Apenas administradores podem gerenciar usuários.' })
    const body = z.object({ password: z.string().min(8).optional(), role: z.enum(['OPERATOR', 'PROGRAMMER', 'SUPERVISOR', 'ADMIN']).optional(), enabled: z.boolean().optional() }).safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: 'Alteração inválida.' })
    const { id } = request.params as { id: string }
    await app.db.update(users).set({ ...(body.data.role ? { role: body.data.role } : {}), ...(body.data.enabled === undefined ? {} : { enabled: body.data.enabled }), ...(body.data.password ? { passwordHash: await hashPassword(body.data.password) } : {}) }).where(eq(users.id, id))
    return { ok: true }
  })
  server.get('/api/health', async () => ({
    ok: true,
    uptimeSeconds: Math.floor(process.uptime()),
    channels: app.runtimes.size,
    engines: [...app.runtimes.values()].filter((runtime) => runtime.transport.health().ready).length,
    mediamtx: app.mediamtx ? (app.mediamtx.running ? 'running' : 'stopped') : 'disabled',
    checkedAt: new Date().toISOString(),
  }))
  server.get('/api/n1/status', async () => probeN1Peer(N1_PEER_URL || null, EXTERNAL_CONTROL_TOKEN))
  server.get('/api/n1/state', async () => {
    const channels = [...app.runtimes.values()].map((runtime) => ({
      channelId: runtime.channel.id,
      state: runtime.transport.state(),
      health: runtime.transport.health(),
    }))
    const canonical = JSON.stringify(channels)
    return {
      checkedAt: new Date().toISOString(),
      stateHash: createHash('sha256').update(canonical).digest('hex'),
      channels,
    }
  })
  server.post('/api/n1/compare', async (request, reply) => {
    const body = z.object({ stateHash: z.string().length(64), channels: z.array(z.object({ channelId: z.string(), state: z.unknown(), health: z.unknown().optional() })).optional() }).safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: 'Estado N+1 inválido.' })
    const local = [...app.runtimes.values()].map((runtime) => ({ channelId: runtime.channel.id, state: runtime.transport.state(), health: runtime.transport.health() }))
    const localHash = createHash('sha256').update(JSON.stringify(local)).digest('hex')
    const localIds = new Set(local.map((entry) => entry.channelId))
    const remoteIds = new Set((body.data.channels ?? []).map((entry) => entry.channelId))
    const divergentChannels = [...new Set([...localIds, ...remoteIds])].filter((id) => !localIds.has(id) || !remoteIds.has(id))
    return { match: localHash === body.data.stateHash && divergentChannels.length === 0, localHash, divergentChannels }
  })
  server.get('/api/ready', async (_request, reply) => {
    const engines = [...app.runtimes.values()]
    const stopped = engines.filter((runtime) => !runtime.transport.health().ready)
    const mediaUnavailable = Boolean(app.mediamtx && !app.mediamtx.running)
    const ready = stopped.length === 0 && !mediaUnavailable
    return reply.code(ready ? 200 : 503).send({
      ready,
      channels: engines.length,
      enginesReady: engines.length - stopped.length,
      mediamtx: app.mediamtx ? (app.mediamtx.running ? 'running' : 'stopped') : 'disabled',
      reasons: [
        ...stopped.map((runtime) => `engine:${runtime.channel.id}`),
        ...(mediaUnavailable ? ['mediamtx:stopped'] : []),
      ],
      checkedAt: new Date().toISOString(),
    })
  })
  server.get('/api/scheduler/status', async () => {
    const now = new Date()
    const nowMinute = now.getHours() * 60 + now.getMinutes()
    const weekday = now.getDay()
    const result = []
    for (const runtime of app.runtimes.values()) {
      const rules = await app.db.select().from(scheduleRules).where(eq(scheduleRules.channelId, runtime.channel.id))
      const activeRule = activeHorizonRule(rules, nowMinute, weekday)
      const nowFrames = framesSinceMidnight(now, runtime.channel.rate)
      const endFrames = runtime.view?.schedule.endsAt ?? nowFrames
      const minutesRemaining = Math.max(0, Math.round((endFrames - nowFrames) * runtime.channel.rate.den / runtime.channel.rate.num / 60))
      const targetMinutes = 48 * 60
      result.push({
        channelId: runtime.channel.id,
        rundownId: runtime.view?.rundown.id ?? null,
        activeRule: activeRule ?? null,
        endsAtFrames: endFrames,
        minutesRemaining,
        coverageMinutes: minutesRemaining,
        coverageHours: Math.round((minutesRemaining / 60) * 10) / 10,
        targetHours: 48,
        coverageReady: minutesRemaining >= targetMinutes,
      })
    }
    return { checkedAt: now.toISOString(), channels: result }
  })
  server.get('/api/channels/:id/timeline', async (request, reply) => {
    const { id } = request.params as { id: string }
    const runtime = await runtimeFor(app, id)
    if (!runtime?.view) return reply.code(404).send({ error: 'Canal sem grade carregada.' })
    const now = framesSinceMidnight(new Date(), runtime.channel.rate)
    return {
      channelId: id,
      rate: runtime.channel.rate,
      nowFrames: now,
      items: runtime.view.schedule.items.map((entry) => ({
        itemId: entry.id,
        title: runtime.view?.items.find((view) => view.item.id === entry.id)?.item.title ?? entry.id,
        type: runtime.view?.items.find((view) => view.item.id === entry.id)?.item.type ?? 'VT',
        start: entry.start,
        end: entry.end,
        duration: entry.end - entry.start,
        state: entry.start <= now && now < entry.end ? 'ON_AIR' : entry.start > now ? 'UP_NEXT' : 'AIRED',
      })),
    }
  })

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
    if (!(await allowed(request, 'OUTPUT_CONTROL'))) return reply.code(403).send({ error: 'Seu papel não pode criar canais.' })
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
      rateNum: body.data.rateNum ?? reference?.rate.num ?? RATE_PADRAO.num,
      rateDen: body.data.rateDen ?? reference?.rate.den ?? RATE_PADRAO.den,
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
    const rate = { num: body.data.rateNum ?? reference?.rate.num ?? RATE_PADRAO.num, den: body.data.rateDen ?? reference?.rate.den ?? RATE_PADRAO.den }
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
    if (!(await allowed(request, 'OUTPUT_CONTROL'))) return reply.code(403).send({ error: 'Seu papel não pode configurar canais.' })
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

  /**
   * Lista as grades do canal ou carrega a grade e visão de uma data específica.
   */
  server.get('/api/channels/:id/rundowns', async (request, reply) => {
    const { id } = request.params as { id: string }
    const { date } = request.query as { date?: string }
    const channel = await getChannel(app.db, id)
    if (!channel) return reply.code(404).send({ error: 'Canal não encontrado.' })

    const channelRundowns = await listRundowns(app.db, id)
    if (!date) {
      return { rundowns: channelRundowns }
    }

    const matched = channelRundowns.find((r) => r.date === date)
    if (!matched) {
      return { rundowns: channelRundowns, rundown: null, view: null }
    }

    const [items, assets] = await Promise.all([
      listItems(app.db, matched.id),
      assetMap(app.db),
    ])

    const view = buildView(matched, channel, items, assets, null, null)
    return { rundowns: channelRundowns, rundown: matched, view }
  })

  /**
   * Cria uma nova grade para o canal numa data, opcionalmente clonando os itens de outra grade.
   */
  server.post('/api/channels/:id/rundowns', async (request, reply) => {
    if (!(await allowed(request, 'PLAYLIST_EDIT'))) {
      return reply.code(403).send({ error: 'Seu papel não pode criar grades.' })
    }

    const { id } = request.params as { id: string }
    const channel = await getChannel(app.db, id)
    if (!channel) return reply.code(404).send({ error: 'Canal não encontrado.' })

    const body = z
      .object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        name: z.string().min(1).optional(),
        copyFromRundownId: z.string().optional(),
      })
      .safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const newRundownId = randomUUID()
    const nowIso = new Date().toISOString()
    const rundownName = body.data.name ?? `Grade — ${channel.name} — ${body.data.date}`

    await app.db.insert(rundowns).values({
      id: newRundownId,
      channelId: id,
      name: rundownName,
      plannedStart: 0,
      loop: true,
      date: body.data.date,
      createdAt: nowIso,
      updatedAt: nowIso,
    })

    if (body.data.copyFromRundownId) {
      const sourceItems = await listItems(app.db, body.data.copyFromRundownId)
      for (const item of sourceItems) {
        await app.db.insert(rundownItems).values({
          id: randomUUID(),
          rundownId: newRundownId,
          sortOrder: item.order,
          type: item.type,
          title: item.title,
          mediaId: item.mediaId,
          sourceRef: item.sourceRef,
          trim: item.trim,
          audio: item.audio,
          durationOverride: item.durationOverride,
          minDuration: item.minDuration,
          anchor: item.anchor,
          onOverrun: item.onOverrun,
          elastic: item.elastic,
          blockId: item.blockId,
          fit: item.fit,
          audioTrack: item.audioTrack,
          locked: item.locked,
          autoNext: item.autoNext,
          loop: item.loop,
          notes: item.notes,
        })
      }
    }

    const created = await getRundown(app.db, newRundownId)
    const [items, assets] = await Promise.all([
      listItems(app.db, newRundownId),
      assetMap(app.db),
    ])
    const view = buildView(created!, channel, items, assets, null, null)
    onChange()
    return { rundown: created, view }
  })

  /**
   * Carrega uma grade no runtime ativo do canal.
   */
  server.post('/api/channels/:id/load-rundown', async (request, reply) => {
    if (!(await allowed(request, 'PLAYLIST_PUBLISH'))) {
      return reply.code(403).send({ error: 'Seu papel não pode carregar grades no ar.' })
    }

    const { id } = request.params as { id: string }
    const body = z.object({ rundownId: z.string().min(1) }).safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: 'Indique o ID da grade.' })

    const runtime = await runtimeFor(app, id)
    if (!runtime) return reply.code(404).send({ error: 'Canal não encontrado.' })

    const loadedView = await runtime.load(body.data.rundownId)
    if (!loadedView) return reply.code(404).send({ error: 'Grade não encontrada.' })

    onChange()
    return snapshot(app, runtime)
  })

  server.get('/api/assets', async () => ({ assets: await listAssets(app.db) }))

  /**
   * Explorador de arquivos. A árvore sai do próprio caminho do arquivo, então
   * a organização em disco é a organização que o operador vê.
   */
  server.get('/api/library', async () => {
    // Playout trabalha com vídeo; imagens e áudios podem continuar registrados
    // para não quebrar referências antigas, mas não entram no explorador.
    const assets = (await listAssets(app.db)).filter((asset) => asset.kind === 'VIDEO')
    const roots = await Roots.listRoots(app.db, app.mediaRoot)

    // A pasta é o caminho inteiro de dentro da raiz, não o último pedaço dele.
    //
    // Antes a chave era só o nome da última pasta: `Programação/2026/Fevereiro`
    // e `Comerciais/Fevereiro` viravam os dois "Fevereiro" e se misturavam, e
    // toda a estrutura de subpastas sumia. Do lado de fora isso aparece como
    // "a pasta não está sendo lida por completo" -- os arquivos estão no
    // acervo, mas não onde o operador sabe procurar.
    const grupos = new Map<string, { rootId: string; rel: string; assets: MediaAsset[] }>()
    for (const asset of assets) {
      const caminho = asset.path.replace(/\\/g, '/')
      const root = roots.find((entry) => Roots.contem(entry.path, asset.path))
      const raiz = root ? root.path.replace(/\\/g, '/').replace(/\/$/, '') : ''
      const rel = root
        ? caminho.slice(raiz.length + 1).split('/').slice(0, -1).join('/')
        : caminho.split('/').slice(0, -1).join('/')
      const chave = `${root?.id ?? 'fora'}::${rel}`
      const grupo = grupos.get(chave)
      if (grupo) grupo.assets.push(asset)
      else grupos.set(chave, { rootId: root?.id ?? 'fora', rel, assets: [asset] })
    }

    const rotulo = new Map(roots.map((root) => [root.id, root.label]))
    return {
      roots,
      folders: [...grupos.entries()]
        .map(([key, grupo]) => ({
          key,
          rootId: grupo.rootId,
          // Vazio quer dizer a própria raiz, e "(na raiz)" é mais claro que uma
          // linha sem nome nenhum.
          path: grupo.rel,
          rootLabel: rotulo.get(grupo.rootId) ?? 'fora do acervo',
          // Arquivo de uma pasta que saiu do acervo não tem caminho relativo:
          // mostrar o caminho absoluto inteiro estoura a coluna. Os dois
          // últimos trechos bastam para reconhecer de onde ele veio.
          name:
            grupo.rootId === 'fora'
              ? grupo.rel.split('/').slice(-2).join('/') || grupo.rel
              : grupo.rel === ''
                ? grupo.rootId === 'fora' ? '(fora do acervo)' : (rotulo.get(grupo.rootId) ?? '(na raiz)')
                : grupo.rel,
          assets: grupo.assets.map((asset) => ({
            ...asset,
            fileName: asset.path.replace(/\\/g, '/').split('/').pop() ?? asset.path,
            thumbnailUrl: `/api/assets/${asset.id}/thumbnail.svg`,
          })),
        }))
        .sort(
          (a, b) =>
            a.rootLabel.localeCompare(b.rootLabel, 'pt-BR') ||
            a.path.localeCompare(b.path, 'pt-BR'),
        ),
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
    const rate = channel?.rate ?? RATE_PADRAO
    return reply
      .type('image/svg+xml')
      .header('cache-control', 'public, max-age=3600')
      .send(thumbnailSvg(asset, rate))
  })

  /**
   * O arquivo em si, para o navegador tocar na hora de marcar entrada e saída.
   *
   * Sai com Range: sem isso o navegador teria que baixar um VT inteiro antes
   * de mostrar o primeiro quadro, e arrastar a cabeça de leitura seria baixar
   * tudo de novo. Com Range, ele pede só o pedaço que vai mostrar.
   *
   * O caminho vem do acervo, nunca da requisição -- quem chama escolhe um id,
   * não um lugar no disco.
   *
   * Formato que o navegador não decodifica (MXF, ProRes) simplesmente não toca,
   * e a régua de quadros continua servindo: quem extrai lá é o GStreamer.
   */
  server.get('/api/assets/:id/file', async (request, reply) => {
    const { id } = request.params as { id: string }
    return reply.redirect(`/api/assets/${id}/media`)
  })

  server.get('/api/assets/:id/media', async (request, reply) => {
    const { id } = request.params as { id: string }
    const assets = await listAssets(app.db)
    const asset = assets.find((candidate) => candidate.id === id)
    if (!asset || !existsSync(asset.path)) {
      return reply.code(404).send({ error: 'Arquivo não encontrado.' })
    }

    const tamanho = statSync(asset.path).size
    const tipo = MIME[extname(asset.path).toLowerCase()] ?? 'application/octet-stream'
    const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range ?? '')

    reply.header('accept-ranges', 'bytes').type(tipo)

    if (!range) {
      return reply.header('content-length', tamanho).send(createReadStream(asset.path))
    }

    const inicio = range[1] === '' ? 0 : Number(range[1])
    const fim = range[2] === '' ? tamanho - 1 : Math.min(Number(range[2]), tamanho - 1)
    if (inicio > fim || inicio >= tamanho) {
      return reply.code(416).header('content-range', `bytes */${tamanho}`).send()
    }

    return reply
      .code(206)
      .header('content-range', `bytes ${inicio}-${fim}/${tamanho}`)
      .header('content-length', fim - inicio + 1)
      .send(createReadStream(asset.path, { start: inicio, end: fim }))
  })

  /**
   * Um quadro de dentro do arquivo, para a régua do corte.
   *
   * `:pos` é o índice do quadro na régua e `total` diz de quantas fatias ela é
   * feita: pede-se `0..total-1` e sai a fita inteira. Cada quadro vem do meio
   * da sua fatia, não da borda, porque a borda de uma fatia é a mesma imagem
   * da vizinha e a régua sairia com pares repetidos.
   *
   * O primeiro pedido manda extrair a fita inteira de uma vez -- abrir e
   * posicionar um arquivo grande custa segundos, e fazer isso dezesseis vezes
   * levava um minuto. Os quadros ficam em disco com o hash do conteúdo no
   * nome, então da segunda vez em diante a régua sai na velocidade do disco, e
   * conteúdo novo é endereço novo.
   */
  server.get('/api/assets/:id/frame/:pos.jpg', async (request, reply) => {
    const { id, pos } = request.params as { id: string; pos: string }
    const { total } = request.query as { total?: string }

    const quantos = Math.min(Math.max(Number(total ?? '12') | 0, 1), 64)
    const indice = Math.min(Math.max(Number(pos) | 0, 0), quantos - 1)

    const assets = await listAssets(app.db)
    const asset = assets.find((candidate) => candidate.id === id)
    if (!asset) return reply.code(404).send({ error: 'Arquivo não encontrado.' })

    // Quantas fatias diz para que serve o pedido: a fita embaixo da régua é
    // grosseira e cada quadro dela ocupa uns quarenta pixels na tela, enquanto
    // a divisão fina é a que alimenta a tela de conferência -- essa precisa dar
    // para ver onde cortar.
    const largura = quantos > 24 ? 640 : 320
    const prefixo = resolvePath(app.thumbnailDir, `${asset.contentHash}-${quantos}`)
    const destino = `${prefixo}-${indice}.jpg`

    if (!existsSync(destino)) {
      if ((await app.ingest.strip(asset.path, quantos, prefixo, largura)) === 0) {
        // Sem quadro, a régua usa a miniatura de sempre: ela fica pobre, e não
        // quebrada.
        return reply.redirect(`/api/assets/${asset.id}/thumbnail.svg`)
      }
      // A sonda pode ter parado no meio -- arquivo sem índice não busca até o
      // fim. As fatias que saíram servem; as que faltam caem na miniatura.
      if (!existsSync(destino)) {
        return reply.redirect(`/api/assets/${asset.id}/thumbnail.svg`)
      }
    }

    return reply
      .type('image/jpeg')
      .header('cache-control', 'public, max-age=604800, immutable')
      .send(createReadStream(destino))
  })

  // ---- listas de reprodução ---------------------------------------------

  /**
   * As listas de reprodução que estão na pasta do acervo.
   *
   * O modelo é o que o operador já usa: uma lista por dia, com a data no nome
   * ("Playlist Programação 08-02-2026.m3u"), salva na mesma pasta dos vídeos.
   * Aqui elas são só lidas -- nada é copiado para o banco, então editar a
   * lista por fora e recarregar continua funcionando.
   */
  server.get('/api/playlists', async () => {
    const assets = await listAssets(app.db)
    const roots = await Roots.listRoots(app.db, app.mediaRoot)
    const arquivos: string[] = []
    for (const root of roots) {
      if (root.present) arquivos.push(...(await Playlists.findPlaylists(root.path)))
    }
    const listas = []
    for (const caminho of arquivos) {
      const lista = await Playlists.describe(caminho, assets)
      if (lista) listas.push(lista)
    }

    // A do dia é a que tem a data de hoje. Não havendo, não há lista do dia:
    // adivinhar "a mais recente" poria a programação de ontem no ar hoje.
    const hoje = new Date().toISOString().slice(0, 10)
    return {
      playlists: listas.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt)),
      today: Playlists.playlistOfDay(listas, hoje)?.path ?? null,
      date: hoje,
    }
  })

  /** As entradas de uma lista, já confrontadas com o acervo. */
  server.get('/api/playlists/entries', async (request, reply) => {
    const { path } = request.query as { path?: string }
    if (!path) return reply.code(400).send({ error: 'Diga qual lista.' })
    if (!(await dentroDoAcervo(app, path))) {
      return reply.code(400).send({ error: 'Essa lista não está numa pasta do acervo.' })
    }
    if (!existsSync(path)) return reply.code(404).send({ error: 'Lista não encontrada.' })

    const assets = await listAssets(app.db)
    return { entries: await Playlists.entriesOf(path, assets) }
  })

  server.get('/api/rundowns/:id/playlist-versions', async (request) => {
    const { id } = request.params as { id: string }
    const versions = await app.db
      .select()
      .from(playlistVersions)
      .where(eq(playlistVersions.rundownId, id))
      .orderBy(asc(playlistVersions.publishedAt))
    return { versions: versions.reverse() }
  })

  /**
   * Lê uma lista arrastada para a janela.
   *
   * O navegador não entrega o caminho do arquivo arrastado -- por segurança,
   * só o nome e o conteúdo. Então quem lê o texto é o servidor, e o casamento
   * com o acervo é pelo nome do arquivo, igual ao de uma lista que mora na
   * pasta. É o que permite arrastar um `.m3u` de qualquer lugar da máquina,
   * inclusive de fora das pastas do acervo.
   */
  server.post('/api/playlists/read', async (request, reply) => {
    const body = z
      .object({ name: z.string().min(1), text: z.string().min(1).max(4_000_000) })
      .safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: 'Mande o nome e o conteúdo da lista.' })

    const assets = await listAssets(app.db)
    const entries = Playlists.resolveEntries(body.data.text, assets)
    return {
      name: body.data.name,
      date: dateInName(body.data.name),
      entries,
      // Quantas entradas não acharam arquivo no acervo. Entrar com item sem
      // mídia poria um buraco no ar que só apareceria na hora.
      missing: entries.filter((entry) => entry.mediaId === null).length,
    }
  })

  /**
   * Põe a lista na grade.
   *
   * `replace` limpa a grade antes; sem ele, a lista entra no fim. Entrada que
   * não achou arquivo no acervo é pulada e contada na resposta -- entrar com
   * um item sem mídia poria um buraco no ar que só apareceria na hora.
   *
   * O item no ar nunca sai, mesmo em `replace`: apagar a linha do que está
   * tocando não tira a imagem da tela, só faz a grade mentir.
   */
  server.post('/api/rundowns/:id/playlist', async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = z
      .object({
        path: z.string().min(1).optional(),
        /** Conteúdo de uma lista arrastada, quando não há caminho. */
        text: z.string().min(1).max(4_000_000).optional(),
        replace: z.boolean().default(false),
        scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      })
      .safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: 'Diga qual lista.' })
    if (!(await allowed(request, body.data.replace ? 'PLAYLIST_PUBLISH' : 'PLAYLIST_EDIT'))) {
      return reply.code(403).send({ error: 'Seu papel não pode publicar esta playlist.' })
    }
    // Ou o caminho de uma lista que mora numa pasta do acervo, ou o conteúdo
    // de uma que foi arrastada para a janela -- o navegador não entrega o
    // caminho de um arquivo arrastado, e sem isto arrastar não teria como
    // chegar na grade.
    if (body.data.path !== undefined && !(await dentroDoAcervo(app, body.data.path))) {
      return reply.code(400).send({ error: 'Essa lista não está numa pasta do acervo.' })
    }
    if (body.data.path === undefined && body.data.text === undefined) {
      return reply.code(400).send({ error: 'Diga qual lista.' })
    }

    const runtime = await runtimeForRundown(app, id)
    if (!runtime?.view) return reply.code(404).send({ error: 'Grade não encontrada.' })

    const assets = await listAssets(app.db)
    const entradas =
      body.data.path !== undefined
        ? await Playlists.entriesOf(body.data.path, assets)
        : Playlists.resolveEntries(body.data.text ?? '', assets)
    const aproveitadas = entradas.filter((entrada) => entrada.mediaId !== null)

    await app.history.capture(app.db, runtime.view.rundown.id, 'carregar lista', {
      wholeRundown: true,
    })

    if (body.data.replace) {
      const noAr = runtime.transport.state().onAir?.itemId ?? null
      for (const entrada of runtime.view.items) {
        if (entrada.item.id === noAr) continue
        await app.db.delete(rundownItems).where(eq(rundownItems.id, entrada.item.id))
      }
    }

    // A ordem é recalculada no fim: os itens que ficaram (o que está no ar,
    // ou a grade inteira quando não é substituição) vêm antes da lista.
    const ficaram = runtime.view.items
      .map((entrada) => entrada.item.id)
      .filter((itemId) => !body.data.replace || itemId === runtime.transport.state().onAir?.itemId)
    const novos: string[] = []

    for (const entrada of aproveitadas) {
      const asset = assets.find((candidate) => candidate.id === entrada.mediaId)
      if (!asset) continue

      const parada = isStill(asset)
        ? secondsToFrames(STILL_DEFAULT_SECONDS, runtime.channel.rate)
        : null
      const duracao =
        parada ??
        trimDuration(asset.defaultTrim ?? { in: 0, out: durationIn(asset, runtime.channel.rate) })

      const itemId = randomUUID()
      novos.push(itemId)
      await app.db.insert(rundownItems).values({
        id: itemId,
        rundownId: runtime.view.rundown.id,
        sortOrder: 0,
        type: 'VT',
        // O título da lista manda quando ela dá um: é o nome que o operador
        // escreveu, e ele diz mais que o nome do arquivo.
        title: entrada.title ?? asset.title,
        mediaId: asset.id,
        sourceRef: null,
        trim: null,
        audio: null,
        durationOverride: parada,
        minDuration: duracao,
        anchor: { kind: 'FLOW' as const },
        onOverrun: 'PUSH',
        elastic: null,
        locked: false,
        autoNext: true,
        loop: false,
        notes: null,
      })
    }

    for (const [posicao, itemId] of [...ficaram, ...novos].entries()) {
      await app.db
        .update(rundownItems)
        .set({ sortOrder: (posicao + 1) * 10 })
        .where(eq(rundownItems.id, itemId))
    }

    await runtime.refresh()
    onChange()
    await app.db.insert(playlistVersions).values({
      id: randomUUID(),
      rundownId: runtime.view.rundown.id,
      sourcePath: body.data.path ?? null,
      sourceName: body.data.path?.split(/[\\/]/).pop() ?? 'lista importada',
      mode: body.data.replace ? 'PUBLISH_NEXT' : 'APPEND',
      loaded: aproveitadas.length,
      skipped: entradas.length - aproveitadas.length,
      scheduledDate: body.data.scheduledDate ?? null,
      publishedAt: new Date().toISOString(),
    })
    await logDecision(app, runtime.view.rundown.id, null, body.data.replace ? 'PLAYLIST_PUBLISHED' : 'PLAYLIST_INSERTED', {
      source: body.data.path ?? 'importada', loaded: aproveitadas.length, skipped: entradas.length - aproveitadas.length,
    }, await usernameOf(request))
    void emitIntegrationEvent(app.db, body.data.replace ? 'playlist.published' : 'playlist.inserted', { rundownId: runtime.view.rundown.id, loaded: aproveitadas.length, skipped: entradas.length - aproveitadas.length }, runtime.channel.id)
    return {
      ...snapshot(app, runtime),
      loaded: aproveitadas.length,
      skipped: entradas.length - aproveitadas.length,
    }
  })

  // ---- acervo -----------------------------------------------------------

  const assetPatch = z.object({
    title: z.string().min(1).optional(),
    categoryId: z.string().min(1).nullable().optional(),
    ignored: z.boolean().optional(),
  })

  server.patch('/api/assets/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    if (!(await allowed(request, 'PLAYLIST_EDIT'))) return reply.code(403).send({ error: 'Seu papel não pode editar o acervo.' })
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
    if (!(await allowed(request, 'PLAYLIST_EDIT'))) return reply.code(403).send({ error: 'Seu papel não pode remover arquivos.' })
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
    // Remoção da listagem é persistente. O arquivo volta a ser visto pelo
    // scanner, mas continua ignorado até o operador aceitá-lo explicitamente.
    await app.db.update(mediaAssets).set({ ignored: true }).where(eq(mediaAssets.id, id))
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
  server.post('/api/assets/prune', async (request, reply) => {
    if (!(await allowed(request, 'PLAYLIST_EDIT'))) return reply.code(403).send({ error: 'Seu papel não pode limpar o acervo.' })
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
  /**
   * Categorias do acervo, com a cor e quantos arquivos cada uma tem.
   *
   * A lista é a união de duas fontes: o que a tabela guarda e o que os
   * arquivos dizem. Categoria digitada no explorador antes de alguém escolher
   * cor aparece assim mesmo, com a cor padrão -- sumir dela seria perder o que
   * o operador já classificou.
   */
  server.get('/api/categories', async () => {
    const assets = await listAssets(app.db)
    const contagem = new Map<string, number>()
    for (const asset of assets) {
      if (!asset.categoryId) continue
      contagem.set(asset.categoryId, (contagem.get(asset.categoryId) ?? 0) + 1)
    }

    const salvas = await app.db.select().from(categories)
    const cores = new Map(salvas.map((linha) => [linha.id, linha.color]))
    const nomes = new Set([...contagem.keys(), ...cores.keys()])

    return {
      categories: [...nomes]
        .sort((a, b) => a.localeCompare(b, 'pt-BR'))
        .map((id) => ({
          id,
          color: cores.get(id) ?? COR_PADRAO,
          items: contagem.get(id) ?? 0,
        })),
    }
  })

  const corValida = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Cor em #rrggbb.')

  /** Cria a categoria ou troca a cor dela. O nome é a chave. */
  server.put('/api/categories/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    if (!(await allowed(request, 'PLAYLIST_EDIT'))) return reply.code(403).send({ error: 'Seu papel não pode editar categorias.' })
    const body = z.object({ color: corValida }).safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: 'Cor em #rrggbb.' })
    if (id.trim() === '') return reply.code(400).send({ error: 'A categoria precisa de nome.' })

    const [existente] = await app.db.select().from(categories).where(eq(categories.id, id))
    if (existente) {
      await app.db.update(categories).set({ color: body.data.color }).where(eq(categories.id, id))
    } else {
      await app.db.insert(categories).values({
        id,
        color: body.data.color,
        createdAt: new Date().toISOString(),
      })
    }
    onChange()
    return { ok: true }
  })

  /**
   * Apaga a categoria e tira a marca dos arquivos dela.
   *
   * Deixar a marca em arquivo cuja categoria não existe mais daria uma cor
   * fantasma na grade e uma opção que não aparece em lista nenhuma.
   */
  server.delete('/api/categories/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    if (!(await allowed(request, 'PLAYLIST_EDIT'))) return reply.code(403).send({ error: 'Seu papel não pode remover categorias.' })
    await app.db.delete(categories).where(eq(categories.id, id))
    const soltos = await app.db
      .update(mediaAssets)
      .set({ categoryId: null })
      .where(eq(mediaAssets.categoryId, id))
    for (const runtime of app.runtimes.values()) await runtime.refresh()
    onChange()
    return { ok: true, soltos: soltos.changes ?? 0 }
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
    if (!(await allowed(request, 'OUTPUT_CONTROL'))) return reply.code(403).send({ error: 'Seu papel não pode remover canais.' })
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

    // O que pende do canal sai antes dele, à mão.
    //
    // Saídas, convidados, destinos, grafismo e regras caem por cascata, mas
    // `rundowns` foi declarada sem `ON DELETE CASCADE` -- e o banco de quem já
    // instalou continua assim, porque o SQLite não altera restrição sem
    // reconstruir a tabela. Confiar na cascata dava
    // `FOREIGN KEY constraint failed` e um 500 no rosto do operador. Apagar
    // aqui funciona nos dois bancos, o velho e o novo, e deixa à vista o que a
    // operação destrói.
    const grades = await app.db.select().from(rundowns).where(eq(rundowns.channelId, id))
    for (const grade of grades) {
      // Histórico de desfazer de uma grade que deixou de existir é lixo.
      await app.db.delete(operatorDecisions).where(eq(operatorDecisions.rundownId, grade.id))
    }
    // Itens e grafismo de item caem por cascata a partir da grade.
    await app.db.delete(rundowns).where(eq(rundowns.channelId, id))
    // O as-run não tem chave estrangeira nenhuma: ficaria para sempre, sem
    // canal a que pertencer e sem tela que o mostre. A caixa de confirmação já
    // avisa que a grade vai junto.
    await app.db.delete(asRun).where(eq(asRun.channelId, id))

    await app.db.delete(channels).where(eq(channels.id, id))
    await syncDistribution(app)
    onChange()
    return { ok: true }
  })


  server.get('/api/library/scan', async () => {
    const roots = await Roots.listRoots(app.db, app.mediaRoot)
    const estado = app.ingest.status()
    return {
      ...estado,
      available: app.ingest.available,
      root: estado.root ?? roots[0]?.path ?? app.mediaRoot,
      folders: roots,
    }
  })

  /**
   * Levanta o canal de novo com os perfis de saída de agora.
   *
   * Ligar um perfil no banco não põe a saída no ar: o engine recebe a lista de
   * saídas quando sobe, e não sabe de mudança feita depois. Até aqui a tela
   * dizia isso numa nota de rodapé e não oferecia como fazer -- o operador
   * ligava o preview, via a tela continuar preta, e não tinha o que clicar.
   *
   * Vale o mesmo aviso de sempre: o canal sai do ar por um instante.
   */
  server.post('/api/channels/:id/restart', async (request, reply) => {
    const { id } = request.params as { id: string }
    if (!(await allowed(request, 'OUTPUT_CONTROL'))) return reply.code(403).send({ error: 'Seu papel não pode reiniciar canais.' })
    if (!(await getChannel(app.db, id))) {
      return reply.code(404).send({ error: 'Canal não encontrado.' })
    }

    const anterior = app.runtimes.get(id)
    const rundownId = anterior?.view?.rundown.id ?? null
    if (anterior) {
      anterior.transport.close()
      app.runtimes.delete(id)
    }

    const runtime = await runtimeFor(app, id)
    if (runtime && rundownId) await runtime.load(rundownId)
    onChange()
    return { ok: true }
  })

  /** As pastas do acervo. */
  server.get('/api/library/roots', async () => ({
    roots: await Roots.listRoots(app.db, app.mediaRoot),
  }))

  server.post('/api/library/roots/pick', async (request, reply) => {
    if (!(await allowed(request, 'PLAYLIST_EDIT'))) return reply.code(403).send({ error: 'Seu papel não pode adicionar pastas.' })
    const path = await Roots.pickFolder()
    if (!path) return reply.code(204).send()
    const resultado = await Roots.addRoot(app.db, path)
    if (!resultado.ok) return reply.code(400).send({ error: resultado.error })
    if (app.ingest.available) app.ingest.start([resultado.root.path])
    return { root: resultado.root, scanning: app.ingest.status().running }
  })

  server.post('/api/files/pick', async (request, reply) => {
    if (!(await allowed(request, 'PLAYLIST_EDIT'))) return reply.code(403).send({ error: 'Sem permissão para escolher arquivos.' })
    const path = await Roots.pickFile()
    if (!path) return reply.code(204).send()
    return { path }
  })

  server.post('/api/library/roots', async (request, reply) => {
    if (!(await allowed(request, 'PLAYLIST_EDIT'))) return reply.code(403).send({ error: 'Seu papel não pode adicionar pastas.' })
    const body = z
      .object({ path: z.string().min(1), label: z.string().optional() })
      .safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: 'Diga o caminho da pasta.' })

    const resultado = await Roots.addRoot(app.db, body.data.path, body.data.label)
    if (!resultado.ok) return reply.code(400).send({ error: resultado.error })

    // Varre só a pasta nova: quem acabou de apontar para uma pasta quer ver o
    // que tem nela, e revarrer o acervo inteiro faria isso levar minutos.
    if (app.ingest.available) app.ingest.start([resultado.root.path])
    return { root: resultado.root, scanning: app.ingest.status().running }
  })

  server.delete('/api/library/roots/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    if (!(await allowed(request, 'PLAYLIST_EDIT'))) return reply.code(403).send({ error: 'Seu papel não pode remover pastas.' })
    if (!(await Roots.removeRoot(app.db, id))) {
      return reply
        .code(400)
        .send({ error: 'Não deu para tirar essa pasta. O acervo precisa de pelo menos uma.' })
    }
    return { ok: true }
  })

  server.post('/api/library/scan', async (request, reply) => {
    if (!(await allowed(request, 'PLAYLIST_EDIT'))) return reply.code(403).send({ error: 'Seu papel não pode iniciar varredura.' })
    if (!app.ingest.available) {
      return reply.code(409).send({ error: 'A sonda de mídia não está configurada.' })
    }
    const body = z
      .object({ root: z.string().min(1).optional(), measure: z.boolean().optional() })
      .safeParse(request.body ?? {})
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    // Medir loudness é o que demora numa varredura. Poder ler sem medir é o
    // que torna um acervo grande utilizável no mesmo dia.

    // Sem pasta escolhida, varre todas -- que é o que "procurar arquivos"
    // significa para quem tem o acervo espalhado em mais de um lugar. Inclui
    // as indisponíveis para que seus arquivos sejam sinalizados na grade.
    const roots = await Roots.listRoots(app.db, app.mediaRoot)
    const alvo = body.data.root
      ? [body.data.root]
      : roots.map((root) => root.path)
    if (alvo.length === 0) {
      return reply.code(409).send({ error: 'Nenhuma pasta do acervo está acessível agora.' })
    }
    if (!app.ingest.start(alvo, body.data.measure ?? true)) {
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

  /** Exporta a grade atual (itens e caminhos de mídia) para conferência ou
   * importação em outra ferramenta. O arquivo é sempre a proposta vigente,
   * sem alterar o estado do canal.
   */
  server.get('/api/rundowns/:id/export.csv', async (request, reply) => {
    const { id } = request.params as { id: string }
    if (!(await allowed(request, 'REPORT_EXPORT'))) return reply.code(403).send({ error: 'Sem permissão para exportar a grade.' })
    const runtime = await runtimeForRundown(app, id)
    if (!runtime?.view) return reply.code(404).send({ error: 'Grade não encontrada.' })
    const esc = (value: unknown): string => `"${String(value ?? '').replace(/"/g, '""')}"`
    const lines = ['ordem;item;tipo;arquivo;entrada prevista;duração;âncora;estado']
    runtime.view.items.forEach((item, index) => {
      const planned = runtime.view!.schedule.items.find((entry) => entry.id === item.item.id)
      lines.push([
        index + 1,
        esc(item.item.title),
        esc(item.item.type),
        esc(item.asset?.path ?? item.item.sourceRef ?? ''),
        esc(planned?.start ?? ''),
        esc(planned?.duration ?? ''),
        esc(item.item.anchor.kind),
        esc(planned?.state ?? ''),
      ].join(';'))
    })
    void reply.header('content-type', 'text/csv; charset=utf-8')
    void reply.header('content-disposition', `attachment; filename="grade-${runtime.channel.name.replace(/\W+/g, '-')}.csv"`)
    return `\ufeff${lines.join('\n')}`
  })

  server.get('/api/v1/schedule/compensation-report', async (request, reply) => {
    const query = request.query as { channelId?: string; rundownId?: string }
    let runtime: ChannelRuntime | null = null
    if (query.rundownId) {
      runtime = await runtimeForRundown(app, query.rundownId)
    } else if (query.channelId) {
      runtime = (await runtimeFor(app, query.channelId)) ?? null
    } else {
      runtime = app.runtimes.values().next().value ?? null
    }
    if (!runtime?.view) return reply.code(404).send({ error: 'Grade não encontrada.' })
    return runtime.view.schedule.compensationReport ?? {
      rundownId: runtime.view.rundown.id,
      generatedAt: new Date().toISOString(),
      rateNum: runtime.channel.rate.num,
      rateDen: runtime.channel.rate.den,
      initialDriftFrames: 0,
      compensatedDriftFrames: 0,
      residualDriftFrames: 0,
      actions: [],
      status: 'RESOLVED_CLEAN',
    }
  })

  server.get('/api/rundowns/:id/compensation-report', async (request, reply) => {
    const { id } = request.params as { id: string }
    const runtime = await runtimeForRundown(app, id)
    if (!runtime?.view) return reply.code(404).send({ error: 'Grade não encontrada.' })
    return runtime.view.schedule.compensationReport ?? {
      rundownId: runtime.view.rundown.id,
      generatedAt: new Date().toISOString(),
      rateNum: runtime.channel.rate.num,
      rateDen: runtime.channel.rate.den,
      initialDriftFrames: 0,
      compensatedDriftFrames: 0,
      residualDriftFrames: 0,
      actions: [],
      status: 'RESOLVED_CLEAN',
    }
  })

  // ---- itens -----------------------------------------------------------

  const addItemSchema = z.object({
    mediaId: z.string().nullable().optional(),
    sourceRef: z.string().nullable().optional(),
    type: z.enum(['VT', 'LIVE', 'GFX', 'SLATE', 'COMMERCIAL', 'FILLER']),
    eventType: z.enum(['FIXED', 'SEQUENTIAL', 'HARD_TIME', 'LIVE', 'FILLER']).optional(),
    title: z.string().min(1).optional(),
    anchor: anchorSchema.optional(),
    durationOverride: z.number().int().min(0).nullable().optional(),
    minDuration: z.number().int().min(0).optional(),
    atIndex: z.number().int().min(0).optional(),
    trimmable: z.boolean().optional(),
    optional: z.boolean().optional(),
    protected: z.boolean().optional(),
    timingFlags: z
      .object({
        trimmable: z.boolean(),
        optional: z.boolean(),
        protected: z.boolean(),
      })
      .optional(),
    liveSourceType: z.enum(['SDI', 'NDI', 'SRT', 'RTMP', 'WEBRTC']).optional(),
    liveEndpoint: z.string().optional(),
    liveEstimatedDuration: z.number().int().min(0).optional(),
    liveMaxDuration: z.number().int().min(0).nullable().optional(),
    liveAutoFollowOnEnd: z.boolean().optional(),
    liveFallbackMediaId: z.string().nullable().optional(),
    liveConfig: z
      .object({
        sourceType: z.enum(['SDI', 'NDI', 'SRT', 'RTMP', 'WEBRTC']),
        sourceEndpoint: z.string(),
        estimatedDuration: z.number().int().min(0),
        maxDuration: z.number().int().min(0).nullable().optional(),
        autoFollowOnEnd: z.boolean(),
        fallbackMediaId: z.string().nullable().optional(),
      })
      .optional(),
  })

  server.post('/api/rundowns/:id/items', async (request, reply) => {
    const { id } = request.params as { id: string }
    if (!(await allowed(request, 'PLAYLIST_EDIT'))) return reply.code(403).send({ error: 'Seu papel não pode inserir itens.' })
    const body = addItemSchema.safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const runtime = await runtimeForRundown(app, id)
    if (!runtime?.view) return reply.code(404).send({ error: 'Rundown não encontrado.' })

    const assets = await listAssets(app.db)
    const asset = body.data.mediaId ? assets.find((a) => a.id === body.data.mediaId) : undefined
    if (body.data.mediaId && !asset) {
      return reply.code(400).send({ error: 'Arquivo não existe no acervo.' })
    }
    if (asset?.ignored) {
      return reply.code(400).send({ error: 'Este arquivo está ignorado. Aceite-o no acervo antes de inserir na grade.' })
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
      (anchor.kind === 'FIXED' || anchor.kind === 'HARD_TIME'
        ? insertionIndexForTime(runtime.view, anchor.at)
        : anchor.kind === 'SOFT'
          ? insertionIndexForTime(runtime.view, anchor.at)
          : runtime.view.items.length)

    await app.history.capture(app.db, id, 'inserir item', { wholeRundown: true })

    const itemId = randomUUID()
    const ordered = runtime.view.items.map((v) => v.item.id)
    ordered.splice(index, 0, itemId)

    const eventType =
      body.data.eventType ??
      (body.data.type === 'LIVE'
        ? 'LIVE'
        : body.data.type === 'FILLER'
          ? 'FILLER'
          : anchor.kind === 'HARD_TIME'
            ? 'HARD_TIME'
            : anchor.kind === 'FIXED'
              ? 'FIXED'
              : 'SEQUENTIAL')

    const trimmable = body.data.timingFlags?.trimmable ?? body.data.trimmable ?? false
    const optional = body.data.timingFlags?.optional ?? body.data.optional ?? false
    const isProtected = body.data.timingFlags?.protected ?? body.data.protected ?? false

    const liveCfg = body.data.liveConfig
    const liveSourceType =
      liveCfg?.sourceType ?? body.data.liveSourceType ?? (body.data.type === 'LIVE' ? 'SRT' : null)
    const liveEndpoint =
      liveCfg?.sourceEndpoint ?? body.data.liveEndpoint ?? body.data.sourceRef ?? null
    const liveEstimatedDuration =
      liveCfg?.estimatedDuration ?? body.data.liveEstimatedDuration ?? duration
    const liveMaxDuration =
      liveCfg?.maxDuration !== undefined ? liveCfg.maxDuration : (body.data.liveMaxDuration ?? null)
    const liveAutoFollowOnEnd =
      liveCfg?.autoFollowOnEnd ?? body.data.liveAutoFollowOnEnd ?? false
    const liveFallbackMediaId =
      liveCfg?.fallbackMediaId ?? body.data.liveFallbackMediaId ?? null

    await app.db.insert(rundownItems).values({
      id: itemId,
      rundownId: id,
      sortOrder: 0,
      type: body.data.type,
      eventType,
      title: body.data.title ?? asset?.title ?? 'Novo item',
      mediaId: body.data.mediaId ?? null,
      sourceRef: liveEndpoint ?? body.data.sourceRef ?? null,
      trimmable,
      optional,
      protected: isProtected,
      liveSourceType,
      liveEndpoint,
      liveEstimatedDuration,
      liveMaxDuration,
      liveAutoFollowOnEnd,
      liveFallbackMediaId,
      trim: null,
      audio: null,
      durationOverride:
        body.data.durationOverride ??
        stillDefault ??
        (eventType === 'LIVE' ? liveEstimatedDuration : null),
      minDuration: body.data.minDuration ?? duration,
      anchor,
      onOverrun:
        body.data.type === 'FILLER' || eventType === 'FILLER'
          ? 'DROP_FILLER'
          : trimmable
            ? 'TRIM_PREV'
            : optional
              ? 'SKIP'
              : 'PUSH',
      elastic: null,
      locked: isProtected,
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
      eventType,
    })
    await runtime.refresh()
    onChange()
    return snapshot(app, runtime)
  })

  const patchSchema = z.object({
    title: z.string().min(1).optional(),
    eventType: z.enum(['FIXED', 'SEQUENTIAL', 'HARD_TIME', 'LIVE', 'FILLER']).optional(),
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
    trimmable: z.boolean().optional(),
    optional: z.boolean().optional(),
    protected: z.boolean().optional(),
    timingFlags: z
      .object({
        trimmable: z.boolean(),
        optional: z.boolean(),
        protected: z.boolean(),
      })
      .optional(),
    liveSourceType: z.enum(['SDI', 'NDI', 'SRT', 'RTMP', 'WEBRTC']).nullable().optional(),
    liveEndpoint: z.string().nullable().optional(),
    liveEstimatedDuration: z.number().int().min(0).nullable().optional(),
    liveMaxDuration: z.number().int().min(0).nullable().optional(),
    liveAutoFollowOnEnd: z.boolean().optional(),
    liveFallbackMediaId: z.string().nullable().optional(),
    liveConfig: z
      .object({
        sourceType: z.enum(['SDI', 'NDI', 'SRT', 'RTMP', 'WEBRTC']),
        sourceEndpoint: z.string(),
        estimatedDuration: z.number().int().min(0),
        maxDuration: z.number().int().min(0).nullable().optional(),
        autoFollowOnEnd: z.boolean(),
        fallbackMediaId: z.string().nullable().optional(),
      })
      .nullable()
      .optional(),
  })

  server.patch('/api/items/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    if (!(await allowed(request, 'PLAYLIST_EDIT'))) return reply.code(403).send({ error: 'Seu papel não pode editar itens.' })
    const body = patchSchema.safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const runtime = await runtimeForItem(app, id)
    if (!runtime?.view) return reply.code(404).send({ error: 'Item não encontrado.' })

    const updatePayload: Record<string, unknown> = { ...body.data }

    if (body.data.timingFlags) {
      updatePayload.trimmable = body.data.timingFlags.trimmable
      updatePayload.optional = body.data.timingFlags.optional
      updatePayload.protected = body.data.timingFlags.protected
      if (body.data.timingFlags.protected) {
        updatePayload.locked = true
      }
      delete updatePayload.timingFlags
    }
    if (body.data.liveConfig !== undefined) {
      if (body.data.liveConfig) {
        updatePayload.liveSourceType = body.data.liveConfig.sourceType
        updatePayload.liveEndpoint = body.data.liveConfig.sourceEndpoint
        updatePayload.liveEstimatedDuration = body.data.liveConfig.estimatedDuration
        updatePayload.liveMaxDuration = body.data.liveConfig.maxDuration ?? null
        updatePayload.liveAutoFollowOnEnd = body.data.liveConfig.autoFollowOnEnd
        updatePayload.liveFallbackMediaId = body.data.liveConfig.fallbackMediaId ?? null
      } else {
        updatePayload.liveSourceType = null
        updatePayload.liveEndpoint = null
        updatePayload.liveEstimatedDuration = null
        updatePayload.liveMaxDuration = null
        updatePayload.liveAutoFollowOnEnd = false
        updatePayload.liveFallbackMediaId = null
      }
      delete updatePayload.liveConfig
    }

    await app.history.capture(app.db, runtime.view.rundown.id, 'editar item', { itemIds: [id] })
    await app.db.update(rundownItems).set(updatePayload).where(eq(rundownItems.id, id))
    await logDecision(app, runtime.view.rundown.id, id, 'ITEM_EDITED', body.data)
    await runtime.refresh()
    onChange()
    return snapshot(app, runtime)
  })

  server.delete('/api/items/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    if (!(await allowed(request, 'PLAYLIST_EDIT'))) return reply.code(403).send({ error: 'Seu papel não pode remover itens.' })
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
    if (!(await allowed(request, 'PLAYLIST_EDIT'))) return reply.code(403).send({ error: 'Seu papel não pode mover itens.' })
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
    if (!(await allowed(request, 'PLAYLIST_EDIT'))) return reply.code(403).send({ error: 'Seu papel não pode cortar itens.' })
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
    if (!(await allowed(request, 'PLAYLIST_EDIT'))) return reply.code(403).send({ error: 'Seu papel não pode ajustar áudio.' })
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

  /**
   * Visão operacional dos processos que pertencem ao playout. O endpoint não
   * cria processos nem tenta adivinhar consumo: ele identifica os PIDs vivos
   * e, no Windows, consulta o próprio sistema para memória e CPU acumulada.
   * Isso permite fechar monitores sem confundir um Preview desligado com uma
   * falha do canal.
   */
  server.get('/api/processes', async () => {
    const rows: Array<{
      id: string
      kind: 'ENGINE' | 'MEDIAMTX' | 'OUTPUT'
      channelId: string | null
      pid: number | null
      state: string
      cpuTimeMs: number | null
      memoryBytes: number | null
      details?: Record<string, unknown>
    }> = []

    if (app.mediamtx) {
      rows.push({
        id: 'mediamtx',
        kind: 'MEDIAMTX',
        channelId: null,
        pid: app.mediamtx.processId,
        state: app.mediamtx.running ? 'running' : 'stopped',
        cpuTimeMs: null,
        memoryBytes: null,
        details: { error: app.mediamtx.lastError },
      })
    }
    for (const [channelId, runtime] of app.runtimes) {
      const publishers = runtime.transport.publishers()
      rows.push({
        id: `engine:${channelId}`,
        kind: 'ENGINE',
        channelId,
        pid: runtime.transport.processId(),
        state: runtime.transport.health().error
          ? 'error'
          : runtime.transport.health().ready
            ? 'running'
            : 'starting',
        cpuTimeMs: null,
        memoryBytes: null,
        details: {
          restarts: runtime.transport.health().restarts,
          deaths: runtime.transport.health().deaths,
          stalls: runtime.transport.health().stalls,
          ready: runtime.transport.health().ready,
          publishers: publishers.map((publisher) => ({
            url: publisher.url,
            health: publisher.health,
            attempts: publisher.attempts,
            delivered: publisher.delivered,
            error: publisher.error ?? null,
          })),
        },
      })
      // Cada publisher é uma unidade operacional própria, mesmo quando
      // compartilha o processo do engine. Linhas separadas permitem localizar
      // rapidamente qual RTMP/SRT caiu sem confundir isso com o PGM.
      for (const [index, publisher] of publishers.entries()) {
        const target = String(publisher.url ?? '')
        rows.push({
          id: `output:${channelId}:${index}`,
          kind: 'OUTPUT',
          channelId,
          pid: runtime.transport.processId(),
          state: publisher.health,
          cpuTimeMs: null,
          memoryBytes: null,
          details: {
            url: target,
            transport: (target.split(':', 1)[0] ?? '').toUpperCase(),
            attempts: publisher.attempts,
            delivered: publisher.delivered,
            error: publisher.error ?? null,
          },
        })
      }
    }

    const pids = rows.map((row) => row.pid).filter((pid): pid is number => pid !== null)
    if (pids.length > 0 && process.platform === 'win32') {
      try {
        const { stdout } = await execFileAsync('tasklist', ['/FO', 'CSV', '/NH'])
        const byPid = new Map<number, { memoryBytes: number; cpuTimeMs: number | null }>()
        for (const line of stdout.split(/\r?\n/)) {
          const columns = line.match(/"([^"]*)"/g)?.map((value) => value.slice(1, -1))
          if (!columns || columns.length < 5) continue
          const pid = Number((columns[1] ?? '').replace(/\D/g, ''))
          if (!pids.includes(pid)) continue
          const memory = Number((columns[4] ?? '').replace(/[^\d]/g, ''))
          byPid.set(pid, { memoryBytes: Number.isFinite(memory) ? memory * 1024 : 0, cpuTimeMs: null })
        }
        for (const row of rows) {
          const sample = row.pid === null ? undefined : byPid.get(row.pid)
          if (sample) {
            row.memoryBytes = sample.memoryBytes
            row.cpuTimeMs = sample.cpuTimeMs
          }
        }
      } catch {
        // A ausência do tasklist não pode derrubar a API de operação.
      }
      // tasklist não expõe CPU. Uma consulta curta ao contador nativo do
      // Windows completa o painel sem manter um coletor permanente no servidor.
      try {
        const query = pids.join(',')
        const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `$ids=@(${query}); Get-Process -Id $ids -ErrorAction SilentlyContinue | Select-Object Id,CPU | ConvertTo-Json -Compress`])
        const parsed = JSON.parse(stdout.trim() || '[]') as Array<{ Id?: number; CPU?: number }> | { Id?: number; CPU?: number }
        const samples = Array.isArray(parsed) ? parsed : [parsed]
        for (const sample of samples) {
          const row = rows.find((candidate) => candidate.pid === sample.Id)
          if (row && typeof sample.CPU === 'number' && Number.isFinite(sample.CPU)) row.cpuTimeMs = Math.round(sample.CPU * 1000)
        }
      } catch {
        // CPU é informativo: se a consulta falhar, memória e estado continuam.
      }
    }
    return { generatedAt: new Date().toISOString(), processes: rows }
  })

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
        urls: app.mediamtx?.urls(path.program, host) ?? MediaMtx.urlsFor(path.program, host),
        // Saídas do engine deste canal. Caminho declarado no servidor não é
        // prova de nada: só a entrega do engine diz que o canal está saindo.
        publishers: app.runtimes.get(path.channelId)?.transport.publishers() ?? [],
      })),
      guests: guests.map((guest) => ({
        ...guest,
        publishUrl: `rtmp://${host}:${PORTS.rtmp}/guest/${guest.streamKey}`,
      })),
      destinations: targets.map((target) => ({ ...target, url: redactUrl(target.url) })),
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

  // ==========================================
  // FASE B: SRT MANAGER, FAILOVER & MULTIVIEW
  // ==========================================

  // Telemetria SRT em tempo real
  const handleSrtTelemetry = async (request: any) => {
    const { sourceId } = request.query as { sourceId?: string }
    if (sourceId) {
      const tel = globalSrtManager.getTelemetry(sourceId)
      return tel ?? { error: 'Telemetria não encontrada para a fonte informada' }
    }
    return globalSrtManager.getAllTelemetry()
  }
  server.get('/api/v1/srt/telemetry', handleSrtTelemetry)
  server.get('/api/srt/telemetry', handleSrtTelemetry)

  // Disparo manual ou automatizado de chaveamento de contingência (Failover)
  const handleFailoverTrigger = async (request: any, reply: any) => {
    if (!(await allowed(request, 'PLAYLIST_EDIT'))) {
      return reply.code(403).send({ error: 'Seu papel não tem permissão para acionar failover técnico.' })
    }

    const body = z
      .object({
        sourceId: z.string().min(1, 'sourceId é obrigatório'),
        targetRole: z.enum(['PRIMARY', 'BACKUP']).optional(),
        reason: z.string().optional(),
      })
      .safeParse(request.body)

    if (!body.success) {
      return reply.code(400).send({ error: body.error.flatten() })
    }

    const source = await getLiveSource(app.db, body.data.sourceId, true)
    if (!source) {
      return reply.code(404).send({ error: 'Fonte ao vivo não encontrada.' })
    }

    const currentRole = globalSrtManager.failover.getActiveRole(source.id, source.role)
    const targetRole = body.data.targetRole ?? (currentRole === 'PRIMARY' ? 'BACKUP' : 'PRIMARY')
    const operator = await usernameOf(request)
    const reason = body.data.reason ?? `Comutação manual de contingência disparada por ${operator}`

    const event = globalSrtManager.failover.triggerSwitch(source, targetRole, reason, {
      operator: operator ?? undefined,
      automatic: false,
    })

    // Registra evento de AsRun e Auditoria
    await app.db.insert(healthEvents).values({
      id: randomUUID(),
      channelId: source.channelId,
      component: 'FAILOVER_CONTROLLER',
      state: targetRole,
      severity: 'WARN',
      message: `Comutação ${event.fromRole} -> ${targetRole}: ${reason}`,
      occurredAt: event.timestamp,
    })

    void emitIntegrationEvent(app.db, 'source.failover', { ...event }, source.channelId)
    onChange()

    return {
      ok: true,
      event,
    }
  }
  server.post('/api/v1/engineering/failover/trigger', handleFailoverTrigger)
  server.post('/api/engineering/failover/trigger', handleFailoverTrigger)

  // Multiview Layout & Configuração
  const handleGetMultiview = async (request: any) => {
    const { channelId } = request.query as { channelId?: string }
    return getMultiviewConfig(app.db, channelId)
  }
  server.get('/api/v1/multiview/config', handleGetMultiview)
  server.get('/api/multiview/config', handleGetMultiview)

  const handlePutMultiview = async (request: any, reply: any) => {
    if (!(await allowed(request, 'PLAYLIST_EDIT'))) {
      return reply.code(403).send({ error: 'Seu papel não pode alterar layout de multiview.' })
    }

    const body = z
      .object({
        channelId: z.string().optional(),
        layout: z.enum(['GRID_2X2', 'GRID_1_PLUS_3', 'COMPACT_LIST']).default('GRID_2X2'),
        cells: z
          .array(
            z.object({
              id: z.string(),
              name: z.string(),
              sourceUrl: z.string(),
              tally: z.enum(['ON_AIR', 'NEXT', 'CUED', 'OFFLINE']),
              audioPeakDb: z.tuple([z.number(), z.number()]),
              syncState: z.enum(['LOCKED', 'DRIFT', 'LOST']),
              srtTelemetry: z.any().optional(),
            }),
          )
          .default([]),
      })
      .safeParse(request.body)

    if (!body.success) {
      return reply.code(400).send({ error: body.error.flatten() })
    }

    const saved = await saveMultiviewConfig(
      app.db,
      body.data.channelId,
      body.data.layout as MultiviewLayout,
      body.data.cells as MultiviewCell[],
    )
    onChange()
    return saved
  }
  server.put('/api/v1/multiview/config', handlePutMultiview)
  server.put('/api/multiview/config', handlePutMultiview)

  // Gerenciamento de Fontes ao Vivo (Live Sources CRUD)
  const liveSourceSchema = z.object({
    channelId: z.string().min(1, 'channelId é obrigatório'),
    name: z.string().min(1, 'name é obrigatório'),
    kind: z.enum(['SRT', 'RTMP', 'SDI', 'NDI']),
    targetUrl: z.string().optional(),
    srtConfig: z
      .object({
        mode: z.enum(['caller', 'listener', 'rendezvous']),
        host: z.string().default(''),
        port: z.number().int().min(1024).max(65535).default(9000),
        latencyMs: z.number().int().min(120).max(2000).default(800),
        passphrase: z.string().min(10).max(79).optional(),
        pbkeylen: z.union([z.literal(16), z.literal(24), z.literal(32)]).optional(),
        streamId: z.string().max(512).optional(),
        pollTimeoutMs: z.number().int().min(50).max(1000).optional(),
      })
      .optional(),
    role: z.enum(['PRIMARY', 'BACKUP']).default('PRIMARY'),
    pairedSourceId: z.string().optional(),
    autoFailover: z.boolean().default(true),
    failoverConfig: z
      .object({
        autoFailover: z.boolean().default(true),
        maxLossPercent: z.number().default(15.0),
        maxTimeoutMs: z.number().default(1500),
        maxRttMs: z.number().default(2400),
        switchDelayMs: z.number().default(120),
      })
      .optional(),
    enabled: z.boolean().default(true),
  })

  const handleListLiveSources = async (request: any) => {
    const { channelId } = request.query as { channelId?: string }
    return listLiveSources(app.db, channelId, false)
  }
  server.get('/api/v1/sources/live', handleListLiveSources)
  server.get('/api/sources/live', handleListLiveSources)

  const handleCreateLiveSource = async (request: any, reply: any) => {
    if (!(await allowed(request, 'PLAYLIST_EDIT'))) {
      return reply.code(403).send({ error: 'Seu papel não tem permissão para cadastrar fontes ao vivo.' })
    }

    const body = liveSourceSchema.safeParse(request.body)
    if (!body.success) {
      return reply.code(400).send({ error: body.error.flatten() })
    }

    const created = await createLiveSource(app.db, body.data)
    onChange()
    return reply.code(201).send(created)
  }
  server.post('/api/v1/sources/live', handleCreateLiveSource)
  server.post('/api/sources/live', handleCreateLiveSource)

  const handleGetLiveSource = async (request: any, reply: any) => {
    const { id } = request.params as { id: string }
    const source = await getLiveSource(app.db, id, false)
    if (!source) {
      return reply.code(404).send({ error: 'Fonte ao vivo não encontrada.' })
    }
    return source
  }
  server.get('/api/v1/sources/live/:id', handleGetLiveSource)
  server.get('/api/sources/live/:id', handleGetLiveSource)

  const handleUpdateLiveSource = async (request: any, reply: any) => {
    if (!(await allowed(request, 'PLAYLIST_EDIT'))) {
      return reply.code(403).send({ error: 'Seu papel não pode editar fontes ao vivo.' })
    }

    const { id } = request.params as { id: string }
    const body = liveSourceSchema.partial().safeParse(request.body)
    if (!body.success) {
      return reply.code(400).send({ error: body.error.flatten() })
    }

    const updated = await updateLiveSource(app.db, id, body.data)
    if (!updated) {
      return reply.code(404).send({ error: 'Fonte ao vivo não encontrada.' })
    }
    onChange()
    return updated
  }
  server.put('/api/v1/sources/live/:id', handleUpdateLiveSource)
  server.put('/api/sources/live/:id', handleUpdateLiveSource)

  const handleDeleteLiveSource = async (request: any, reply: any) => {
    if (!(await allowed(request, 'PLAYLIST_EDIT'))) {
      return reply.code(403).send({ error: 'Seu papel não pode remover fontes ao vivo.' })
    }

    const { id } = request.params as { id: string }
    await deleteLiveSource(app.db, id)
    onChange()
    return { ok: true }
  }
  server.delete('/api/v1/sources/live/:id', handleDeleteLiveSource)
  server.delete('/api/sources/live/:id', handleDeleteLiveSource)

  const handleForceFailover = async (request: any, reply: any) => {
    if (!(await allowed(request, 'PLAYLIST_EDIT'))) {
      return reply.code(403).send({ error: 'Seu papel não pode forçar comutação de redundância.' })
    }

    const { id } = request.params as { id: string }
    const source = await getLiveSource(app.db, id, true)
    if (!source) {
      return reply.code(404).send({ error: 'Fonte ao vivo não encontrada.' })
    }

    const currentRole = globalSrtManager.failover.getActiveRole(source.id, source.role)
    const targetRole = currentRole === 'PRIMARY' ? 'BACKUP' : 'PRIMARY'
    const operator = await usernameOf(request)
    const reason = `Comutação forçada manual pelo operador ${operator}`

    const event = globalSrtManager.failover.triggerSwitch(source, targetRole, reason, {
      operator: operator ?? undefined,
      automatic: false,
    })

    await app.db.insert(healthEvents).values({
      id: randomUUID(),
      channelId: source.channelId,
      component: 'FAILOVER_CONTROLLER',
      state: targetRole,
      severity: 'WARN',
      message: `Comutação forçada ${event.fromRole} -> ${targetRole}: ${reason}`,
      occurredAt: event.timestamp,
    })

    onChange()
    return { ok: true, event }
  }
  server.post('/api/v1/sources/live/:id/force-failover', handleForceFailover)
  server.post('/api/sources/live/:id/force-failover', handleForceFailover)

  server.patch('/api/channels/:id/slate', async (request, reply) => {
    const { id } = request.params as { id: string }
    if (!(await allowed(request, 'PLAYLIST_EDIT'))) return reply.code(403).send({ error: 'Seu papel não pode configurar a apresentação técnica.' })
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
    if (!(await allowed(request, 'PLAYLIST_EDIT'))) return reply.code(403).send({ error: 'Seu papel não pode editar a pauta.' })
    const body = ruleSchema.safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })
    if (body.data.endMinute <= body.data.startMinute) {
      return reply.code(400).send({ error: 'A faixa termina antes de começar.' })
    }

    const existentes = await app.db.select().from(scheduleRules).where(eq(scheduleRules.channelId, id))
    const conflita = conflictsWithScheduleRule(body.data, existentes)
    if (conflita) {
      return reply.code(409).send({ error: 'Esta faixa se sobrepõe a outra faixa no mesmo dia.' })
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

  server.delete('/api/rules/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    if (!(await allowed(request, 'PLAYLIST_EDIT'))) return reply.code(403).send({ error: 'Seu papel não pode editar a pauta.' })
    await app.db.delete(scheduleRules).where(eq(scheduleRules.id, id))
    return { ok: true }
  })

  server.patch('/api/rules/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    if (!(await allowed(request, 'PLAYLIST_EDIT'))) return reply.code(403).send({ error: 'Seu papel não pode editar a pauta.' })
    const body = ruleSchema.partial().safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })
    const [current] = await app.db.select().from(scheduleRules).where(eq(scheduleRules.id, id)).limit(1)
    if (!current) return reply.code(404).send({ error: 'Faixa não encontrada.' })
    const next = { ...current, ...body.data }
    if (next.endMinute <= next.startMinute) return reply.code(400).send({ error: 'A faixa termina antes de começar.' })
    const existentes = await app.db.select().from(scheduleRules).where(eq(scheduleRules.channelId, next.channelId))
    const conflita = conflictsWithScheduleRule(next, existentes, id)
    if (conflita) return reply.code(409).send({ error: 'Esta faixa se sobrepõe a outra faixa no mesmo dia.' })
    await app.db.update(scheduleRules).set(body.data).where(eq(scheduleRules.id, id))
    return { rule: { ...current, ...body.data } }
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
    if (!(await allowed(request, 'PLAYLIST_EDIT'))) return reply.code(403).send({ error: 'Seu papel não pode montar a grade.' })
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
    if (!(await allowed(request, 'REPORT_EXPORT'))) return reply.code(403).send({ error: 'Seu papel não pode exportar relatórios.' })
    const { since, until, nome, categoria, data, hora } = request.query as { since?: string; until?: string; nome?: string; categoria?: string; data?: string; hora?: string }
    const channel = await getChannel(app.db, id)
    if (!channel) return reply.code(404).send({ error: 'Canal não encontrado.' })

    const defaultSince = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
    const start = since !== undefined ? since : defaultSince
    const entries = (await listAsRun(app.db, id, start, 5000, until)).filter((entry) =>
      (!nome || entry.title.toLowerCase().includes(nome.toLowerCase())) &&
      (!categoria || entry.type === categoria) &&
      (!data || entry.startedAt.slice(0, 10) === data) &&
      (!hora || entry.startedAt.slice(11, 16).startsWith(hora)),
    )

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

  server.post('/api/backups', async (request, reply) => {
    if (!(await allowed(request, 'REPORT_EXPORT'))) return reply.code(403).send({ error: 'Seu papel não pode criar backups.' })
    const result = await backupDatabase(app.sqlite, app.backupDir)
    return { ...result, files: await listBackups(app.backupDir) }
  })

  // ---- montagem automática -----------------------------------------------

  const fillSchema = z.object({
    /** Quanto tempo preencher, em minutos. */
    minutes: z.number().int().min(1).max(1440),
    categories: z.array(z.string()).optional(),
    /** Não repetir o que foi ao ar nas últimas N horas. */
    avoidHours: z.number().min(0).max(720).optional(),
    /** Só planejar, sem gravar. É o que a interface mostra antes de aplicar. */
    preview: z.boolean().optional(),
    /** Minuto do dia (0 a 1440) para inserção exata do GAP */
    insertAtMinute: z.number().min(0).max(1440).optional(),
    /** Inserir logo após este item específico da grade */
    insertAfterItemId: z.string().optional(),
    /** Inserir nesta ordem específica */
    insertAtOrder: z.number().optional(),
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
      (body.data.avoidHours ?? 0) * 60,
    )

    const byId = new Map(assets.map((asset) => [asset.id, asset]))
    const chosen = plan.items.map((item) => ({
      mediaId: item.id,
      title: byId.get(item.id)?.title ?? 'arquivo',
      durationFrames: item.durationFrames,
      explanation: {
        category: item.categoryId,
        lastAiredAt: item.lastAiredMs === null ? null : new Date(item.lastAiredMs).toISOString(),
        preference: item.preference,
      },
    }))

    // Planejar é de graça; aplicar mexe na grade, e por isso é pedido à parte.
    if (body.data.preview) {
      return { plan: { ...plan, items: chosen } }
    }

    await app.history.capture(app.db, id, 'montagem automática', { wholeRundown: true })

    // Determina onde os novos itens devem ser posicionados na grade
    let targetIdx = runtime.view.items.length
    if (body.data.insertAfterItemId) {
      const found = runtime.view.items.findIndex((it) => it.item.id === body.data.insertAfterItemId)
      if (found >= 0) targetIdx = found + 1
    } else if (body.data.insertAtMinute !== undefined) {
      const atFrames = secondsToFrames(body.data.insertAtMinute * 60, runtime.channel.rate)
      targetIdx = insertionIndexForTime(runtime.view, atFrames)
    } else if (body.data.insertAtOrder !== undefined) {
      const found = runtime.view.items.findIndex((it) => it.item.order >= body.data.insertAtOrder!)
      if (found >= 0) targetIdx = found
    }

    const existingIds = runtime.view.items.map((it) => it.item.id)
    const newIds: string[] = []
    let isFirst = true

    for (const item of plan.items) {
      const asset = byId.get(item.id)
      if (!asset) continue
      const itemId = randomUUID()
      newIds.push(itemId)

      const anchor =
        isFirst && body.data.insertAtMinute !== undefined
          ? { kind: 'FIXED' as const, at: secondsToFrames(body.data.insertAtMinute * 60, runtime.channel.rate) }
          : { kind: 'FLOW' as const }
      isFirst = false

      await app.db.insert(rundownItems).values({
        id: itemId,
        rundownId: id,
        sortOrder: 0,
        type: 'VT',
        title: asset.title,
        mediaId: asset.id,
        sourceRef: null,
        trim: null,
        audio: null,
        durationOverride: null,
        minDuration: item.durationFrames,
        anchor,
        onOverrun: 'PUSH',
        elastic: null,
        locked: false,
        autoNext: true,
        loop: false,
        notes: null,
      })
      await logDecision(app, id, itemId, 'AUTO_FILLED', { mediaId: asset.id })
    }

    const combinedIds = [
      ...existingIds.slice(0, targetIdx),
      ...newIds,
      ...existingIds.slice(targetIdx),
    ]

    await renumber(app.db, id, combinedIds)

    await runtime.refresh()
    onChange()
    return { plan: { ...plan, items: chosen }, ...snapshot(app, runtime) }
  })

  // ---- as-run ------------------------------------------------------------

  server.get('/api/channels/:id/asrun', async (request, reply) => {
    const { id } = request.params as { id: string }
    const { since, until, limit } = request.query as { since?: string; until?: string; limit?: string }
    const channel = await getChannel(app.db, id)
    if (!channel) return reply.code(404).send({ error: 'Canal não encontrado.' })

    // Sincroniza a linha aberta antes da consulta. O laço operacional também
    // chama followAsRun, mas a leitura pode chegar exatamente na troca de item;
    // aguardá-la aqui evita que o Aired fique uma atualização atrás do PGM.
    const runtime = app.runtimes.get(id)
    if (runtime) await runtime.followAsRun()

    // Sem `since`, o padrão de 24 horas: é a janela móvel de auditoria regulatória
    const defaultSince = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
    const start = since !== undefined ? since : defaultSince
    const maxEntries = limit ? parseInt(limit, 10) || 1000 : 2000
    const entries = await listAsRun(app.db, id, start, maxEntries, until)
    return { since: start, until: until ?? null, entries }
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
    if (!(await allowed(request, 'PLAYLIST_EDIT'))) return reply.code(403).send({ error: 'Seu papel não pode criar grafismos.' })
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
    if (!(await allowed(request, 'PLAYLIST_EDIT'))) return reply.code(403).send({ error: 'Seu papel não pode editar grafismos.' })
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

  server.delete('/api/graphics/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    if (!(await allowed(request, 'PLAYLIST_EDIT'))) return reply.code(403).send({ error: 'Seu papel não pode remover grafismos.' })
    await app.db.delete(graphicTemplates).where(eq(graphicTemplates.id, id))
    return { ok: true }
  })

  const fireSchema = z.object({
    templateId: z.string(),
    values: z.record(z.string(), z.string()).optional(),
  })

  server.post('/api/channels/:id/graphic', async (request, reply) => {
    const { id } = request.params as { id: string }
    if (!(await allowed(request, 'PLAYLIST_EDIT'))) return reply.code(403).send({ error: 'Seu papel não pode colocar grafismos no ar.' })
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
    if (!(await allowed(request, 'PLAYLIST_EDIT'))) return reply.code(403).send({ error: 'Seu papel não pode retirar grafismos.' })
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
    if (!(await allowed(request, 'PLAYLIST_EDIT'))) return reply.code(403).send({ error: 'Seu papel não pode programar grafismos.' })
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
    if (!(await allowed(request, 'PLAYLIST_EDIT'))) return reply.code(403).send({ error: 'Seu papel não pode remover grafismos programados.' })
    const [cue] = await app.db.select().from(itemGraphics).where(eq(itemGraphics.id, id))
    if (!cue) return reply.code(404).send({ error: 'Deixa não existe.' })

    await app.db.delete(itemGraphics).where(eq(itemGraphics.id, id))
    const runtime = await runtimeForItem(app, cue.itemId)
    if (runtime) await runtime.refresh()
    onChange()
    return { cues: runtime?.cuesOf(cue.itemId) ?? [] }
  })

  /**
   * "Estou com este monitor aberto."
   *
   * O engine só codifica o monitor enquanto alguém avisa. Sem isto, uma
   * máquina com quatro canais gastava quatro codificações para janelas que
   * podiam estar fechadas -- e era a CPU do ar que pagava.
   */
  server.post('/api/channels/:id/watching', async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = z.object({ bus: z.enum(['pvw', 'mon']), watching: z.boolean().optional() }).safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: 'Barramento inválido.' })

    const runtime = await runtimeFor(app, id)
    if (!runtime) return reply.code(404).send({ error: 'Canal não encontrado.' })

    runtime.watching(body.data.bus)
    // Diz na resposta se o monitor existe. A interface precisa saber para
    // mostrar o motivo em vez de uma janela preta esperando um sinal que não
    // vem -- e para parar de pedir.
    return { ok: true, available: runtime.temMonitor(body.data.bus) }
  })

  // ---- perfis de saída ---------------------------------------------------

  server.get('/api/channels/:id/outputs', async (request) => {
    const { id } = request.params as { id: string }
    const host = lanAddress()
    const path = app.paths.find((entry) => entry.channelId === id)
    const rows = await listOutputs(app.db, id)
    const canal = await getChannel(app.db, id)
    return {
      outputs: rows.map((row) => {
        const streamPath =
          row.role === 'PROGRAM'
            ? path?.program
            : row.role === 'PREVIEW'
            ? path?.preview
            : row.role === 'MONITOR'
            ? path?.monitor
            : null
        const streamUrls = streamPath ? MediaMtx.urlsFor(streamPath, host) : null
        const primaryUrl =
          streamUrls?.rtsp ??
          (row.target ? row.target : targetOf(row, path))
        return {
          ...row,
          // Destino efetivo: derivado nos gerenciados, guardado nos demais.
          resolvedTarget: targetOf(row, path),
          displayUrl: primaryUrl,
          streamUrls,
          target: row.target || primaryUrl || '',
          // Quanto esta saída usaria se ninguém escrevesse um número. Mostrar
          // isso é o que deixa a escolha ser uma escolha: "automático" sozinho
          // não diz se são 4 Mbps ou 12.
          suggestedBitrateKbps: canal
            ? suggestedBitrateKbps(
                row.width ?? canal.width,
                row.height ?? canal.height,
                row.rateNum !== null && row.rateDen !== null
                  ? { num: row.rateNum, den: row.rateDen }
                  : canal.rate,
              )
            : null,
        }
      }),
    }
  })

  server.post('/api/channels/:id/outputs', async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = z
      .object({
        name: z.string().min(1),
        kind: z.enum(['RTMP', 'SRT', 'FILE', 'SDI']),
        target: z.string().min(1),
      })
      .safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: 'Dê um nome e um destino.' })
    if (!(await allowed(request, 'OUTPUT_CONTROL'))) {
      return reply.code(403).send({ error: 'Seu papel não pode criar saídas.' })
    }
    // Na placa o destino é o número do conector, e só isso.
    if (body.data.kind === 'SDI' && !/^\d+$/.test(body.data.target.trim())) {
      return reply.code(400).send({ error: 'Na SDI o destino é o número do conector: 0, 1, 2…' })
    }

    const row = await createOutput(app.db, id, body.data)
    const runtime = app.runtimes.get(id)
    if (runtime) {
      const rundownId = runtime.view?.rundown.id ?? null
      runtime.transport.close()
      app.runtimes.delete(id)
      const novo = await runtimeFor(app, id)
      if (novo && rundownId) await novo.load(rundownId)
    }
    await syncDistribution(app)
    return { output: row, restartRequired: false }
  })

  server.patch('/api/outputs/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = z
      .object({
        name: z.string().min(1).optional(),
        target: z.string().min(1).optional(),
        kind: z.enum(['RTMP', 'SRT', 'FILE', 'SDI']).optional(),
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
    if (!(await allowed(request, 'OUTPUT_CONTROL'))) {
      return reply.code(403).send({ error: 'Seu papel não pode alterar saídas.' })
    }

    const [profile] = await app.db.select({ channelId: outputProfiles.channelId }).from(outputProfiles).where(eq(outputProfiles.id, id))
    await updateOutput(app.db, id, body.data)
    // Trocar liga/desliga é uma ação operacional: reconstrói somente o engine
    // deste canal e mantém o servidor HTTP, banco e os demais canais vivos.
    if (profile) {
      const anterior = app.runtimes.get(profile.channelId)
      const rundownId = anterior?.view?.rundown.id ?? null
      if (anterior) {
        anterior.transport.close()
        app.runtimes.delete(profile.channelId)
      }
      const runtime = await runtimeFor(app, profile.channelId)
      if (runtime && rundownId) await runtime.load(rundownId)
    }
    await syncDistribution(app)
    return { ok: true, restartRequired: false }
  })

  server.delete('/api/outputs/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    if (!(await allowed(request, 'OUTPUT_CONTROL'))) {
      return reply.code(403).send({ error: 'Seu papel não pode remover saídas.' })
    }
    const [profile] = await app.db.select({ channelId: outputProfiles.channelId }).from(outputProfiles).where(eq(outputProfiles.id, id))
    if (!(await deleteOutput(app.db, id))) {
      return reply.code(409).send({ error: 'Programa e preview não podem ser removidos.' })
    }
    if (profile) {
      const anterior = app.runtimes.get(profile.channelId)
      const rundownId = anterior?.view?.rundown.id ?? null
      if (anterior) {
        anterior.transport.close()
        app.runtimes.delete(profile.channelId)
      }
      const runtime = await runtimeFor(app, profile.channelId)
      if (runtime && rundownId) await runtime.load(rundownId)
    }
    await syncDistribution(app)
    return { ok: true, restartRequired: false }
  })

  server.post('/api/channels/:id/guests', async (request, reply) => {
    const { id } = request.params as { id: string }
    if (!(await allowed(request, 'OUTPUT_CONTROL'))) return reply.code(403).send({ error: 'Seu papel não pode gerenciar convidados.' })
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

  server.delete('/api/guests/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    if (!(await allowed(request, 'OUTPUT_CONTROL'))) return reply.code(403).send({ error: 'Seu papel não pode revogar convidados.' })
    // Revogar é sumir com o caminho: quem tinha a chave passa a publicar no
    // vazio, sem derrubar quem está no ar.
    await app.db.delete(guestKeys).where(eq(guestKeys.id, id))
    await syncDistribution(app)
    return { ok: true }
  })

  server.post('/api/channels/:id/destinations', async (request, reply) => {
    const { id } = request.params as { id: string }
    if (!(await allowed(request, 'OUTPUT_CONTROL'))) return reply.code(403).send({ error: 'Seu papel não pode criar destinos.' })
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
    if (!(await allowed(request, 'OUTPUT_CONTROL'))) return reply.code(403).send({ error: 'Seu papel não pode editar destinos.' })
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

  server.delete('/api/destinations/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    if (!(await allowed(request, 'OUTPUT_CONTROL'))) return reply.code(403).send({ error: 'Seu papel não pode remover destinos.' })
    await app.db.delete(destinations).where(eq(destinations.id, id))
    await syncDistribution(app)
    return { ok: true }
  })

  // ---- desfazer e refazer ----------------------------------------------

  const step = (kind: 'undo' | 'redo') =>
    async (request: { params: unknown }, reply: { code: (n: number) => { send: (b: unknown) => unknown } }) => {
      const { id } = request.params as { id: string }
      if (!(await allowed(request as never, 'PLAYLIST_EDIT'))) return reply.code(403).send({ error: 'Seu papel não pode desfazer esta alteração.' })
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
    if (!(await allowed(request, 'PLAYLIST_EDIT'))) return reply.code(403).send({ error: 'Seu papel não pode agrupar itens.' })
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
    if (!(await allowed(request, 'PLAYLIST_EDIT'))) return reply.code(403).send({ error: 'Seu papel não pode desfazer blocos.' })
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

  server.post('/api/external/control', async (request, reply) => {
    if (!EXTERNAL_CONTROL_TOKEN) return reply.code(503).send({ error: 'Controle externo não configurado.' })
    const token = request.headers['x-rplayout-control-token']
    if (token !== EXTERNAL_CONTROL_TOKEN) return reply.code(401).send({ error: 'Token de controle externo inválido.' })
    const body = z.object({
      channelId: z.string().min(1),
      action: z.enum(['take', 'cue', 'stop', 'park']),
      itemId: z.string().nullable().optional(),
      assetId: z.string().nullable().optional(),
    }).safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: 'Comando externo inválido.' })
    const runtime = await runtimeFor(app, body.data.channelId)
    if (!runtime?.view) return reply.code(404).send({ error: 'Canal sem grade carregada.' })
    try {
      if (body.data.action === 'take') await runtime.transport.take(runtime.view.rundown.id, body.data.itemId ?? '')
      else if (body.data.action === 'cue') await runtime.transport.cue(body.data.itemId ? { kind: 'ITEM', id: body.data.itemId } : body.data.assetId ? { kind: 'ASSET', id: body.data.assetId } : null)
      else if (body.data.action === 'stop') await runtime.transport.stop()
      else if (body.data.itemId) await runtime.transport.park(body.data.itemId)
      await logDecision(app, runtime.view.rundown.id, body.data.itemId ?? null, `EXTERNAL_${body.data.action.toUpperCase()}`, { ...body.data, source: 'external-control' })
      await emitIntegrationEvent(app.db, `external.${body.data.action}`, body.data, body.data.channelId)
      return { ok: true, action: body.data.action, channelId: body.data.channelId }
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : 'Comando recusado pelo transporte.' })
    }
  })

  server.post('/api/channels/:id/transport', async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = z
      .object({
        action: z.enum(['take', 'cue', 'stop', 'park', 'seek']),
        itemId: z.string().nullable().optional(),
        /** Arquivo aberto direto do explorador, sem entrar na grade. */
        assetId: z.string().nullable().optional(),
        bus: z.enum(['pgm', 'pvw']).optional(),
        frames: z.number().int().min(0).optional(),
      })
      .safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })
    const actionPermission = body.data.action === 'stop' ? 'CHANNEL_STOP' : 'PLAYLIST_EDIT'
    if (!(await allowed(request, actionPermission))) return reply.code(403).send({ error: 'Seu papel não pode executar esta ação.' })

    const runtime = await runtimeFor(app, id)
    if (!runtime?.view) return reply.code(404).send({ error: 'Canal sem grade carregada.' })

    switch (body.data.action) {
      case 'take': {
        const armed = runtime.transport.state().preview
        const itemId = body.data.itemId ?? (armed?.kind === 'ITEM' ? armed.id : null)
        if (!itemId) return reply.code(400).send({ error: 'Nada armado para entrar no ar.' })
        await runtime.transport.take(runtime.view.rundown.id, itemId)
        break
      }
      case 'cue': {
        const target: PreviewTarget | null = body.data.assetId
          ? { kind: 'ASSET', id: body.data.assetId }
          : body.data.itemId
            ? { kind: 'ITEM', id: body.data.itemId }
            : null
        await runtime.transport.cue(target)
        break
      }
      case 'park': {
        const first = runtime.view.items[0]
        if (!first) return reply.code(400).send({ error: 'Grade vazia.' })
        await runtime.transport.park(first.item.id)
        break
      }
      case 'stop':
        if (!(await allowed(request, 'CHANNEL_STOP'))) {
          return reply.code(403).send({ error: 'Seu papel não pode parar o canal.' })
        }
        await runtime.transport.stop()
        await logDecision(app, runtime.view.rundown.id, null, 'CHANNEL_STOPPED', {}, await usernameOf(request))
        void emitIntegrationEvent(app.db, 'channel.stopped', { rundownId: runtime.view.rundown.id }, runtime.channel.id)
        break
      case 'seek':
        if (!body.data.bus || body.data.frames === undefined) return reply.code(400).send({ error: 'Informe barramento e posição.' })
        await runtime.transport.seek(body.data.bus, body.data.frames)
        await logDecision(app, runtime.view.rundown.id, body.data.itemId ?? null, 'TRANSPORT_SEEK', { bus: body.data.bus, frames: body.data.frames }, await usernameOf(request))
        break
    }

    await runtime.refresh()
    onChange()
    return snapshot(app, runtime)
  })

  // ==========================================
  // FASE C: CONTINUIDADE, COMPLIANCE E SONDA DE PGM
  // ==========================================

  // 1. Telemetria e Cobertura de Cache de Continuidade (48h/7d)
  const getCacheStatusHandler = async (
    request: { headers: Record<string, string | string[] | undefined> },
    reply: { code: (code: number) => { send: (body: unknown) => unknown } },
  ) => {
    if (!(await allowed(request, 'REPORT_EXPORT'))) {
      return reply.code(403).send({ error: 'Sem permissão para consultar cache de continuidade.' })
    }
    const assets = await listAssets(app.db)
    return app.continuityCache.getStatus(assets)
  }
  server.get('/api/v1/continuity/cache/status', getCacheStatusHandler)
  server.get('/api/v1/cache/status', getCacheStatusHandler)

  // 2. Pré-aquecimento de Cache de Continuidade
  const warmCacheHandler = async (
    request: { headers: Record<string, string | string[] | undefined> },
    reply: { code: (code: number) => { send: (body: unknown) => unknown } },
  ) => {
    if (!(await allowed(request, 'PLAYLIST_EDIT'))) {
      return reply.code(403).send({ error: 'Sem permissão para pré-aquecer cache.' })
    }
    const assets = await listAssets(app.db)
    const result = await app.continuityCache.warmSchedule(assets, assets)
    const status = await app.continuityCache.getStatus(assets)
    return {
      ok: true,
      cached48h: result.cached48h,
      missing48h: result.missing48h,
      cached7d: result.cached7d,
      missing7d: result.missing7d,
      status,
    }
  }
  server.post('/api/v1/continuity/cache/warm', warmCacheHandler)
  server.post('/api/v1/cache/prewarm', warmCacheHandler)

  // 3. Telemetria da Sonda de Qualidade de PGM
  const getPgmProbeStatusHandler = async (
    request: { headers: Record<string, string | string[] | undefined> },
    reply: { code: (code: number) => { send: (body: unknown) => unknown } },
  ) => {
    if (!(await allowed(request, 'REPORT_EXPORT'))) {
      return reply.code(403).send({ error: 'Sem permissão para acessar telemetria de engenharia.' })
    }
    return app.pgmProbe.getStatus()
  }
  server.get('/api/v1/engineering/pgm-probe/status', getPgmProbeStatusHandler)
  server.get('/api/v1/probe/pgm/status', getPgmProbeStatusHandler)

  // 4. Disparo Manual / Reset de Slate de Emergência
  server.post('/api/v1/engineering/pgm-probe/emergency-slate', async (request, reply) => {
    if (!(await allowed(request, 'PLAYLIST_EDIT'))) {
      return reply.code(403).send({ error: 'Sem permissão para acionar intervenções de emergência.' })
    }
    const body = (request.body as { action?: string; reason?: string } | undefined) ?? {}
    if (body.action === 'RESET') {
      app.pgmProbe.resetEmergencySlate()
      return { ok: true, emergencySlateActive: false, status: app.pgmProbe.getStatus() }
    }
    const alert = app.pgmProbe.triggerEmergencySlate(body.reason ?? 'MANUAL_EMERGENCY_DISPATCH')
    for (const runtime of app.runtimes.values()) {
      void emitIntegrationEvent(app.db, 'pgm_probe.emergency_slate', { alert }, runtime.channel.id)
    }
    return {
      ok: true,
      emergencySlateActive: true,
      alert,
      status: app.pgmProbe.getStatus(),
    }
  })

  // 5. Exportação de As-Run em BXF XML (SMPTE-2021)
  const getAsRunBxfHandler = async (
    request: {
      headers: Record<string, string | string[] | undefined>
      query: { channelId?: string; since?: string; until?: string; channelName?: string; limit?: string }
    },
    reply: {
      code: (code: number) => { send: (body: unknown) => unknown }
      header: (name: string, value: string) => {
        header: (name: string, value: string) => { send: (body: string) => unknown }
        send: (body: string) => unknown
      }
    },
  ) => {
    if (!(await allowed(request, 'REPORT_EXPORT'))) {
      return reply.code(403).send({ error: 'Sem permissão para exportar relatórios.' })
    }
    const query = request.query
    const limit = Math.min(2000, Math.max(1, Number(query.limit ?? 1000) || 1000))
    const entries = await listAsRun(app.db, query.channelId, query.since, limit, query.until)
    const channel = query.channelId ? await getChannel(app.db, query.channelId) : null
    const bxfXml = exportAsRunBxf(entries, {
      channelName: query.channelName ?? channel?.name ?? 'RPlayout Master',
      channelId: query.channelId ?? channel?.id ?? 'CH-01',
      rate: channel?.rate ?? RATE_PADRAO,
    })
    return reply
      .header('content-type', 'application/xml; charset=utf-8')
      .header('content-disposition', 'attachment; filename="asrun.bxf.xml"')
      .send(bxfXml)
  }
  server.get('/api/v1/compliance/asrun/bxf', getAsRunBxfHandler as any)
  server.get('/api/v1/as-run/export/bxf', getAsRunBxfHandler as any)

  // 6. Resumo de Conformidade Regulatória ANCINE (Cotas e Limite de 25%)
  const getAncineSummaryHandler = async (
    request: {
      headers: Record<string, string | string[] | undefined>
      query: { channelId?: string; date?: string; targetHour?: string }
    },
    reply: { code: (code: number) => { send: (body: unknown) => unknown } },
  ) => {
    if (!(await allowed(request, 'REPORT_EXPORT'))) {
      return reply.code(403).send({ error: 'Sem permissão para consultar conformidade regulatória.' })
    }
    const query = request.query
    const channel = query.channelId ? await getChannel(app.db, query.channelId) : null
    const summary = await getAncineComplianceSummary(
      app.db,
      query.channelId,
      query.date ?? query.targetHour,
      channel?.rate ?? RATE_PADRAO,
    )
    return summary
  }
  server.get('/api/v1/compliance/ancine/summary', getAncineSummaryHandler as any)
  server.get('/api/v1/as-run/compliance/ancine', getAncineSummaryHandler as any)

  // 7. Exportação de As-Run em CSV estruturado
  server.get('/api/v1/compliance/asrun/csv', async (request, reply) => {
    if (!(await allowed(request, 'REPORT_EXPORT'))) {
      return reply.code(403).send({ error: 'Sem permissão para exportar relatórios.' })
    }
    const query = request.query as { channelId?: string; since?: string; until?: string; limit?: string }
    const limit = Math.min(2000, Math.max(1, Number(query.limit ?? 1000) || 1000))
    const entries = await listAsRun(app.db, query.channelId, query.since, limit, query.until)
    const channel = query.channelId ? await getChannel(app.db, query.channelId) : null
    const csv = exportAsRunCsv(entries, channel?.rate ?? RATE_PADRAO)
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', 'attachment; filename="asrun.csv"')
      .send(csv)
  })

  // ==========================================
  // FASE D: ROTAS DE EVENTOS SECUNDÁRIOS, SCTE E CONTROLE EXTERNO
  // ==========================================

  // 1. Consulta de camadas de GC
  server.get('/api/v1/graphics/layers', async (request, reply) => {
    const query = request.query as { channelId?: string }
    const channelId = query.channelId ?? (await listChannels(app.db))[0]?.id
    if (!channelId) {
      return reply.code(404).send({ error: 'Nenhum canal encontrado.' })
    }
    const runtime = await runtimeFor(app, channelId)
    if (!runtime) {
      return reply.code(404).send({ error: 'Canal não inicializado.' })
    }
    return {
      channelId,
      layers: runtime.graphics.getLayers(),
    }
  })

  // 2. Disparo e controle de camadas de GC
  server.post('/api/v1/graphics/layers/:layer/trigger', async (request, reply) => {
    if (!(await allowed(request, 'OUTPUT_CONTROL'))) {
      return reply.code(403).send({ error: 'Sem permissão para controlar grafismo.' })
    }
    const params = request.params as { layer: string }
    const validLayers: GraphicsLayer[] = ['STATION_LOGO', 'ONAIR_CLOCK', 'CRAWL_TICKER', 'LOWER_THIRD']
    const layer = params.layer.toUpperCase() as GraphicsLayer
    if (!validLayers.includes(layer)) {
      return reply.code(400).send({ error: `Camada gráfica inválida: ${params.layer}. Válidas: ${validLayers.join(', ')}` })
    }
    const body = z.object({
      channelId: z.string().optional(),
      action: z.enum(['SHOW', 'HIDE', 'UPDATE']).default('SHOW'),
      templateId: z.string().optional(),
      name: z.string().optional(),
      payload: z.record(z.unknown()).optional(),
      values: z.record(z.string()).optional(),
      fadeMs: z.number().int().min(0).max(5000).optional(),
      durationFrames: z.number().int().min(0).optional(),
      opacity: z.number().min(0).max(1).optional(),
    }).safeParse(request.body)
    if (!body.success) {
      return reply.code(400).send({ error: 'Parâmetros inválidos.', details: body.error.format() })
    }
    const channelId = body.data.channelId ?? (await listChannels(app.db))[0]?.id
    if (!channelId) {
      return reply.code(404).send({ error: 'Nenhum canal encontrado.' })
    }
    const runtime = await runtimeFor(app, channelId)
    if (!runtime) {
      return reply.code(404).send({ error: 'Canal não inicializado.' })
    }
    let template: import('@rplayout/protocol').GraphicTemplate | undefined
    if (body.data.templateId) {
      const [t] = await app.db.select().from(graphicTemplates).where(eq(graphicTemplates.id, body.data.templateId))
      template = t
    }
    const result = runtime.graphics.triggerLayer(layer, body.data.action, {
      templateId: body.data.templateId,
      template,
      name: body.data.name,
      payload: body.data.payload,
      values: body.data.values,
      fadeMs: body.data.fadeMs,
      durationFrames: body.data.durationFrames,
      opacity: body.data.opacity,
    })
    return { success: true, layerState: result }
  })

  // 3. Disparo de marcador SCTE-35 / SCTE-104
  server.post('/api/v1/scte/splice-insert', async (request, reply) => {
    if (!(await allowed(request, 'OUTPUT_CONTROL'))) {
      return reply.code(403).send({ error: 'Sem permissão para acionar sinalização SCTE.' })
    }
    const body = z.object({
      channelId: z.string().optional(),
      spliceEventId: z.number().int().optional(),
      ptsTime: z.number().optional(),
      durationSeconds: z.number().positive().optional().default(30.0),
      autoReturn: z.boolean().optional().default(true),
      prerollMs: z.number().int().min(0).max(60000).optional().default(4000),
      uniqueProgramId: z.number().int().optional(),
      segmentationTypeId: z.number().int().optional(),
      availNum: z.number().int().optional(),
      availsExpected: z.number().int().optional(),
      outOfNetwork: z.boolean().optional().default(true),
    }).safeParse(request.body)
    if (!body.success) {
      return reply.code(400).send({ error: 'Parâmetros de SCTE-35 inválidos.', details: body.error.format() })
    }
    const channelId = body.data.channelId ?? (await listChannels(app.db))[0]?.id
    const channel = channelId ? await getChannel(app.db, channelId) : null
    const rate = channel?.rate ?? RATE_PADRAO
    const nowFrames = framesSinceMidnight(new Date(), rate)
    const ptsCalculated = body.data.ptsTime ?? Math.floor((nowFrames / (rate.num / rate.den)) * 90000)
    const scteMessage: Scte35Message = {
      spliceEventId: body.data.spliceEventId ?? Math.floor(10000 + Math.random() * 89999),
      ptsTime: ptsCalculated,
      durationSeconds: body.data.durationSeconds,
      autoReturn: body.data.autoReturn,
      prerollMs: body.data.prerollMs,
      uniqueProgramId: body.data.uniqueProgramId ?? 1,
      segmentationTypeId: body.data.segmentationTypeId,
      availNum: body.data.availNum,
      availsExpected: body.data.availsExpected,
      outOfNetwork: body.data.outOfNetwork,
      commandType: 'SPLICE_INSERT',
    }
    const result = globalScteDispatcher.dispatchSpliceInsert(scteMessage)
    return {
      success: true,
      spliceEventId: scteMessage.spliceEventId,
      prerollMs: scteMessage.prerollMs,
      durationSeconds: scteMessage.durationSeconds,
      scte35Hex: result.scte35.toString('hex'),
      scte104Hex: result.scte104.payload.toString('hex'),
      vancLine: result.scte104.line,
      latencyMs: result.latencyMs,
      status: result.status,
    }
  })

  // 4. Acionamento de hardware externo (ATEM, Videohub, GPIO) protegido por token
  server.post('/api/v1/external/control', async (request, reply) => {
    const rawHeaderToken = request.headers['x-rplayout-control-token']
    const headerToken = Array.isArray(rawHeaderToken) ? rawHeaderToken[0] : rawHeaderToken

    const body = z.object({
      targetDevice: z.enum(['ATEM_SWITCHER', 'VIDEOHUB_ROUTER', 'GPIO_RELAY', 'BLACKMAGIC_ATEM', 'LEITCH_ROUTER']),
      action: z.string().min(1),
      parameters: z.record(z.unknown()).optional(),
      params: z.record(z.unknown()).optional(),
      token: z.string().optional(),
      channelId: z.string().optional(),
      clientMetadata: z.record(z.unknown()).optional(),
    }).safeParse(request.body)

    if (!body.success) {
      return reply.code(400).send({ error: 'Parâmetros de comando externo inválidos.', details: body.error.format() })
    }

    const token = body.data.token ?? headerToken
    if (EXTERNAL_CONTROL_TOKEN && EXTERNAL_CONTROL_TOKEN.trim() !== '') {
      if (!token || token.trim() !== EXTERNAL_CONTROL_TOKEN.trim()) {
        return reply.code(401).send({ error: 'Chave de controle externo inválida ou ausente (X-RPlayout-Control-Token).' })
      }
    } else {
      if (!(await allowed(request, 'OUTPUT_CONTROL'))) {
        return reply.code(403).send({ error: 'Sem permissão para operar dispositivos externos.' })
      }
    }

    const command: ExternalDeviceCommand = {
      targetDevice: (body.data.targetDevice === 'BLACKMAGIC_ATEM' ? 'ATEM_SWITCHER' : body.data.targetDevice as any),
      action: body.data.action,
      params: body.data.parameters ?? body.data.params ?? {},
      token,
    }

    const channelId = body.data.channelId ?? (await listChannels(app.db))[0]?.id
    const channel = channelId ? await getChannel(app.db, channelId) : null
    const rate = channel?.rate ?? RATE_PADRAO
    const nowFrames = framesSinceMidnight(new Date(), rate)
    const pgmTimecode = formatTimecode(nowFrames, rate)

    const execution = await globalStudioAutomationGateway.execute(command, token, pgmTimecode)
    if (!execution.success && execution.status === 'FAILED' && execution.error?.includes('inválida')) {
      return reply.code(401).send(execution)
    }

    return execution
  })

  // ==========================================
  // FASE E: TIMELINE VISUAL MULTICAMADA & OPERAÇÃO DISTRIBUÍDA
  // ==========================================

  // 1. Consulta completa das 4 pistas da timeline 24h
  server.get('/api/v1/timeline/:rundownId/multitrack', async (request, reply) => {
    const { rundownId } = request.params as { rundownId: string }
    const query = request.query as {
      zoom?: TimelineZoomLevel
      windowStartMs?: string
      currentPlayheadFrames?: string
      tenantId?: string
      channelId?: string
    }

    try {
      const data = await generateTimelineMultiTrack(app.db, rundownId, {
        zoomLevel: query.zoom,
        windowStartMs: query.windowStartMs ? Number(query.windowStartMs) : undefined,
        currentPlayheadFrames: query.currentPlayheadFrames ? Number(query.currentPlayheadFrames) : undefined,
        tenantId: query.tenantId,
        channelId: query.channelId,
      })

      if (data.eTag) {
        void reply.header('ETag', data.eTag)
      }

      return data
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes('não encontrado')) {
        return reply.code(404).send({ error: message })
      }
      return reply.code(500).send({ error: 'Erro ao gerar timeline multicamada.', details: message })
    }
  })

  // Alias canal/tenant para timeline
  server.get('/api/v1/tenants/:tenantId/channels/:channelId/timeline', async (request, reply) => {
    const { tenantId, channelId } = request.params as { tenantId: string; channelId: string }
    const query = request.query as {
      date?: string
      zoom?: TimelineZoomLevel
      windowStartMs?: string
      currentPlayheadFrames?: string
    }

    const rundownsList = await listRundowns(app.db, channelId)
    const targetRundown = query.date
      ? rundownsList.find((r) => r.date === query.date) ?? rundownsList[0]
      : rundownsList[0]

    if (!targetRundown) {
      return reply.code(404).send({ error: `Nenhuma grade encontrada para o canal ${channelId}` })
    }

    const data = await generateTimelineMultiTrack(app.db, targetRundown.id, {
      zoomLevel: query.zoom,
      windowStartMs: query.windowStartMs ? Number(query.windowStartMs) : undefined,
      currentPlayheadFrames: query.currentPlayheadFrames ? Number(query.currentPlayheadFrames) : undefined,
      tenantId,
      channelId,
    })

    if (data.eTag) {
      void reply.header('ETag', data.eTag)
    }

    return data
  })

  // 2. Controle de presença e bloqueio otimista de linha
  server.post('/api/v1/rundowns/:id/acquire-lock', async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = z.object({
      itemId: z.string().optional(),
      userId: z.string().optional(),
      userName: z.string().optional(),
    }).safeParse(request.body ?? {})

    if (!body.success) {
      return reply.code(400).send({ error: 'Parâmetros de lock inválidos.', details: body.error.format() })
    }

    const userId = body.data.userId ?? (await usernameOf(request)) ?? 'operador_mcr'
    const userName = body.data.userName ?? userId

    const result = globalConcurrencyManager.acquireLock({
      rundownId: id,
      itemId: body.data.itemId,
      userId,
      userName,
    })

    if (!result.success) {
      return reply.code(409).send({ error: result.error, lockState: result.lockState })
    }

    return { success: true, lockState: result.lockState }
  })

  server.post('/api/v1/rundowns/:id/release-lock', async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = z.object({
      itemId: z.string().optional(),
      userId: z.string().optional(),
    }).safeParse(request.body ?? {})

    if (!body.success) {
      return reply.code(400).send({ error: 'Parâmetros de release inválidos.', details: body.error.format() })
    }

    const userId = body.data.userId ?? (await usernameOf(request)) ?? 'operador_mcr'
    const result = globalConcurrencyManager.releaseLock({
      rundownId: id,
      itemId: body.data.itemId,
      userId,
    })

    return { success: true, lockState: result.lockState }
  })

  // 3. Resolução e merge assistido de conflitos concorrentes
  server.post('/api/v1/rundowns/:id/resolve-conflict', async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = z.object({
      conflictId: z.string().optional(),
      itemId: z.string().min(1),
      clientRundownVersion: z.number().int().default(1),
      resolutionStrategy: z.enum(['OVERWRITE_FORCE', 'DISCARD_MINE', 'APPLY_MERGED_FIELDS']),
      mergedData: z.record(z.unknown()).optional(),
      patch: z.record(z.unknown()).optional(),
    }).safeParse(request.body)

    if (!body.success) {
      return reply.code(400).send({ error: 'Parâmetros de resolução de conflito inválidos.', details: body.error.format() })
    }

    const item = await getItem(app.db, body.data.itemId)
    if (!item) {
      return reply.code(404).send({ error: `Item não encontrado: ${body.data.itemId}` })
    }

    const result = globalConcurrencyManager.resolveConflict({
      rundownId: id,
      itemId: body.data.itemId,
      decision: body.data as ConflictResolutionDecision,
      currentItemState: item as any,
      clientPatch: body.data.patch ?? body.data.mergedData,
    })

    // Aplica alterações permitidas no banco de dados
    const patch = result.resolvedData
    const updates: Record<string, unknown> = {}
    if (typeof patch.title === 'string') updates.title = patch.title
    if (typeof patch.durationOverride === 'number') updates.durationOverride = patch.durationOverride
    if (typeof patch.minDuration === 'number') updates.minDuration = patch.minDuration
    if (typeof patch.trimmable === 'boolean') updates.trimmable = patch.trimmable
    if (typeof patch.optional === 'boolean') updates.optional = patch.optional
    if (typeof patch.protected === 'boolean') updates.protected = patch.protected
    if (typeof patch.notes === 'string') updates.notes = patch.notes

    if (Object.keys(updates).length > 0) {
      await app.db.update(rundownItems).set(updates).where(eq(rundownItems.id, body.data.itemId))
    }

    for (const runtime of app.runtimes.values()) {
      if (runtime.view?.rundown.id === id) {
        await runtime.refresh()
      }
    }
    onChange()

    return {
      success: true,
      newRundownVersion: result.newRundownVersion,
      newLineVersion: result.newLineVersion,
      resolvedData: result.resolvedData,
    }
  })

  // 4. Atualização de item com validação de versão otimista e detecção de 409 Conflict
  server.put('/api/v1/rundowns/:id/items/:itemId', async (request, reply) => {
    const { id, itemId } = request.params as { id: string; itemId: string }
    const rawIfMatch = request.headers['if-match']
    const ifMatchHeader = Array.isArray(rawIfMatch) ? rawIfMatch[0] : rawIfMatch

    const body = z.object({
      expectedRundownVersion: z.number().int().optional(),
      expectedLineVersion: z.number().int().optional(),
      patch: z.record(z.unknown()),
    }).safeParse(request.body)

    if (!body.success) {
      return reply.code(400).send({ error: 'Payload de atualização de item inválido.', details: body.error.format() })
    }

    const item = await getItem(app.db, itemId)
    if (!item) {
      return reply.code(404).send({ error: `Item não encontrado: ${itemId}` })
    }

    const validation = globalConcurrencyManager.validateOptimisticLock({
      rundownId: id,
      itemId,
      expectedRundownVersion: body.data.expectedRundownVersion,
      expectedLineVersion: body.data.expectedLineVersion,
      ifMatchHeader,
      serverItemState: item as any,
      clientPatch: body.data.patch,
    })

    if (!validation.valid && validation.errorPayload) {
      return reply.code(409).send(validation.errorPayload)
    }

    // Aplica alterações na linha
    const patch = body.data.patch
    const updates: Record<string, unknown> = {}
    if (typeof patch.title === 'string') updates.title = patch.title
    if (typeof patch.durationOverride === 'number') updates.durationOverride = patch.durationOverride
    if (typeof patch.minDuration === 'number') updates.minDuration = patch.minDuration
    if (typeof patch.trimmable === 'boolean') updates.trimmable = patch.trimmable
    if (typeof patch.optional === 'boolean') updates.optional = patch.optional
    if (typeof patch.protected === 'boolean') updates.protected = patch.protected
    if (typeof patch.notes === 'string') updates.notes = patch.notes

    if (Object.keys(updates).length > 0) {
      await app.db.update(rundownItems).set(updates).where(eq(rundownItems.id, itemId))
    }

    const newRundownVersion = globalConcurrencyManager.incrementRundownVersion(id)
    const newLineVersion = globalConcurrencyManager.incrementLineVersion(id, itemId)
    const eTag = globalConcurrencyManager.generateETag(id, itemId)
    void reply.header('ETag', eTag)

    for (const runtime of app.runtimes.values()) {
      if (runtime.view?.rundown.id === id) {
        await runtime.refresh()
      }
    }
    onChange()

    return {
      success: true,
      newRundownVersion,
      newLineVersion,
      item: { ...item, ...updates },
    }
  })

  // 5. Autofill inteligente de gap em 1-clique
  server.post('/api/v1/rundowns/:id/autofill-gap', async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = z.object({
      gapStartMs: z.number().optional(),
      gapDurationMs: z.number().positive().default(30000),
      preferredCategory: z.string().optional().default('FILLER'),
      allowExtendPrevious: z.boolean().optional().default(true),
    }).safeParse(request.body ?? {})

    if (!body.success) {
      return reply.code(400).send({ error: 'Parâmetros de autofill inválidos.', details: body.error.format() })
    }

    const rundown = await getRundown(app.db, id)
    if (!rundown) {
      return reply.code(404).send({ error: `Rundown não encontrado: ${id}` })
    }

    const channel = await getChannel(app.db, rundown.channelId)
    const rate = channel?.rate ?? RATE_PADRAO
    const gapFrames = Math.round((body.data.gapDurationMs * rate.num) / (1000 * rate.den))

    // Localiza asset compatível no acervo
    const assets = await listAssets(app.db)
    const fillerAsset = assets.find((a) => !a.ignored && (a.categoryId === 'FILLER' || a.title.toLowerCase().includes('filler') || a.title.toLowerCase().includes('promo')))

    const existingItems = await listItems(app.db, id)
    const nextOrder = existingItems.length > 0 ? Math.max(...existingItems.map((i) => i.order)) + 1 : 0

    const insertedId = randomUUID()
    await app.db.insert(rundownItems).values({
      id: insertedId,
      rundownId: id,
      sortOrder: nextOrder,
      type: 'FILLER',
      eventType: 'FILLER',
      title: fillerAsset ? `[AUTOFILL] ${fillerAsset.title}` : `[AUTOFILL] Contingência (${Math.round(body.data.gapDurationMs / 1000)}s)`,
      mediaId: fillerAsset?.id ?? null,
      sourceRef: null,
      trimmable: true,
      optional: true,
      protected: false,
      durationOverride: gapFrames,
      minDuration: 1,
      anchor: { kind: 'FLOW' },
      onOverrun: 'TRIM_PREV',
      elastic: null,
      blockId: null,
      fit: 'PILLARBOX',
      audioTrack: null,
      locked: false,
      autoNext: true,
      loop: false,
      notes: 'Inserido automaticamente pelo Autofill Inteligente de Gap',
    })

    const newRundownVersion = globalConcurrencyManager.incrementRundownVersion(id)

    for (const runtime of app.runtimes.values()) {
      if (runtime.view?.rundown.id === id) {
        await runtime.refresh()
      }
    }
    onChange()

    return {
      success: true,
      strategyApplied: 'INSERT_OPTIMAL_FILLER',
      insertedItemId: insertedId,
      newRundownVersion,
      remainingGapMs: 0,
    }
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
