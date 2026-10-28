import { randomUUID } from 'node:crypto'
import { EngineTransport, type HotOutputProfile } from './domain/engine.js'
import {NativeLiveReplacementUnknown} from './domain/native-live-replacement.js'
import {GraphicCommandLedger} from './domain/graphic-command-ledger.js'
import { setChannelArchived } from './domain/channel-archive.js'
import {assertChannelAudioChange} from './domain/audio-bus.js'
import {requireChannelConfiguration} from './domain/channel-configuration-guard.js'
import {configurationRevision} from './db/channel-configuration.js'
import {qcRevision} from './db/qc-revisions.js'
import {editLiveSource,readLiveSourceReview} from './domain/live-source-edit.js'
import {editMultiview,readMultiviewReview} from './domain/multiview-edit.js'
import {editScheduleRule,readScheduleRuleReview} from './domain/schedule-rule-edit.js'
import {editGraphicTemplate,editSlate,readGraphicsReview} from './domain/graphics-edit.js'
import {requireQcReview} from './domain/qc-review-guard.js'
import {assetMetadataETag,assetRemovalETag} from '@rplayout/protocol'
import {captureAssetRemovalAuthority,readAssetRemoval,applyAssetRemoval} from './domain/asset-removal.js'
import {captureAssetMetadataAuthority,readAssetMetadata,editAssetMetadata} from './domain/asset-metadata-edit.js'
import {EditorialVersions} from './db/editorial-revisions.js'
import {Interruptions,type InterruptedItem} from './domain/interruptions.js'
import {inspectInsertion,requireInsertionReview,OperationalInsertions,type InsertionInput} from './domain/operational-insertion.js'
import {installationVault} from './domain/secret-vault.js'
import {inspectCompensation,commitCompensation,compensationReceipt} from './domain/operational-compensation.js'
import {Checkpoints,stoppedCheckpoint} from './domain/checkpoints.js'
import type {ConfigurationLease} from './domain/configuration-changes.js'
import {applyCollaborativeEdit,CollaborativeEditError} from './domain/collaborative-edit.js'
import {readAudit} from './domain/audit.js'
import {acknowledgeHealthIncident,readHealthIncidents,readHealthIncidentPage,type IncidentPageQuery,IncidentError} from './domain/health-incidents.js'
import { resolveTakeTarget, TakeTargetError } from './domain/take-target.js'
import { and, asc, desc, eq, inArray, isNotNull,or,sql } from 'drizzle-orm'
import { z } from 'zod'
import { overlayCommandSchema, overlayDeckOf, OverlayError } from './domain/overlays.js'
import type { GraphicTemplate } from '@rplayout/protocol'
import { scheduledDeviceSchema, freezeDeviceAutomation } from './domain/device-automation.js'
import type { FastifyInstance,FastifyRequest } from 'fastify'
import {recordManualFailover,type ManualFailoverInput} from './domain/manual-failover.js'
import {
  resolveTrim,
  channelConfigurationETag,
  liveSourceETag,
  multiviewETag,
  scheduleRuleETag,
  graphicsETag,
  DEFAULT_QC_PROFILE, assessQc, qcApproved, type QcStatus,
  qcDecisionETag,
  inferLiveSourceType,
  dateInName,
  formatVideoFormat,
  formatTimecode,
  type GraphicsLayer,
  type Scte35Message,
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
  type EditScope,
} from '@rplayout/protocol'
import { networkInterfaces } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  runtimeFor,
  runtimeForRundown as initialRuntimeForRundown,
  type App,
  type ChannelRuntime,
} from './app.js'
import {
  assetMap,
  toAsset,
  toItem,
  toChannel,
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
import { exportXmltv } from './domain/epg.js'
import { buildCommercialComplianceReport, renderCommercialCompliancePdf } from './domain/reports.js'
import {proposeFill,applyFillProposal} from './domain/autofill-proposal.js'
import type {Db} from './db/client.js'
import { backupDatabase, listBackups } from './domain/backup.js'
import {UpgradeBackups,upgradeBackupRequest} from './domain/upgrade-backups.js'
import { pgmProbeFor, syncDistribution } from './app.js'
import { MediaMtx, PORTS } from './domain/mediamtx.js'
import { can, parseRole, roleLabel, type Action } from './domain/permissions.js'
import { hashPassword, verifyPassword } from './domain/auth.js'
import {issueLoginSession} from './domain/login-session.js'
import { AccessControl, sessionDigest, sessionToken, trustedOrigin, secretEquals, normalizedIp } from './domain/access.js'
import {parseAllowedOrigins} from './domain/http-origin-policy.js'
import { applyQcDecisions,applyQcDecisionsNow } from './domain/qc-workflow.js'
import { channelCachePlan, warmChannelCache } from './domain/published-cache-plan.js'
import { ProcessMetrics } from './domain/process-metrics.js'
import {scopedOperationalSample} from './domain/operational-metrics.js'
import {parseMetricHistoryQuery} from './domain/metric-history-query.js'
import { isIP } from 'node:net'
import { emitIntegrationEvent } from './domain/integrations.js'
import {readCategory,editCategory,categoryAuthority} from './domain/category-edit.js'
import {categoryETag} from '@rplayout/protocol'
import {integrationAuthority,readIntegration,readIntegrationCatalog,createIntegration,updateIntegration,queueIntegrationTest,readIntegrationDelivery,readIntegrationDeliveries,retryIntegrationDelivery,publicIntegration} from './domain/integration-edit.js'
import {integrationETag,integrationCatalogETag,integrationDeliveryETag} from '@rplayout/protocol'
import { redactUrl } from './domain/relays.js'
import { probeN1Peer } from './domain/n1.js'
import {HaError} from './domain/ha-replication.js'
import {HaRecoveryError} from './domain/ha-recovery.js'
import { createEditorialRundown, EditorialRundownError } from './domain/editorial-rundown.js'
import { diagnosticValue, sanitizeDiagnostic } from './domain/sanitize-diagnostic.js'
import { ChannelProgrammingError, copyRundownToChannel, isActiveMirrorRundown, mirrorOf, mirrorsFrom, recordMirrorSync, setMirror, syncMirrorRundown } from './domain/channel-programming.js'
import { canShareAcrossChannels } from './domain/permissions.js'
import {databaseStorageStatus} from './db/process-database.js'
import {HaBindingError,haBindingRequest,type HaBindingInventory} from './domain/ha-bindings.js'
import {haReturnBindingRequest,haReturnBindingReviewRequest} from './domain/ha-return-bindings.js'
import {haReturnApplicationRequest} from './domain/ha-return-application.js'
import {haReturnMediaReviewRequest} from './domain/ha-return-media-review.js'
import {haReturnMediaApplicationRequest} from './domain/ha-return-media-application.js'
import {haReturnJobRecoveryRequest} from './domain/ha-return-job-recovery.js'
import {haReturnJobListQuery} from './domain/ha-return-job-list.js'
import {haReturnAutoDecisionRequest} from './domain/ha-return-auto-decision.js'
import {haReturnPostGainReviewRequest} from './domain/ha-return-postgain-review.js'
import {haReturnBusReviewRequest} from './domain/ha-return-bus-review.js'
import {haMonitorRequest} from './domain/ha-promotion.js'
import {haControlRequest,haControlReviewRequest} from './domain/ha-control.js'
import {haStopRequest} from './domain/ha-stop.js'
import {haExportRequest} from './domain/ha-execution-export.js'
import {haReturnSendRequest,haReturnResumeRequest} from './domain/ha-return-send.js'
import {haReturnReviewRequest} from './domain/ha-return-store.js'
import {haReturnSelectionRequest} from './domain/ha-return-selection.js'
import {haReturnCandidateRequest} from './domain/ha-return-candidate-staging.js'
import {haHistoryImportRequest} from './domain/ha-history-import.js'
import {haHistoryVariantRequest} from './domain/ha-history-variant.js'
import {haReturnRekeyRequest} from './domain/ha-return-rekey.js'
const haReturnWritePaths=new Set(['/api/ha/executions/return-resume'])
const haQuarantineWrites=new Set(['/api/ha/returns/review','/api/ha/returns/history','/api/ha/returns/variants','/api/ha/returns/rekey','/api/ha/returns/selection','/api/ha/returns/candidate','/api/ha/returns/bindings','/api/ha/returns/application','/api/ha/returns/media-review','/api/ha/returns/media-application'])
haQuarantineWrites.add('/api/ha/returns/auto-decision')
haQuarantineWrites.add('/api/ha/returns/postgain-review')
haQuarantineWrites.add('/api/ha/returns/bus-review')
import {configuredSourceEndpoint} from './domain/item-source-binding.js'
import {isRecoveryRehearsal,rehearsalRequestAllowed} from './domain/recovery-rehearsal.js'
import { ExternalCommandLedger, DeviceCommandConflict } from './domain/external-command-ledger.js'
import { sourceWire, sourceAddress, credentialAddress } from './domain/source-wire.js'
import {requireItemSourceBinding} from './domain/item-source-binding.js'
import {scopedSourceList} from './domain/sources.js'
import { activeHorizonRule, executionHorizon } from './domain/continuous.js'
import { localDate, rundownClock, rundownFrames, rundownMidnight } from './domain/rundown-clock.js'
import { inspectBoundary, PlaylistBoundaryLedger } from './domain/playlist-boundary.js'
import { AUTH_PASSWORD, AUTH_USER, EXTERNAL_CONTROL_TOKEN, N1_PEER_URL } from './config.js'

const execFileAsync = promisify(execFile)
import * as Roots from './domain/roots.js'
import {rootCatalogETag,rootAddETag} from '@rplayout/protocol'
import {rootAuthority,readRootCatalog,readRootAdd,addRootConferred,removeRootConferred} from './domain/root-edit.js'
import {readScanReview,queueScan} from './domain/scan-command.js'
import {scanETag} from '@rplayout/protocol'
import {recoverScan} from './domain/scan-recovery.js'
import {readScanDiagnostics} from './domain/scan-diagnostic.js'
import {
  categories,
  channels,
  destinations,
  rundowns,
  graphicTemplates,
  guestKeys,
  itemGraphics,
  mediaAssets,
  qcDecisions,
  rundownItems,
  scheduleRules,
  outputProfiles,
  playlistVersions,
  users,
  sessions,
  healthEvents,
  integrations,
  integrationDeliveries,
  secondaryEvents,
  secondaryEventRuns,
  externalDevices,
  liveSources,
  multiviewConfigs,
  transmissionPresets,
  operationalPlaylistRevisions,
} from './db/schema.js'
import { listChannelProjects, restoreChannelProject, reviewChannelProject, saveChannelProject } from './domain/channel-projects.js'
import {projectRestoreETag} from '@rplayout/protocol'
import {accountCatalogETag,accountSessionsETag} from '@rplayout/protocol'
import {bootstrapConfiguredAccount,captureAccountAuthority,changeAccountAccess,checkCreateAccountReview,checkUpdateAccountReview,createAccount,createAccountBody,logoutAccount,readAccountCatalog,readAccountSessions,revokeAccountSessions,updateAccount,updateAccountBody} from './domain/account-edit.js'
import {trimSchema,audioSchema,anchorSchema,qcProfileSchema} from './domain/editorial-schemas.js'
import {
  globalSrtManager,
  listLiveSources,
  getLiveSource,
} from './domain/srt.js'
import { globalScteDispatcher } from './domain/scte.js'
import { globalStudioAutomationGateway } from './domain/external-control.js'
import { asRun, operatorDecisions } from './db/schema.js'
import { applyAudio, applyTrim, type ScopeGuard } from './domain/scopes.js'
import {inspectEditScope,requireScopeReview,type ScopeOwner} from './domain/scoped-edit-review.js'
import type {HistoryGuard} from './domain/history.js'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { extname, resolve as resolvePath } from 'node:path'
import {
  createOutput,
  newOutputProfile,
  validateOutputProfile,
  deleteOutput,
  toEngineProfile,
  listOutputs,
  outputCapability,
  outputUpdatePatch,
  type OutputProfileRow,
  targetOf,
} from './domain/outputs.js'
import { thumbnailSvg } from './domain/thumbnail.js'
import * as Playlists from './domain/playlists.js'
import { buildView, type RundownView } from './domain/plan.js'
import {executionTrim} from './domain/execution-trim.js'
import {readEditorialState,editorialView} from './domain/editorial-state.js'
import {mutateEditorial,requireEditorialRevision} from './domain/editorial-mutation.js'
import {readItemAutomationState} from './domain/item-automation-state.js'
import { generateTimelineMultiTrack } from './domain/timeline.js'
import {
  activeOperationalPlaylist,
  inspectOperationalPlaylist,
  inspectOperationalRollback,
  assertOnAirMediaUnchanged,
  adjustPublishedLiveDuration,
  listOperationalPlaylists,
  publishOperationalPlaylist,
  simulateOperationalPlaylist,
  readOperationalPayload,
  rollbackOperationalPlaylist,
  diffOperationalItems,
  diffOperationalGraphics,
} from './domain/operational-playlist.js'
import {requireOperationalReview} from './domain/operational-review.js'
import type {OperationalReview} from '@rplayout/protocol'
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


const scopeSchema = z.enum(['ITEM', 'RUNDOWN', 'ALL_RUNDOWNS', 'ASSET_DEFAULT'])
// Legacy collaborative editing uses the same bounded operational fields; it
// must never accept arbitrary keys, fractional frames or non-finite numbers.
const collaborativePatchSchema = z.object({
  title:z.string().trim().min(1).max(500).optional(),
  durationOverride:z.number().int().min(0).max(100_000_000).nullable().optional(),
  minDuration:z.number().int().min(0).max(100_000_000).optional(),
  trimmable:z.boolean().optional(),optional:z.boolean().optional(),protected:z.boolean().optional(),
  notes:z.string().max(20_000).nullable().optional(),
}).strict().refine(value => typeof value.durationOverride !== 'number' || value.minDuration === undefined || value.minDuration <= value.durationOverride,
  'A duração mínima não pode exceder a duração definida.')

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

type EditorialContext = Pick<ChannelRuntime, 'view' | 'channel' | 'executionView' | 'operationalRevision' | 'transport' | 'live' | 'refresh' | 'markManualEdit' | 'cuesOf'>

/** Request-local editorial context. It never swaps another date into execution. */
async function runtimeForRundown(app: App, rundownId: string): Promise<EditorialContext | null> {
  const rundown = await getRundown(app.db, rundownId)
  if (!rundown) return null
  const runtime = await runtimeFor(app, rundown.channelId)
  if (!runtime) throw Object.assign(new Error('A grade existe, mas o runtime do canal está indisponível ou protegido. Confira distribuição, posse e recuperação no Monitor; nenhum comando foi executado.'),{statusCode:409,code:'CHANNEL_RUNTIME_UNAVAILABLE'})
  // Preserve the first-load compatibility of an idle, uninitialized channel.
  if (!runtime.view) return initialRuntimeForRundown(app, rundownId)
  if (runtime.view.rundown.id === rundownId) return runtime
  let cues: ReturnType<ChannelRuntime['cuesOf']> = []
  const context: EditorialContext = {
    view: null, channel: runtime.channel,
    get executionView() { return runtime.executionView },
    get operationalRevision() { return runtime.operationalRevision },
    transport: runtime.transport, live: () => runtime.live(),
    markManualEdit: () => {},
    cuesOf: itemId => cues.filter(cue => cue.itemId === itemId),
    refresh: async () => {
      // Asset-wide edits may affect the current schedule, but its identity stays.
      await runtime.refresh()
      context.channel = runtime.channel
      const result = await editorialSnapshot(app, rundownId)
      context.view = result?.view ?? null
      const rows = await app.db.select().from(itemGraphics)
        .innerJoin(rundownItems, eq(itemGraphics.itemId, rundownItems.id))
        .innerJoin(graphicTemplates, eq(itemGraphics.templateId, graphicTemplates.id))
        .where(eq(rundownItems.rundownId, rundownId))
      cues = rows.map(row => ({ ...row.item_graphics, templateName: row.graphic_templates.name }))
      return context.view
    },
  }
  await context.refresh()
  return context
}

async function runtimeForItem(app: App, itemId: string): Promise<EditorialContext | null> {
  const item = await getItem(app.db, itemId)
  return item ? runtimeForRundown(app, item.rundownId) : null
}

const snapshot = (app: App, runtime: Pick<EditorialContext, 'view' | 'executionView' | 'operationalRevision' | 'live' | 'channel'>) => ({
  view: runtime.view,
  executionView: runtime.executionView,
  operationalRevision: runtime.operationalRevision,
  live: runtime.live(),
  history: app.history.state(runtime.view?.rundown.id ?? ''),
  monitors: monitors(app, runtime.channel.id),
})

/** Browsing/exporting editorial dates must never replace the running playlist. */
async function editorialSnapshot(app: App, rundownId: string) {
  const rundown = await getRundown(app.db, rundownId)
  if (!rundown) return null
  const runtime = await runtimeFor(app, rundown.channelId)
  if (!runtime) return null
  const state=readEditorialState(app.db,rundownId)
  if(!state)return null
  const current=runtime.view?.rundown.id===rundownId
  const clock = rundownClock(state.rundown.date, state.channel.rate, new Date(), current ? runtime.transport.state().onAir : null)
  const view=editorialView(state,current?clock.now:null,current?clock.onAir:null)
  const currentSnapshot = snapshot(app, runtime)
  return { ...currentSnapshot, live: current && clock.now !== null ? { ...currentSnapshot.live, now: clock.now } : currentSnapshot.live, view, history: app.history.state(rundownId) }
}

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
  // Browser monitoring is a low-bandwidth derivative, not the full broadcast
  // master. The PGM card must heartbeat `mon` just as PVW heartbeats `pvw`.
  return { port: PORTS.webrtc, program: path.monitor, preview: path.preview, inspection: path.inspection ?? null }
}

/**
 * Itens que andam junto com este. Um item de bloco nunca se move sozinho: o
 * bloco comercial que se parte no meio é o pesadelo clássico do playout.
 */
function blockCompanions(runtime: Pick<EditorialContext, 'view'>, itemId: string): string[] {
  const items = runtime.view?.items ?? []
  const found = items.find((entry) => entry.item.id === itemId)
  const blockId = found?.item.blockId
  if (!blockId) return [itemId]
  return items.filter((entry) => entry.item.blockId === blockId).map((entry) => entry.item.id)
}

export function registerRoutes(app: App, server: FastifyInstance, onChange: () => void): void {
  const globalConcurrencyManager=app.concurrency
  const auditChannels=new WeakMap<object,string[]>()
  const mutatePlaylist = async (runtime: ChannelRuntime, reply: any, work: () => Promise<unknown>, changesExecution = () => true) => {
    try { return await (runtime.transport instanceof EngineTransport ? runtime.transport.mutatePlaylist(work, changesExecution) : work()) }
    catch (error) { if(error instanceof CollaborativeEditError)return reply.code(error.status).send(error.payload);return reply.code(409).send({ error: error instanceof Error ? error.message : 'Revisão não ativada; confira a operação pendente.' }) }
  }
  const configureChannel = async (id: string, reply: any, work: (applyOutput?: (output: HotOutputProfile) => Promise<void>,lease?:ConfigurationLease) => Promise<unknown>) => {
    const previous = app.runtimes.get(id)
    const guarded = async (applyOutput?: (output: HotOutputProfile) => Promise<void>) => {
      if (app.runtimes.get(id) !== previous) throw new Error('O runtime mudou enquanto a configuração aguardava. Confira o canal antes de repetir.')
      previous?.assertReconfigurationReady()
      return app.configurationChanges.execute(id,previous?.transport instanceof EngineTransport?previous.transport.processId():null,access.identity(reply.request)?.username??null,`${reply.request.method} ${reply.request.routeOptions.url}`,lease=>work(applyOutput,lease))
    }
    try { return await (previous?.transport instanceof EngineTransport ? previous.transport.mutateConfiguration(guarded) : guarded()) }
    catch (error) { if(error instanceof CollaborativeEditError)return reply.code(error.status).send(error.payload);return reply.code(409).send({ error: sanitizeDiagnostic(error instanceof Error ? error.message : 'Configuração não aplicada; confira a operação pendente.') }) }
  }
  // Called inside the old transport queue: old queued commands fail closed,
  // and the replacement restores the confirmed PGM rather than just its grade.
  const rebuildChannel = async (id: string, beforeCreate?: () => Promise<void>,checkpointAlreadyHandled=false) => {
    // A runtime that never had a grade (channel created in this session) falls
    // back to the channel's first grade, exactly like startup.
    const previous = app.runtimes.get(id), rundownId = previous?.view?.rundown.id ?? (await listRundowns(app.db, id))[0]?.id ?? null
    if (previous) {
      if(!checkpointAlreadyHandled)previous.checkpoint(true)
      previous.close()
      app.runtimes.delete(id)
    }
    await beforeCreate?.()
    const runtime = await runtimeFor(app, id)
    const recoveryRequested = runtime ? await runtime.recoverCheckpoint() : false
    if (!recoveryRequested && runtime && rundownId && runtime.view?.rundown.id !== rundownId) await runtime.load(rundownId)
    return { controlledInterruption: Boolean(previous), recoveryRequested, recoveryError: runtime?.recoveryError ?? null }
  }
  server.addHook('preValidation', async (request, reply) => {
    if (!request.url.startsWith('/api')) return
    // Peer comparison accepts a redacted diagnostic snapshot, not decoder
    // configuration. It must remain byte-consistent with the public digest.
    if (request.url.split('?')[0] === '/api/n1/compare') return
    try { request.body = sourceWire().incoming(request.body, /^\/api\/(?:v1\/)?sources\/live(?:\/|\?|$)/.test(request.url)) }
    catch { return reply.code(400).send({ error: 'Referência de entrada inválida. Atualize a lista e selecione a fonte novamente; nenhum comando foi enviado.' }) }
  })
  server.addHook('preSerialization', async (request, _reply, payload) => request.url.startsWith('/api') ? sourceWire().publicValue(payload) : payload)
  const access = new AccessControl(app.sqlite)
  const assertTransportOwnership=(channelId:string)=>{
    try{
      if(app.mediamtx||app.hostFence){const global=app.distributionOwnership.status();if(global.blocked)throw new CollaborativeEditError(409,{error:global.message,distributionOwnershipBlocked:true,...(global.hostDistributionBlocked?{hostDistributionBlocked:true}:{})})}
      const status=app.executionOwnership.status(channelId)
      if(status.blocked)throw new CollaborativeEditError(409,{error:status.message??'A execução deste canal está protegida por outra instância ou ainda não tem parada comprovada.',executionOwnershipBlocked:true})
    }catch(error){
      if(error instanceof CollaborativeEditError)throw error
      throw new CollaborativeEditError(409,{error:'Registro de posse da execução inválido. Nenhum comando foi enviado; preserve o estado e confira a recuperação.',executionOwnershipBlocked:true})
    }
  }
  const assertEditorialAccess=(request:FastifyRequest,channelId:string)=>{
    if(access.required() && !access.identity(request) || !can(access.role(request),'PLAYLIST_EDIT') || !access.channelAllowed(request,channelId))throw new CollaborativeEditError(403,{error:'A sessão ou a permissão deste canal mudou; entre novamente antes de editar.'})
  }
  const assertConfigurationAccess=(request:FastifyRequest,channelId:string)=>{
    if(access.required()&&!access.identity(request) || !can(access.role(request),'OUTPUT_CONTROL') || !access.channelAllowed(request,channelId))throw new CollaborativeEditError(403,{error:'A sessão ou a permissão de configuração mudou; entre novamente antes de confirmar.'})
  }
  const assertQcAccess=(request:FastifyRequest,channelId:string|null,ownerId:string|null)=>{
    const identity=access.identity(request)
    if((identity?.id??null)!==ownerId || access.required()&&!identity || !can(access.role(request),'PLAYLIST_EDIT') ||
      (channelId===null ? identity?.channelIds!==undefined&&identity.channelIds!==null : !access.channelAllowed(request,channelId)))throw new CollaborativeEditError(403,{error:'A sessão ou a permissão de QC mudou; entre novamente antes de confirmar.'})
    if(channelId!==null && app.sqlite.prepare('SELECT 1 FROM channels WHERE id=? AND archived_at IS NOT NULL').get(channelId))throw new CollaborativeEditError(409,{error:'Canal arquivado: nenhuma decisão QC foi aplicada.'})
  }
  type EditorialTransaction=Parameters<Parameters<Db['transaction']>[0]>[0]
  const editItemAutomation=(request:FastifyRequest,itemId:string,kind:string,work:(tx:EditorialTransaction,state:NonNullable<ReturnType<typeof readEditorialState>>)=>Record<string,unknown>)=>{
    const owner=app.db.select().from(rundownItems).where(eq(rundownItems.id,itemId)).get()
    if(!owner)throw new CollaborativeEditError(404,{error:'Item não encontrado.'})
    return mutateEditorial(app.db,app.concurrency,owner.rundownId,request.headers['if-match'],(tx,state)=>{
      assertEditorialAccess(request,state.channel.id)
      auditChannels.set(request,[state.channel.id])
      const remember=app.history.prepareCapture(tx,state.rundown.id,kind,{itemIds:[itemId],itemAutomation:true})
      const details=work(tx,state)
      tx.insert(operatorDecisions).values({id:randomUUID(),rundownId:state.rundown.id,itemId,kind,payload:details,actorUsername:access.identity(request)?.username??null,createdAt:new Date().toISOString()}).run()
      return {value:{...readItemAutomationState(app.db,itemId)!,...details},remember}
    },itemId)
  }
  const automationError=(reply:any,error:unknown)=>{if(error instanceof CollaborativeEditError)return reply.code(error.status).send(error.payload);throw error}
  const authorizePublication=(request:FastifyRequest,review:OperationalReview)=>{
    if(access.required() && !access.identity(request) || !can(access.role(request),'PLAYLIST_PUBLISH') || !access.channelAllowed(request,review.channelId))throw new CollaborativeEditError(403,{error:'A sessão ou a permissão de publicação mudou; entre novamente antes de confirmar.'})
    if(review.rundownId!==(request.params as {id:string}).id)throw new CollaborativeEditError(409,{error:'A grade desta conferência mudou.'})
    requireEditorialRevision(app.concurrency,review.rundownId,request.headers['if-match'],review.editorialRevision)
    auditChannels.set(request,[review.channelId])
  }
  const authorizeScope=(request:FastifyRequest,owners:ScopeOwner[])=>{
    if(access.required() && !access.identity(request) || !can(access.role(request),'PLAYLIST_EDIT'))throw new CollaborativeEditError(403,{error:'A sessão ou a permissão mudou; entre novamente antes de editar.'})
    if(!owners.length)throw new CollaborativeEditError(409,{error:'Os vínculos dos itens mudaram; atualize a grade antes de repetir.'})
    if(owners.some(row=>!access.channelAllowed(request,row.channelId)))throw new CollaborativeEditError(403,{error:'Este escopo altera um canal não autorizado. Escolha somente este item ou esta grade.'})
    if(owners.some(row=>row.archivedAt))throw new CollaborativeEditError(409,{error:'Este escopo alcança uma grade arquivada. Escolha somente este item ou reative explicitamente o canal.'})
    const itemId=(request.params as {id:string}).id,source=owners.find(row=>row.itemId===itemId)
    if(!source)throw new CollaborativeEditError(409,{error:'A origem não pertence mais a este escopo.'})
    requireEditorialRevision(app.concurrency,source.rundownId,request.headers['if-match'],app.concurrency.getRundownVersion(source.rundownId),itemId)
  }
  const scopedEditGuard=(request:FastifyRequest,scope:EditScope,label:string,reviewToken?:string):ScopeGuard=>(db,targets)=>{
    const review=inspectEditScope(db,(request.params as {id:string}).id,scope,id=>app.concurrency.getRundownVersion(id),owners=>authorizeScope(request,owners))
    requireScopeReview(review,reviewToken)
    auditChannels.set(request,[...new Set(review.owners.map(row=>row.channelId))])
    return app.history.prepareCapture(db,targets.rundownId,label,{
      itemIds:scope==='ASSET_DEFAULT'?[targets.ids[0]!]:targets.ids,
      assetIds:scope==='ASSET_DEFAULT' && targets.mediaId?[targets.mediaId]:[],
    })
  }
  const historyGuard=(request:FastifyRequest):HistoryGuard=>(db,footprint)=>{
    if(access.required() && !access.identity(request) || !can(access.role(request),'PLAYLIST_EDIT'))throw new CollaborativeEditError(403,{error:'A sessão ou a permissão mudou; entre novamente antes de desfazer.'})
    if(footprint.deviceAutomation&&!can(access.role(request),'OUTPUT_CONTROL'))throw new CollaborativeEditError(403,{error:'Desfazer/refazer automação de equipamento exige permissão atual de controle de saídas.'})
    const sourceId=(request.params as {id:string}).id
    requireEditorialRevision(app.concurrency,sourceId,request.headers['if-match'],app.concurrency.getRundownVersion(sourceId))
    const references=db.select({rundownId:rundownItems.rundownId}).from(rundownItems)
      .where(or(inArray(rundownItems.id,footprint.itemIds),inArray(rundownItems.mediaId,footprint.assetIds))).all()
    const ids=[...new Set([...footprint.rundownIds,...references.map(row=>row.rundownId)])]
    const owners=db.select({id:rundowns.id,channelId:rundowns.channelId,archivedAt:channels.archivedAt}).from(rundowns)
      .innerJoin(channels,eq(channels.id,rundowns.channelId)).where(inArray(rundowns.id,ids)).all()
    if(owners.length!==ids.length)throw new CollaborativeEditError(409,{error:'O histórico alcança uma grade que não existe mais. Nenhum item foi restaurado.'})
    if(owners.some(row=>!access.channelAllowed(request,row.channelId)))throw new CollaborativeEditError(403,{error:'Este desfazer/refazer alcança um canal não autorizado. Peça a um operador com acesso a todos os canais afetados.'})
    if(owners.some(row=>row.archivedAt))throw new CollaborativeEditError(409,{error:'Este desfazer/refazer alcança uma grade arquivada. Reative o canal antes de restaurar os dados.'})
    if(footprint.wholeRundownId)for(const runtime of app.runtimes.values()){
      const onAir=runtime.transport.state().onAir?.itemId
      if(onAir && db.select({id:rundownItems.id}).from(rundownItems).where(and(eq(rundownItems.id,onAir),eq(rundownItems.rundownId,footprint.wholeRundownId))).get() && !footprint.restoredItemIds?.includes(onAir))throw new CollaborativeEditError(409,{error:'Desfazer/refazer removeria o item no ar. Pare o canal antes de restaurar essa operação; o PGM foi preservado.'})
    }
    auditChannels.set(request,[...new Set(owners.map(row=>row.channelId))])
  }
  const securityAudit = (kind: string, actor: string | null, details: Record<string, unknown>) => logDecision(app, '@security', null, kind, details, actor)
  const configurationAudit = (request: any, channelId: string, kind: string, details: Record<string, unknown>) => securityAudit(kind, access.identity(request)?.username ?? null, { channelId, ...details })
  const origins=parseAllowedOrigins(process.env.RPLAYOUT_ALLOWED_ORIGINS)
  const publicPaths = new Set(['/api/session', '/api/auth/login', '/api/auth/logout', '/api/health'])
  const servicePaths = new Set(['/api/external/control', '/api/v1/external/control', '/api/n1/state', '/api/n1/compare'])
  server.addHook('onRequest', async (request, reply) => {
    const path = request.url.split('?')[0]!
    if (!path.startsWith('/api') && path !== '/ws') return
    if(!databaseStorageStatus(app.sqlite).connected)return reply.code(503).header('Cache-Control','private, no-store').send({error:'STORAGE_UNAVAILABLE',message:'Banco operacional indisponível. Controle bloqueado; nenhum comando será repetido automaticamente. Confira o servidor.'})
    if (!trustedOrigin(request.headers.origin, request.headers.host, origins)) return reply.code(403).send({ error: 'Esta origem não está autorizada a acessar o playout. Abra a página no endereço do servidor.' })
    if(isRecoveryRehearsal(app.sqlite)&&!rehearsalRequestAllowed(request.method,path))return reply.code(409).send({error:'RESTORED_REHEARSAL',message:'Cópia restaurada em conferência: mudanças e execução bloqueadas. Isso não autoriza promoção do canal.'})
    if(path==='/api/ha/replica'||path==='/api/ha/media'||path==='/api/ha/return'){
      if(request.method!=='POST'||!app.ha?.authenticate(request.headers,path==='/api/ha/return'?'RETURN':path==='/api/ha/media'?'MEDIA':'STATE'))return reply.code(403).send({error:'Pareamento HA não autorizado.'})
      return
    }
    if(app.ha?.options.role==='STANDBY'&&!['GET','HEAD','OPTIONS'].includes(request.method)&&!haReturnWritePaths.has(path)&&!['/api/auth/login','/api/auth/logout','/api/ha/rehearsal','/api/ha/rehearsal/reconcile','/api/ha/bindings','/api/ha/prepare','/api/ha/executions/monitor','/api/ha/executions/control','/api/ha/executions/control/review','/api/ha/executions/stop','/api/ha/executions/export','/api/ha/executions/return-send','/api/ha/executions/return-inspect'].includes(path))return reply.code(409).send({error:'Nó reserva: operação local bloqueada. Espelhar não autoriza assumir o PGM.'})
    if (publicPaths.has(path) || !access.required() || access.identity(request)) return
    const bearer = request.headers.authorization?.replace(/^Bearer /i, '') ?? request.headers['x-rplayout-control-token'] ?? ''
    if (servicePaths.has(path) && EXTERNAL_CONTROL_TOKEN && typeof bearer === 'string' && secretEquals(bearer, EXTERNAL_CONTROL_TOKEN)) return
    return reply.code(401).send({ error: 'Entre com usuário e senha. A sessão expirou, foi revogada ou a conta está desativada.' })
  })
  const unauditedHeartbeats=new Set(['/api/channels/:id/watching'])
  server.addHook('onResponse', async (request, reply) => {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method) || !request.url.startsWith('/api') || request.url.startsWith('/api/auth/')) return
    // Monitor keep-alive is a heartbeat every few seconds per open window, not
    // an operation. Auditing it wrote one encrypted row per beat and, with the
    // monitors open, kept the server thread busy on storage.
    if (request.routeOptions.url && unauditedHeartbeats.has(request.routeOptions.url)) return
    // Record route/actor/result, never request bodies or credential-bearing URLs.
    // The domain decision/as-run remains the detailed operational record.
    try { await logDecision(app, '@http', null, 'API_MUTATION', { requestId: request.id, method: request.method, route: request.routeOptions.url, status: reply.statusCode, station: request.ip,channelIds:auditChannels.get(request) ?? [] }, access.identity(request)?.username ?? null) }
    catch (error) { server.log.error({ err: error }, 'Falha ao persistir auditoria da requisição') }
  })
  const sharedReads = new Set(['/api/state', '/api/session', '/api/health', '/api/library', '/api/assets', '/api/categories', '/api/library/scan', '/api/library/roots', '/api/library/roots/browse', '/api/sources', '/api/media/jobs', '/api/srt/telemetry', '/api/v1/srt/telemetry'])
  sharedReads.add('/api/channels/archived')
  sharedReads.add('/api/categories/:id/review')
  sharedReads.add('/api/scheduler/status') // Its collection is filtered per authorized channel.
  sharedReads.add('/api/health-events') // Visibility is enforced before the query limit.
  sharedReads.add('/api/health-events.csv')
  sharedReads.add('/api/distribution/execution-ownership') // Generic status only, no paths/process IDs.
  sharedReads.add('/api/ha/binding-channels') // Filtered by channel authorization before response.
  const channelParameterRoutes = new Set(['/api/library', '/api/health-events', '/api/health-events.csv', '/api/sources/live', '/api/v1/sources/live', '/api/multiview/config', '/api/v1/multiview/config', '/api/v1/engineering/pgm-probe/status', '/api/v1/engineering/pgm-probe/emergency-slate', '/api/v1/engineering/pgm-probe/policy', '/api/v1/continuity/cache/status', '/api/v1/cache/status', '/api/v1/continuity/cache/warm', '/api/v1/cache/prewarm'])
  channelParameterRoutes.add('/api/integrations')
  channelParameterRoutes.add('/api/ha/bindings')
  channelParameterRoutes.add('/api/ha/prepare')
  channelParameterRoutes.add('/api/ha/executions')
  channelParameterRoutes.add('/api/ha/executions/monitor')
  channelParameterRoutes.add('/api/ha/executions/control')
  channelParameterRoutes.add('/api/ha/executions/control/review')
  channelParameterRoutes.add('/api/ha/executions/stop')
  channelParameterRoutes.add('/api/ha/executions/stop-review')
  channelParameterRoutes.add('/api/ha/executions/return-review')
  channelParameterRoutes.add('/api/ha/executions/export')
  channelParameterRoutes.add('/api/ha/executions/return-send')
  channelParameterRoutes.add('/api/ha/executions/return-inspect')
  channelParameterRoutes.add('/api/ha/executions/return-resume')
  channelParameterRoutes.add('/api/ha/returns')
  channelParameterRoutes.add('/api/ha/returns/review')
  channelParameterRoutes.add('/api/ha/returns/history')
  channelParameterRoutes.add('/api/ha/returns/variants')
  channelParameterRoutes.add('/api/ha/returns/rekey')
  channelParameterRoutes.add('/api/ha/returns/selection')
  channelParameterRoutes.add('/api/ha/returns/candidate')
  channelParameterRoutes.add('/api/ha/returns/bindings')
  channelParameterRoutes.add('/api/ha/returns/application')
  channelParameterRoutes.add('/api/ha/returns/media-review')
  channelParameterRoutes.add('/api/ha/returns/media-options')
  channelParameterRoutes.add('/api/ha/returns/media-application')
  channelParameterRoutes.add('/api/ha/returns/job-recovery')
  channelParameterRoutes.add('/api/ha/returns/pending-jobs')
  channelParameterRoutes.add('/api/ha/returns/history-job')
  haQuarantineWrites.add('/api/ha/returns/job-recovery')
  channelParameterRoutes.add('/api/ha/returns/auto-options')
  channelParameterRoutes.add('/api/ha/returns/auto-decision')
  channelParameterRoutes.add('/api/ha/returns/postgain-review')
  channelParameterRoutes.add('/api/ha/returns/bus-review')
  channelParameterRoutes.add('/api/sources')
  channelParameterRoutes.add('/api/integrations/review')
  channelParameterRoutes.add('/api/audit')
  channelParameterRoutes.add('/api/integration-deliveries')
  channelParameterRoutes.add('/api/graphics')
  channelParameterRoutes.add('/api/graphics/review')
  sharedReads.add('/api/graphics/review') // Only global templates without a channel parameter.
  channelParameterRoutes.add('/api/v1/engineering/pgm-probe/contingency-loop')
  for (const route of ['/api/v1/graphics/layers','/api/v1/graphics/layers/:layer/trigger','/api/v1/scte/splice-insert']) channelParameterRoutes.add(route)
  server.addHook('preHandler', async (request, reply) => {
    const identity = access.identity(request)
    const path = request.url.split('?')[0]!, params = request.params as Record<string, string> | undefined
    const query = request.query as Record<string, unknown> | undefined, body = request.body as Record<string, unknown> | undefined
    const channelIds = new Set<string>()
    for (const value of [query?.channelId, body?.channelId]) if (typeof value === 'string') channelIds.add(value)
    const route = request.routeOptions.url ?? ''
    const scopedRoute = channelParameterRoutes.has(path) || channelParameterRoutes.has(route) || route === '/api/assets/:id/qc' || /^\/api\/(?:v1\/)?(channels\/:id|rules\/:id|rundowns\/:id|items\/:id|sources\/live\/:id|outputs\/:id|health-events\/:id|integrations\/:id|integration-deliveries\/:id|item-graphics\/:id|graphics\/:id|guests\/:id|destinations\/:id|blocks\/:blockId|timeline\/:rundownId|tenants\/:tenantId\/channels\/:channelId)(?:\/|$)/.test(route)
    if (/^\/api\/(?:v1\/)?channels\/:id(?:\/|$)/.test(route) && params?.id) channelIds.add(params.id)
    const lookup = (sql: string, id: unknown) => {
      if (typeof id !== 'string') return
      const rows = app.sqlite.prepare(sql).all(id) as { channelId: string | null }[]
      for (const row of rows) if (row.channelId) channelIds.add(row.channelId)
    }
    if (/^\/api\/(?:v1\/)?rundowns\/:id(?:\/|$)/.test(route)) lookup('SELECT channel_id AS channelId FROM rundowns WHERE id=?', params?.id)
    if (/^\/api\/(?:v1\/)?items\/:id(?:\/|$)/.test(route)) lookup('SELECT r.channel_id AS channelId FROM rundown_items i JOIN rundowns r ON r.id=i.rundown_id WHERE i.id=?', params?.id)
    for (const value of [body?.rundownId, body?.copyFromRundownId, query?.rundownId, params?.rundownId]) lookup('SELECT channel_id AS channelId FROM rundowns WHERE id=?', value)
    for (const value of [body?.itemId, params?.itemId]) lookup('SELECT r.channel_id AS channelId FROM rundown_items i JOIN rundowns r ON r.id=i.rundown_id WHERE i.id=?', value)
    if (route.startsWith('/api/v1/tenants/:tenantId/channels/:channelId/') && params?.channelId) channelIds.add(params.channelId)
    if (route.startsWith('/api/item-graphics/:id')) lookup('SELECT r.channel_id AS channelId FROM item_graphics g JOIN rundown_items i ON i.id=g.item_id JOIN rundowns r ON r.id=i.rundown_id WHERE g.id=?', params?.id)
    if (route.startsWith('/api/blocks/:blockId')) lookup('SELECT DISTINCT r.channel_id AS channelId FROM rundown_items i JOIN rundowns r ON r.id=i.rundown_id WHERE i.block_id=?', params?.blockId)
    if (route.startsWith('/api/guests/:id')) lookup('SELECT channel_id AS channelId FROM guest_keys WHERE id=?', params?.id)
    if (route.startsWith('/api/destinations/:id')) lookup('SELECT channel_id AS channelId FROM destinations WHERE id=?', params?.id)
    const templateTarget = route.startsWith('/api/graphics/:id') && params?.id
      ? app.sqlite.prepare('SELECT channel_id AS channelId FROM graphic_templates WHERE id=?').get(params.id) as {channelId:string|null}|undefined : undefined
    if (templateTarget?.channelId) channelIds.add(templateTarget.channelId)
    // A global template may be used on any authorized channel, not rewritten
    // or moved into one by spoofing a channel in the query/body.
    lookup('SELECT channel_id AS channelId FROM graphic_templates WHERE id=?', body?.templateId)
    const sharedTemplateMutation = !['GET','HEAD','OPTIONS'].includes(request.method) &&
      ((route === '/api/graphics' && typeof body?.channelId !== 'string') ||
       (route === '/api/graphics/:id' && (templateTarget?.channelId === null || body?.channelId === null)))
    if (/^\/api\/(?:v1\/)?sources\/live\/:id/.test(route)) lookup('SELECT channel_id AS channelId FROM live_sources WHERE id=?', params?.id)
    if (route.startsWith('/api/outputs/:id')) lookup('SELECT channel_id AS channelId FROM output_profiles WHERE id=?', params?.id)
    if (route.startsWith('/api/rules/:id')) lookup('SELECT channel_id AS channelId FROM schedule_rules WHERE id=?',params?.id)
    if (route.startsWith('/api/health-events/:id')) lookup('SELECT channel_id AS channelId FROM health_events WHERE id=?', params?.id)
    if (route.startsWith('/api/integrations/:id')) lookup('SELECT channel_id AS channelId FROM integrations WHERE id=?',params?.id)
    if (route.startsWith('/api/integration-deliveries/:id')) lookup('SELECT channel_id AS channelId FROM integration_deliveries WHERE id=?',params?.id)
    auditChannels.set(request,[...channelIds])
    if (identity?.channelIds && [...channelIds].some(id => !identity.channelIds!.includes(id))) return reply.code(403).send({error:'Sua conta não pode acessar este canal.'})
    if (!['GET','HEAD','OPTIONS'].includes(request.method) && !haReturnWritePaths.has(route) && !haQuarantineWrites.has(route) && route!=='/api/ha/bindings' && route!=='/api/ha/prepare' && route!=='/api/ha/executions/monitor' && route!=='/api/ha/executions/control' && route!=='/api/ha/executions/control/review' && route!=='/api/ha/executions/stop' && route!=='/api/ha/executions/export' && route!=='/api/ha/executions/return-send' && route!=='/api/ha/executions/return-inspect' && route!=='/api/channels/:id/reactivate' && !(route==='/api/channels/:id' && request.method==='DELETE')) {
      for (const channelId of channelIds) {
        if (app.sqlite.prepare('SELECT 1 FROM channels WHERE id=? AND archived_at IS NOT NULL').get(channelId)) return reply.code(409).send({error:'Este canal está arquivado e disponível somente para histórico. Reative-o explicitamente antes de editar ou comandar a operação.'})
      }
    }
    // Grade espelhada: o conteúdo vem do canal de origem; editar aqui seria
    // sobrescrito na próxima publicação de lá.
    if (!['GET','HEAD','OPTIONS'].includes(request.method) && route!=='/api/rundowns/:id/operational-publish' && /^\/api\/(rundowns\/:id|items\/:id|blocks\/:blockId)(?:\/|$)/.test(route)) {
      const touched=new Set<string>()
      if(route.startsWith('/api/rundowns/:id')&&params?.id)touched.add(params.id)
      if(route.startsWith('/api/items/:id')&&params?.id)for(const row of app.sqlite.prepare('SELECT rundown_id AS id FROM rundown_items WHERE id=?').all(params.id) as {id:string}[])touched.add(row.id)
      if(route.startsWith('/api/blocks/:blockId')&&params?.blockId)for(const row of app.sqlite.prepare('SELECT DISTINCT rundown_id AS id FROM rundown_items WHERE block_id=?').all(params.blockId) as {id:string}[])touched.add(row.id)
      if([...touched].some(id=>isActiveMirrorRundown(app.db,id)))return reply.code(409).send({error:'Esta grade espelha outro canal. Edite no canal de origem ou desligue o espelho em Configurações › Canais.'})
    }
    if (!identity || identity.channelIds === null) return
    if (sharedTemplateMutation) return reply.code(403).send({error:'Sua conta pode usar grafismos compartilhados, mas não editar, remover ou compartilhar estes modelos.'})
    const scopedTransaction=route==='/api/items/:id/trim' || route==='/api/items/:id/audio'
    if (scopedRoute && channelIds.size && [...channelIds].every(id => identity.channelIds!.includes(id)) && (scopedTransaction || !['ALL_RUNDOWNS', 'ASSET_DEFAULT'].includes(String(body?.scope)))) return
    // Parameterized read-only entries must match the registered route too.
    // Global writes and channel-bound reads keep the earlier scope checks.
    if (!channelIds.size && (request.method === 'GET' || request.method === 'HEAD') && (path==='/api/audit' || path==='/api/graphics' || sharedReads.has(path) || sharedReads.has(route) || /^\/api\/assets\/[^/]+\/(thumbnail\.svg|file|media|workflow|frame\/|metadata-review$)/.test(path))) return
    if (path === '/api/auth/logout' || path === '/api/auth/login' || path === '/ws') return
    return reply.code(403).send({ error: 'Sua conta não pode acessar este canal ou alterar configurações compartilhadas. Peça ao administrador para revisar os canais permitidos.' })
  })
  const roleOf = async (request: { headers: Record<string, string | string[] | undefined> }) => access.role(request)
  server.addHook('preHandler',async(request,reply)=>{
    if(!(app.mediamtx||app.hostFence)||['GET','HEAD','OPTIONS'].includes(request.method)||!can(access.role(request),'OUTPUT_CONTROL'))return
    const route=request.routeOptions.url??''
    const distributionMutation=route==='/api/channels'||route==='/api/channels/:id'||
      /^\/api\/channels\/:id\/(guests|destinations|outputs|reactivate|archive)(?:\/|$)/.test(route)||
      /^\/api\/(guests|destinations|outputs)\/:id(?:\/|$)/.test(route)||
      /^\/api\/channels\/:id\/projects\/[^/]+\/restore$/.test(route)||
      /^\/api\/channels\/:id\/transmission-presets\/[^/]+\/apply$/.test(route)
    if(!distributionMutation)return
    try{app.distributionOwnership.claim();app.distributionOwnership.assertOwned()}
    catch(error){return reply.code(409).send(error instanceof CollaborativeEditError?error.payload:{error:'Posse da distribuição inválida; nenhum recurso foi alterado.',distributionOwnershipBlocked:true})}
  })
  const usernameOf = async (request: { headers: Record<string, string | string[] | undefined> }): Promise<string | null> => {
    return access.identity(request)?.username ?? null
  }
  const allowed = async (request: { headers: Record<string, string | string[] | undefined> }, action: Action): Promise<boolean> =>
    (!access.required() || access.identity(request) !== null) && can(await roleOf(request), action)

  server.get('/api/session', async (request) => {
    const role = await roleOf(request)
    const authenticated = (await usernameOf(request)) !== null
    return { role, label: roleLabel(role), authenticated, required: access.required() }
  })
  const loginAttempts = new Map<string, { count: number; until: number }>()
  server.post('/api/auth/login', async (request, reply) => {
    const attempt = loginAttempts.get(request.ip)
    if (attempt && attempt.until > Date.now() && attempt.count >= 10) return reply.header('retry-after', String(Math.ceil((attempt.until - Date.now()) / 1000))).code(429).send({ error: 'Muitas tentativas. Aguarde antes de tentar entrar novamente.' })
    if (loginAttempts.size > 1000) for (const [ip, entry] of loginAttempts) { if (entry.until <= Date.now()) loginAttempts.delete(ip) }
    if (loginAttempts.size > 2000 && !attempt) return reply.code(429).send({ error: 'Limite de tentativas de login atingido.' })
    loginAttempts.set(request.ip, attempt && attempt.until > Date.now() ? { ...attempt, count: attempt.count + 1 } : { count: 1, until: Date.now() + 900_000 })
    const body = z.object({ username: z.string().min(1).max(80), password: z.string().min(1).max(1024) }).strict().safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: 'Informe usuário e senha.' })
    let [user] = await app.db.select().from(users).where(eq(users.username, body.data.username)).limit(1)
    if (!user && AUTH_USER && AUTH_PASSWORD && body.data.username === AUTH_USER && secretEquals(body.data.password, AUTH_PASSWORD)) {
      const passwordHash=await hashPassword(AUTH_PASSWORD)
      try {user=bootstrapConfiguredAccount(app.db,AUTH_USER,passwordHash,request.ip)}
      catch(error){return automationError(reply,error)}
    }
    if (!user || !user.enabled || parseRole(user.role)==='DENIED' || !(await verifyPassword(body.data.password, user.passwordHash))) {
      await securityAudit('LOGIN_FAILED', null, { username: body.data.username, station: request.ip })
      return reply.code(401).send({ error: 'Usuário ou senha inválidos.' })
    }
    let issued:ReturnType<typeof issueLoginSession>
    try{issued=issueLoginSession(app.db,user,request.ip)}catch(error){
      if(error instanceof CollaborativeEditError)return reply.code(error.status).send(error.payload)
      throw error
    }
    loginAttempts.delete(request.ip)
    const secure = request.protocol === 'https' || process.env.RPLAYOUT_SECURE_COOKIES === '1' ? '; Secure' : ''
    return reply.header('set-cookie', `rplayout_session=${issued.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${secure}`).send({ role: issued.role, label: roleLabel(issued.role) })
  })
  server.post('/api/auth/logout', async (request, reply) => {
    const result=logoutAccount(app.db,request)
    return reply.header('set-cookie', 'rplayout_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0').send(result)
  })
  const accountCatalogHandler=async(request:FastifyRequest,reply:any)=>{
    try {const review=readAccountCatalog(app.db,captureAccountAuthority(app.db,request));return reply.header('Cache-Control','private, no-store').header('ETag',accountCatalogETag(review)).send(review)}
    catch(error){return automationError(reply,error)}
  }
  server.get('/api/users',accountCatalogHandler)
  server.get('/api/users/review',accountCatalogHandler)
  server.get('/api/users/:id/sessions', async (request, reply) => {
    const { id } = request.params as { id: string }
    try {const review=readAccountSessions(app.db,id,captureAccountAuthority(app.db,request));return reply.header('Cache-Control','private, no-store').header('ETag',accountSessionsETag(review)).send(review)}
    catch(error){return automationError(reply,error)}
  })
  server.delete('/api/users/:id/sessions', async (request, reply) => {
    const { id } = request.params as { id: string }
    try {const result=revokeAccountSessions(app.db,id,request.headers['if-match'],captureAccountAuthority(app.db,request));return reply.header('Cache-Control','private, no-store').header('ETag',result.eTag).send(result)}
    catch(error){return automationError(reply,error)}
  })
  server.get('/api/audit', async (request, reply) => {
    reply.header('Cache-Control','private, no-store')
    if (!(await allowed(request, 'REPORT_EXPORT'))) return reply.code(403).send({ error: 'Sem permissão para consultar auditoria.' })
    const query = request.query as { limit?: string;channelId?:string }
    const limit = Math.min(1000, Math.max(1, Math.trunc(Number(query.limit ?? 200) || 200)))
    const identity=access.identity(request)
    const entries=await readAudit(app.db,{channelId:query.channelId,channelIds:identity?.channelIds ?? null,globalAdmin:access.role(request)==='ADMIN'},limit)
    return { entries }
  })
  server.get('/api/health-events', async (request, reply) => {
    if (!(await allowed(request, 'REPORT_EXPORT'))) return reply.code(403).send({ error: 'Sem permissão para consultar saúde.' })
    const query = request.query as Omit<IncidentPageQuery,'limit'> & {limit?:string}
    try{return reply.header('Cache-Control','private, no-store').send(readHealthIncidentPage(app.db,access.identity(request)?.channelIds??null,{...query,limit:Number(query.limit??200)}))}
    catch(error){if(error instanceof IncidentError)return reply.code(error.status).send({error:error.message});throw error}
  })
  server.get('/api/health-events.csv', async (request, reply) => {
    if (!(await allowed(request, 'REPORT_EXPORT'))) return reply.code(403).send({ error: 'Sem permissão para exportar saúde.' })
    const query = request.query as { channelId?: string; since?: string }
    const filtered=readHealthIncidents(app.db,access.identity(request)?.channelIds??null,query.channelId,10000,query.since)
    void reply.header('Cache-Control','private, no-store')
    const quote = (value: unknown): string => `"${String(value ?? '').replace(/"/g, '""')}"`
    const csv = ['horário;canal;componente;estado;severidade;mensagem;reconhecido;recuperado;observação encerrada', ...filtered.map((row) => [row.occurredAt, row.channelId, row.component, row.state, row.severity, row.message, row.acknowledgedAt,row.resolvedAt,row.observationEndedAt].map(quote).join(';'))].join('\n')
    void reply.header('content-type', 'text/csv; charset=utf-8')
    void reply.header('content-disposition', 'attachment; filename="rplayout-saude.csv"')
    return csv
  })
  server.post('/api/health-events/:id/ack', async (request, reply) => {
    if (!(await allowed(request, 'CHANNEL_STOP'))) return reply.code(403).send({ error: 'Supervisor precisa reconhecer alertas.' })
    const { id } = request.params as { id: string }
    try{
      const result=acknowledgeHealthIncident(app.db,id,()=>({actor:access.identity(request)?.username??null,channelIds:access.identity(request)?.channelIds??null,canAcknowledge:can(access.role(request),'CHANNEL_STOP')}))
      return reply.header('Cache-Control','private, no-store').send(result)
    }catch(error){if(error instanceof IncidentError)return reply.code(error.status).send({error:error.message});return reply.code(409).send({error:'Alerta não reconhecido; registro de auditoria indisponível. Tente novamente.'})}
  })
  const integrationResult=(reply:import('fastify').FastifyReply,work:()=>unknown)=>{try{return work()}catch(error){if(error instanceof CollaborativeEditError)return reply.code(error.status).send(error.payload);return reply.code(409).send({error:'Integração não alterada/agendada; conferência ou auditoria indisponível.'})}}
  server.get('/api/integrations/review',async(request,reply)=>integrationResult(reply,()=>{const channelId=(request.query as {channelId?:string}).channelId??null;const review=readIntegrationCatalog(app.db,channelId,integrationAuthority(app.db,request));return reply.header('cache-control','private, no-store').header('etag',integrationCatalogETag(review)).send(review)}))
  server.get('/api/integrations/:id/review',async(request,reply)=>integrationResult(reply,()=>{const review=readIntegration(app.db,(request.params as {id:string}).id,integrationAuthority(app.db,request));return reply.header('cache-control','private, no-store').header('etag',integrationETag(review)).send(review)}))
  server.get('/api/integration-deliveries/:id/review',async(request,reply)=>integrationResult(reply,()=>{const review=readIntegrationDelivery(app.db,(request.params as {id:string}).id,integrationAuthority(app.db,request));return reply.header('cache-control','private, no-store').header('etag',integrationDeliveryETag(review)).send(review)}))
  server.get('/api/integrations', async (request, reply) => {
    if (!(await allowed(request, 'OUTPUT_CONTROL'))) return reply.code(403).send({ error: 'Sem permissão para integrações.' })
    const { channelId } = request.query as { channelId?: string }
    const rows = await app.db.select().from(integrations)
    return { integrations: (channelId ? rows.filter((row) => row.channelId === channelId || row.channelId === null) : rows).map(publicIntegration) }
  })
  server.post('/api/integrations', async (request, reply) => {
    return integrationResult(reply,()=>createIntegration(app.db,request.body,request.headers['if-match'],integrationAuthority(app.db,request)))
  })
  server.patch('/api/integrations/:id', async (request, reply) => {
    return integrationResult(reply,()=>updateIntegration(app.db,(request.params as {id:string}).id,request.body,request.headers['if-match'],integrationAuthority(app.db,request)))
  })
  server.post('/api/integrations/:id/test', async (request, reply) => {
    return integrationResult(reply,()=>queueIntegrationTest(app.db,(request.params as {id:string}).id,request.body,request.headers['if-match'],integrationAuthority(app.db,request)))
  })
  server.get('/api/integration-deliveries',async (request,reply) => {
    return integrationResult(reply,()=>reply.header('cache-control','private, no-store').send(readIntegrationDeliveries(app.db,(request.query as {channelId?:string}).channelId??null,integrationAuthority(app.db,request))))
  })
  server.post('/api/integration-deliveries/:id/retry',async (request,reply) => {
    return integrationResult(reply,()=>retryIntegrationDelivery(app.db,(request.params as {id:string}).id,request.body,request.headers['if-match'],integrationAuthority(app.db,request)))
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
    const body = createAccountBody.safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: 'Informe usuário, senha com 8 caracteres e papel.' })
    const authority=captureAccountAuthority(app.db,request)
    try {
      checkCreateAccountReview(app.db,request.headers['if-match'],authority)
      const passwordHash=await hashPassword(body.data.password)
      const result=createAccount(app.db,body.data,passwordHash,request.headers['if-match'],authority)
      return reply.header('Cache-Control','private, no-store').header('ETag',result.eTag).send(result)
    } catch(error){return automationError(reply,error)}
  })
  server.patch('/api/users/:id', async (request, reply) => {
    const body = updateAccountBody.safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: 'Alteração inválida.' })
    const { id } = request.params as { id: string }
    const authority=captureAccountAuthority(app.db,request)
    try {
      checkUpdateAccountReview(app.db,id,request.headers['if-match'],authority)
      const passwordHash=body.data.password?await hashPassword(body.data.password):undefined
      const result=updateAccount(app.db,id,body.data,passwordHash,request.headers['if-match'],authority)
      return reply.header('Cache-Control','private, no-store').header('ETag',result.eTag).send(result)
    } catch(error){return automationError(reply,error)}
  })
  server.put('/api/users/:id/access', async (request, reply) => {
    const {id}=request.params as {id:string}
    try {const result=changeAccountAccess(app.db,id,request.body,request.headers['if-match'],captureAccountAuthority(app.db,request));return reply.header('Cache-Control','private, no-store').header('ETag',result.eTag).send(result)}
    catch(error){return automationError(reply,error)}
  })
  server.get('/api/health', async () => ({
    ok: true,
    uptimeSeconds: Math.floor(process.uptime()),
    channels: app.runtimes.size,
    engines: [...app.runtimes.values()].filter((runtime) => runtime.transport instanceof EngineTransport && runtime.transport.health().ready).length,
    nativeEngines: [...app.runtimes.values()].filter((runtime) => runtime.transport instanceof EngineTransport).length,
    simulatedChannels: [...app.runtimes.values()].filter((runtime) => !(runtime.transport instanceof EngineTransport)).length,
    mediamtx: app.mediamtx ? (app.mediamtx.running ? 'running' : 'stopped') : 'disabled',
    checkedAt: new Date().toISOString(),
  }))
  server.get('/api/n1/status', async () => probeN1Peer(N1_PEER_URL || null, EXTERNAL_CONTROL_TOKEN))
  server.get('/api/ha/status',async(request,reply)=>{
    if(!(await allowed(request,'OUTPUT_CONTROL')))return reply.code(403).send({error:'Sem permissão para consultar redundância.'})
    reply.header('Cache-Control','private, no-store')
    return app.ha?.status()??{configured:false,failoverReady:false,automaticTake:false,reason:'HA não configurada; heartbeat N+1 não replica a operação.'}
  })
  server.post('/api/ha/replica',{bodyLimit:48*1024*1024},async(request,reply)=>{
    try{reply.header('Cache-Control','private, no-store');return app.ha!.receive(request.body,request.headers)}
    catch(error){return reply.code(error instanceof HaError?error.status:400).send({error:error instanceof HaError?error.message:'Snapshot HA inválido. Nenhum estado local foi instalado.'})}
  })
  server.get('/api/ha/returns/candidate',async(request,reply)=>{
    const body=z.object({candidateId:z.string().uuid(),channelId:z.string().min(1).max(128)}).strict().safeParse(request.query)
    if(!body.success)return reply.code(400).send({error:'Informe candidato e canal.'})
    reply.header('Cache-Control','private, no-store')
    try{bindingAccess(request,body.data.channelId);if(!app.ha)throw new Error();return app.ha.queryReturnCandidate(body.data.candidateId,body.data.channelId)}catch(error){return reply.code(error instanceof HaBindingError?error.status:409).send({error:'Candidato não confirmado; nenhuma criação repetida.'})}
  })
  server.post('/api/ha/returns/candidate',async(request,reply)=>{
    const body=haReturnCandidateRequest.safeParse(request.body)
    if(!body.success)return reply.code(400).send({error:'Informe candidato, seleção e canal.'})
    const actorId=access.identity(request)?.id??null
    const authorize=()=>{bindingAccess(request,body.data.channelId);if(!can(access.role(request),'TRANSPORT')||(access.identity(request)?.id??null)!==actorId)throw new HaBindingError(403,'Permissão/sessão mudou durante criação do candidato.')}
    reply.header('Cache-Control','private, no-store')
    try{authorize();if(!app.ha)throw new Error();auditChannels.set(request,[body.data.channelId]);return await app.ha.stageReturnCandidate(body.data,authorize)}catch(error){return reply.code(error instanceof HaBindingError?error.status:409).send({error:'Candidato não confirmado; consulte sem repetir. Banco ativo e PGM preservados.'})}
  })
  server.get('/api/ha/returns/selection',async(request,reply)=>{
    const body=z.object({planId:z.string().uuid(),channelId:z.string().min(1).max(128)}).strict().safeParse(request.query)
    if(!body.success)return reply.code(400).send({error:'Informe seleção e canal.'})
    reply.header('Cache-Control','private, no-store')
    try{bindingAccess(request,body.data.channelId);if(!app.ha)throw new Error();return app.ha.queryReturnSelection(body.data.planId,body.data.channelId)}catch(error){return reply.code(error instanceof HaBindingError?error.status:409).send({error:'Seleção não confirmada neste canal; nenhuma operação iniciada.'})}
  })
  server.post('/api/ha/returns/selection',async(request,reply)=>{
    const body=haReturnSelectionRequest.safeParse(request.body)
    if(!body.success)return reply.code(400).send({error:'Informe revisão, edições, cursor e justificativa da seleção.'})
    const actorId=access.identity(request)?.id??null,actor=access.identity(request)?.username??'local-admin'
    const authorize=()=>{bindingAccess(request,body.data.channelId);if(!can(access.role(request),'TRANSPORT')||(access.identity(request)?.id??null)!==actorId)throw new HaBindingError(403,'Permissão/sessão mudou durante seleção.')}
    reply.header('Cache-Control','private, no-store')
    try{authorize();if(!app.ha)throw new Error();auditChannels.set(request,[body.data.channelId]);return app.ha.selectReturn(body.data,authorize,actor)}catch(error){return reply.code(error instanceof HaBindingError?error.status:409).send({error:'Seleção não confirmada; consulte sem repetir. Banco ativo e PGM preservados.'})}
  })
  server.get('/api/ha/returns/rekey',async(request,reply)=>{
    const body=z.object({rekeyId:z.string().uuid(),channelId:z.string().min(1).max(128)}).strict().safeParse(request.query)
    if(!body.success)return reply.code(400).send({error:'Informe reproteção e canal.'})
    reply.header('Cache-Control','private, no-store')
    try{bindingAccess(request,body.data.channelId);if(!app.ha)throw new Error();return app.ha.queryReturnRekey(body.data.rekeyId,body.data.channelId)}catch(error){return reply.code(error instanceof HaBindingError?error.status:409).send({error:'Diário indisponível; nenhuma reproteção foi repetida.'})}
  })
  server.post('/api/ha/returns/rekey',async(request,reply)=>{
    const body=haReturnRekeyRequest.safeParse(request.body)
    if(!body.success)return reply.code(400).send({error:'Informe recebimento, canal e intenção de reproteção.'})
    const actorId=access.identity(request)?.id??null
    const authorize=()=>{bindingAccess(request,body.data.channelId);if(!can(access.role(request),'TRANSPORT')||(access.identity(request)?.id??null)!==actorId)throw new HaBindingError(403,'Permissão/sessão mudou durante reproteção.')}
    reply.header('Cache-Control','private, no-store')
    try{authorize();if(!app.ha)throw new Error();auditChannels.set(request,[body.data.channelId]);return await app.ha.rekeyReturn(body.data,authorize)}catch(error){return reply.code(error instanceof HaBindingError?error.status:409).send({error:'Reproteção não confirmada; preserve pedido e consulte. Banco ativo não alterado.'})}
  })
  server.get('/api/ha/returns/variants',async(request,reply)=>{
    const body=z.object({decisionId:z.string().uuid(),channelId:z.string().min(1).max(128)}).strict().safeParse(request.query)
    if(!body.success)return reply.code(400).send({error:'Informe decisão e canal.'})
    reply.header('Cache-Control','private, no-store')
    try{bindingAccess(request,body.data.channelId);if(!app.ha)throw new Error();return app.ha.queryReturnVariants(body.data.decisionId,body.data.channelId)}catch(error){return reply.code(error instanceof HaBindingError?error.status:409).send({error:'Diário indisponível; nenhuma decisão foi repetida.'})}
  })
  server.post('/api/ha/returns/variants',async(request,reply)=>{
    const body=haHistoryVariantRequest.safeParse(request.body)
    if(!body.success)return reply.code(400).send({error:'Decisão exige IDs, ambos os hashes e justificativa explícita.'})
    const actorId=access.identity(request)?.id??null,actor=access.identity(request)?.username??'local-admin'
    const authorize=()=>{bindingAccess(request,body.data.channelId);if(!can(access.role(request),'TRANSPORT')||(access.identity(request)?.id??null)!==actorId)throw new HaBindingError(403,'Permissão/sessão mudou durante decisão.')}
    reply.header('Cache-Control','private, no-store')
    try{authorize();if(!app.ha)throw new Error();auditChannels.set(request,[body.data.channelId]);return await app.ha.preserveReturnVariants(body.data,authorize,actor)}catch(error){return reply.code(error instanceof HaBindingError?error.status:409).send({error:'Decisão não confirmada; consulte. Histórico existente não foi substituído.'})}
  })
  server.get('/api/ha/returns/history',async(request,reply)=>{
    const body=z.object({importId:z.string().uuid(),channelId:z.string().min(1).max(128)}).strict().safeParse(request.query)
    if(!body.success)return reply.code(400).send({error:'Informe importação e canal.'})
    reply.header('Cache-Control','private, no-store')
    try{bindingAccess(request,body.data.channelId);if(!app.ha)throw new Error();return app.ha.queryReturnHistory(body.data.importId,body.data.channelId)}catch(error){return reply.code(error instanceof HaBindingError?error.status:409).send({error:'Diário indisponível; nenhum registro foi importado novamente.'})}
  })
  server.post('/api/ha/returns/history',async(request,reply)=>{
    const body=haHistoryImportRequest.safeParse(request.body)
    if(!body.success)return reply.code(400).send({error:'Selecione IDs novos e hashes identificados na revisão.'})
    const actorId=access.identity(request)?.id??null,actor=access.identity(request)?.username??'local-admin'
    const authorize=()=>{bindingAccess(request,body.data.channelId);if(!can(access.role(request),'TRANSPORT')||(access.identity(request)?.id??null)!==actorId)throw new HaBindingError(403,'Permissão/sessão mudou durante importação.')}
    reply.header('Cache-Control','private, no-store')
    try{authorize();if(!app.ha)throw new Error();auditChannels.set(request,[body.data.channelId]);return await app.ha.importReturnHistory(body.data,authorize,actor)}catch(error){return reply.code(error instanceof HaBindingError?error.status:409).send({error:'Importação não confirmada; consulte o pedido. Registros existentes não serão substituídos.'})}
  })
  server.get('/api/ha/returns/review',async(request,reply)=>{
    const body=z.object({reviewId:z.string().uuid(),channelId:z.string().min(1).max(128)}).strict().safeParse(request.query)
    if(!body.success)return reply.code(400).send({error:'Informe revisão e canal.'})
    reply.header('Cache-Control','private, no-store')
    try{bindingAccess(request,body.data.channelId);if(!app.ha)throw new Error();return app.ha.queryReturnReview(body.data.reviewId,body.data.channelId)}catch(error){return reply.code(error instanceof HaBindingError?error.status:409).send({error:'Revisão indisponível; nenhuma nova análise foi iniciada.'})}
  })
  server.post('/api/ha/returns/review',async(request,reply)=>{
    const body=haReturnReviewRequest.safeParse(request.body)
    if(!body.success)return reply.code(400).send({error:'Informe recebimento, canal e intenção de revisão.'})
    const actorId=access.identity(request)?.id??null
    const authorize=()=>{bindingAccess(request,body.data.channelId);if(!can(access.role(request),'TRANSPORT')||(access.identity(request)?.id??null)!==actorId)throw new HaBindingError(403,'Permissão/sessão mudou durante revisão.')}
    reply.header('Cache-Control','private, no-store')
    try{authorize();if(!app.ha)throw new Error();auditChannels.set(request,[body.data.channelId]);return await app.ha.reviewReturn(body.data,authorize)}catch(error){return reply.code(error instanceof HaBindingError?error.status:409).send({error:'Revisão não confirmada; consulte o pedido. Banco operacional não alterado.'})}
  })
  server.get('/api/ha/returns',async(request,reply)=>{
    const body=z.object({channelId:z.string().min(1).max(128)}).strict().safeParse(request.query)
    if(!body.success)return reply.code(400).send({error:'Selecione o canal.'})
    reply.header('Cache-Control','private, no-store')
    try{bindingAccess(request,body.data.channelId);if(!app.ha)throw new Error();return {receipts:app.ha.returnReceipts(body.data.channelId),publicationAuthorized:false}}
    catch(error){return reply.code(error instanceof HaBindingError?error.status:409).send({error:'Quarentena indisponível neste nó; nenhuma execução alterada.'})}
  })
  server.post('/api/ha/return',{bodyLimit:1024*1024},async(request,reply)=>{
    try{reply.header('Cache-Control','private, no-store');return await app.ha!.receiveReturn(request.body,request.headers)}
    catch(error){return reply.code(error instanceof HaError?error.status:400).send({error:'Retorno recusado. Quarentena preservada; banco operacional e autoridade não alterados.'})}
  })
  server.post('/api/ha/media',{bodyLimit:1024*1024},async(request,reply)=>{
    try{reply.header('Cache-Control','private, no-store');return await app.ha!.receiveMedia(request.body,request.headers)}
    catch(error){return reply.code(error instanceof HaError?error.status:400).send({error:error instanceof HaError?error.message:'Cópia HA recusada. Confira SHA, pasta, quota e edição; nenhum parcial está pronto para PGM.'})}
  })
  const bindingInventory=async(channelId:string):Promise<HaBindingInventory>=>{
    const found=await app.sources.list(true)
    const inputs:HaBindingInventory['inputs']=[...(found.sdi.available?found.sdi.sources:[]),...(found.ndi.available?found.ndi.sources:[]),...(found.omt.available?found.omt.sources:[]),...(found.guests.available?found.guests.sources:[])].filter(row=>row.discovery==='DISCOVERED')
      .map(row=>({key:'discovered:'+installationVault(false).reviewIdentity(JSON.stringify([row.family,row.reference]),'ha-local-source:v1'),label:row.label,family:row.family,reference:row.reference}))
    for(const row of app.db.select().from(liveSources).where(and(eq(liveSources.channelId,channelId),eq(liveSources.enabled,true))).all())inputs.push({key:'configured:'+row.id,label:row.name,family:row.kind,reference:configuredSourceEndpoint(row)})
    const sdiOutputs=found.sdiOutputs.available?found.sdiOutputs.sources.filter(row=>row.discovery==='DISCOVERED').map(row=>({key:'output:'+installationVault(false).reviewIdentity(row.reference,'ha-local-output:v1'),label:row.label,family:row.family,reference:row.reference})):[]
    return {inputs:inputs.sort((a,b)=>a.key.localeCompare(b.key)),sdiOutputs:sdiOutputs.sort((a,b)=>a.key.localeCompare(b.key))}
  }
  const bindingAccess=(request:FastifyRequest,channelId:string)=>{
    if(access.role(request)!=='ADMIN'||!can(access.role(request),'OUTPUT_CONTROL')||!access.channelAllowed(request,channelId)||access.required()&&!access.identity(request))throw new HaBindingError(403,'Vínculos do reserva exigem administrador autorizado no canal.')
  }
  server.get('/api/ha/returns/bindings',async(request,reply)=>{
    const body=haReturnBindingReviewRequest.safeParse(request.query)
    if(!body.success)return reply.code(400).send({error:'Informe candidato, seleção e canal.'})
    const actorId=access.identity(request)?.id??null
    const authorize=()=>{bindingAccess(request,body.data.channelId);if((access.identity(request)?.id??null)!==actorId)throw new HaBindingError(403,'Sessão mudou durante conferência de retorno.')}
    reply.header('Cache-Control','private, no-store')
    try{authorize();if(!app.ha)throw new Error();const inventory=await bindingInventory(body.data.channelId);authorize();return await app.ha.reviewReturnBindings(body.data,inventory,authorize)}catch(error){return reply.code(error instanceof HaBindingError?error.status:409).send({error:'Conferência de vínculos indisponível; candidato e PGM preservados.'})}
  })
  server.get('/api/ha/returns/application',async(request,reply)=>{
    const body=z.object({applicationId:z.string().uuid(),channelId:z.string().min(1).max(128)}).strict().safeParse(request.query)
    if(!body.success)return reply.code(400).send({error:'Informe aplicação e canal.'})
    reply.header('Cache-Control','private, no-store')
    try{bindingAccess(request,body.data.channelId);if(!app.ha)throw new Error();return app.ha.queryReturnApplication(body.data.applicationId,body.data.channelId)}catch(error){return reply.code(error instanceof HaBindingError?error.status:409).send({error:'Aplicação não confirmada; nenhuma criação repetida.'})}
  })
  server.get('/api/ha/returns/media-review',async(request,reply)=>{
    const body=z.object({mediaReviewId:z.string().uuid(),channelId:z.string().min(1).max(128)}).strict().safeParse(request.query)
    if(!body.success)return reply.code(400).send({error:'Informe revisão de mídia e canal.'})
    reply.header('Cache-Control','private, no-store')
    try{bindingAccess(request,body.data.channelId);if(!app.ha)throw new Error();return app.ha.queryReturnMedia(body.data.mediaReviewId,body.data.channelId)}catch(error){return reply.code(error instanceof HaBindingError?error.status:409).send({error:'Revisão não confirmada; nenhuma análise repetida.'})}
  })
  server.get('/api/ha/returns/history-job',async(request,reply)=>{
    const body=z.object({id:z.string().uuid(),channelId:z.string().min(1).max(128),kind:z.enum(['HISTORY_IMPORT','HISTORY_VARIANT'])}).strict().safeParse(request.query)
    if(!body.success)return reply.code(400).send({error:'Informe trabalho, canal e tipo de histórico.'})
    reply.header('Cache-Control','private, no-store')
    try{bindingAccess(request,body.data.channelId);if(!app.ha)throw new Error();return app.ha.observeReturnHistoryJob(body.data.id,body.data.channelId,body.data.kind)}catch{return reply.code(409).send({error:'Intenção/recibo operacional indisponível; não presumir commit nem repetir.'})}
  })
  server.get('/api/ha/returns/pending-jobs',async(request,reply)=>{
    const body=haReturnJobListQuery.safeParse(request.query)
    if(!body.success)return reply.code(400).send({error:'Informe canal, tipo de pedido e cursor válido.'})
    const actorId=access.identity(request)?.id??null,authorize=()=>{bindingAccess(request,body.data.channelId);if((access.identity(request)?.id??null)!==actorId)throw new HaBindingError(403,'Sessão mudou durante consulta.')}
    reply.header('Cache-Control','private, no-store')
    try{authorize();if(!app.ha)throw new Error();return app.ha.listReturnPendingJobs(body.data,authorize)}catch{return reply.code(409).send({error:'Listagem indisponível; nenhum pedido retomado ou encerrado.'})}
  })
  server.get('/api/ha/returns/job-recovery',async(request,reply)=>{
    const body=z.object({recoveryId:z.string().uuid(),channelId:z.string().min(1).max(128)}).strict().safeParse(request.query)
    if(!body.success)return reply.code(400).send({error:'Informe encerramento e canal.'})
    reply.header('Cache-Control','private, no-store')
    try{bindingAccess(request,body.data.channelId);if(!app.ha)throw new Error();return app.ha.queryReturnJobRecovery(body.data.recoveryId,body.data.channelId)}catch{return reply.code(409).send({error:'Encerramento não confirmado; nenhuma operação repetida.'})}
  })
  server.post('/api/ha/returns/job-recovery',async(request,reply)=>{
    const body=haReturnJobRecoveryRequest.safeParse(request.body)
    if(!body.success)return reply.code(400).send({error:'Informe pedido interrompido, estado/data esperados e justificativa.'})
    const actorId=access.identity(request)?.id??null,authorize=()=>{bindingAccess(request,body.data.channelId);if(!can(access.role(request),'TRANSPORT')||(access.identity(request)?.id??null)!==actorId)throw new HaBindingError(403,'Permissão/sessão mudou durante encerramento.')}
    reply.header('Cache-Control','private, no-store')
    try{authorize();if(!app.ha||!actorId)throw new Error();auditChannels.set(request,[body.data.channelId]);return app.ha.closeInterruptedReturnJob(body.data,actorId,authorize)}catch{return reply.code(409).send({error:'Encerramento não confirmado: pedido ativo, alterado ou processo sem encerramento comprovado. Consulte sem repetir; parciais preservados.'})}
  })
  server.get('/api/ha/returns/auto-options',async(request,reply)=>{
    const body=z.object({mediaReviewId:z.string().uuid(),channelId:z.string().min(1).max(128)}).strict().safeParse(request.query)
    if(!body.success)return reply.code(400).send({error:'Informe revisão e canal.'})
    const actorId=access.identity(request)?.id??null,authorize=()=>{bindingAccess(request,body.data.channelId);if((access.identity(request)?.id??null)!==actorId)throw new HaBindingError(403,'Sessão mudou durante opções AUTO.')}
    reply.header('Cache-Control','private, no-store')
    try{authorize();if(!app.ha)throw new Error();return await app.ha.returnAutoOptions(body.data.mediaReviewId,body.data.channelId,authorize)}catch{return reply.code(409).send({error:'Opções AUTO indisponíveis; nenhuma medição aplicada.'})}
  })
  server.get('/api/ha/returns/auto-decision',async(request,reply)=>{
    const body=z.object({decisionId:z.string().uuid(),channelId:z.string().min(1).max(128)}).strict().safeParse(request.query)
    if(!body.success)return reply.code(400).send({error:'Informe decisão e canal.'})
    reply.header('Cache-Control','private, no-store')
    try{bindingAccess(request,body.data.channelId);if(!app.ha)throw new Error();return app.ha.queryReturnAutoDecision(body.data.decisionId,body.data.channelId)}catch{return reply.code(409).send({error:'Decisão não confirmada; nenhuma gravação repetida.'})}
  })
  server.post('/api/ha/returns/auto-decision',async(request,reply)=>{
    const body=haReturnAutoDecisionRequest.safeParse(request.body)
    if(!body.success)return reply.code(400).send({error:'Informe decisão, revisão, montagens e justificativa.'})
    const actorId=access.identity(request)?.id??null,authorize=()=>{bindingAccess(request,body.data.channelId);if(!can(access.role(request),'TRANSPORT')||(access.identity(request)?.id??null)!==actorId)throw new HaBindingError(403,'Permissão/sessão mudou durante decisão AUTO.')}
    reply.header('Cache-Control','private, no-store')
    try{authorize();if(!app.ha||!actorId)throw new Error();const inventory=await bindingInventory(body.data.channelId);authorize();auditChannels.set(request,[body.data.channelId]);return await app.ha.saveReturnAutoDecision(body.data,inventory,actorId,authorize)}catch{return reply.code(409).send({error:'Decisão AUTO não confirmada; consulte sem repetir. PGM e fonte preservados.'})}
  })
  server.get('/api/ha/returns/postgain-review',async(request,reply)=>{
    const body=z.object({postGainReviewId:z.string().uuid(),channelId:z.string().min(1).max(128)}).strict().safeParse(request.query)
    if(!body.success)return reply.code(400).send({error:'Informe revisão pós-ganho e canal.'})
    reply.header('Cache-Control','private, no-store')
    try{bindingAccess(request,body.data.channelId);if(!app.ha)throw new Error();return app.ha.queryReturnPostGain(body.data.postGainReviewId,body.data.channelId)}catch(error){return reply.code(error instanceof HaBindingError?error.status:409).send({error:'Revisão pós-ganho não confirmada; nenhuma medição repetida.'})}
  })
  server.post('/api/ha/returns/postgain-review',async(request,reply)=>{
    const body=haReturnPostGainReviewRequest.safeParse(request.body)
    if(!body.success)return reply.code(400).send({error:'Informe revisão pós-ganho, cópia de mídia e canal, sem parâmetros de áudio.'})
    const actorId=access.identity(request)?.id??null,authorize=()=>{bindingAccess(request,body.data.channelId);if(!actorId||!can(access.role(request),'TRANSPORT')||(access.identity(request)?.id??null)!==actorId)throw new HaBindingError(403,'Permissão/sessão mudou durante pós-ganho.')}
    reply.header('Cache-Control','private, no-store')
    try{authorize();if(!app.ha||!actorId)throw new Error();const inventory=await bindingInventory(body.data.channelId);authorize();auditChannels.set(request,[body.data.channelId]);return await app.ha.reviewReturnPostGain(body.data,inventory,actorId,authorize)}catch(error){return reply.code(error instanceof HaBindingError?error.status:409).send({error:'Pós-ganho não confirmado; consulte o mesmo pedido sem repetir. Cópia e PGM preservados.'})}
  })
  server.get('/api/ha/returns/bus-review',async(request,reply)=>{
    const body=z.object({busReviewId:z.string().uuid(),channelId:z.string().min(1).max(128)}).strict().safeParse(request.query)
    if(!body.success)return reply.code(400).send({error:'Informe revisão bus completo e canal.'})
    reply.header('Cache-Control','private, no-store')
    try{bindingAccess(request,body.data.channelId);if(!app.ha)throw new Error();return app.ha.queryReturnBus(body.data.busReviewId,body.data.channelId)}catch(error){return reply.code(error instanceof HaBindingError?error.status:409).send({error:'Revisão bus completo não confirmada; nenhuma medição repetida.'})}
  })
  server.post('/api/ha/returns/bus-review',async(request,reply)=>{
    const body=haReturnBusReviewRequest.safeParse(request.body)
    if(!body.success)return reply.code(400).send({error:'Informe revisão bus completo, cópia de mídia e canal, sem parâmetros de áudio.'})
    const actorId=access.identity(request)?.id??null,authorize=()=>{bindingAccess(request,body.data.channelId);if(!actorId||!can(access.role(request),'TRANSPORT')||(access.identity(request)?.id??null)!==actorId)throw new HaBindingError(403,'Permissão/sessão mudou durante bus completo.')}
    reply.header('Cache-Control','private, no-store')
    try{authorize();if(!app.ha||!actorId)throw new Error();const inventory=await bindingInventory(body.data.channelId);authorize();auditChannels.set(request,[body.data.channelId]);return await app.ha.reviewReturnBus(body.data,inventory,actorId,authorize)}catch(error){return reply.code(error instanceof HaBindingError?error.status:409).send({error:'Bus completo não confirmado; consulte o mesmo pedido sem repetir. Cópia e PGM preservados.'})}
  })
  server.get('/api/ha/returns/media-application',async(request,reply)=>{
    const body=z.object({mediaApplicationId:z.string().uuid(),channelId:z.string().min(1).max(128)}).strict().safeParse(request.query)
    if(!body.success)return reply.code(400).send({error:'Informe cópia de mídia e canal.'})
    reply.header('Cache-Control','private, no-store')
    try{bindingAccess(request,body.data.channelId);if(!app.ha)throw new Error();return app.ha.queryReturnMediaApplication(body.data.mediaApplicationId,body.data.channelId)}catch(error){return reply.code(error instanceof HaBindingError?error.status:409).send({error:'Cópia não confirmada; nenhuma criação repetida.'})}
  })
  server.post('/api/ha/returns/media-application',async(request,reply)=>{
    const body=haReturnMediaApplicationRequest.safeParse(request.body)
    if(!body.success)return reply.code(400).send({error:'Informe cópia, revisão de mídia e canal.'})
    const actorId=access.identity(request)?.id??null
    const authorize=()=>{bindingAccess(request,body.data.channelId);if(!can(access.role(request),'TRANSPORT')||(access.identity(request)?.id??null)!==actorId)throw new HaBindingError(403,'Permissão/sessão mudou durante criação da cópia.')}
    reply.header('Cache-Control','private, no-store')
    try{authorize();if(!app.ha)throw new Error();const inventory=await bindingInventory(body.data.channelId);authorize();auditChannels.set(request,[body.data.channelId]);return await app.ha.stageReturnMediaApplication(body.data,inventory,authorize)}catch(error){return reply.code(error instanceof HaBindingError?error.status:409).send({error:'Cópia não confirmada; consulte sem repetir. Originais e PGM preservados.'})}
  })
  server.get('/api/ha/returns/media-options',async(request,reply)=>{
    const body=z.object({applicationId:z.string().uuid(),channelId:z.string().min(1).max(128)}).strict().safeParse(request.query)
    if(!body.success)return reply.code(400).send({error:'Informe aplicação e canal.'})
    const actorId=access.identity(request)?.id??null
    const authorize=()=>{bindingAccess(request,body.data.channelId);if((access.identity(request)?.id??null)!==actorId)throw new HaBindingError(403,'Sessão mudou durante conferência de arquivos.')}
    reply.header('Cache-Control','private, no-store')
    try{authorize();if(!app.ha)throw new Error();return await app.ha.returnMediaOptions(body.data.applicationId,body.data.channelId,authorize)}catch(error){return reply.code(error instanceof HaBindingError?error.status:409).send({error:'Opções locais indisponíveis ou inventário excede limite. Nenhum arquivo foi aberto como entrada.'})}
  })
  server.post('/api/ha/returns/media-review',async(request,reply)=>{
    const body=haReturnMediaReviewRequest.safeParse(request.body)
    if(!body.success)return reply.code(400).send({error:'Informe revisão, aplicação e canal.'})
    const actorId=access.identity(request)?.id??null
    const authorize=()=>{bindingAccess(request,body.data.channelId);if(!can(access.role(request),'TRANSPORT')||(access.identity(request)?.id??null)!==actorId)throw new HaBindingError(403,'Permissão/sessão mudou durante análise de mídia.')}
    reply.header('Cache-Control','private, no-store')
    try{authorize();if(!app.ha)throw new Error();const inventory=await bindingInventory(body.data.channelId);authorize();auditChannels.set(request,[body.data.channelId]);return await app.ha.reviewReturnMedia(body.data,inventory,authorize)}catch(error){return reply.code(error instanceof HaBindingError?error.status:409).send({error:'Análise não confirmada; consulte sem repetir. Cópias e PGM preservados.'})}
  })
  server.post('/api/ha/returns/application',async(request,reply)=>{
    const body=haReturnApplicationRequest.safeParse(request.body)
    if(!body.success)return reply.code(400).send({error:'Informe aplicação, candidato e plano local deste canal.'})
    const actorId=access.identity(request)?.id??null
    const authorize=()=>{bindingAccess(request,body.data.channelId);if(!can(access.role(request),'TRANSPORT')||(access.identity(request)?.id??null)!==actorId)throw new HaBindingError(403,'Permissão/sessão mudou durante aplicação.')}
    reply.header('Cache-Control','private, no-store')
    try{authorize();if(!app.ha)throw new Error();const inventory=await bindingInventory(body.data.channelId);authorize();auditChannels.set(request,[body.data.channelId]);return await app.ha.applyReturnBindings(body.data,inventory,authorize)}catch(error){return reply.code(error instanceof HaBindingError?error.status:409).send({error:'Aplicação não confirmada; consulte sem repetir. Originais e PGM preservados.'})}
  })
  server.post('/api/ha/returns/bindings',async(request,reply)=>{
    const body=haReturnBindingRequest.safeParse(request.body)
    if(!body.success)return reply.code(400).send({error:'Informe candidato e decisão completa para este canal.'})
    const actorId=access.identity(request)?.id??null
    const authorize=()=>{bindingAccess(request,body.data.channelId);if(!can(access.role(request),'TRANSPORT')||(access.identity(request)?.id??null)!==actorId)throw new HaBindingError(403,'Permissão/sessão mudou durante decisão de vínculos.')}
    reply.header('Cache-Control','private, no-store')
    try{authorize();if(!app.ha)throw new Error();const inventory=await bindingInventory(body.data.channelId);authorize();auditChannels.set(request,[body.data.channelId]);return await app.ha.saveReturnBindings(body.data,inventory,authorize,actorId)}catch(error){return reply.code(error instanceof HaBindingError?error.status:409).send({error:'Decisão não confirmada; consulte sem repetir. Nenhuma saída foi aberta.'})}
  })
  server.get('/api/ha/binding-channels',async(request,reply)=>{
    try{
      if(!(await allowed(request,'OUTPUT_CONTROL'))||access.role(request)!=='ADMIN')return reply.code(403).send({error:'Conferência do reserva exige administrador.'})
      reply.header('Cache-Control','private, no-store')
      return {channels:(app.ha?.bindingChannels()??[]).filter(row=>access.channelAllowed(request,row.id))}
    }catch(error){return reply.code(error instanceof HaError?error.status:409).send({error:'Conferência exige reserva configurado e espelho válido.'})}
  })
  server.get('/api/ha/executions',async(request,reply)=>{
    const channelId=(request.query as {channelId?:unknown}).channelId
    if(typeof channelId!=='string'||!channelId||channelId.length>128)return reply.code(400).send({error:'Selecione o canal espelhado.'})
    if(!(await allowed(request,'OUTPUT_CONTROL'))||access.role(request)!=='ADMIN'||!access.channelAllowed(request,channelId))return reply.code(403).send({error:'Consulta da execução HA exige administrador autorizado no canal.'})
    reply.header('Cache-Control','private, no-store')
    try{return {executions:app.ha?.promotionObservations(channelId)??[],automaticTake:false,physicalOutputValidated:false}}
    catch{return reply.code(409).send({error:'Observação de execução indisponível neste nó.'})}
  })
  server.get('/api/ha/executions/return-resume',async(request,reply)=>{
    const body=z.object({resumeId:z.string().uuid(),channelId:z.string().min(1).max(128)}).strict().safeParse(request.query)
    if(!body.success)return reply.code(400).send({error:'Informe retomada e canal.'})
    reply.header('Cache-Control','private, no-store')
    try{bindingAccess(request,body.data.channelId);if(!app.ha)throw new Error();return app.ha.queryReturnResume(body.data.resumeId,body.data.channelId)}catch(error){return reply.code(error instanceof HaBindingError?error.status:409).send({error:'Pedido indisponível; retomada não foi repetida.'})}
  })
  server.post('/api/ha/executions/return-resume',async(request,reply)=>{
    const body=haReturnResumeRequest.safeParse(request.body)
    if(!body.success)return reply.code(400).send({error:'Retomada exige intenção, conferência e offset.'})
    const actorId=access.identity(request)?.id??null,actor=access.identity(request)?.username??'local-admin'
    const authorize=()=>{bindingAccess(request,body.data.channelId);if(!can(access.role(request),'TRANSPORT')||(access.identity(request)?.id??null)!==actorId)throw new HaBindingError(403,'Permissão/sessão mudou durante retomada.')}
    reply.header('Cache-Control','private, no-store')
    try{authorize();if(!app.ha)throw new Error();auditChannels.set(request,[body.data.channelId]);return await app.ha.resumeReturn(body.data,authorize,actor)}catch(error){return reply.code(error instanceof HaBindingError?error.status:409).send({error:'Retomada não confirmada; preserve pedido e consulte sem repetir.'})}
  })
  server.get('/api/ha/executions/return-send',async(request,reply)=>{
    const body=z.object({requestId:z.string().uuid(),channelId:z.string().min(1).max(128)}).strict().safeParse(request.query)
    if(!body.success)return reply.code(400).send({error:'Informe pedido e canal.'})
    reply.header('Cache-Control','private, no-store')
    try{bindingAccess(request,body.data.channelId);if(!app.ha)throw new Error();return app.ha.queryReturn(body.data.requestId,body.data.channelId)}catch(error){return reply.code(error instanceof HaBindingError?error.status:409).send({error:'Diário indisponível; envio não foi repetido.'})}
  })
  server.post('/api/ha/executions/return-send',async(request,reply)=>{
    const body=haReturnSendRequest.safeParse(request.body)
    if(!body.success)return reply.code(400).send({error:'Informe execução, exportação e intenção de envio.'})
    const actorId=access.identity(request)?.id??null,actor=access.identity(request)?.username??'local-admin'
    const authorize=()=>{bindingAccess(request,body.data.channelId);if(!can(access.role(request),'TRANSPORT')||(access.identity(request)?.id??null)!==actorId)throw new HaBindingError(403,'Permissão/sessão mudou durante envio.')}
    reply.header('Cache-Control','private, no-store')
    try{authorize();if(!app.ha)throw new Error();auditChannels.set(request,[body.data.channelId]);return await app.ha.sendReturn(body.data,authorize,actor)}catch(error){return reply.code(error instanceof HaBindingError?error.status:409).send({error:'Envio não confirmado; preserve pedido e consulte sem repetir.'})}
  })
  server.post('/api/ha/executions/return-inspect',async(request,reply)=>{
    const body=z.object({requestId:z.string().uuid(),channelId:z.string().min(1).max(128)}).strict().safeParse(request.body)
    if(!body.success)return reply.code(400).send({error:'Informe pedido e canal.'})
    const actorId=access.identity(request)?.id??null
    const authorize=()=>{bindingAccess(request,body.data.channelId);if(!can(access.role(request),'TRANSPORT')||(access.identity(request)?.id??null)!==actorId)throw new HaBindingError(403,'Permissão/sessão mudou durante consulta.')}
    reply.header('Cache-Control','private, no-store')
    try{authorize();if(!app.ha)throw new Error();auditChannels.set(request,[body.data.channelId]);return await app.ha.inspectReturn(body.data.requestId,body.data.channelId,authorize)}catch(error){return reply.code(error instanceof HaBindingError?error.status:409).send({error:'Consulta remota não confirmada; nenhum bloco foi reenviado.'})}
  })
  server.get('/api/ha/executions/export',async(request,reply)=>{
    const body=z.object({requestId:z.string().uuid(),channelId:z.string().min(1).max(128)}).strict().safeParse(request.query)
    if(!body.success)return reply.code(400).send({error:'Informe pedido e canal.'})
    reply.header('Cache-Control','private, no-store')
    try{bindingAccess(request,body.data.channelId);if(!app.ha)throw new Error();return app.ha.promotionExportQuery(body.data.requestId,body.data.channelId)}
    catch(error){return reply.code(error instanceof HaBindingError?error.status:409).send({error:'Exportação indisponível; nenhuma cópia foi repetida.'})}
  })
  server.post('/api/ha/executions/export',async(request,reply)=>{
    const body=haExportRequest.safeParse(request.body)
    if(!body.success)return reply.code(400).send({error:'Informe execução, parada confirmada e intenção de exportação.'})
    const actorId=access.identity(request)?.id??null,actor=access.identity(request)?.username??'local-admin'
    const authorize=()=>{bindingAccess(request,body.data.channelId);if(!can(access.role(request),'TRANSPORT')||(access.identity(request)?.id??null)!==actorId)throw new HaBindingError(403,'Permissão/sessão mudou durante exportação.')}
    reply.header('Cache-Control','private, no-store')
    try{authorize();if(!app.ha)throw new Error();auditChannels.set(request,[body.data.channelId]);return await app.ha.promotionExport(body.data,authorize,actor)}
    catch(error){return reply.code(error instanceof HaBindingError?error.status:409).send({error:'Exportação não confirmada; preserve o pedido e consulte sem repetir.'})}
  })
  server.get('/api/ha/executions/return-review',async(request,reply)=>{
    const body=z.object({promotionId:z.string().uuid(),channelId:z.string().min(1).max(128)}).strict().safeParse(request.query)
    if(!body.success)return reply.code(400).send({error:'Informe execução e canal.'})
    const actorId=access.identity(request)?.id??null
    const authorize=()=>{bindingAccess(request,body.data.channelId);if((access.identity(request)?.id??null)!==actorId)throw new HaBindingError(403,'Sessão mudou durante conferência de retorno.')}
    reply.header('Cache-Control','private, no-store')
    try{authorize();if(!app.ha)throw new Error();return await app.ha.promotionReturnReview(body.data.promotionId,body.data.channelId,authorize)}
    catch(error){return reply.code(error instanceof HaBindingError?error.status:409).send({error:'Conferência indisponível. Nenhuma autoridade foi transferida ou engine iniciado.'})}
  })
  server.get('/api/ha/executions/stop-review',async(request,reply)=>{
    const body=z.object({promotionId:z.string().uuid(),channelId:z.string().min(1).max(128)}).strict().safeParse(request.query)
    if(!body.success)return reply.code(400).send({error:'Informe execução e canal.'})
    reply.header('Cache-Control','private, no-store')
    try{bindingAccess(request,body.data.channelId);if(!app.ha)throw new Error();return app.ha.promotionStopReview(body.data.promotionId,body.data.channelId)}
    catch(error){return reply.code(error instanceof HaBindingError?error.status:409).send({error:'Conferência de encerramento indisponível; nenhum processo alterado.'})}
  })
  server.get('/api/ha/executions/stop',async(request,reply)=>{
    const body=z.object({requestId:z.string().uuid(),channelId:z.string().min(1).max(128)}).strict().safeParse(request.query)
    if(!body.success)return reply.code(400).send({error:'Informe pedido e canal.'})
    reply.header('Cache-Control','private, no-store')
    try{bindingAccess(request,body.data.channelId);if(!app.ha)throw new Error();return app.ha.promotionStopQuery(body.data.requestId,body.data.channelId)}
    catch(error){return reply.code(error instanceof HaBindingError?error.status:409).send({error:'Pedido indisponível; encerramento não foi repetido.'})}
  })
  server.post('/api/ha/executions/stop',async(request,reply)=>{
    const body=haStopRequest.safeParse(request.body)
    if(!body.success)return reply.code(400).send({error:'Encerramento exige intenção e confirmação explícitas.'})
    const actorId=access.identity(request)?.id??null,actor=access.identity(request)?.username??'local-admin'
    const authorize=()=>{bindingAccess(request,body.data.channelId);if(!can(access.role(request),'TRANSPORT')||(access.identity(request)?.id??null)!==actorId)throw new HaBindingError(403,'Permissão/sessão mudou durante encerramento.')}
    reply.header('Cache-Control','private, no-store')
    try{authorize();if(!app.ha)throw new Error();auditChannels.set(request,[body.data.channelId]);return await app.ha.promotionStop(body.data,authorize,actor)}
    catch(error){return reply.code(error instanceof HaBindingError?error.status:409).send({error:'Encerramento não confirmado; preserve o pedido e consulte, sem repetir.'})}
  })
  server.get('/api/ha/executions/control',async(request,reply)=>{
    const body=z.object({requestId:z.string().uuid(),channelId:z.string().min(1).max(128)}).strict().safeParse(request.query)
    if(!body.success)return reply.code(400).send({error:'Informe pedido e canal do controle.'})
    reply.header('Cache-Control','private, no-store')
    try{bindingAccess(request,body.data.channelId);if(!can(access.role(request),'TRANSPORT'))throw new HaBindingError(403,'Sem permissão de operação.');if(!app.ha)throw new Error();return app.ha.promotionControlQuery(body.data.requestId,body.data.channelId)}
    catch(error){return reply.code(error instanceof HaBindingError?error.status:409).send({error:'Pedido indisponível; nenhum CUE/TAKE foi reenviado.'})}
  })
  server.post('/api/ha/executions/control',async(request,reply)=>{
    const body=haControlRequest.safeParse(request.body)
    if(!body.success)return reply.code(400).send({error:'Pedido CUE/TAKE inválido.'})
    const actorId=access.identity(request)?.id??null,actor=access.identity(request)?.username??'local-admin'
    const authorize=()=>{bindingAccess(request,body.data.channelId);if(!can(access.role(request),'TRANSPORT')||(access.identity(request)?.id??null)!==actorId)throw new HaBindingError(403,'Permissão/sessão mudou durante comando da reserva.')}
    reply.header('Cache-Control','private, no-store')
    try{authorize();if(!app.ha)throw new Error();auditChannels.set(request,[body.data.channelId]);return await app.ha.promotionControl(body.data,authorize,actor)}
    catch(error){return reply.code(error instanceof HaBindingError?error.status:409).send({error:'Controle não confirmado; consulte o mesmo pedido antes de qualquer nova tentativa.'})}
  })
  server.post('/api/ha/executions/control/review',async(request,reply)=>{
    const body=haControlReviewRequest.safeParse(request.body)
    if(!body.success)return reply.code(400).send({error:'Revisão de controle inválida.'})
    const actorId=access.identity(request)?.id??null,actor=access.identity(request)?.username??'local-admin'
    const authorize=()=>{bindingAccess(request,body.data.channelId);if(!can(access.role(request),'TRANSPORT')||(access.identity(request)?.id??null)!==actorId)throw new HaBindingError(403,'Permissão/sessão mudou durante revisão da reserva.')}
    reply.header('Cache-Control','private, no-store')
    try{authorize();if(!app.ha)throw new Error();auditChannels.set(request,[body.data.channelId]);return await app.ha.promotionControlReview(body.data,authorize,actor)}
    catch(error){return reply.code(error instanceof HaBindingError?error.status:409).send({error:'Revisão sem prova suficiente; nenhum CUE/TAKE foi repetido.'})}
  })
  server.get('/api/ha/executions/monitor',async(request,reply)=>{
    const body=z.object({requestId:z.string().uuid(),channelId:z.string().min(1).max(128)}).strict().safeParse(request.query)
    if(!body.success)return reply.code(400).send({error:'Informe pedido e canal do monitor.'})
    reply.header('Cache-Control','private, no-store')
    try{bindingAccess(request,body.data.channelId);if(!app.ha)throw new Error();return app.ha.promotionMonitorQuery(body.data.requestId,body.data.channelId)}
    catch(error){return reply.code(error instanceof HaBindingError?error.status:409).send({error:'Pedido indisponível; nenhum comando foi reenviado.'})}
  })
  server.post('/api/ha/executions/monitor',async(request,reply)=>{
    const body=haMonitorRequest.safeParse(request.body)
    if(!body.success)return reply.code(400).send({error:'Pedido de monitor inválido.'})
    const actorId=access.identity(request)?.id??null,actor=access.identity(request)?.username??'local-admin'
    const authorize=()=>{bindingAccess(request,body.data.channelId);if((access.identity(request)?.id??null)!==actorId)throw new HaBindingError(403,'Sessão mudou durante comando do monitor.')}
    reply.header('Cache-Control','private, no-store')
    try{authorize();if(!app.ha)throw new Error();auditChannels.set(request,[body.data.channelId]);return await app.ha.promotionMonitor(body.data,authorize,actor)}
    catch(error){return reply.code(error instanceof HaBindingError?error.status:409).send({error:'Monitor não confirmado; consulte o mesmo pedido antes de outra tentativa.'})}
  })
  server.get('/api/ha/bindings',async(request,reply)=>{
    const channelId=(request.query as {channelId?:string}).channelId
    if(!channelId)return reply.code(400).send({error:'Selecione o canal espelhado.'})
    try{bindingAccess(request,channelId);const inventory=await bindingInventory(channelId);bindingAccess(request,channelId);reply.header('Cache-Control','private, no-store');if(!app.ha)throw new HaBindingError(409,'Reserva não configurado.');return app.ha.bindingReview(channelId,inventory)}
    catch(error){return reply.code(error instanceof HaBindingError||error instanceof HaError?error.status:409).send({error:error instanceof HaBindingError?error.message:'Não foi possível conferir os vínculos locais.'})}
  })
  server.post('/api/ha/bindings',async(request,reply)=>{
    const body=haBindingRequest.safeParse(request.body)
    if(!body.success)return reply.code(400).send({error:'Plano local inválido; atualize a conferência.'})
    const channelId=body.data.channelId,actor=access.identity(request)?.username??null,actorId=access.identity(request)?.id??null
    try{
      bindingAccess(request,channelId);const inventory=await bindingInventory(channelId)
      const authorize=()=>{bindingAccess(request,channelId);if((access.identity(request)?.id??null)!==actorId)throw new HaBindingError(403,'Sessão mudou durante a conferência.')}
      if(!app.ha)throw new HaBindingError(409,'Reserva não configurado.')
      auditChannels.set(request,[channelId]);reply.header('Cache-Control','private, no-store')
      return app.ha.saveBindings(body.data,inventory,actor,authorize)
    }catch(error){return reply.code(error instanceof HaBindingError||error instanceof HaError?error.status:409).send({error:error instanceof HaBindingError?error.message:'Plano local não foi confirmado; nada entrou em PGM.'})}
  })
  server.post('/api/ha/prepare',async(request,reply)=>{
    const body=z.object({requestId:z.string().uuid(),sequence:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),channelId:z.string().min(1).max(128),bindingPlanId:z.string().uuid()}).strict().safeParse(request.body)
    if(!body.success)return reply.code(400).send({error:'Informe pedido, sequência, canal e plano local registrado.'})
    const channelId=body.data.channelId,actorId=access.identity(request)?.id??null
    try{
      bindingAccess(request,channelId)
      const inventory=await bindingInventory(channelId)
      const authorize=()=>{bindingAccess(request,channelId);if((access.identity(request)?.id??null)!==actorId)throw new HaBindingError(403,'Sessão mudou durante a preparação.')}
      if(!app.ha)throw new HaBindingError(409,'Reserva não configurado.')
      auditChannels.set(request,[channelId]);reply.header('Cache-Control','private, no-store')
      const report=await app.ha.prepareBindings(body.data,inventory,authorize)
      authorize();return report
    }catch(error){return reply.code(error instanceof HaBindingError||error instanceof HaError?error.status:409).send({error:error instanceof HaBindingError||error instanceof HaRecoveryError?error.message:'Preparação não confirmada. Consulte o pedido no histórico; nenhum PGM foi aberto.'})}
  })
  server.get('/api/engineering/storage',async(request,reply)=>{
    if(!(await allowed(request,'OUTPUT_CONTROL'))||access.role(request)!=='ADMIN')return reply.code(403).send({error:'Diagnóstico do banco exige administrador.'})
    reply.header('Cache-Control','private, no-store')
    return databaseStorageStatus(app.db.$client)
  })
  server.get('/api/ha/rehearsal',async(request,reply)=>{
    if(!(await allowed(request,'OUTPUT_CONTROL'))||access.role(request)!=='ADMIN')return reply.code(403).send({error:'Ensaio HA exige administrador.'})
    reply.header('Cache-Control','private, no-store')
    const status=app.ha?.recoveryStatus()??{enabled:false,reports:[],promotionReady:false,automaticTake:false}
    return {...status,reports:status.reports.filter(report=>access.channelAllowed(request,report.channelId))}
  })
  for(const endpoint of ['/api/ha/rehearsal','/api/ha/rehearsal/reconcile'])server.post(endpoint,async(request,reply)=>{
    if(!(await allowed(request,'OUTPUT_CONTROL'))||access.role(request)!=='ADMIN')return reply.code(403).send({error:'Ensaio HA exige administrador.'})
    const body=z.object({requestId:z.string().uuid(),sequence:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),channelId:z.string().min(1).max(128),bindingPlanId:z.string().uuid().optional()}).strict().safeParse(request.body)
    if(!body.success)return reply.code(400).send({error:'Informe pedido único, sequência espelhada e canal; não há ação de TAKE neste endpoint.'})
    if(!access.channelAllowed(request,body.data.channelId))return reply.code(403).send({error:'Sem acesso a este canal.'})
    reply.header('Cache-Control','private, no-store')
    auditChannels.set(request,[body.data.channelId])
    try{if(!app.ha)throw new HaError(409,'HA não configurada.');return endpoint.endsWith('/reconcile')?app.ha.reconcileRecovery(body.data,access.identity(request)?.username??null):await app.ha.rehearse(body.data)}
    catch(error){return reply.code(error instanceof HaError?error.status:409).send({error:error instanceof HaError||error instanceof HaRecoveryError?error.message:'Ensaio recusado ou pedido anterior em andamento. Nenhum PGM foi aberto.'})}
  })
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
      // Recovery availability is diagnostic, not part of the canonical
      // transport hash exchanged with existing N+1 peers.
      channels: diagnosticValue(channels.map(row => ({ ...row, reconfiguration: app.runtimes.get(row.channelId)?.reconfigurationStatus() }))),
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
  server.get('/api/scheduler/status', async (request) => {
    const now = new Date()
    const nowMinute = now.getHours() * 60 + now.getMinutes()
    const weekday = now.getDay()
    const result = []
    for (const runtime of app.runtimes.values()) {
      if (!access.channelAllowed(request, runtime.channel.id)) continue
      const rules = await app.db.select().from(scheduleRules).where(eq(scheduleRules.channelId, runtime.channel.id))
      const activeRule = activeHorizonRule(rules, nowMinute, weekday)
      const horizon = executionHorizon(runtime.executionView, runtime.transport.state().onAir, runtime.operationalRevision?.id ?? null, now)
      const passage=runtime.boundaryStatus()
      result.push({
        channelId: runtime.channel.id,
        activeRule: activeRule ?? null,
        ...horizon,
        automaticHandover:passage.nativeEngine && passage.current?.plan.sourceRevisionId===passage.sourceRevisionId && ['QUEUED','PREPARING','SWITCHING'].includes(passage.current.state),
        nextPlaylist:passage.current?{state:passage.current.state,targetName:passage.current.plan.targetName,targetRevisionId:passage.current.plan.targetRevisionId,policy:passage.automaticPolicy}:null,
      })
    }
    return { checkedAt: now.toISOString(), channels: result }
  })

  server.get('/api/channels/:id/schedule-publication',async(request,reply)=>{
    const {id}=request.params as {id:string},channel=await getChannel(app.db,id)
    if(!channel)return reply.code(404).send({error:'Canal não encontrado.'})
    return {...app.schedulePublication.status(id),canConfigure:await allowed(request,'PLAYLIST_PUBLISH')}
  })
  server.get('/api/channels/:id/schedule-publication/review',async(request,reply)=>{
    if(!(await allowed(request,'PLAYLIST_PUBLISH')))return reply.code(403).send({error:'Seu papel não pode autorizar publicação automática.'})
    const {id}=request.params as {id:string},body=z.object({daysAhead:z.coerce.number().int().min(1).max(7),maxItems:z.coerce.number().int().min(1).max(5000)}).strict().safeParse(request.query)
    if(!body.success)return reply.code(400).send({error:'Antecedência de 1–7 dias; limite de 1–5000 itens.'})
    const actor=access.identity(request)
    try{return {review:app.schedulePublication.review(id,body.data.daysAhead,body.data.maxItems,{userId:actor?.id??null,username:actor?.username??null})}}
    catch(error){return reply.code(error instanceof CollaborativeEditError?error.status:409).send(error instanceof CollaborativeEditError?error.payload:{error:error instanceof Error?error.message:'Pauta inválida.'})}
  })
  server.post('/api/channels/:id/schedule-publication',async(request,reply)=>{
    if(!(await allowed(request,'PLAYLIST_PUBLISH')))return reply.code(403).send({error:'Seu papel não pode configurar publicação automática.'})
    const {id}=request.params as {id:string},body=z.object({action:z.enum(['ENABLE','DISABLE']),version:z.number().int().min(0),daysAhead:z.number().int().min(1).max(7).optional(),maxItems:z.number().int().min(1).max(5000).optional(),reviewToken:z.string().regex(/^[A-Za-z0-9_-]{43}$/).optional()}).strict().safeParse(request.body)
    if(!body.success)return reply.code(400).send({error:'Política de publicação inválida.'})
    if(!await getChannel(app.db,id))return reply.code(404).send({error:'Canal não encontrado.'})
    const actor=access.identity(request),owner={userId:actor?.id??null,username:actor?.username??null}
    const authorize=()=>{
      if(access.required()&&!access.identity(request)||!can(access.role(request),'PLAYLIST_PUBLISH')||!access.channelAllowed(request,id)||(access.identity(request)?.id??null)!==owner.userId)throw new CollaborativeEditError(403,{error:'Sessão/permissão mudou; política não alterada.'})
      if(app.schedulePublication.status(id).version!==body.data.version)throw new CollaborativeEditError(409,{error:'A política mudou desde a leitura. Confira novamente.'})
    }
    try{return app.db.transaction(()=>{
      authorize()
      if(body.data.action==='ENABLE')return app.schedulePublication.enable(id,body.data.daysAhead??2,body.data.maxItems??2000,owner,body.data.reviewToken,authorize)
      return app.schedulePublication.suspend(id,owner.username,'Publicação automática desligada explicitamente. Grades já publicadas permanecem intactas.','DISABLED')
    },{behavior:'immediate'})}
    catch(error){return reply.code(error instanceof CollaborativeEditError?error.status:409).send(error instanceof CollaborativeEditError?error.payload:{error:'Política não foi alterada. Confira a pauta e tente novamente.'})}
  })

  server.get('/api/channels/:id/execution-ownership',async(request,reply)=>{
    const {id}=request.params as {id:string}
    if(!access.channelAllowed(request,id))return reply.code(403).send({error:'Canal não autorizado.'})
    if(!await getChannel(app.db,id,true))return reply.code(404).send({error:'Canal não encontrado.'})
    reply.header('Cache-Control','private, no-store')
    try{return {...app.executionOwnership.status(id),physicalOutputValidated:false,promotionReady:false}}
    catch{return reply.code(409).send({error:'Registro de posse da execução inválido. Nenhum processo foi aberto ou encerrado.',diagnostic:{code:'INVALID_RECORD',message:'Registro inválido ou não autenticável; preserve reserva, cursor e histórico para reparo explícito.',repairRequired:true}})}
  })
  server.get('/api/distribution/execution-ownership',async(request,reply)=>{
    if(!can(access.role(request),'OUTPUT_CONTROL'))return reply.code(403).send({error:'Sem permissão para consultar a distribuição.'})
    reply.header('cache-control','private, no-store')
    try{return {...app.distributionOwnership.status(),enabled:Boolean(app.mediamtx||app.hostFence)}}
    catch{return reply.code(409).send({error:'Registro global inválido; nenhum arquivo ou processo foi alterado.',diagnostic:{code:'INVALID_RECORD',message:'Reserva global inválida ou não autenticável; nenhum recurso foi liberado.',repairRequired:true}})}
  })

  server.get('/api/channels/:id/published-continuity',async(request,reply)=>{
    const {id}=request.params as {id:string},runtime=await runtimeFor(app,id)
    if(!runtime)return reply.code(404).send({error:'Canal não encontrado.'})
    return {...app.publishedContinuity.status(id),sourceRevisionId:runtime.operationalRevision?.id??null,nativeEngine:runtime.transport instanceof EngineTransport,canConfigure:await allowed(request,'PLAYLIST_PUBLISH')}
  })
  server.get('/api/channels/:id/published-continuity/review',async(request,reply)=>{
    if(!(await allowed(request,'PLAYLIST_PUBLISH')))return reply.code(403).send({error:'Seu papel não pode autorizar continuidade.'})
    const {id}=request.params as {id:string},body=z.object({maxLateMinutes:z.coerce.number().int().min(0).max(180)}).strict().safeParse(request.query)
    if(!body.success)return reply.code(400).send({error:'Informe atraso máximo de 0 a 180 minutos.'})
    const runtime=await runtimeFor(app,id);if(!runtime)return reply.code(404).send({error:'Canal não encontrado.'})
    const actor=access.identity(request)
    try{return {review:app.publishedContinuity.review(runtime,body.data.maxLateMinutes,{userId:actor?.id??null,username:actor?.username??null})}}
    catch(error){return reply.code(409).send({error:error instanceof Error?error.message:String(error)})}
  })
  server.post('/api/channels/:id/published-continuity',async(request,reply)=>{
    if(!(await allowed(request,'PLAYLIST_PUBLISH')))return reply.code(403).send({error:'Seu papel não pode configurar continuidade.'})
    const {id}=request.params as {id:string},body=z.object({action:z.enum(['ENABLE','DISABLE']),version:z.number().int().min(0),maxLateMinutes:z.number().int().min(0).max(180).optional(),reviewToken:z.string().regex(/^[A-Za-z0-9_-]{43}$/).optional()}).strict().safeParse(request.body)
    if(!body.success)return reply.code(400).send({error:'Política de continuidade inválida.'})
    const runtime=await runtimeFor(app,id);if(!runtime)return reply.code(404).send({error:'Canal não encontrado.'})
    const actor=access.identity(request),owner={userId:actor?.id??null,username:actor?.username??null}
    const authorize=()=>{
      if(access.required()&&!access.identity(request)||!can(access.role(request),'PLAYLIST_PUBLISH')||!access.channelAllowed(request,id)||(access.identity(request)?.id??null)!==owner.userId)throw new CollaborativeEditError(403,{error:'Sessão/permissão mudou; política não alterada.'})
      if(app.publishedContinuity.status(id).version!==body.data.version)throw new CollaborativeEditError(409,{error:'A política mudou desde a leitura. Confira novamente.'})
    }
    return mutatePlaylist(runtime,reply,async()=>app.db.transaction(()=>{
      authorize()
      if(body.data.action==='ENABLE')return app.publishedContinuity.enable(runtime,body.data.maxLateMinutes??5,owner,body.data.reviewToken,authorize)
      const status=app.publishedContinuity.suspend(id,owner.username,'Desligada explicitamente. TAKE já enviado não pode ser desfeito por esta opção.','DISABLED')
      const ledger=new PlaylistBoundaryLedger(app.db,id)
      for(const run of ledger.list().filter(run=>run.plan.owner.policy && ['QUEUED','PREPARING'].includes(run.state)))ledger.phase(run.id,[run.state],'CANCELLED',()=>true,{message:'Política recorrente desligada; intenção ainda não enviada cancelada.'},owner.username)
      runtime.restoreBoundaryProtection();return status
    },{behavior:'immediate'}))
  })
  server.get('/api/channels/:id/next-playlist',async(request,reply)=>{
    const {id}=request.params as {id:string},runtime=await runtimeFor(app,id)
    if(!runtime)return reply.code(404).send({error:'Canal não encontrado.'})
    const status=runtime.boundaryStatus()
    const rows=await app.db.select({revision:operationalPlaylistRevisions}).from(operationalPlaylistRevisions)
      .innerJoin(rundowns,eq(rundowns.id,operationalPlaylistRevisions.rundownId))
      .where(and(eq(rundowns.channelId,id),eq(operationalPlaylistRevisions.active,true)))
    const publicRun=(run:typeof status.current)=>run?{id:run.id,state:run.state,createdAt:run.createdAt,updatedAt:run.updatedAt,message:run.message?sanitizeDiagnostic(run.message):undefined,
      plan:{sourceRevisionId:run.plan.sourceRevisionId,targetRevisionId:run.plan.targetRevisionId,sourceName:run.plan.sourceName,targetName:run.plan.targetName,targetDate:run.plan.targetDate,firstItemTitle:run.plan.firstItemTitle,notBeforeMs:run.plan.notBeforeMs}}:null
    return {...status,channelId:id,current:publicRun(status.current),history:status.history.map(publicRun),canConfigure:await allowed(request,'PLAYLIST_PUBLISH'),
      canReconcile:await allowed(request,'OUTPUT_CONTROL'),options:rows.filter(({revision})=>revision.id!==status.sourceRevisionId).map(({revision})=>{
        const payload=readOperationalPayload(revision.payload)
        return {revisionId:revision.id,revision:revision.revision,name:payload.rundown.name,date:payload.rundown.date}
      })}
  })
  server.get('/api/channels/:id/next-playlist/review',async(request,reply)=>{
    if(!(await allowed(request,'PLAYLIST_PUBLISH')))return reply.code(403).send({error:'Seu papel não pode autorizar a próxima playlist.'})
    const {id}=request.params as {id:string},body=z.object({revisionId:z.string().min(1)}).safeParse(request.query)
    if(!body.success)return reply.code(400).send({error:'Selecione a revisão publicada de destino.'})
    const runtime=await runtimeFor(app,id)
    if(!runtime?.operationalRevision)return reply.code(409).send({error:'Publique e carregue a grade de origem antes de conferir a passagem.'})
    const identity=access.identity(request),owner={userId:identity?.id??null,username:identity?.username??null}
    try {
      const review=inspectBoundary(app.db,id,runtime.operationalRevision.id,body.data.revisionId,owner)
      const {owner:_owner,...publicReview}=review
      return {review:publicReview,nativeEngine:runtime.transport instanceof EngineTransport}
    }catch(error){return reply.code(409).send({error:error instanceof Error?error.message:String(error)})}
  })
  server.post('/api/channels/:id/next-playlist',async(request,reply)=>{
    const body=z.object({action:z.enum(['QUEUE','CANCEL','RECONCILE']),requestId:z.string().uuid(),sourceRevisionId:z.string().optional(),targetRevisionId:z.string().optional(),reviewToken:z.string().regex(/^[A-Za-z0-9_-]{43}$/).optional()}).strict().safeParse(request.body)
    if(!body.success)return reply.code(400).send({error:'Pedido de passagem inválido.'})
    const action=body.data.action==='RECONCILE'?'OUTPUT_CONTROL':'PLAYLIST_PUBLISH'
    if(!(await allowed(request,action)))return reply.code(403).send({error:'Seu papel não pode configurar/reconhecer esta passagem.'})
    const {id}=request.params as {id:string},runtime=await runtimeFor(app,id)
    if(!runtime)return reply.code(404).send({error:'Canal não encontrado.'})
    const identity=access.identity(request),owner={userId:identity?.id??null,username:identity?.username??null}
    const authorize=()=>{
      const fresh=access.identity(request)
      if(access.required()&&!fresh || !can(access.role(request),action) || !access.channelAllowed(request,id) || (fresh?.id??null)!==owner.userId)throw new CollaborativeEditError(403,{error:'A sessão/permissão mudou. Nenhuma passagem foi autorizada.'})
    }
    try {
      if(body.data.action==='QUEUE') {
        if(!body.data.sourceRevisionId || !body.data.targetRevisionId || runtime.operationalRevision?.id!==body.data.sourceRevisionId)throw new Error('A grade/revisão em execução mudou. Confira a passagem novamente.')
        const plan=inspectBoundary(app.db,id,body.data.sourceRevisionId,body.data.targetRevisionId,owner)
        const run=await runtime.queuePlaylistBoundary(body.data.requestId,plan,body.data.reviewToken,authorize)
        return {id:run.id,state:run.state,nativeProgramConfirmed:false,physicalOutputValidated:false}
      }
      if(body.data.action==='CANCEL') {
        const ledger=new PlaylistBoundaryLedger(app.db,id)
        const run=app.db.transaction(()=>{
          const cancelled=ledger.phase(body.data.requestId,['QUEUED','PREPARING','FAILED'],'CANCELLED',()=>{authorize();return true},{message:'Cancelada explicitamente pelo operador.'},owner.username)
          app.publishedContinuity.suspend(id,owner.username,'Passagem cancelada pelo operador; continuidade recorrente suspensa.')
          return cancelled
        },{behavior:'immediate'})
        runtime.restoreBoundaryProtection()
        return {id:run.id,state:run.state,nativeProgramConfirmed:false}
      }
      return mutatePlaylist(runtime,reply,async()=>{
        authorize();runtime.reconcilePlaylistBoundary(body.data.requestId,owner.username)
        return {id:body.data.requestId,state:'CANCELLED',replayed:false}
      })
    }catch(error){if(error instanceof CollaborativeEditError)return reply.code(error.status).send(error.payload);return reply.code(409).send({error:error instanceof Error?error.message:String(error)})}
  })
  server.get('/api/channels/:id/timeline', async (request, reply) => {
    const { id } = request.params as { id: string }
    const runtime = await runtimeFor(app, id)
    if (!runtime?.view) return reply.code(404).send({ error: 'Canal sem grade carregada.' })
    const now = rundownFrames(runtime.view.rundown.date, runtime.channel.rate) ?? 0
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

  server.get('/api/state', async (request) => {
    const channels = (await listChannels(app.db)).filter(channel => access.channelAllowed(request, channel.id))
    const activeIds=new Set(channels.map(channel=>channel.id))
    const rundowns = (await listRundowns(app.db)).filter(rundown => activeIds.has(rundown.channelId))
    return { channels, rundowns }
  })

  const channelSchema = z.object({
    name: z.string().min(1),
    audioChannels:z.union([z.literal(2),z.literal(8),z.literal(16)]).optional(),
    width: z.number().int().min(160).max(7680).optional(),
    height: z.number().int().min(120).max(4320).optional(),
    rateNum: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional(),
    rateDen: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional(),
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
      qcProfile:{...DEFAULT_QC_PROFILE,requireProbe:true},
      rateNum: body.data.rateNum ?? reference?.rate.num ?? RATE_PADRAO.num,
      rateDen: body.data.rateDen ?? reference?.rate.den ?? RATE_PADRAO.den,
      width: body.data.width ?? reference?.width ?? 1920,
      height: body.data.height ?? reference?.height ?? 1080,
      scan: body.data.scan ?? reference?.scan ?? 'PROGRESSIVE',
      fieldOrder: body.data.fieldOrder ?? reference?.fieldOrder ?? 'TFF',
      targetLufs: reference?.targetLufs ?? -23,
      ceilingDbtp: reference?.ceilingDbtp ?? -1,
      limiterLookaheadMs: reference?.limiterLookaheadMs ?? 5,
      audioChannels:body.data.audioChannels??reference?.audioChannels??2,
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
      date: localDate(new Date()),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    // O servidor de mídia ganha o caminho do canal novo, e o canal ganha suas
    // saídas gerenciadas: sem isto ele existiria na tela e em lugar nenhum.
    await syncDistribution(app)
    // Same as startup: the new channel's grade must be the runtime's grade, or
    // the Master shows it while CUE answers "Canal sem grade carregada" until a
    // server restart. Editorial load only; nothing is cued or put on air.
    const created = await runtimeFor(app, id)
    if (created && !created.view) await created.load(rundownId)
    onChange()
    return { channelId: id, rundownId }
  })

  const channelPatch = z.object({
    audioChannels:z.union([z.literal(2),z.literal(8),z.literal(16)]).optional(),
    expectedAudioChannels:z.union([z.literal(2),z.literal(8),z.literal(16)]).optional(),
    name: z.string().min(1).optional(),
    width: z.number().int().min(160).max(7680).optional(),
    height: z.number().int().min(120).max(4320).optional(),
    rateNum: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional(),
    rateDen: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional(),
    scan: z.enum(['PROGRESSIVE', 'INTERLACED']).optional(),
    fieldOrder: z.enum(['TFF', 'BFF']).optional(),
    targetLufs: z.number().min(-40).max(0).optional(),
    ceilingDbtp: z.number().min(-20).max(0).optional(),
  }).strict()

  server.get('/api/channels/:id/configuration',async(request,reply)=>{
    const {id}=request.params as {id:string},channel=await getChannel(app.db,id)
    if(!channel)return reply.code(404).send({error:'Canal ativo não encontrado.'})
    reply.header('ETag',channelConfigurationETag(id,channel.configurationRevision!))
    reply.header('Cache-Control','private, no-store')
    return {channel}
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
    if(!Object.keys(body.data).some(key=>key!=='expectedAudioChannels'))return reply.code(400).send({error:'Selecione ao menos uma configuração para alterar.'})

    if (!(await getChannel(app.db, id))) return reply.code(404).send({ error: 'Canal não encontrado.' })
    return configureChannel(id, reply, async () => {
      const changed=app.db.transaction(tx=>{
      assertConfigurationAccess(request,id)
      const row=tx.select().from(channels).where(eq(channels.id,id)).get()
      if(!row || row.archivedAt)throw new CollaborativeEditError(404,{error:'Canal ativo não encontrado.'})
      const revisionBefore=requireChannelConfiguration(tx,id,request.headers['if-match'])
      const current=toChannel(row)
      const audioChanged=body.data.audioChannels!==undefined && body.data.audioChannels!==(current.audioChannels??2)
      if(body.data.audioChannels!==undefined){
        if(body.data.expectedAudioChannels===undefined)throw new CollaborativeEditError(428,{error:'Confira o barramento atual antes de alterar os canais de áudio.'})
        if(body.data.expectedAudioChannels!==(current.audioChannels??2))throw new CollaborativeEditError(409,{error:'O barramento mudou desde a abertura. Reabra a configuração; nenhum canal foi alterado.'})
      }
      if(audioChanged){
        const state=app.runtimes.get(id)?.transport.state()
        if(state?.onAir || state?.preview || state?.playing)throw new CollaborativeEditError(409,{error:'Pare o PGM e limpe o CUE antes de mudar o barramento de áudio. Revise e publique novamente as grades após a mudança.'})
      }
      const rateChanged = BigInt(body.data.rateNum ?? current.rate.num) * BigInt(current.rate.den) !==
        BigInt(current.rate.num) * BigInt(body.data.rateDen ?? current.rate.den)
      if (rateChanged) {
        throw new CollaborativeEditError(409,{error:'Cortes, durações e horários são armazenados em quadros. Simule e confirme a conversão de cadência antes de alterar o FPS; revise e publique a grade convertida.'})
      }
      const antes = {
        width: current.width, height: current.height,
        rateNum: current.rate.num, rateDen: current.rate.den,
        scan: current.scan, fieldOrder: current.fieldOrder,
        audioChannels:current.audioChannels??2,
      }
      const formatChanged = Object.entries(antes).some(
        ([field, valor]) => body.data[field as keyof typeof antes] !== undefined && body.data[field as keyof typeof antes] !== valor,
      )

      const {expectedAudioChannels,...patch}=body.data
        if(audioChanged)assertChannelAudioChange(tx,id,patch.audioChannels!)
        tx.update(channels).set(patch).where(eq(channels.id,id)).run()
        if(audioChanged){
          const gradeIds=tx.select({id:rundowns.id}).from(rundowns).where(eq(rundowns.channelId,id)).all().map(row=>row.id)
          tx.update(rundowns).set({publicationRequired:true}).where(eq(rundowns.channelId,id)).run()
          for(let offset=0;offset<gradeIds.length;offset+=400)tx.update(operationalPlaylistRevisions).set({active:false,state:'SUPERSEDED'}).where(inArray(operationalPlaylistRevisions.rundownId,gradeIds.slice(offset,offset+400))).run()
        }
        tx.insert(operatorDecisions).values({id:randomUUID(),rundownId:'@configuration',kind:'CHANNEL_CONFIGURATION_CHANGED',payload:{channelId:id,fields:Object.keys(patch),before:Object.fromEntries(Object.keys(patch).map(key=>[key,row[key as keyof typeof row]])),after:patch,revisionBefore,revisionAfter:configurationRevision(tx,id),formatChanged,recovery:'REQUEST_AFTER_CONTROLLED_RESTART'},actorUsername:access.identity(request)?.username??null,createdAt:new Date().toISOString()}).run()
        return {formatChanged,nameChanged:patch.name!==undefined&&patch.name!==current.name}
      },{behavior:'immediate'})
      let recovery:{controlledInterruption:boolean;recoveryRequested:boolean;recoveryError:string|null}
      try{recovery=await rebuildChannel(id,changed.nameChanged?()=>syncDistribution(app):undefined)}
      catch(error){onChange();return {ok:true,applied:true,formatChanged:changed.formatChanged,engineError:sanitizeDiagnostic(error instanceof Error?error.message:'Engine não reconstruído. Confira o diagnóstico antes de operar.'),configurationRevision:configurationRevision(app.db,id)}}
      onChange()
      return { ok: true, applied:true,restarted: recovery.controlledInterruption,formatChanged:changed.formatChanged,engineError:recovery.recoveryError,configurationRevision:configurationRevision(app.db,id),...recovery }
    })
  })

  const cadenceRequest=z.object({rateNum:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),rateDen:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    format:channelPatch.omit({rateNum:true,rateDen:true,audioChannels:true,expectedAudioChannels:true}).strict().optional()})
  server.post('/api/channels/:id/cadence-preview',async(request,reply)=>{
    if(!(await allowed(request,'OUTPUT_CONTROL')))return reply.code(403).send({error:'Conversão de cadência exige Supervisor ou Administrador.'})
    const {id}=request.params as {id:string},body=cadenceRequest.safeParse(request.body)
    if(!body.success)return reply.code(400).send({error:'Formato/cadência inválidos.'})
    try{return {report:previewCadenceConversion(app.db,id,{num:body.data.rateNum,den:body.data.rateDen},body.data.format,tx=>{assertConfigurationAccess(request,id);requireChannelConfiguration(tx,id,request.headers['if-match'])}),applied:false}}
    catch(error){if(error instanceof CollaborativeEditError)return reply.code(error.status).send(error.payload);return reply.code(409).send({error:error instanceof Error?error.message:'Conversão não simulada.'})}
  })
  server.post('/api/channels/:id/cadence-convert',async(request,reply)=>{
    if(!(await allowed(request,'OUTPUT_CONTROL')))return reply.code(403).send({error:'Conversão de cadência exige Supervisor ou Administrador.'})
    const {id}=request.params as {id:string},body=cadenceRequest.extend({fingerprint:z.string().regex(/^[a-f0-9]{64}$/),confirm:z.literal(true)}).safeParse(request.body)
    if(!body.success)return reply.code(400).send({error:'Simule e confirme explicitamente a conversão antes de aplicar.'})
    return configureChannel(id,reply,async()=>{
      const previous=app.runtimes.get(id),state=previous?.transport.state()
      if(state?.onAir || state?.preview || state?.playing)return reply.code(409).send({error:'Pare o PGM e limpe o CUE antes de converter a cadência.'})
      const actor=await usernameOf(request)
      const freshState=previous?.transport.state()
      if(freshState?.onAir || freshState?.preview || freshState?.playing)return reply.code(409).send({error:'O estado mudou durante a confirmação. Pare o PGM e limpe o CUE antes de converter.'})
      let converted
      try{converted=applyCadenceConversion(app.db,id,{num:body.data.rateNum,den:body.data.rateDen},body.data.fingerprint,actor,body.data.format,tx=>{assertConfigurationAccess(request,id);requireChannelConfiguration(tx,id,request.headers['if-match'])})}
      catch(error){if(error instanceof CollaborativeEditError)return reply.code(error.status).send(error.payload);return reply.code(409).send({error:error instanceof Error?error.message:'Conversão recusada; nenhum dado alterado.'})}
      for(const rundownId of converted.rundownIds){
        app.history.forget(rundownId)
      }
      let engineError:string|null=null
      try{await rebuildChannel(id,()=>syncDistribution(app),true)}
      catch(error){engineError=sanitizeDiagnostic(error instanceof Error?error.message:'Engine não reconstruído; confira o diagnóstico antes de operar.')}
      onChange()
      return {ok:true,applied:true,...converted,engineError,automaticTake:false,controlledInterruption:Boolean(previous)}
    })
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

    const state=readEditorialState(app.db,matched.id)
    if(!state || state.channel.id!==id)return reply.code(404).send({error:'Grade ativa não encontrada.'})
    return { rundowns: channelRundowns, rundown: state.rundown, view:editorialView(state) }
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
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => rundownMidnight(value) !== null, 'Data de calendário inválida.'),
        name: z.string().min(1).optional(),
        copyFromRundownId: z.string().optional(),
      })
      .safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const rundownName = body.data.name ?? `Grade — ${channel.name} — ${body.data.date}`
    let newRundownId:string
    try {
      newRundownId=createEditorialRundown(app.db,{channelId:id,date:body.data.date,name:rundownName,copyFromRundownId:body.data.copyFromRundownId})
    } catch(error) {
      if(error instanceof EditorialRundownError)return reply.code(404).send({error:error.message})
      throw error
    }

    const state=readEditorialState(app.db,newRundownId)!
    onChange()
    return { rundown: state.rundown, view:editorialView(state) }
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
    const target = await getRundown(app.db, body.data.rundownId)
    if (!target || target.channelId !== id) return reply.code(404).send({ error: 'Grade não encontrada neste canal.' })
    let loadedView
    try { loadedView = await runtime.activateRundown(body.data.rundownId) }
    catch (error) { return reply.code(409).send({ error: error instanceof Error ? error.message : 'A grade não pôde ser ativada.' }) }
    if (!loadedView) return reply.code(404).send({ error: 'Grade não encontrada.' })

    onChange()
    return snapshot(app, runtime)
  })

  server.get('/api/assets', async () => ({ assets: await listAssets(app.db) }))

  /**
   * Explorador de arquivos. A árvore sai do próprio caminho do arquivo, então
   * a organização em disco é a organização que o operador vê.
   */
  server.get('/api/library', async (request) => {
    // Playout trabalha com vídeo; imagens e áudios podem continuar registrados
    // para não quebrar referências antigas, mas não entram no explorador.
    const channelId = (request.query as { channelId?: string }).channelId
    const assets = app.db.transaction(tx=>{
      const raw=new Map(tx.select().from(mediaAssets).all().map(row=>[row.id,toAsset(row)]))
      return [...(channelId?applyQcDecisionsNow(tx,raw,channelId):raw).values()].filter(asset=>asset.kind==='VIDEO').map(asset=>({...asset,qcRevision:qcRevision(tx,asset.id)}))
    })
    const roots = await Roots.listRoots(app.db, app.mediaRoot)

    // A pasta é o caminho inteiro de dentro da raiz, não o último pedaço dele.
    //
    // Antes a chave era só o nome da última pasta: `Programação/2026/Fevereiro`
    // e `Comerciais/Fevereiro` viravam os dois "Fevereiro" e se misturavam, e
    // toda a estrutura de subpastas sumia. Do lado de fora isso aparece como
    // "a pasta não está sendo lida por completo" -- os arquivos estão no
    // acervo, mas não onde o operador sabe procurar.
    const grupos = new Map<string, { rootId: string; rel: string; assets: Array<MediaAsset&{qcRevision:number}> }>()
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
    if (!asset) {
      return reply.code(404).send({ error: 'Arquivo não encontrado.' })
    }
    const query=request.query as {preview?:string;hash?:string;quality?:string}
    const preview = query.preview === '1'
    const quality=query.quality==='original'
    if(quality && preview)return reply.code(400).send({error:'Escolha preview leve ou inspeção do original, não ambos.'})
    if(quality && !query.hash)return reply.code(428).send({error:'Informe a versão conferida para inspecionar em qualidade.'})
    if(query.hash!==undefined && query.hash!==asset.contentHash)return reply.code(409).send({error:'A versão desta mídia mudou. Atualize a seleção; nenhum vídeo original foi enviado.'})
    if(quality)reply.header('cache-control','private, no-store').header('x-rplayout-rendition','original')
    const path = quality ? await app.mediaWorkflow.inspectionOriginal(asset.id,asset.contentHash,asset.path)
      : preview && asset.kind === 'VIDEO' ? await app.mediaWorkflow.preview(asset.id, asset.contentHash) : asset.path
    if(quality && !path)return reply.code(409).send({error:'Conteúdo do original não corresponde à versão conferida ou está indisponível. Reescaneie e selecione a edição correta antes de aprovar.'})
    if (!path || !existsSync(path)) return reply.code(preview ? 425 : 404).send({ error: preview ? 'Proxy leve ainda não disponível. Consulte a fila de mídia ou use a régua de quadros.' : 'Arquivo não encontrado.' })

    const tamanho = statSync(path).size
    const tipo = MIME[extname(path).toLowerCase()] ?? 'application/octet-stream'
    const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range ?? '')

    reply.header('accept-ranges', 'bytes').type(tipo)

    if (!range) {
      return reply.header('content-length', tamanho).send(createReadStream(path))
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
      .send(createReadStream(path, { start: inicio, end: fim }))
  })

  server.get('/api/assets/:id/workflow', async (request, reply) => {
    const { id } = request.params as { id: string }
    const asset = (await listAssets(app.db)).find(candidate => candidate.id === id)
    if (!asset) return reply.code(404).send({ error: 'Mídia não encontrada.' })
    const expectedHash=(request.query as {hash?:string}).hash
    if(expectedHash!==undefined && expectedHash!==asset.contentHash)return reply.code(409).send({error:'A versão desta mídia mudou. Atualize a seleção antes de conferir o preview.'})
    const preview = await app.mediaWorkflow.preview(id, asset.contentHash)
    return { versions: app.mediaWorkflow.versions(id), previewReady: Boolean(preview), previewUrl: preview ? `/api/assets/${encodeURIComponent(id)}/media?preview=1&hash=${encodeURIComponent(asset.contentHash)}` : null }
  })
  server.get('/api/media/jobs', async (request, reply) => {
    if (!(await allowed(request, 'REPORT_EXPORT'))) return reply.code(403).send({ error: 'Sem permissão para consultar fila de mídia.' })
    return { jobs: app.mediaWorkflow.jobs(), worker:{error:app.mediaWorkflow.lastError,cleanup:app.mediaWorkflow.cleanup},batches: app.sqlite.prepare('SELECT id,roots,state,error,created_at,updated_at FROM ingest_batches ORDER BY created_at DESC LIMIT 100').all() }
  })
  server.post('/api/media/jobs/:id/retry', async (request, reply) => {
    if (!(await allowed(request, 'PLAYLIST_EDIT'))) return reply.code(403).send({ error: 'Sem permissão para reexecutar análise de mídia.' })
    const { id } = request.params as { id: string }
    const body=z.object({confirmedPreviousStopped:z.boolean().optional()}).strict().safeParse(request.body??{})
    if(!body.success)return reply.code(400).send({error:'Confirmação de retomada inválida.'})
    return app.mediaWorkflow.retry(id,body.data.confirmedPreviousStopped===true,details=>{app.db.insert(operatorDecisions).values({id:randomUUID(),rundownId:'@library',kind:'MEDIA_JOB_RETRY_REQUESTED',payload:{...details,automaticTake:false},actorUsername:access.identity(request)?.username??null,createdAt:new Date().toISOString()}).run()}) ? { ok: true } : reply.code(409).send({ error: 'Somente trabalhos com falha podem ser reexecutados. Se o responsável anterior não foi identificado, confirme primeiro que aquela instância encerrou.' })
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
    const { total,quality,hash } = request.query as { total?: string;quality?:string;hash?:string }

    const quantos = Math.min(Math.max(Number(total ?? '12') | 0, 1), 64)
    const indice = Math.min(Math.max(Number(pos) | 0, 0), quantos - 1)

    const assets = await listAssets(app.db)
    const asset = assets.find((candidate) => candidate.id === id)
    if (!asset) return reply.code(404).send({ error: 'Arquivo não encontrado.' })

    const highQuality=quality==='original'
    if(highQuality && !hash)return reply.code(428).send({error:'Informe a versão conferida para inspecionar quadros em qualidade.'})
    if(hash!==undefined && hash!==asset.contentHash)return reply.code(409).send({error:'A mídia mudou. Atualize a seleção antes de inspecionar os quadros.'})

    // Quantas fatias diz para que serve o pedido: a fita embaixo da régua é
    // grosseira e cada quadro dela ocupa uns quarenta pixels na tela, enquanto
    // a divisão fina é a que alimenta a tela de conferência -- essa precisa dar
    // para ver onde cortar.
    const largura = highQuality ? (Math.max(64,Math.min(asset.probe?.width??1920,3840)) & ~1) : quantos > 24 ? 640 : 320
    // New picture recipe: do not relabel/reuse JPEGs baked by the old geometry.
    // Old caches stay recoverable; this address generates corrected frames.
    const prefixo = resolvePath(app.thumbnailDir, `${asset.contentHash}-${quantos}-picture-v2${highQuality?`-qc-frame-v3-${largura}`:''}`)
    const destino = `${prefixo}-${indice}.jpg`

    // Navigation strips need only the economical rendition. Opening a large
    // original for all 24 thumbnails delays QC and competes with playout.
    // Without a ready proxy show the existing static thumbnail instead of
    // silently launching expensive original decoding. Explicit quality always
    // uses the verified original, never this proxy.
    const inspectionPath=highQuality?await app.mediaWorkflow.inspectionOriginal(asset.id,asset.contentHash,asset.path)
      :await app.mediaWorkflow.preview(asset.id,asset.contentHash)
    if(highQuality&&!inspectionPath)return reply.code(409).send({error:'Original não corresponde à edição selecionada ou está indisponível. Reescaneie antes de aprovar.'})

    if (!existsSync(destino)) {
      if(!highQuality&&!inspectionPath)return reply.redirect(`/api/assets/${asset.id}/thumbnail.svg`)
      if ((await (highQuality?app.ingest.strip(inspectionPath!,quantos,prefixo,largura,indice):app.ingest.strip(inspectionPath!,quantos,prefixo,largura))) === 0) {
        if(highQuality)return reply.code(425).send({error:'Não foi possível extrair quadros em qualidade. Nenhuma miniatura foi anunciada como inspeção em qualidade.'})
        // Sem quadro, a régua usa a miniatura de sempre: ela fica pobre, e não
        // quebrada.
        return reply.redirect(`/api/assets/${asset.id}/thumbnail.svg`)
      }
      // A sonda pode ter parado no meio -- arquivo sem índice não busca até o
      // fim. As fatias que saíram servem; as que faltam caem na miniatura.
      if (!existsSync(destino)) {
        if(highQuality)return reply.code(425).send({error:'Quadro em qualidade indisponível; tente outro ponto ou confira a análise do arquivo.'})
        return reply.redirect(`/api/assets/${asset.id}/thumbnail.svg`)
      }
    }

    return reply
      .type('image/jpeg')
      .header('cache-control', 'private, max-age=604800, immutable')
      .header('x-rplayout-rendition',highQuality?`qc-jpeg-${largura}`:'thumbnail')
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
    const hoje = localDate(new Date())
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
   * Revisões operacionais são fotografias imutáveis da grade e do timing.
   * Editar o rundown depois disto não reescreve a revisão que foi aprovada.
   */
  server.get('/api/rundowns/:id/operational-playlists', async (request) => {
    const { id } = request.params as { id: string }
    return { revisions: await listOperationalPlaylists(app.db, id) }
  })

  server.put('/api/rundowns/:id/protected-zones', async (request, reply) => {
    if (!(await allowed(request, 'PLAYLIST_EDIT'))) return reply.code(403).send({ error: 'Seu papel não pode editar zonas protegidas.' })
    const { id } = request.params as { id: string }
    const body = z.object({ expectedZones: z.array(z.unknown()).max(100).optional(), zones: z.array(z.object({ id: z.string().min(1).max(80), label: z.string().trim().min(1).max(120), from: z.number().int().min(0), to: z.number().int().positive(), priority: z.union([z.literal(1),z.literal(2),z.literal(3),z.literal(4),z.literal(5)]) }).refine(zone => zone.to > zone.from, { message: 'Fim deve ser depois do início.' })).max(100) }).safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: 'Informe zonas válidas, com nome, início/fim em frames e prioridade 1–5.' })
    if (new Set(body.data.zones.map(zone => zone.id)).size !== body.data.zones.length) return reply.code(400).send({ error: 'As zonas precisam de identificadores distintos.' })
    const actor = await usernameOf(request)
    const conflictMessage = 'Outro operador alterou as zonas. Reabra a configuração e confira as regras atuais antes de salvar.'
    try {
      mutateEditorial(app.db,app.concurrency,id,request.headers['if-match'],(tx,state) => {
        assertEditorialAccess(request,state.channel.id)
        auditChannels.set(request,[state.channel.id])
        const horizon=Math.ceil(48*3600*state.channel.rate.num/state.channel.rate.den)
        if(body.data.zones.some(zone=>zone.to>horizon))throw new CollaborativeEditError(400,{error:'As zonas devem ficar dentro das 48 horas da grade; para cruzar meia-noite, use horário acima de 24h.'})
        const current=tx.select().from(rundowns).where(eq(rundowns.id,id)).get()
        if (!current || (body.data.expectedZones !== undefined && JSON.stringify(current.protectedZones ?? []) !== JSON.stringify(body.data.expectedZones))) throw new CollaborativeEditError(409,{error:conflictMessage})
        const remember=app.history.prepareCapture(tx,id,'zonas protegidas',{protectedZones:true})
        tx.update(rundowns).set({ protectedZones: body.data.zones, updatedAt: new Date().toISOString() }).where(eq(rundowns.id,id)).run()
        tx.insert(operatorDecisions).values({ id:randomUUID(), rundownId:id, itemId:null, kind:'PROTECTED_ZONES_EDITED', payload:{ previous:current.protectedZones ?? [], next:body.data.zones }, actorUsername:actor, createdAt:new Date().toISOString() }).run()
        return {value:true,remember}
      })
    } catch(error) {return automationError(reply,error)}
    const owner=await getRundown(app.db,id)
    await (owner&&app.runtimes.get(owner.channelId))?.refresh()
    onChange()
    return { ...await editorialSnapshot(app,id), zones: body.data.zones, publicationRequired: true }
  })

  server.get('/api/rundowns/:id/operational-playlist', async (request, reply) => {
    const { id } = request.params as { id: string }
    const active = await activeOperationalPlaylist(app.db, id)
    if (!active) return reply.code(404).send({ error: 'Nenhuma playlist operacional foi publicada para esta grade.' })
    return active
  })

  const protectReviewedExecution=(runtime:ChannelRuntime,payload:Parameters<typeof assertOnAirMediaUnchanged>[1]&{rundown:RundownView['rundown']},context:ReturnType<ChannelRuntime['interruptionContext']>)=>{
    if(JSON.stringify(runtime.interruptionContext())!==JSON.stringify(context))throw new Error('A execução mudou durante a publicação. Confira novamente o PGM e a revisão.')
    const preview=runtime.transport.state().preview
    if(preview?.kind==='ITEM'&&runtime.executionView){
      try{
        assertOnAirMediaUnchanged({rate:runtime.channel.rate,items:runtime.executionView.items.map(entry=>entry.item),assets:runtime.executionView.items.flatMap(entry=>entry.asset?[entry.asset]:[])},payload,preview.id)
        const previous=runtime.executionView,entry=previous.items.find(row=>row.item.id===preview.id)
        if(entry?.asset&&!entry.item.sourceRef&&!entry.item.liveEndpoint&&!entry.item.liveConfig?.sourceEndpoint){
          const candidate=buildView(payload.rundown,runtime.channel,payload.items,new Map((payload.assets??[]).map(asset=>[asset.id,asset])),null,runtime.transport.state().onAir)
          const next=candidate.items.find(row=>row.item.id===preview.id)
          if(!next||JSON.stringify(executionTrim(entry,previous.schedule.items.find(row=>row.id===preview.id),runtime.channel.rate,previous))!==JSON.stringify(executionTrim(next,candidate.schedule.items.find(row=>row.id===preview.id),runtime.channel.rate,candidate)))throw new Error('Corte calculado do CUE mudou.')
        }
      }
      catch{throw new Error('A revisão alteraria ou removeria a mídia/fonte/corte/áudio do item no CUE. Limpe o CUE e confira novamente antes de publicar.')}
    }
  }
  /** Espelho: cada publicação no canal de origem atualiza e publica a grade
   * espelhada dos canais vinculados. O item no ar do canal espelhado é
   * protegido como numa publicação manual; se a revisão mexer nele, o espelho
   * fica pendente (registrado) e o operador daquele canal decide. */
  const propagateMirrors=async(sourceChannelId:string,sourceRundownId:string,actor:string|null,onlyTarget?:string)=>{
    const results:Array<{channelId:string;ok:boolean;loaded?:boolean;rundownId?:string;items?:number;skippedGraphics?:number;unboundLive?:number;error?:string}>=[]
    for(const mirror of mirrorsFrom(app.db,sourceChannelId).filter(row=>!onlyTarget||row.targetChannelId===onlyTarget)){
      try{
        const target=await runtimeFor(app,mirror.targetChannelId)
        if(!target)throw new Error('Canal espelhado sem execução.')
        const work=async()=>{
          const report=syncMirrorRundown(app.db,mirror.targetChannelId,sourceRundownId)
          const loaded=target.executionView?.rundown.id===report.rundownId
          const onAir=loaded?target.transport.state().onAir?.itemId??null:null
          const context=target.interruptionContext()
          await publishOperationalPlaylist(app.db,target.channel,report.rundownId,`espelho:${actor??'sistema'}`,onAir,(_review,payload)=>{if(loaded)protectReviewedExecution(target,payload,context)})
          if(loaded)await target.refresh()
          return {loaded,...report}
        }
        const done=await (target.transport instanceof EngineTransport?target.transport.mutatePlaylist(work,()=>true):work()) as Awaited<ReturnType<typeof work>>
        recordMirrorSync(app.db,mirror.targetChannelId,null)
        results.push({channelId:mirror.targetChannelId,ok:true,...done})
      }catch(error){
        const message=sanitizeDiagnostic(error instanceof Error?error.message:String(error))
        try{recordMirrorSync(app.db,mirror.targetChannelId,message)}catch{}
        results.push({channelId:mirror.targetChannelId,ok:false,error:message})
      }
    }
    return results
  }
  // ---- Programação multicanal (cópia e espelho) ----
  const shareDenied=(request:FastifyRequest)=>(access.required()&&!access.identity(request))||!canShareAcrossChannels(access.role(request))||!can(access.role(request),'PLAYLIST_EDIT')
  const programmingError=(reply:{code:(status:number)=>{send:(body:unknown)=>unknown}},error:unknown)=>error instanceof ChannelProgrammingError?reply.code(error.status).send({error:error.message}):error instanceof CollaborativeEditError?reply.code(error.status).send(error.payload):reply.code(409).send({error:sanitizeDiagnostic(error instanceof Error?error.message:String(error))})
  server.get('/api/channels/:id/programming', async (request) => {
    const {id}=request.params as {id:string}
    const visible=(channelId:string)=>access.channelAllowed(request,channelId)
    return {mirror:mirrorOf(app.db,id),mirrorsFrom:mirrorsFrom(app.db,id).filter(row=>visible(row.targetChannelId)),canShare:!shareDenied(request)}
  })
  server.post('/api/channels/:id/copy-rundown', async (request, reply) => {
    const {id}=request.params as {id:string}
    if(shareDenied(request))return reply.code(403).send({error:'Copiar grade entre canais exige Supervisor ou Administrador.'})
    const body=z.object({copyFromRundownId:z.string().min(1),date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),name:z.string().trim().min(1).max(200).optional()}).strict().safeParse(request.body)
    if(!body.success)return reply.code(400).send({error:'Informe a grade de origem e, se quiser, a data e o nome.'})
    // O preHandler já conferiu o acesso aos dois canais (destino e dono da grade).
    try{const report=copyRundownToChannel(app.db,{sourceRundownId:body.data.copyFromRundownId,targetChannelId:id,date:body.data.date,name:body.data.name});onChange();return reply.code(201).send(report)}
    catch(error){return programmingError(reply,error)}
  })
  server.put('/api/channels/:id/mirror', async (request, reply) => {
    const {id}=request.params as {id:string}
    if(shareDenied(request))return reply.code(403).send({error:'Ligar ou desligar espelho exige Supervisor ou Administrador.'})
    const body=z.object({sourceChannelId:z.string().min(1).nullable()}).strict().safeParse(request.body)
    if(!body.success)return reply.code(400).send({error:'Informe o canal de origem (ou nulo para desligar).'})
    const source=body.data.sourceChannelId
    if(source&&!access.channelAllowed(request,source))return reply.code(403).send({error:'Sua conta não pode acessar o canal de origem.'})
    let mirror
    try{mirror=setMirror(app.db,id,source,access.identity(request)?.username??null)}catch(error){return programmingError(reply,error)}
    let initial=null
    // Primeira sincronização: a grade publicada que a origem executa agora.
    if(mirror){
      const origin=await runtimeFor(app,mirror.sourceChannelId),rundownId=origin?.operationalRevision?origin.executionView?.rundown.id:null
      if(rundownId)initial=(await propagateMirrors(mirror.sourceChannelId,rundownId,access.identity(request)?.username??null,id))[0]??null
    }
    onChange()
    return {mirror:mirror?mirrorOf(app.db,id):null,initial}
  })
  server.post('/api/rundowns/:id/operational-publish', async (request, reply) => {
    const { id } = request.params as { id: string }
    if (!(await allowed(request, 'PLAYLIST_PUBLISH'))) {
      return reply.code(403).send({ error: 'Seu papel não pode publicar a playlist operacional.' })
    }
    const body=z.object({reviewToken:z.string().regex(/^[A-Za-z0-9_-]{43}$/).optional()}).safeParse(request.body??{})
    if(!body.success)return reply.code(400).send({error:'Conferência de publicação inválida.'})
    const target = await getRundown(app.db, id)
    if (!target) return reply.code(404).send({ error: 'Grade não encontrada.' })
    const runtime = await runtimeFor(app, target.channelId)
    if (!runtime) return reply.code(404).send({ error: 'Canal não encontrado.' })
    return mutatePlaylist(runtime, reply, async () => {
    const actor = await usernameOf(request)
    const isLoaded = runtime.executionView?.rundown.id === id
    const context=runtime.interruptionContext()
    const onAirId = isLoaded ? runtime.transport.state().onAir?.itemId : null
    let revision
    try {
      // The first publication must protect a legacy execution too. Subsequent
      // publications use the persisted snapshot inside the domain service.
      revision = await publishOperationalPlaylist(app.db, runtime.channel, id, actor, onAirId ?? null,(review,payload)=>{
        authorizePublication(request,review);requireOperationalReview(review,body.data.reviewToken)
        if(isLoaded)protectReviewedExecution(runtime,payload,context)
        if(onAirId && !runtime.operationalRevision && runtime.executionView)assertOnAirMediaUnchanged({rate:runtime.channel.rate,items:runtime.executionView.items.map(entry=>entry.item),assets:runtime.executionView.items.flatMap(entry=>entry.asset?[entry.asset]:[])},payload,onAirId)
      })
    }
    catch (error) { if(error instanceof CollaborativeEditError)return reply.code(error.status).send(error.payload);return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) }) }
    let refreshError:string|null=null
    // A channel whose execution was cleared (cadence conversion) still owns
    // this grade in its editorial view; publishing must load it again.
    const reload=isLoaded||(!runtime.executionView&&runtime.view?.rundown.id===id)
    if(reload)try{await runtime.refresh()}catch{refreshError='Revisão gravada, mas a atualização da execução não foi confirmada. Confira o canal; não repita a publicação.'}
    const payload = readOperationalPayload(revision.payload)
    const mirrors=await propagateMirrors(runtime.channel.id,id,actor)
    try{onChange()}catch{refreshError??='Revisão gravada; atualização da tela não confirmada. Confira o canal.'}
    try{await emitIntegrationEvent(app.db, 'operational-playlist.published', {
      rundownId: id,
      revision: revision.revision,
      conflicts: payload.schedule.conflicts.length,
    }, runtime.channel.id)}catch{server.log.warn({rundownId:id,revision:revision.revision},'Publicação gravada; notificação de integração não confirmada.')}
    return reply.code(201).send({
      id: revision.id,
      revision: revision.revision,
      publishedAt: revision.publishedAt,
      conflicts: payload.schedule.conflicts,
      applied:true,
      executionUpdated:reload?refreshError===null:null,
      refreshError,
      mirrors,
    })
    }, () => runtime.executionView?.rundown.id === id)
  })

  server.get('/api/rundowns/:id/operational-simulation', async (request, reply) => {
    const { id } = request.params as { id: string }
    // A planning/read operation must never replace the channel's execution.
    let inspection
    try{inspection=inspectOperationalPlaylist(app.db,id)}catch(error){if(error instanceof CollaborativeEditError)return reply.code(error.status).send(error.payload);return reply.code(409).send({error:error instanceof Error?error.message:'Não foi possível conferir a grade.'})}
    const {payload:simulated,active,review}=inspection
    return { simulated,review, activeRevision: active?.revision ?? null,
      differences: { ...diffOperationalItems(active ? readOperationalPayload(active.payload).items : [], simulated.items), graphicsChanged: diffOperationalGraphics(active ? readOperationalPayload(active.payload) : null, simulated), timingPolicyChanged: JSON.stringify(active ? readOperationalPayload(active.payload).rundown.protectedZones ?? [] : []) !== JSON.stringify(simulated.rundown.protectedZones ?? []) } }
  })

  server.get('/api/rundowns/:id/operational-rollback-review',async(request,reply)=>{
    const {id}=request.params as {id:string},query=z.object({revisionId:z.string().min(1)}).safeParse(request.query)
    if(!query.success)return reply.code(400).send({error:'Informe a revisão a conferir.'})
    try{return app.db.transaction(()=>{
      const inspected=inspectOperationalRollback(app.db,id,query.data.revisionId)
      authorizePublication(request,inspected.review)
      const {payload:simulated,active,review,source}=inspected
      return {review,sourceRevision:source.revision,simulated,activeRevision:active?.revision??null,differences:{...diffOperationalItems(active?readOperationalPayload(active.payload).items:[],simulated.items),graphicsChanged:diffOperationalGraphics(active?readOperationalPayload(active.payload):null,simulated),timingPolicyChanged:JSON.stringify(active?readOperationalPayload(active.payload).rundown.protectedZones??[]:[])!==JSON.stringify(simulated.rundown.protectedZones??[])}}
    })}catch(error){if(error instanceof CollaborativeEditError)return reply.code(error.status).send(error.payload);return reply.code(409).send({error:error instanceof Error?error.message:'Conferência de rollback recusada.'})}
  })

  const durationInput=z.object({itemId:z.string().min(1),expectedFrames:z.number().int().min(0),deltaSeconds:z.number().int().min(-600).max(600).refine(value=>value!==0)}).strict()
  const compensationInput=z.object({itemId:z.string().min(1),expectedFrames:z.number().int().min(0),action:z.enum(['FILLER','TRIM','DROP_OPTIONAL','ACCEPT_DELAY']),deltaFrames:z.number().int()}).strict()
  const compensationContext=(runtime:ChannelRuntime)=>({...runtime.insertionContext(),onAir:runtime.transport.state().onAir,preview:runtime.transport.state().preview})
  server.get('/api/channels/:id/compensation/:requestId',async(request,reply)=>{
    const {id,requestId}=request.params as {id:string;requestId:string}
    if(!z.string().uuid().safeParse(requestId).success)return reply.code(400).send({error:'Identificador de solicitação inválido.'})
    try{
      assertEditorialAccess(request,id)
      return reply.header('cache-control','private, no-store').send(compensationReceipt(app.db,id,requestId,await usernameOf(request)))
    }catch(error){if(error instanceof CollaborativeEditError)return reply.code(error.status).send(error.payload);return reply.code(409).send({error:error instanceof Error?error.message:'Consulta indisponível.'})}
  })
  server.post('/api/channels/:id/compensation-review',async(request,reply)=>{
    const {id}=request.params as {id:string},body=compensationInput.safeParse(request.body)
    if(!body.success)return reply.code(400).send({error:'Informe item, ação e ajuste em quadros válidos.'})
    const runtime=await runtimeFor(app,id);if(!runtime)return reply.code(404).send({error:'Canal não encontrado.'})
    try{assertEditorialAccess(request,id);assertTransportOwnership(id);return reply.header('cache-control','private, no-store').send(inspectCompensation(app.db,compensationContext(runtime),body.data,await usernameOf(request)).review)}
    catch(error){if(error instanceof CollaborativeEditError)return reply.code(error.status).send(error.payload);return reply.code(409).send({error:error instanceof Error?error.message:'Compensação recusada.'})}
  })
  server.post('/api/channels/:id/compensation',async(request,reply)=>{
    const {id}=request.params as {id:string},body=z.object({input:compensationInput,requestId:z.string().uuid(),reviewToken:z.string().regex(/^[A-Za-z0-9_-]{43}$/)}).strict().safeParse(request.body)
    if(!body.success)return reply.code(400).send({error:'Confira a compensação antes de confirmar.'})
    const runtime=await runtimeFor(app,id);if(!runtime)return reply.code(404).send({error:'Canal não encontrado.'})
    return mutatePlaylist(runtime,reply,async()=>{
      try{
        const actor=await usernameOf(request)
        const result=commitCompensation(app.db,compensationContext(runtime),body.data.input,body.data.requestId,body.data.reviewToken,actor,()=>{assertEditorialAccess(request,id);assertTransportOwnership(id)})
        let refreshError:string|null=null
        try{await runtime.refresh();runtime.checkpoint(true)}catch{refreshError='Compensação gravada; atualização da execução não confirmada. Confira o canal.'}
        try{onChange()}catch{refreshError??='Compensação gravada; atualização da tela não confirmada.'}
        return {...result,applied:true,refreshError}
      }catch(error){if(error instanceof CollaborativeEditError)return reply.code(error.status).send(error.payload);return reply.code(409).send({error:error instanceof Error?error.message:'Compensação recusada.'})}
    })
  })
  const inspectLiveDuration=(runtime:ChannelRuntime,input:z.infer<typeof durationInput>,actor:string|null)=>{
    const context=runtime.insertionContext()
    if(context.onAirItemId!==input.itemId)throw new Error('O item no ar mudou. Confira o PGM antes de ajustar.')
    const active=app.db.select().from(operationalPlaylistRevisions).where(and(eq(operationalPlaylistRevisions.rundownId,context.rundownId),eq(operationalPlaylistRevisions.active,true))).get()
    if(!active || active.id!==context.revisionId)throw new Error('A revisão operacional mudou. Confira a grade antes de ajustar.')
    const item=readOperationalPayload(active.payload).items.find(item=>item.id===input.itemId)
    if(!item || !(item.type==='LIVE'||item.sourceRef||item.liveEndpoint))throw new Error('O item no ar não é uma entrada ao vivo.')
    const frames=item.liveConfig?.estimatedDuration??item.liveEstimatedDuration??item.durationOverride??0
    if(frames!==input.expectedFrames)throw new Error('A duração exibida mudou. Aguarde a atualização da grade antes de ajustar.')
    const reviewToken=installationVault().reviewIdentity(JSON.stringify({kind:'LIVE_DURATION',context,input,actor,configurationRevision:configurationRevision(app.db,runtime.channel.id)}),'live-duration-review:v1')
    return {reviewToken,context}
  }
  server.get('/api/channels/:id/live-duration-review',async(request,reply)=>{
    const {id}=request.params as {id:string}
    const input=durationInput.safeParse({...request.query as object,expectedFrames:Number((request.query as any).expectedFrames),deltaSeconds:Number((request.query as any).deltaSeconds)})
    if(!input.success)return reply.code(400).send({error:'Informe item, duração exibida e ajuste válido.'})
    const runtime=await runtimeFor(app,id)
    if(!runtime)return reply.code(404).send({error:'Canal não encontrado.'})
    try{
      assertEditorialAccess(request,id);assertTransportOwnership(id)
      const review=inspectLiveDuration(runtime,input.data,await usernameOf(request))
      return reply.header('cache-control','private, no-store').send({reviewToken:review.reviewToken,input:input.data})
    }catch(error){if(error instanceof CollaborativeEditError)return reply.code(error.status).send(error.payload);return reply.code(409).send({error:error instanceof Error?error.message:'Ajuste recusado.'})}
  })
  server.post('/api/channels/:id/live-duration', async (request, reply) => {
    if (!(await allowed(request, 'PLAYLIST_EDIT'))) return reply.code(403).send({ error: 'Seu papel não pode ajustar a duração ao vivo.' })
    const { id } = request.params as { id: string }
    const body = z.object({input:durationInput,requestId:z.string().uuid(),reviewToken:z.string().regex(/^[A-Za-z0-9_-]{43}$/)}).strict().safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: 'Informe ajuste em segundos entre -600 e +600, diferente de zero.' })
    const runtime = await runtimeFor(app, id)
    if (!runtime) return reply.code(404).send({ error: 'Canal não encontrado.' })
    return mutatePlaylist(runtime, reply, async () => {
    try {
      const actor=await usernameOf(request),decisionId=`live-duration:${body.data.requestId}`
      const digest=installationVault().reviewIdentity(JSON.stringify({channelId:id,actor,input:body.data.input,reviewToken:body.data.reviewToken}),'live-duration-request:v1')
      const result=app.db.transaction(tx=>{
        // Authorization is rechecked even for retries of an already committed request.
        assertEditorialAccess(request,id);assertTransportOwnership(id)
        const previous=tx.select().from(operatorDecisions).where(eq(operatorDecisions.id,decisionId)).get()
        if(previous){
          if(previous.kind!=='LIVE_DURATION_ADJUSTED'||previous.payload.digest!==digest)throw new Error('Identificador pertence a outro ajuste.')
          return {revision:previous.payload.revision as number,deduplicated:true}
        }
        const review=inspectLiveDuration(runtime,body.data.input,actor)
        if(review.reviewToken!==body.data.reviewToken)throw new Error('A execução ou configuração mudou. Confira o PGM e a grade antes de ajustar.')
        const onAir=runtime.transport.state().onAir
        if(!onAir || onAir.itemId!==review.context.onAirItemId)throw new Error('O PGM mudou durante o ajuste.')
        const revision=adjustPublishedLiveDuration(tx,runtime.channel,review.context.rundownId,onAir.itemId,secondsToFrames(body.data.input.deltaSeconds,runtime.channel.rate),Math.floor(onAir.elapsed),actor)
        tx.insert(operatorDecisions).values({id:decisionId,rundownId:review.context.rundownId,itemId:onAir.itemId,kind:'LIVE_DURATION_ADJUSTED',payload:{digest,revision:revision.revision,revisionId:revision.id,operation:readOperationalPayload(revision.payload).operation},actorUsername:actor,createdAt:new Date().toISOString()}).run()
        return {revision:revision.revision,deduplicated:false}
      },{behavior:'immediate'})
      // The durable commit must not be reported as rolled back if refresh fails.
      let refreshError:string|null=null
      try{await runtime.refresh();runtime.checkpoint(true)}catch{refreshError='Ajuste gravado, mas a execução não confirmou a atualização. Confira o canal antes de outro ajuste.'}
      try{onChange();return {...snapshot(app,runtime),...result,applied:true,refreshError}}
      catch{return {...result,applied:true,refreshError:refreshError??'Ajuste gravado; atualização da tela não confirmada. Confira o canal.'}}
    } catch (error) {if(error instanceof CollaborativeEditError)return reply.code(error.status).send(error.payload);return reply.code(409).send({ error: error instanceof Error ? error.message : 'Ajuste recusado.' }) }
    })
  })

  server.post('/api/rundowns/:id/operational-rollback', async (request, reply) => {
    const { id } = request.params as { id: string }
    if (!(await allowed(request, 'PLAYLIST_PUBLISH'))) return reply.code(403).send({ error: 'Seu papel não pode ativar revisões operacionais.' })
    const body = z.object({ revisionId: z.string().min(1),reviewToken:z.string().regex(/^[A-Za-z0-9_-]{43}$/).optional() }).safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: 'Informe a revisão a restaurar.' })
    const target = await getRundown(app.db, id)
    if (!target) return reply.code(404).send({ error: 'Grade não encontrada.' })
    const runtime = await runtimeFor(app, target.channelId)
    if (!runtime) return reply.code(404).send({ error: 'Canal não encontrado.' })
    return mutatePlaylist(runtime, reply, async () => {
    try {
      const actor = await usernameOf(request)
      const isLoaded = runtime.executionView?.rundown.id === id
      const context=runtime.interruptionContext()
      const revision = await rollbackOperationalPlaylist(app.db, id, body.data.revisionId, actor, isLoaded ? runtime.transport.state().onAir?.itemId ?? null : null,(review,payload)=>{authorizePublication(request,review);requireOperationalReview(review,body.data.reviewToken);if(isLoaded)protectReviewedExecution(runtime,payload,context)})
      let refreshError:string|null=null
      if(isLoaded)try{await runtime.refresh()}catch{refreshError='Rollback gravado, mas a atualização da execução não foi confirmada. Confira o canal; não repita a restauração.'}
      try{onChange()}catch{refreshError??='Rollback gravado; atualização da tela não confirmada.'}
      const result={revision:revision.revision,applied:true,executionUpdated:isLoaded?refreshError===null:null,refreshError}
      try{return {...snapshot(app,runtime),...result,snapshotAvailable:true}}
      catch{return {...result,snapshotAvailable:false,refreshError:refreshError??'Rollback gravado; leitura da tela não confirmada.'}}
    } catch (error) {
      if(error instanceof CollaborativeEditError)return reply.code(error.status).send(error.payload)
      return reply.code(409).send({ error: error instanceof Error ? error.message : 'Rollback recusado.' })
    }
    }, () => runtime.executionView?.rundown.id === id)
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
    if (!(await allowed(request, 'PLAYLIST_EDIT'))) {
      return reply.code(403).send({ error: 'Seu papel não pode importar para a grade editorial.' })
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

    const assets = [...(await applyQcDecisions(app.db, await assetMap(app.db), runtime.channel.id)).values()]
    const entradas =
      body.data.path !== undefined
        ? await Playlists.entriesOf(body.data.path, assets)
        : Playlists.resolveEntries(body.data.text ?? '', assets)
    let loadedCount:number
    try {
    loadedCount=mutateEditorial(app.db,app.concurrency,id,request.headers['if-match'],(tx,state)=>{
    assertEditorialAccess(request,state.channel.id)
    const assets=[...state.assets.values()]
    const currentView=editorialView(state)
    const aproveitadas = entradas.filter((entrada) => {
      const asset = entrada.mediaId ? assets.find((candidate) => candidate.id === entrada.mediaId) : null
      return asset && qcApproved(asset.qcStatus) && !asset.ignored && assessQc(asset,state.channel.qcProfile??DEFAULT_QC_PROFILE).playable
    })

    const remember=app.history.prepareCapture(tx,id,'carregar lista',{
      wholeRundown: true,
    })

    if (body.data.replace) {
      const noAr = runtime.transport.state().onAir?.itemId ?? null
      for (const entrada of currentView.items) {
        if (entrada.item.id === noAr) continue
        tx.delete(secondaryEvents).where(eq(secondaryEvents.itemId,entrada.item.id)).run()
        tx.delete(rundownItems).where(eq(rundownItems.id, entrada.item.id)).run()
      }
    }

    // A ordem é recalculada no fim: os itens que ficaram (o que está no ar,
    // ou a grade inteira quando não é substituição) vêm antes da lista.
    const ficaram = currentView.items
      .map((entrada) => entrada.item.id)
      .filter((itemId) => !body.data.replace || itemId === runtime.transport.state().onAir?.itemId)
    const novos: string[] = []

    for (const entrada of aproveitadas) {
      const asset = assets.find((candidate) => candidate.id === entrada.mediaId)
      if (!asset) continue

      const parada = isStill(asset)
        ? secondsToFrames(STILL_DEFAULT_SECONDS, state.channel.rate)
        : null
      const duracao =
        parada ??
        trimDuration(resolveTrim(null, asset, state.channel.rate).value)

      const itemId = randomUUID()
      novos.push(itemId)
      tx.insert(rundownItems).values({
        id: itemId,
        rundownId: id,
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
      }).run()
    }

    for (const [posicao, itemId] of [...ficaram, ...novos].entries()) {
      tx
        .update(rundownItems)
        .set({ sortOrder: (posicao + 1) * 10 })
        .where(eq(rundownItems.id, itemId))
        .run()
    }
    tx.insert(playlistVersions).values({
      id: randomUUID(),
      rundownId: id,
      sourcePath: body.data.path ?? null,
      sourceName: body.data.path?.split(/[\\/]/).pop() ?? 'lista importada',
      mode: body.data.replace ? 'PUBLISH_NEXT' : 'APPEND',
      loaded: aproveitadas.length,
      skipped: entradas.length - aproveitadas.length,
      scheduledDate: body.data.scheduledDate ?? null,
      publishedAt: new Date().toISOString(),
    }).run()
    return {value:aproveitadas.length,remember}
    })
    }catch(error){if(error instanceof CollaborativeEditError)return reply.code(error.status).send(error.payload);throw error}
    await runtime.refresh()
    onChange()
    await logDecision(app, id, null, 'EDITORIAL_PLAYLIST_IMPORTED', {
      replace:body.data.replace,editorialOnly:true,
      source: body.data.path ?? 'importada', loaded: loadedCount, skipped: entradas.length - loadedCount,
    }, await usernameOf(request))
    void emitIntegrationEvent(app.db, 'editorial-playlist.imported', { rundownId: id,replace:body.data.replace,editorialOnly:true, loaded: loadedCount, skipped: entradas.length - loadedCount }, runtime.channel.id)
    return {
      ...snapshot(app, runtime),
      loaded: loadedCount,
      skipped: entradas.length - loadedCount,
    }
  })

  // ---- acervo -----------------------------------------------------------

  server.get('/api/channels/:id/qc-profile', async (request, reply) => {
    const id=(request.params as {id:string}).id
    const result=app.db.transaction(tx=>{
      const channel=tx.select().from(channels).where(eq(channels.id,id)).get()
      return channel?{profile:channel.qcProfile??DEFAULT_QC_PROFILE,configurationRevision:configurationRevision(tx,id)}:null
    })
    if(!result)return reply.code(404).send({error:'Canal não encontrado.'})
    return reply.header('cache-control','private, no-store').header('etag',channelConfigurationETag(id,result.configurationRevision)).send(result)
  })
  server.put('/api/channels/:id/qc-profile', async (request, reply) => {
    if (!(await allowed(request, 'OUTPUT_CONTROL'))) return reply.code(403).send({ error: 'Supervisor precisa definir o perfil técnico.' })
    const body = qcProfileSchema.safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })
    const id = (request.params as { id: string }).id
    const ownerId=access.identity(request)?.id??null
    let result:{profile:typeof body.data;configurationRevision:number}
    try{result=app.db.transaction(tx=>{
      assertConfigurationAccess(request,id)
      if((access.identity(request)?.id??null)!==ownerId)throw new CollaborativeEditError(403,{error:'A sessão mudou antes da confirmação.'})
      const channel=tx.select().from(channels).where(eq(channels.id,id)).get()
      if(!channel)throw new CollaborativeEditError(404,{error:'Canal não encontrado.'})
      if(channel.archivedAt)throw new CollaborativeEditError(409,{error:'Canal arquivado: perfil preservado.'})
      const before=requireChannelConfiguration(tx,id,request.headers['if-match'])
      const savedProfile={...body.data,requireProbe:body.data.requireProbe??channel.qcProfile?.requireProbe??false}
      tx.update(channels).set({qcProfile:savedProfile}).where(eq(channels.id,id)).run()
      const revision=configurationRevision(tx,id)
      tx.insert(operatorDecisions).values({id:randomUUID(),rundownId:'@qc',kind:'QC_PROFILE_CHANGED',payload:{channelId:id,before:channel.qcProfile??DEFAULT_QC_PROFILE,profile:savedProfile,revisionBefore:before,revisionAfter:revision},actorUsername:access.identity(request)?.username??null,createdAt:new Date().toISOString()}).run()
      return {profile:savedProfile,configurationRevision:revision}
    },{behavior:'immediate'})}catch(error){return automationError(reply,error)}
    // A committed profile change isn't a rollback if updating the view fails.
    // This route never reconfigures the decoder or issues transport commands.
    app.runtimes.get(id)?.applyCommittedQcProfile(result.profile)
    let refreshError:string|null=null
    try{await app.runtimes.get(id)?.refresh();onChange()}catch{refreshError='Perfil gravado; falha ao atualizar a visão. Consulte o canal novamente.'}
    return reply.header('etag',channelConfigurationETag(id,result.configurationRevision)).send({...result,refreshError,message:refreshError??'Perfil gravado. Elegibilidade dos próximos arquivos será reconferida; o decoder do item no ar foi preservado.'})
  })
  server.get('/api/assets/:id/qc', async (request, reply) => {
    const id = (request.params as { id: string }).id, channelId = (request.query as { channelId?: string }).channelId
    const result=app.db.transaction(tx=>{
      const asset=tx.select().from(mediaAssets).where(eq(mediaAssets.id,id)).get()
      const channel=channelId?tx.select().from(channels).where(eq(channels.id,channelId)).get():null
      if(!asset||!channel)return null
      const review={assetId:id,channelId:channel.id,contentHash:asset.contentHash,assetRevision:qcRevision(tx,id),configurationRevision:configurationRevision(tx,channel.id)}
      const decisions=tx.select().from(qcDecisions).where(and(eq(qcDecisions.assetId,id),eq(qcDecisions.contentHash,asset.contentHash),or(eq(qcDecisions.channelId,channel.id),eq(qcDecisions.channelId,'@all')))).orderBy(desc(sql`rowid`)).all()
      return {contentHash:asset.contentHash,review,profile:channel.qcProfile??DEFAULT_QC_PROFILE,checks:assessQc(toAsset(asset),channel.qcProfile??DEFAULT_QC_PROFILE),decisions}
    })
    if(!result)return reply.code(404).send({error:'Arquivo/canal não encontrado.'})
    return reply.header('cache-control','private, no-store').header('etag',qcDecisionETag(result.review)).send(result)
  })
  server.post('/api/assets/:id/qc', async (request, reply) => {
    if (!(await allowed(request, 'PLAYLIST_EDIT'))) return reply.code(403).send({ error: 'Sem permissão para avaliar mídia.' })
    const body = z.object({ channelId: z.string(), contentHash: z.string(), status: z.enum(['PENDING', 'ANALYSIS', 'APPROVED', 'APPROVED_WITH_NOTES', 'REJECTED', 'BLOCKED']), notes: z.string().max(2000).optional() }).safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })
    if (body.data.status === 'APPROVED_WITH_NOTES' && !body.data.notes?.trim()) return reply.code(400).send({ error: 'Descreva a ressalva para liberar com exceção registrada.' })
    const id=(request.params as {id:string}).id,channelId=body.data.channelId,ownerId=access.identity(request)?.id??null
    let saved:{checks:ReturnType<typeof assessQc>;assetRevision:number}
    try{saved=app.db.transaction(tx=>{
      assertQcAccess(request,channelId,ownerId)
      const current=tx.select().from(mediaAssets).where(eq(mediaAssets.id,id)).get(),channel=tx.select().from(channels).where(eq(channels.id,channelId)).get()
      if(!current||!channel)throw new CollaborativeEditError(404,{error:'Arquivo/canal não encontrado.'})
      const before=requireQcReview(tx,id,request.headers['if-match'],channelId)
      if(current.contentHash!==body.data.contentHash)throw new CollaborativeEditError(409,{error:'O arquivo mudou durante a conferência. Revise a nova versão antes de decidir.'})
      const checks=assessQc(toAsset(current),channel.qcProfile??DEFAULT_QC_PROFILE)
      if(qcApproved(body.data.status)&&!checks.playable)throw new CollaborativeEditError(409,{error:checks.errors.join(' '),checks})
      const actor=access.identity(request)?.username??null,now=new Date().toISOString(),decisionId=randomUUID()
      tx.insert(qcDecisions).values({id:decisionId,assetId:id,contentHash:current.contentHash,channelId,status:body.data.status,notes:body.data.notes?.trim()??null,checks,actor,createdAt:now}).run()
      const after=qcRevision(tx,id)
      tx.insert(operatorDecisions).values({id:randomUUID(),rundownId:'@qc',kind:'QC_DECISION',payload:{assetId:id,contentHash:current.contentHash,channelId,status:body.data.status,notes:body.data.notes?.trim()??null,checks,decisionId,revisionBefore:before,revisionAfter:after},actorUsername:actor,createdAt:now}).run()
      return {checks,assetRevision:after}
    },{behavior:'immediate'})}catch(error){return automationError(reply,error)}
    let refreshError:string|null=null
    try{for(const runtime of app.runtimes.values())await runtime.refresh();onChange()}catch{refreshError='QC gravado; falha ao atualizar a visão. Consulte a conferência novamente.'}
    return {ok:true,...saved,refreshError}
  })

  const assetPatch = z.object({
    expectedContentHash: z.string().optional(),
    title: z.string().min(1).optional(),
    categoryId: z.string().min(1).nullable().optional(),
    ignored: z.boolean().optional(),
    qcStatus: z.enum(['PENDING', 'ANALYSIS', 'APPROVED', 'APPROVED_WITH_NOTES', 'REJECTED', 'FAILED', 'BLOCKED']).optional(),
    qcNotes: z.string().max(2_000).nullable().optional(),
  }).strict().refine(body=>body.title!==undefined||body.categoryId!==undefined||body.qcStatus!==undefined||body.ignored!==undefined,'Informe os campos da alteração.').refine(body=>body.qcNotes===undefined || body.qcStatus!==undefined || body.ignored!==undefined,'Informe o estado QC junto com a observação.')

  server.get('/api/assets/:id/metadata-review',(request,reply)=>{
    try{
      const result=readAssetMetadata(app.db,(request.params as {id:string}).id,captureAssetMetadataAuthority(app.db,request))
      return reply.header('cache-control','private, no-store').header('etag',assetMetadataETag(result)).send(result)
    }catch(error){return automationError(reply,error)}
  })
  const saveAssetMetadata=(request:FastifyRequest,reply:any)=>{
    try{
      const result=editAssetMetadata(app.db,(request.params as {id:string}).id,request.body,request.headers['if-match'],captureAssetMetadataAuthority(app.db,request))
      let refreshError:string|null=null
      try{onChange()}catch{refreshError='Metadados gravados; falha ao atualizar a visão. Consulte o acervo novamente.'}
      return reply.header('cache-control','private, no-store').header('etag',result.eTag).send({...result,refreshError})
    }catch(error){return automationError(reply,error)}
  }
  server.patch('/api/assets/:id/metadata',saveAssetMetadata)

  server.patch('/api/assets/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    // Metadata authority is captured synchronously before any permission await.
    // A changed session owner cannot inherit the prior actor's draft.
    const raw=request.body
    if(raw!==null&&typeof raw==='object'&&(Object.hasOwn(raw,'title')||Object.hasOwn(raw,'categoryId')))return saveAssetMetadata(request,reply)
    if (!(await allowed(request, 'PLAYLIST_EDIT'))) return reply.code(403).send({ error: 'Seu papel não pode editar o acervo.' })
    const body = assetPatch.safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const [asset] = await app.db.select().from(mediaAssets).where(eq(mediaAssets.id, id)).limit(1)
    if (!asset) return reply.code(404).send({ error: 'Arquivo não encontrado no acervo.' })
    if (body.data.expectedContentHash !== undefined && body.data.expectedContentHash !== asset.contentHash) return reply.code(409).send({ error: 'A versão do arquivo mudou. Atualize a conferência.' })

    // A decisão de QC é atômica: aprovar também o devolve do acervo oculto;
    // rejeitar o coloca em quarentena. O antigo campo `ignored` continua
    // aceito para compatibilidade, mas passa a produzir uma decisão explícita.
    const qcStatus = body.data.qcStatus ??
      (body.data.ignored === true ? 'REJECTED' : body.data.ignored === false ? 'APPROVED' : undefined)
    if (qcStatus === 'APPROVED_WITH_NOTES' && !body.data.qcNotes?.trim()) return reply.code(400).send({ error: 'Informe a ressalva.' })
    if (qcStatus && qcApproved(qcStatus) && asset.probeError) return reply.code(409).send({ error: asset.probeError })
    const { expectedContentHash: _expectedContentHash, ...fields } = body.data
    const update = {
      ...fields,
      ...(qcStatus ? {
        qcStatus,
        qcCheckedAt: qcStatus === 'PENDING' ? null : new Date().toISOString(),
        ignored: ['REJECTED', 'FAILED', 'BLOCKED'].includes(qcStatus) ? true : qcApproved(qcStatus) ? false : asset.ignored,
      } : {}),
    }
    const ownerId=access.identity(request)?.id??null
    let saved:boolean
    try{saved = app.db.transaction(tx => {
      assertQcAccess(request,null,ownerId)
      const current = tx.select().from(mediaAssets).where(eq(mediaAssets.id, id)).get()
      if (!current || current.contentHash !== asset.contentHash || (qcStatus && qcApproved(qcStatus) && current.probeError)) return false
      const before=qcStatus?requireQcReview(tx,id,request.headers['if-match']):null
      const checks=assessQc(toAsset(current))
      if(qcStatus&&qcApproved(qcStatus)&&!checks.playable)throw new CollaborativeEditError(409,{error:checks.errors.join(' '),checks})
      tx.update(mediaAssets).set(update).where(eq(mediaAssets.id, id)).run()
      if(qcStatus){
        const now=new Date().toISOString(),decisionId=randomUUID(),notes=body.data.qcNotes?.trim()??null
        tx.insert(qcDecisions).values({id:decisionId,assetId:id,contentHash:current.contentHash,channelId:'@all',status:qcStatus as QcStatus,notes,checks,actor:access.identity(request)?.username??null,createdAt:now}).run()
        tx.insert(operatorDecisions).values({id:randomUUID(),rundownId:'@qc',kind:'QC_GLOBAL_DECISION',payload:{assetId:id,contentHash:current.contentHash,status:qcStatus,notes,checks,decisionId,revisionBefore:before,revisionAfter:qcRevision(tx,id)},actorUsername:access.identity(request)?.username??null,createdAt:now}).run()
      }
      return true
    },{behavior:'immediate'})}catch(error){return automationError(reply,error)}
    if (!saved) return reply.code(409).send({ error: 'O arquivo mudou ou ficou indisponível antes de salvar. Atualize a conferência.' })
    let refreshError:string|null=null
    try{for(const runtime of app.runtimes.values())await runtime.refresh();onChange()}catch{refreshError='Alteração gravada; falha ao atualizar a visão. Consulte o acervo novamente.'}
    return { ok: true,refreshError }
  })

  server.get('/api/assets/:id/removal-review',(request,reply)=>{
    try{
      const review=readAssetRemoval(app,'REMOVE',(request.params as {id:string}).id,captureAssetRemovalAuthority(app.db,request))
      return reply.header('cache-control','private, no-store').header('etag',assetRemovalETag(review)).send(review)
    }catch(error){return automationError(reply,error)}
  })
  server.get('/api/assets/prune-review',(request,reply)=>{
    try{
      const review=readAssetRemoval(app,'PRUNE',null,captureAssetRemovalAuthority(app.db,request))
      return reply.header('cache-control','private, no-store').header('etag',assetRemovalETag(review)).send(review)
    }catch(error){return automationError(reply,error)}
  })
  const saveAssetRemoval=(operation:'REMOVE'|'PRUNE')=>(request:FastifyRequest,reply:any)=>{
    try{
      const authority=captureAssetRemovalAuthority(app.db,request)
      if(Object.keys(request.query as object).length)throw new CollaborativeEditError(400,{error:'Remoção não aceita force nem escopo forjado. Confira o impacto original.'})
      const result=applyAssetRemoval(app,operation,operation==='REMOVE'?(request.params as {id:string}).id:null,request.body,request.headers['if-match'],authority)
      let refreshError:string|null=null
      // No await gap permits an old unpublished runtime to execute removed
      // editorial rows. Earlier loads are fenced before notifying observers.
      for(const runtime of app.runtimes.values())try{runtime.invalidateCatalogRemoval((request.body as {assetIds:string[]}).assetIds)}catch{refreshError='Remoção gravada; falha ao atualizar uma visão. Confira o canal antes de comandá-lo.'}
      try{onChange()}catch{refreshError='Remoção gravada; falha ao notificar a visão. Consulte o acervo novamente.'}
      return reply.header('cache-control','private, no-store').send({...result,refreshError})
    }catch(error){return automationError(reply,error)}
  }
  server.delete('/api/assets/:id',saveAssetRemoval('REMOVE'))
  server.post('/api/assets/prune',saveAssetRemoval('PRUNE'))

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

  server.get('/api/categories/:id/review',async(request,reply)=>{
    const {id}=request.params as {id:string}
    try{const review=readCategory(app.db,id,categoryAuthority(app.db,request));return reply.header('cache-control','private, no-store').header('etag',categoryETag(review)).send(review)}
    catch(error){if(error instanceof CollaborativeEditError)return reply.code(error.status).send(error.payload);return reply.code(409).send({error:'Conferência indisponível; nenhuma categoria foi alterada.'})}
  })
  const categoryMutation=async(request:import('fastify').FastifyRequest,reply:import('fastify').FastifyReply,action:'SET'|'DELETE')=>{
    const {id}=request.params as {id:string}
    let result
    try{result=editCategory(app.db,id,action,request.body,request.headers['if-match'],categoryAuthority(app.db,request))}
    catch(error){if(error instanceof CollaborativeEditError)return reply.code(error.status).send(error.payload);return reply.code(409).send({error:'Categoria não foi alterada; confira a auditoria e tente novamente.'})}
    let refreshError:string|null=null
    if(action==='DELETE')for(const runtime of app.runtimes.values())try{await runtime.refresh()}catch{refreshError='Remoção gravada, mas atualização da grade não confirmada. Não repita a remoção.'}
    try{onChange()}catch{refreshError??='Categoria gravada; atualização da tela não confirmada. Não repita a gravação.'}
    return {...result,ok:true,refreshError}
  }

  /** Cria a categoria ou troca a cor dela. O nome é a chave. */
  server.put('/api/categories/:id', async (request, reply) => {
    return categoryMutation(request,reply,'SET')
  })

  /**
   * Apaga a categoria e tira a marca dos arquivos dela.
   *
   * Deixar a marca em arquivo cuja categoria não existe mais daria uma cor
   * fantasma na grade e uma opção que não aparece em lista nenhuma.
   */
  server.delete('/api/categories/:id', async (request, reply) => {
    return categoryMutation(request,reply,'DELETE')
  })

  /** Archive decommissions the channel, preserving published/as-run history. */
  server.delete('/api/channels/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    if (!(await allowed(request, 'OUTPUT_CONTROL'))) return reply.code(403).send({ error: 'Seu papel não pode arquivar canais.' })
    if (!(await getChannel(app.db,id,true))) return reply.code(404).send({error:'Canal não encontrado.'})
    return configureChannel(id,reply,async()=>{
      const runtime=app.runtimes.get(id),state=runtime?.transport.state()
      if (state?.playing || state?.onAir || state?.preview) return reply.code(409).send({error:'Pare o PGM e limpe o CUE antes de arquivar o canal.'})
      if (runtime) { await runtime.followAsRun(); runtime.checkpoint(true) }
      const result=app.sqlite.transaction(()=>{
        const archived=setChannelArchived(app.sqlite,id,true,access.identity(request)?.username ?? null)
        runtime?.cancelQueuedBoundaryOnStop(access.identity(request)?.username ?? null)
        app.publishedContinuity.suspend(id,access.identity(request)?.username ?? null,'Canal arquivado; continuidade recorrente suspensa.')
        app.schedulePublication.suspend(id,access.identity(request)?.username ?? null,'Canal arquivado; publicação automática suspensa.')
        return archived
      })()
      runtime?.close();app.runtimes.delete(id);app.pgmProbes.delete(id)
      for(const owner of [`runtime:${id}`,`channel:${id}`,`contingency:${id}`,`boundary:${id}`]) app.continuityCache.replaceProtection(owner,[])
      await syncDistribution(app);onChange()
      return {ok:true,...result,historyPreserved:true}
    })
  })

  server.get('/api/channels/archived',async(request,reply)=>{
    if (!(await allowed(request,'REPORT_EXPORT'))) return reply.code(403).send({error:'Sem permissão para consultar histórico.'})
    return {channels:(await listChannels(app.db,true)).filter(channel=>channel.archivedAt && access.channelAllowed(request,channel.id))}
  })
  server.post('/api/channels/:id/reactivate',async(request,reply)=>{
    const {id}=request.params as {id:string}
    if (!(await allowed(request,'OUTPUT_CONTROL'))) return reply.code(403).send({error:'Reativar canal exige Supervisor ou Administrador.'})
    if (!(await getChannel(app.db,id,true))) return reply.code(404).send({error:'Canal não encontrado.'})
    return configureChannel(id,reply,async()=>{
      const result=setChannelArchived(app.sqlite,id,false,access.identity(request)?.username ?? null)
      await syncDistribution(app);onChange()
      // Do not instantiate/TAKE here. The explicit operator activation/startup
      // may open configured publishers, but its persisted PGM remains stopped.
      return {ok:true,...result,automaticTake:false}
    })
  })


  server.get('/api/library/scan', async () => {
    const roots = await Roots.listRoots(app.db, app.mediaRoot)
    const estado = app.ingest.status()
    const activeBatches=readScanDiagnostics(app.sqlite)
    return {
      ...estado,
      running:activeBatches.some(batch=>batch.state==='RUNNING'),
      globalBusy:activeBatches.length>0,
      localRunning:estado.running,
      progressAvailable:estado.running,
      activeBatches,
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

    return configureChannel(id, reply, async () => {
      await configurationAudit(request, id, 'CHANNEL_RESTART_REQUESTED', { controlledInterruption: true })
      const result = await rebuildChannel(id)
      onChange()
      return { ok: true, ...result }
    })
  })

  /** As pastas do acervo. */
  const rootResult=(reply:import('fastify').FastifyReply,work:()=>unknown)=>{try{return work()}catch(error){if(error instanceof CollaborativeEditError)return reply.code(error.status).send(error.payload);return reply.code(409).send({error:'Conferência das pastas indisponível; nenhuma alteração aplicada.'})}}
  server.get('/api/library/roots/review',async(request,reply)=>rootResult(reply,()=>{const review=readRootCatalog(app.db,rootAuthority(app.db,request));return reply.header('cache-control','private, no-store').header('etag',rootCatalogETag(review)).send(review)}))
  server.get('/api/library/roots/add-review',async(request,reply)=>rootResult(reply,()=>{const query=z.object({path:z.string().min(1).max(4096)}).strict().safeParse(request.query);if(!query.success)return reply.code(400).send({error:'Informe somente o caminho da pasta.'});const review=readRootAdd(app.db,query.data.path,rootAuthority(app.db,request));return reply.header('cache-control','private, no-store').header('etag',rootAddETag(review)).send(review)}))
  server.get('/api/library/roots', async () => ({
    roots: await Roots.listRoots(app.db, app.mediaRoot),
  }))

  // Seletor remoto: enumera pastas no host do servidor e devolve JSON para a
  // página. Nunca abre Explorer/WinForms na estação onde o servidor está.
  server.get('/api/library/roots/browse', async (request, reply) => {
    if (!(await allowed(request, 'PLAYLIST_EDIT'))) return reply.code(403).send({ error: 'Seu papel não pode navegar as pastas do servidor.' })
    const { path } = request.query as { path?: string }
    try {
      return await Roots.browseServerFolders(app.mediaRoot, path)
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : 'Não consegui abrir a pasta no servidor.' })
    }
  })

  server.post('/api/library/roots/pick', async (request, reply) => {
    if (!(await allowed(request, 'PLAYLIST_EDIT'))) return reply.code(403).send({ error: 'Seu papel não pode adicionar pastas.' })
    return reply.code(410).send({
      error: 'O seletor local foi desativado. Use “Navegar no servidor” na página para escolher a pasta remotamente.',
    })
  })

  server.post('/api/files/pick', async (request, reply) => {
    if (!(await allowed(request, 'OUTPUT_CONTROL'))) return reply.code(403).send({ error: 'Sem permissão para escolher destinos de gravação.' })
    return reply.code(410).send({ error: 'O seletor local foi desativado. Escolha a pasta do servidor e o nome da gravação na página.' })
  })

  server.post('/api/files/target', async (request, reply) => {
    if (!(await allowed(request, 'OUTPUT_CONTROL'))) return reply.code(403).send({ error: 'Sem permissão para escolher destinos de gravação.' })
    const body = z.object({ folder: z.string().min(1).max(4096), filename: z.string().min(1).max(160) }).safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: 'Informe a pasta do servidor e o nome do arquivo .mkv.' })
    const target = Roots.recordingTarget(body.data.folder, body.data.filename)
    if (!target.ok) return reply.code(target.status).send({ error: target.error })
    return { path: target.path }
  })

  server.post('/api/library/roots', async (request, reply) => {
    let result:ReturnType<typeof addRootConferred>
    try {result=addRootConferred(app.db,request.body,request.headers['if-match'],rootAuthority(app.db,request),app.ingest.available)}
    catch(error){if(error instanceof CollaborativeEditError)return reply.code(error.status).send(error.payload);return reply.code(409).send({error:'Pasta não cadastrada; conferência ou auditoria indisponível.'})}
    if(!result.scanBatchId)return {...result,scanning:false,scanRequired:true,scanState:null,scanError:'Sonda indisponível; pasta cadastrada sem pedido de leitura.'}
    try{app.ingest.resumePending();const row=app.sqlite.prepare('SELECT state FROM ingest_batches WHERE id=?').get(result.scanBatchId) as {state:string}|undefined;return {...result,scanning:row?.state==='RUNNING',scanRequired:false,scanState:row?.state??'UNKNOWN'}}
    catch{return {...result,scanning:false,scanRequired:false,scanState:'UNKNOWN',scanError:'Pasta e pedido confirmados; início/status indisponível. Não repita o cadastro.'}}
  })

  server.delete('/api/library/roots/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    try{return removeRootConferred(app.db,id,request.body,request.headers['if-match'],rootAuthority(app.db,request))}
    catch(error){if(error instanceof CollaborativeEditError)return reply.code(error.status).send(error.payload);return reply.code(409).send({error:'Pasta não removida; conferência ou auditoria indisponível.'})}
  })

  server.get('/api/library/scan/review',async(request,reply)=>rootResult(reply,()=>{const review=readScanReview(app.db,rootAuthority(app.db,request),app.ingest.available);return reply.header('cache-control','private, no-store').header('etag',scanETag(review)).send(review)}))
  server.post('/api/library/scan/recover',async(request,reply)=>{
    let result:import('@rplayout/protocol').ScanCommandResult
    try{result=recoverScan(app.db,request.body,request.headers['if-match'],rootAuthority(app.db,request),app.ingest.available)}catch(error){if(error instanceof CollaborativeEditError)return reply.code(error.status).send(error.payload);return reply.code(409).send({error:'Retomada não registrada; conferência ou auditoria indisponível.'})}
    try{if(result.state==='PENDING')app.ingest.resumePending();const row=app.sqlite.prepare('SELECT state FROM ingest_batches WHERE id=?').get(result.batchId) as {state:string}|undefined;return {...result,state:row?.state??'UNKNOWN'}}catch{return {...result,state:'UNKNOWN',startError:'Retomada registrada; início/status indisponível. Não crie outro pedido.'}}
  })
  server.post('/api/library/scan',async(request,reply)=>{
    let result:import('@rplayout/protocol').ScanCommandResult
    try{result=queueScan(app.db,request.body,request.headers['if-match'],rootAuthority(app.db,request),app.ingest.available)}
    catch(error){if(error instanceof CollaborativeEditError)return reply.code(error.status).send(error.payload);return reply.code(409).send({error:'Varredura não registrada; conferência ou auditoria indisponível.'})}
    // Committed command is never reported as rolled back if worker startup fails.
    try{if(result.state==='PENDING')app.ingest.resumePending()}catch{return {...result,startError:'Pedido registrado; início do scanner indisponível. Não crie outro pedido.'}}
    const row=app.sqlite.prepare('SELECT state FROM ingest_batches WHERE id=?').get(result.batchId) as {state:string}|undefined
    return {...result,state:row?.state??'UNKNOWN'}
  })

  server.get('/api/rundowns/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const result = await editorialSnapshot(app, id)
    if (!result) return reply.code(404).send({ error: 'Rundown não encontrado.' })
    return result
  })

  /** Exporta a grade atual (itens e caminhos de mídia) para conferência ou
   * importação em outra ferramenta. O arquivo é sempre a proposta vigente,
   * sem alterar o estado do canal.
   */
  server.get('/api/rundowns/:id/export.csv', async (request, reply) => {
    const { id } = request.params as { id: string }
    if (!(await allowed(request, 'REPORT_EXPORT'))) return reply.code(403).send({ error: 'Sem permissão para exportar a grade.' })
    const result = await editorialSnapshot(app, id)
    if (!result) return reply.code(404).send({ error: 'Grade não encontrada.' })
    const esc = (value: unknown): string => `"${String(value ?? '').replace(/"/g, '""')}"`
    const lines = ['ordem;item;tipo;arquivo;entrada prevista;duração;âncora;estado']
    result.view.items.forEach((item, index) => {
      const planned = result.view.schedule.items.find((entry) => entry.id === item.item.id)
      lines.push([
        index + 1,
        esc(item.item.title),
        esc(item.item.type),
        esc(item.asset?.path ?? sourceAddress(item.item.sourceRef ?? '')),
        esc(planned?.start ?? ''),
        esc(planned?.duration ?? ''),
        esc(item.item.anchor.kind),
        esc(planned?.state ?? ''),
      ].join(';'))
    })
    void reply.header('content-type', 'text/csv; charset=utf-8')
    void reply.header('content-disposition', `attachment; filename="grade-${result.view.channel.name.replace(/\W+/g, '-')}.csv"`)
    return `\ufeff${lines.join('\n')}`
  })

  server.get('/api/v1/schedule/compensation-report', async (request, reply) => {
    const query = request.query as { channelId?: string; rundownId?: string }
    let runtime: ChannelRuntime | null = null
    if (query.rundownId) {
      const result = await editorialSnapshot(app, query.rundownId)
      if (!result) return reply.code(404).send({ error: 'Grade não encontrada.' })
      return result.view.schedule.compensationReport
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
    const result = await editorialSnapshot(app, id)
    if (!result) return reply.code(404).send({ error: 'Grade não encontrada.' })
    return result.view.schedule.compensationReport ?? {
      rundownId: result.view.rundown.id,
      generatedAt: new Date().toISOString(),
      rateNum: result.view.channel.rate.num,
      rateDen: result.view.channel.rate.den,
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
    configuredSourceId: z.string().min(1).max(200).nullable().optional(),
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
    liveSourceType: z.enum(['SDI', 'NDI', 'OMT', 'SRT', 'RTMP', 'WEBRTC']).optional(),
    liveEndpoint: z.string().optional(),
    liveEstimatedDuration: z.number().int().min(0).optional(),
    liveMaxDuration: z.number().int().min(0).nullable().optional(),
    liveAutoFollowOnEnd: z.boolean().optional(),
    liveFallbackMediaId: z.string().nullable().optional(),
    liveConfig: z
      .object({
        sourceType: z.enum(['SDI', 'NDI', 'OMT', 'SRT', 'RTMP', 'WEBRTC']),
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

    let inserted
    try {
    inserted=mutateEditorial(app.db,app.concurrency,id,request.headers['if-match'],(tx,state)=>{
    assertEditorialAccess(request,state.channel.id)
    const currentView=editorialView(state)
    const asset=body.data.mediaId?state.assets.get(body.data.mediaId):undefined
    if (body.data.mediaId && !asset) {
      throw new CollaborativeEditError(400,{ error: 'Arquivo não existe no acervo.' })
    }
    if (asset?.ignored) {
      throw new CollaborativeEditError(400,{ error: 'Este arquivo está ignorado. Aceite-o no acervo antes de inserir na grade.' })
    }
    if (asset && !qcApproved(asset.qcStatus)) {
      throw new CollaborativeEditError(400,{ error: `Este arquivo está ${asset.qcStatus === 'PENDING' ? 'pendente de QC' : 'reprovado no QC'}. Aprove-o no Quality Control antes de inserir na grade.` })
    }
    if (asset) {
      const checks = assessQc(asset, state.channel.qcProfile ?? DEFAULT_QC_PROFILE)
      if (!checks.playable) throw new CollaborativeEditError(409,{ error: checks.errors.join(' '), checks })
    }

    // Imagem parada não traz duração: quem diz quanto ela fica é a grade, e
    // sem um valor o item entraria com zero quadro.
    const stillDefault =
      asset && isStill(asset)
        ? secondsToFrames(STILL_DEFAULT_SECONDS, state.channel.rate)
        : null

    const duration =
      body.data.durationOverride ??
      stillDefault ??
      (asset
        ? trimDuration(resolveTrim(null, asset, state.channel.rate).value)
        : 0)

    const anchor = body.data.anchor ?? { kind: 'FLOW' as const }
    const index =
      body.data.atIndex ??
      (anchor.kind === 'FIXED' || anchor.kind === 'HARD_TIME'
        ? insertionIndexForTime(currentView, anchor.at)
        : anchor.kind === 'SOFT'
          ? insertionIndexForTime(currentView, anchor.at)
          : state.items.length)

    const remember=app.history.prepareCapture(tx,id,'inserir item',{wholeRundown:true})

    const itemId = randomUUID()
    const ordered = state.items.map(item=>item.id)
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
      liveCfg?.sourceType ?? body.data.liveSourceType ?? (body.data.type === 'LIVE' ? inferLiveSourceType(body.data.sourceRef ?? body.data.liveEndpoint ?? '') : null)
    const liveEndpoint =
      liveCfg?.sourceEndpoint ?? body.data.liveEndpoint ?? body.data.sourceRef ?? null
    const configuredSource = body.data.configuredSourceId
      ? requireItemSourceBinding(tx,state.channel.id,body.data.configuredSourceId,liveEndpoint,body.data.type)
      : null
    const liveEstimatedDuration =
      liveCfg?.estimatedDuration ?? body.data.liveEstimatedDuration ?? duration
    const liveMaxDuration =
      liveCfg?.maxDuration !== undefined ? liveCfg.maxDuration : (body.data.liveMaxDuration ?? null)
    const liveAutoFollowOnEnd =
      liveCfg?.autoFollowOnEnd ?? body.data.liveAutoFollowOnEnd ?? false
    const liveFallbackMediaId =
      liveCfg?.fallbackMediaId ?? body.data.liveFallbackMediaId ?? null

    tx.insert(rundownItems).values({
      id: itemId,
      rundownId: id,
      sortOrder: 0,
      type: body.data.type,
      eventType,
      title: body.data.title ?? configuredSource?.name ?? asset?.title ?? 'Novo item',
      mediaId: body.data.mediaId ?? null,
      sourceRef: liveEndpoint ?? body.data.sourceRef ?? null,
      configuredSourceId: configuredSource?.id ?? null,
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
    }).run()

    for (const [position, existingId] of ordered.entries()) {
      tx
        .update(rundownItems)
        .set({ sortOrder: (position + 1) * 10 })
        .where(eq(rundownItems.id, existingId))
        .run()
    }
    return {value:{itemId,index,anchor,eventType},remember}
    })
    }catch(error){if(error instanceof CollaborativeEditError)return reply.code(error.status).send(error.payload);throw error}
    const {itemId,index,anchor,eventType}=inserted

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
    liveSourceType: z.enum(['SDI', 'NDI', 'OMT', 'SRT', 'RTMP', 'WEBRTC']).nullable().optional(),
    liveEndpoint: z.string().nullable().optional(),
    liveEstimatedDuration: z.number().int().min(0).nullable().optional(),
    liveMaxDuration: z.number().int().min(0).nullable().optional(),
    liveAutoFollowOnEnd: z.boolean().optional(),
    liveFallbackMediaId: z.string().nullable().optional(),
    liveConfig: z
      .object({
        sourceType: z.enum(['SDI', 'NDI', 'OMT', 'SRT', 'RTMP', 'WEBRTC']),
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
    // A resolução da grade percorre a ordem física dos itens. Trocar apenas
    // a âncora de um VT que já estava no fim deixava o horário marcado sem
    // efeito operacional. Guardamos a ordem atual para reinseri-lo junto ao
    // primeiro evento programado depois da hora solicitada.

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
      // A manual connection edit removes the catalog claim. A new binding is
      // established only through explicit selection when inserting a live.
      updatePayload.configuredSourceId = null
      if (body.data.liveConfig) {
        updatePayload.liveSourceType = body.data.liveConfig.sourceType
        updatePayload.liveEndpoint = body.data.liveConfig.sourceEndpoint
        updatePayload.sourceRef = body.data.liveConfig.sourceEndpoint
        updatePayload.liveEstimatedDuration = body.data.liveConfig.estimatedDuration
        updatePayload.liveMaxDuration = body.data.liveConfig.maxDuration ?? null
        updatePayload.liveAutoFollowOnEnd = body.data.liveConfig.autoFollowOnEnd
        updatePayload.liveFallbackMediaId = body.data.liveConfig.fallbackMediaId ?? null
      } else {
        updatePayload.liveSourceType = null
        updatePayload.liveEndpoint = null
        updatePayload.sourceRef = null
        updatePayload.liveEstimatedDuration = null
        updatePayload.liveMaxDuration = null
        updatePayload.liveAutoFollowOnEnd = false
        updatePayload.liveFallbackMediaId = null
      }
      delete updatePayload.liveConfig
    }

    try{
      mutateEditorial(app.db,app.concurrency,runtime.view.rundown.id,request.headers['if-match'],(tx,state)=>{
        assertEditorialAccess(request,state.channel.id)
        if(body.data.liveEndpoint!==undefined || body.data.liveSourceType!==undefined) updatePayload.configuredSourceId=null
        if(body.data.liveConfig===undefined && body.data.liveEndpoint!==undefined)updatePayload.sourceRef=body.data.liveEndpoint
        const previousView=editorialView(state)
        // The schedule editor sends a live's duration as durationOverride, but
        // the planner reads the live estimate first: the new duration never
        // reached the timing and nothing after the live was recalculated.
        const editedItem=state.items.find(entry=>entry.id===id)
        if(body.data.durationOverride!==undefined&&body.data.durationOverride!==null&&body.data.liveConfig===undefined&&body.data.liveEstimatedDuration===undefined
          &&editedItem&&(editedItem.type==='LIVE'||editedItem.eventType==='LIVE'))updatePayload.liveEstimatedDuration=body.data.durationOverride
        const reorders=Boolean(body.data.anchor && body.data.anchor.kind!=='FLOW')
        const remember=app.history.prepareCapture(tx,state.rundown.id,'editar item',{itemIds:reorders?state.items.map(item=>item.id):[id]})
    tx.update(rundownItems).set(updatePayload).where(eq(rundownItems.id, id)).run()

    const requestedAnchor = body.data.anchor
    if (
      requestedAnchor &&
      (requestedAnchor.kind === 'FIXED' || requestedAnchor.kind === 'HARD_TIME' || requestedAnchor.kind === 'SOFT')
    ) {
      const before = previousView.items.map((entry) => entry.item.id)
      const currentIndex = before.indexOf(id)
      const requestedIndex = insertionIndexForTime(previousView, requestedAnchor.at)
      const ordered = before.filter((itemId) => itemId !== id)
      // Remover o item desloca uma posição quando ele estava antes do ponto
      // de inserção. `splice` aceita o fim da lista, que é o caso de uma hora
      // posterior a toda a programação existente.
      const targetIndex = Math.max(
        0,
        Math.min(ordered.length, requestedIndex - (currentIndex >= 0 && currentIndex < requestedIndex ? 1 : 0)),
      )
      ordered.splice(targetIndex, 0, id)
      for (const [position, itemId] of ordered.entries()) {
        tx
          .update(rundownItems)
          .set({ sortOrder: (position + 1) * 10 })
          .where(eq(rundownItems.id, itemId)).run()
      }
    }
        return {value:true,remember}
      },id)
    }catch(error){if(error instanceof CollaborativeEditError)return reply.code(error.status).send(error.payload);throw error}
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

    let removed
    try {
      removed=mutateEditorial(app.db,app.concurrency,runtime.view.rundown.id,request.headers['if-match'],(tx,state)=>{
        assertEditorialAccess(request,state.channel.id)
        if(id===runtime.transport.state().onAir?.itemId)throw new CollaborativeEditError(400,{error:'O item no ar não pode ser removido da grade. Pare primeiro.'})
        const item=state.items.find(entry=>entry.id===id)!
        const remember=app.history.prepareCapture(tx,state.rundown.id,'remover item',{wholeRundown:true})
        tx.delete(secondaryEvents).where(eq(secondaryEvents.itemId,id)).run()
        tx.delete(rundownItems).where(eq(rundownItems.id,id)).run()
        tx.update(rundowns).set({updatedAt:new Date().toISOString()}).where(eq(rundowns.id,state.rundown.id)).run()
        return {value:item,remember}
      },id)
    }catch(error){if(error instanceof CollaborativeEditError)return reply.code(error.status).send(error.payload);throw error}
    runtime.markManualEdit()
    const preview=runtime.transport.state().preview
    // PRÓXIMO/preroll is not the operator's CUE. Removing the next editorial
    // line must not cancel an unrelated manual PVW or pending live TAKE.
    if(preview?.kind==='ITEM' && preview.id===id)await runtime.transport.cue(null)
    await logDecision(app, runtime.view.rundown.id, id, 'ITEM_REMOVED', {
      mediaId: removed.mediaId ?? null,
    })
    await runtime.refresh()
    onChange()
    return snapshot(app, runtime)
  })

  server.post('/api/rundowns/:id/items/bulk-delete', async (request, reply) => {
    const { id } = request.params as { id: string }
    if (!(await allowed(request, 'PLAYLIST_EDIT'))) return reply.code(403).send({ error: 'Seu papel não pode remover itens.' })
    const body = z.object({ ids: z.array(z.string()).min(1) }).safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const runtime = await runtimeForRundown(app, id)
    if (!runtime?.view) return reply.code(404).send({ error: 'Rundown não encontrado.' })

    let idsToRemove:string[]
    try {
      idsToRemove=mutateEditorial(app.db,app.concurrency,id,request.headers['if-match'],(tx,state)=>{
        assertEditorialAccess(request,state.channel.id)
        const gradeIds=new Set(state.items.map(item=>item.id)),chosen=[...new Set(body.data.ids)]
        if(chosen.some(itemId=>!gradeIds.has(itemId)))throw new CollaborativeEditError(400,{error:'Os itens selecionados não pertencem todos a esta grade. Nenhum item foi removido.'})
        const ids=chosen.filter(itemId=>itemId!==runtime.transport.state().onAir?.itemId)
        if(!ids.length)throw new CollaborativeEditError(400,{error:'O item no ar não pode ser removido da grade.'})
        const remember=app.history.prepareCapture(tx,id,'remover itens em lote',{wholeRundown:true})
        tx.delete(secondaryEvents).where(inArray(secondaryEvents.itemId,ids)).run()
        tx.delete(rundownItems).where(and(eq(rundownItems.rundownId,id),inArray(rundownItems.id,ids))).run()
        tx.update(rundowns).set({updatedAt:new Date().toISOString()}).where(eq(rundowns.id,id)).run()
        return {value:ids,remember}
      })
    }catch(error){if(error instanceof CollaborativeEditError)return reply.code(error.status).send(error.payload);throw error}
    runtime.markManualEdit()
    const preview=runtime.transport.state().preview
    if(preview?.kind==='ITEM' && idsToRemove.includes(preview.id))await runtime.transport.cue(null)

    for (const itemId of idsToRemove) {
      await logDecision(app, id, itemId, 'ITEM_REMOVED', { mediaId: null })
    }

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

    let from:number
    try{
      from=mutateEditorial(app.db,app.concurrency,runtime.view.rundown.id,request.headers['if-match'],(tx,state)=>{
        assertEditorialAccess(request,state.channel.id)
        const ids=state.items.map(item=>item.id),from=ids.indexOf(id),item=state.items[from]!
        const moving=item.blockId?state.items.filter(candidate=>candidate.blockId===item.blockId).map(candidate=>candidate.id):[id]
        const movingSet=new Set(moving),anchorId=ids[Math.min(body.data.toIndex,ids.length-1)]
        const rest=ids.filter(candidate=>!movingSet.has(candidate))
        const target=anchorId && !movingSet.has(anchorId)?rest.indexOf(anchorId):Math.min(body.data.toIndex,rest.length)
        rest.splice(target<0?rest.length:target,0,...moving)
        const remember=app.history.prepareCapture(tx,state.rundown.id,'mover item',{itemIds:ids})
        for(const [position,itemId] of rest.entries())tx.update(rundownItems).set({sortOrder:(position+1)*10}).where(eq(rundownItems.id,itemId)).run()
        return {value:from,remember}
      },id)
    }catch(error){if(error instanceof CollaborativeEditError)return reply.code(error.status).send(error.payload);throw error}

    await logDecision(app, runtime.view.rundown.id, id, 'ITEM_MOVED', {
      from,
      to: body.data.toIndex,
    })
    await runtime.refresh()
    onChange()
    return snapshot(app, runtime)
  })

  // ---- corte e nível, com escopo ---------------------------------------

  server.get('/api/items/:id/edit-scope',async(request,reply)=>{
    if(!(await allowed(request,'PLAYLIST_EDIT')))return reply.code(403).send({error:'Seu papel não pode revisar esta edição.'})
    const query=z.object({scope:scopeSchema}).safeParse(request.query)
    if(!query.success)return reply.code(400).send({error:'Informe o escopo da edição.'})
    try{
      return app.db.transaction(tx=>({review:inspectEditScope(tx,(request.params as {id:string}).id,query.data.scope,id=>app.concurrency.getRundownVersion(id),owners=>authorizeScope(request,owners))}))
    }catch(error){if(error instanceof CollaborativeEditError)return reply.code(error.status).send(error.payload);throw error}
  })

  server.post('/api/items/:id/trim', async (request, reply) => {
    const { id } = request.params as { id: string }
    if (!(await allowed(request, 'PLAYLIST_EDIT'))) return reply.code(403).send({ error: 'Seu papel não pode cortar itens.' })
    const body = z.object({ trim: trimSchema, scope: scopeSchema,scopeReviewToken:z.string().regex(/^[A-Za-z0-9_-]{43}$/).optional() }).safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })
    if (body.data.trim.out <= body.data.trim.in) {
      return reply.code(400).send({ error: 'A saída tem de vir depois da entrada.' })
    }

    const runtime = await runtimeForItem(app, id)
    if (!runtime?.view) return reply.code(404).send({ error: 'Item não encontrado.' })

    let result
    try{result=await applyTrim(app.db,id,body.data.trim,body.data.scope,scopedEditGuard(request,body.data.scope,'marcar entrada e saída',body.data.scopeReviewToken))}
    catch(error){if(error instanceof CollaborativeEditError)return reply.code(error.status).send(error.payload);throw error}
    await logDecision(app, runtime.view.rundown.id, id, 'TRIM_APPLIED', {
      ...body.data,
      itemsAffected: result.itemsAffected,
    })
    await runtime.refresh()
    onChange()
    return { ...snapshot(app, runtime), result }
  })

  server.post('/api/items/:id/audio-analysis',async(request,reply)=>{
    const {id}=request.params as {id:string}
    if(!(await allowed(request,'PLAYLIST_EDIT')))return reply.code(403).send({error:'Seu papel não pode medir o mix deste item.'})
    const body=z.object({contentHash:z.string().regex(/^[a-f0-9]{64}$/i),audioTrack:z.number().int().min(0).max(63),routing:audioSchema.shape.routing.unwrap(),scope:z.enum(['FILE','TRIM']).default('FILE')}).strict().safeParse(request.body)
    if(!body.success)return reply.code(400).send({error:'Configuração de mix inválida.'})
    try{
      const job=app.audioMixAnalysis.queue(id,body.data.contentHash,body.data.audioTrack,body.data.routing,await usernameOf(request),()=>{
        const owners=inspectEditScope(app.db,id,'ITEM',rid=>app.concurrency.getRundownVersion(rid),rows=>authorizeScope(request,rows));auditChannels.set(request,owners.owners.map(row=>row.channelId))
      },body.data.scope)
      const {worker,...publicJob}=job;return reply.code(job.state==='READY'?200:202).send({analysis:publicJob})
    }catch(error){return automationError(reply,error)}
  })
  server.get('/api/items/:id/audio-analysis/:analysisId',async(request,reply)=>{
    const {id,analysisId}=request.params as {id:string;analysisId:string}
    if(!(await allowed(request,'PLAYLIST_EDIT')))return reply.code(403).send({error:'Seu papel não pode consultar esta medição.'})
    const job=app.audioMixAnalysis.read(id,analysisId);if(!job)return reply.code(404).send({error:'Medição não encontrada neste item.'})
    const {worker,...publicJob}=job;return {analysis:publicJob}
  })
  server.post('/api/items/:id/audio', async (request, reply) => {
    const { id } = request.params as { id: string }
    if (!(await allowed(request, 'PLAYLIST_EDIT'))) return reply.code(403).send({ error: 'Seu papel não pode ajustar áudio.' })
    const body = z.object({ audio: audioSchema, scope: scopeSchema,audioTrack:z.number().int().min(0).max(63).optional(),scopeReviewToken:z.string().regex(/^[A-Za-z0-9_-]{43}$/).optional() }).safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const runtime = await runtimeForItem(app, id)
    if (!runtime?.view) return reply.code(404).send({ error: 'Item não encontrado.' })

    let result
    try{result=await applyAudio(app.db,id,body.data.audio,body.data.scope,scopedEditGuard(request,body.data.scope,'nivelar áudio',body.data.scopeReviewToken),body.data.audioTrack)}
    catch(error){if(error instanceof CollaborativeEditError)return reply.code(error.status).send(error.payload);throw error}
    await logDecision(app, runtime.view.rundown.id, id, 'AUDIO_APPLIED', {
      ...body.data,
      itemsAffected: result.itemsAffected,
    })
    await runtime.refresh()
    onChange()
    return { ...snapshot(app, runtime), result }
  })

  // ---- distribuição ----------------------------------------------------

  // A utilização de CPU só pode ser calculada pela diferença entre duas
  // leituras. O estado fica no processo do servidor e nunca vem de valores
  // decorativos da interface.

  /** Métricas do computador que efetivamente hospeda esta instância. */
  server.get('/api/host-metrics', async (request) => {
    return scopedOperationalSample(await app.hostMetrics.latest(),id=>access.channelAllowed(request,id))
  })
  server.get('/api/host-metrics/history', async (request, reply) => {
    if (!(await allowed(request, 'REPORT_EXPORT'))) return reply.code(403).send({ error: 'Sem permissão para consultar histórico do servidor.' })
    const query=parseMetricHistoryQuery(request.query)
    if(!query)return reply.code(400).send({error:'Janela ou cursor de histórico inválido.'})
    if(query.channelId&&!access.channelAllowed(request,query.channelId))return reply.code(403).send({error:'Sem acesso ao histórico deste canal.'})
    const page=app.hostMetrics.historyPage(query.since,query.until,query.before,query.limit)
    const samples=page.samples.map(({sample})=>scopedOperationalSample(sample,id=>access.channelAllowed(request,id),query.channelId))
    return {since:query.since,until:query.until,retainedDays:14,limit:query.limit,totalSamples:page.totalSamples,truncated:page.totalSamples>samples.length,nextBefore:page.nextBefore,samples}
  })
  server.get('/api/channels/:id/operational-metrics/history',async(request,reply)=>{
    const id=(request.params as {id:string}).id
    if(!access.channelAllowed(request,id)||!(await allowed(request,'REPORT_EXPORT')))return reply.code(403).send({error:'Sem permissão para o histórico deste canal.'})
    const query=parseMetricHistoryQuery(request.query)
    if(!query)return reply.code(400).send({error:'Janela ou cursor de histórico inválido.'})
    const {since,until,before,limit}=query
    const page=app.hostMetrics.historyPage(since,until,before,limit)
    const samples=page.samples.map(({sampledAt,sample})=>({sampledAt,operations:scopedOperationalSample(sample,channelId=>access.channelAllowed(request,channelId),id).operations??null}))
    return {channelId:id,since,until,retainedDays:14,totalSamples:page.totalSamples,truncated:page.totalSamples>samples.length,nextBefore:page.nextBefore,samples}
  })

  /**
   * Visão operacional dos processos que pertencem ao playout. O endpoint não
   * cria processos nem tenta adivinhar consumo: ele identifica os PIDs vivos
   * e, no Windows, consulta o próprio sistema para memória e CPU acumulada.
   * Isso permite fechar monitores sem confundir um Preview desligado com uma
   * falha do canal.
   */
  const processMetrics = new ProcessMetrics()
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
          transport: runtime.transport instanceof EngineTransport ? 'NATIVE' : 'SIMULATED',
          restarts: runtime.transport.health().restarts,
          deaths: runtime.transport.health().deaths,
          stalls: runtime.transport.health().stalls,
          ready: runtime.transport.health().ready,
          publishers: publishers.map((publisher) => ({
            url: redactUrl(publisher.url),
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
            url: redactUrl(target),
            transport: (target.split(':', 1)[0] ?? '').toUpperCase(),
            attempts: publisher.attempts,
            delivered: publisher.delivered,
            error: publisher.error ?? null,
          },
        })
      }
    }

    const pids = rows.map((row) => row.pid).filter((pid): pid is number => pid !== null)
    const counters = await processMetrics.latest(pids)
    for (const row of rows) {
      const sample = row.pid === null ? undefined : counters.samples.get(row.pid)
      if (sample) { row.memoryBytes = sample.memoryBytes; row.cpuTimeMs = sample.cpuTimeMs }
    }
    return { generatedAt: new Date().toISOString(), processes: rows, measurementError:counters.error }
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
  server.get('/api/sources', async (request,reply) => {
    const query=z.object({refresh:z.enum(['0','1']).optional(),channelId:z.string().min(1).optional()}).safeParse(request.query)
    if(!query.success)return reply.code(400).send({error:'Consulta de fontes inválida.'})
    if(query.data.channelId&&!access.channelAllowed(request,query.data.channelId))return reply.code(403).send({error:'Sem acesso às entradas deste canal.'})
    return scopedSourceList(await app.sources.list(query.data.refresh==='1'),id=>access.channelAllowed(request,id),query.data.channelId)
  })

  // ==========================================
  // FASE B: SRT MANAGER, FAILOVER & MULTIVIEW
  // ==========================================

  // Telemetria SRT em tempo real
  const handleSrtTelemetry = async (request: any, reply: any) => {
    const { sourceId } = request.query as { sourceId?: string }
    const restricted = access.identity(request)?.channelIds != null
    const allowedSources = restricted ? new Set((await listLiveSources(app.db, undefined, false)).filter(source => access.channelAllowed(request, source.channelId)).map(source => source.id)) : null
    if (sourceId) {
      if (allowedSources && !allowedSources.has(sourceId)) return reply.code(403).send({ error: 'Sua conta não pode consultar esta fonte.' })
      const tel = globalSrtManager.getTelemetry(sourceId)
      return tel ?? { error: 'Telemetria não encontrada para a fonte informada' }
    }
    const telemetry = globalSrtManager.getAllTelemetry()
    return allowedSources ? Object.fromEntries(Object.entries(telemetry).filter(([id]) => allowedSources.has(id))) : telemetry
  }
  server.get('/api/v1/srt/telemetry', handleSrtTelemetry)
  server.get('/api/srt/telemetry', handleSrtTelemetry)

  // Disparo manual ou automatizado de chaveamento de contingência (Failover)
  const failoverSelection=z.object({targetRole:z.enum(['PRIMARY','BACKUP']).optional(),reason:z.string().trim().min(1).max(500).optional()})
  const applyManualFailover=async(request:FastifyRequest,reply:any,input:ManualFailoverInput)=>{
    if(!(await allowed(request,'PLAYLIST_EDIT')))return reply.code(403).send({error:'Seu papel não pode registrar decisão de failover.'})
    const ownerId=access.identity(request)?.id??null,actorName=await usernameOf(request)
    try{
      const result=recordManualFailover(app.db,globalSrtManager.failover,request.headers['idempotency-key'],input,ownerId,actorName,channelId=>{
        const current=access.identity(request)
        if((current?.id??null)!==ownerId||access.required()&&!current||!can(access.role(request),'PLAYLIST_EDIT')||!access.channelAllowed(request,channelId))throw new CollaborativeEditError(403,{error:'Sessão ou acesso ao canal mudou; decisão de failover não registrada.'})
      })
      let refreshError:string|null=!result.replayed&&!result.cacheApplied?'Decisão gravada, mas cache local não aplicado. O recibo não confirma a seleção atual ou o PGM.':null
      if(!result.replayed){
        try{void emitIntegrationEvent(app.db,'source.failover',{...result.event},result.channelId).catch(()=>{});onChange()}
        catch{refreshError='Decisão gravada, mas atualização da tela/integração não confirmada. Não repita com outro identificador.'}
      }
      return reply.header('cache-control','private, no-store').send({ok:true,...result,refreshError})
    }catch(error){return automationError(reply,error)}
  }
  const handleFailoverTrigger = async (request: FastifyRequest, reply: any) => {
    const body=failoverSelection.extend({sourceId:z.string().min(1)}).strict().safeParse(request.body)
    if(!body.success)return reply.code(400).send({error:body.error.flatten()})
    return applyManualFailover(request,reply,body.data)
  }
  server.post('/api/v1/engineering/failover/trigger', handleFailoverTrigger)
  server.post('/api/engineering/failover/trigger', handleFailoverTrigger)

  // Multiview Layout & Configuração
  const multiviewAuthority=(request:FastifyRequest,ownerId:string|null,write=false)=>(_tx:unknown,id:string|null)=>{
    const identity=access.identity(request)
    if(access.required()&&!identity || (identity?.id??null)!==ownerId || !can(access.role(request),write?'PLAYLIST_EDIT':'REPORT_EXPORT') ||
      (id===null?identity?.channelIds!==undefined&&identity.channelIds!==null:!access.channelAllowed(request,id)))throw new CollaborativeEditError(403,{error:'A sessão ou acesso ao escopo do multiview mudou. Confira novamente.'})
  }
  const handleGetMultiview = async (request: FastifyRequest,reply:any) => {
    const query=z.object({channelId:z.string().min(1).optional()}).strict().safeParse(request.query)
    if(!query.success)return reply.code(400).send({error:'Escopo multiview inválido.'})
    try{
      const id=query.data.channelId??null,ownerId=access.identity(request)?.id??null
      const review=readMultiviewReview(app.db,id,multiviewAuthority(request,ownerId))
      reply.header('cache-control','private, no-store').header('etag',multiviewETag(id,review.revision))
      return review
    }catch(error){return automationError(reply,error)}
  }
  server.get('/api/v1/multiview/config', handleGetMultiview)
  server.get('/api/multiview/config', handleGetMultiview)

  const handlePutMultiview = async (request: FastifyRequest, reply: any) => {
    if (!(await allowed(request, 'PLAYLIST_EDIT'))) {
      return reply.code(403).send({ error: 'Seu papel não pode alterar layout de multiview.' })
    }

    const ownerId=access.identity(request)?.id??null
    try{
      const saved=editMultiview(app.db,request.body,request.headers['if-match'],{
        authorize:multiviewAuthority(request,ownerId,true),
        audit:(tx,details)=>{
          auditChannels.set(request,typeof details.channelId==='string'?[details.channelId]:[])
          tx.insert(operatorDecisions).values({id:randomUUID(),rundownId:'@security',kind:'MULTIVIEW_EDITED',actorUsername:access.identity(request)?.username??null,payload:details,createdAt:new Date().toISOString()}).run()
        },
      })
      reply.header('cache-control','private, no-store').header('etag',saved.eTag)
      try{onChange();return saved}catch{return {...saved,refreshError:'Multiview gravado; atualização da tela não confirmada. Reabra antes de outra alteração.'}}
    }catch(error){return automationError(reply,error)}
  }
  server.put('/api/v1/multiview/config', handlePutMultiview)
  server.put('/api/multiview/config', handlePutMultiview)

  // Gerenciamento de Fontes ao Vivo (Live Sources CRUD)
  const sourceEditHooks=(request:FastifyRequest)=>{
    const ownerId=access.identity(request)?.id??null
    return {
      authorize:(_tx:Pick<Db,'select'>,channelId:string)=>{
        assertEditorialAccess(request,channelId)
        if((access.identity(request)?.id??null)!==ownerId)throw new CollaborativeEditError(403,{error:'A sessão mudou antes de alterar a entrada.'})
        auditChannels.set(request,[channelId])
      },
      audit:(tx:EditorialTransaction,details:Record<string,unknown>)=>{
        tx.insert(operatorDecisions).values({id:randomUUID(),rundownId:'@security',kind:'LIVE_SOURCE_EDITED',actorUsername:access.identity(request)?.username??null,createdAt:new Date().toISOString(),payload:details}).run()
      },
    }
  }
  server.get('/api/channels/:id/live-source-review',async(request,reply)=>{
    const {id}=request.params as {id:string}
    try{
      const review=readLiveSourceReview(app.db,id,sourceEditHooks(request).authorize)
      return reply.header('cache-control','private, no-store').header('etag',liveSourceETag(id,review.revision)).send(review)
    }catch(error){return automationError(reply,error)}
  })
  const handleListLiveSources = async (request: any,reply:any) => {
    const { channelId } = request.query as { channelId?: string }
    reply.header('cache-control','private, no-store')
    return listLiveSources(app.db, channelId, false)
  }
  server.get('/api/v1/sources/live', handleListLiveSources)
  server.get('/api/sources/live', handleListLiveSources)

  const sourceMutation=async(request:FastifyRequest,reply:any,operation:'CREATE'|'UPDATE'|'DELETE')=>{
    if(!(await allowed(request,'PLAYLIST_EDIT')))return reply.code(403).send({error:'Seu papel não pode alterar entradas ao vivo.'})
    try{
      const {id}=(request.params??{}) as {id?:string}
      const result=editLiveSource(app.db,operation,id,request.body,request.headers['if-match'],sourceEditHooks(request))
      let refreshError:string|null=null
      try{onChange()}catch{refreshError='Cadastro gravado; falha ao atualizar a tela. Consulte a lista antes de repetir.'}
      // Registration never rebuilds a runtime, retunes PVW or changes PGM.
      return reply.code(operation==='CREATE'?201:200).header('cache-control','private, no-store').header('etag',result.eTag).send(operation==='DELETE'?{ok:true,...result,refreshError}:{...result.source,applied:true,channelId:result.channelId,revision:result.revision,automaticTake:false,physicalSignalValidated:false,refreshError})
    }catch(error){return automationError(reply,error)}
  }
  const handleCreateLiveSource=(request:FastifyRequest,reply:any)=>sourceMutation(request,reply,'CREATE')
  server.post('/api/v1/sources/live', handleCreateLiveSource)
  server.post('/api/sources/live', handleCreateLiveSource)

  const handleGetLiveSource = async (request: any, reply: any) => {
    const { id } = request.params as { id: string }
    const source = await getLiveSource(app.db, id, false)
    if (!source) return reply.code(404).send({ error: 'Fonte ao vivo não encontrada.' })
    return reply.header('cache-control','private, no-store').send(source)
  }
  server.get('/api/v1/sources/live/:id', handleGetLiveSource)
  server.get('/api/sources/live/:id', handleGetLiveSource)

  const handleUpdateLiveSource=(request:FastifyRequest,reply:any)=>sourceMutation(request,reply,'UPDATE')
  server.put('/api/v1/sources/live/:id', handleUpdateLiveSource)
  server.put('/api/sources/live/:id', handleUpdateLiveSource)
  const handleDeleteLiveSource=(request:FastifyRequest,reply:any)=>sourceMutation(request,reply,'DELETE')
  server.delete('/api/v1/sources/live/:id', handleDeleteLiveSource)
  server.delete('/api/sources/live/:id', handleDeleteLiveSource)

  const handleForceFailover = async (request: FastifyRequest, reply: any) => {
    const {id}=request.params as {id:string},body=failoverSelection.strict().safeParse(request.body??{})
    if(!body.success)return reply.code(400).send({error:body.error.flatten()})
    return applyManualFailover(request,reply,{sourceId:id,...body.data})
  }
  server.post('/api/v1/sources/live/:id/force-failover', handleForceFailover)
  server.post('/api/sources/live/:id/force-failover', handleForceFailover)

  const graphicsAuthority=(request:FastifyRequest,ownerId:string|null,write:boolean)=>(_tx:unknown,id:string|null)=>{
    const identity=access.identity(request)
    if(access.required()&&!identity||(identity?.id??null)!==ownerId||!can(access.role(request),write?'PLAYLIST_EDIT':'REPORT_EXPORT')||
      (id===null?write&&identity?.channelIds!==undefined&&identity.channelIds!==null:!access.channelAllowed(request,id)))throw new CollaborativeEditError(403,{error:'A sessão, papel, estação ou acesso às artes mudou. Confira novamente.'})
  }
  const graphicsHooks=(request:FastifyRequest,kind:string)=>{
    const ownerId=access.identity(request)?.id??null
    return {authorize:graphicsAuthority(request,ownerId,true),audit:(tx:Parameters<Parameters<Db['transaction']>[0]>[0],details:Record<string,unknown>)=>{
      const id=typeof details.channelId==='string'?details.channelId:null;auditChannels.set(request,id?[id]:[])
      tx.insert(operatorDecisions).values({id:randomUUID(),rundownId:'@security',kind,actorUsername:access.identity(request)?.username??null,createdAt:new Date().toISOString(),payload:details}).run()
    }}
  }
  server.patch('/api/channels/:id/slate', async (request, reply) => {
    const { id } = request.params as { id: string }
    try{
      const result=editSlate(app.db,id,request.body,request.headers['if-match'],graphicsHooks(request,'SLATE_CONFIGURATION_CHANGED'))
      reply.header('cache-control','private, no-store').header('etag',result.eTag)
      try{const runtime=app.runtimes.get(id);runtime?.setSlate(result.slateTemplateId);onChange();return {...result,runtimeConfigurationApplied:Boolean(runtime)}}
      catch(error){return {...result,runtimeConfigurationApplied:false,refreshError:sanitizeDiagnostic(error instanceof Error?error.message:'Configuração gravada; aplicação no runtime não confirmada.')}}
    }catch(error){if(error instanceof CollaborativeEditError)return reply.code(error.status).send(error.payload);throw error}
  })

  // ---- pauta ---------------------------------------------------------------

  const ruleAuthority=(request:FastifyRequest,ownerId:string|null,write:boolean)=>(_tx:unknown,id:string)=>{
    const identity=access.identity(request)
    if(access.required()&&!identity||(identity?.id??null)!==ownerId||!can(access.role(request),write?'PLAYLIST_EDIT':'REPORT_EXPORT')||!access.channelAllowed(request,id))
      throw new CollaborativeEditError(403,{error:'A sessão ou o acesso às faixas mudou. Confira novamente.'})
  }
  server.get('/api/channels/:id/rules',async(request,reply)=>{
    const {id}=request.params as {id:string}
    try{
      const review=readScheduleRuleReview(app.db,id,ruleAuthority(request,access.identity(request)?.id??null,false))
      reply.header('cache-control','private, no-store').header('etag',scheduleRuleETag(id,review.revision))
      return review
    }catch(error){return automationError(reply,error)}
  })
  const changeRule=async(request:FastifyRequest,reply:import('fastify').FastifyReply,operation:'CREATE'|'UPDATE'|'DELETE')=>{
    if(!(await allowed(request,'PLAYLIST_EDIT')))return reply.code(403).send({error:'Seu papel não pode editar a pauta.'})
    const {id}=request.params as {id:string},actorId=access.identity(request)?.id??null
    try{
      const saved=editScheduleRule(app.db,operation,id,request.body,request.headers['if-match'],{
        authorize:ruleAuthority(request,actorId,true),
        audit:(tx,details)=>{
          auditChannels.set(request,[String(details.channelId)])
          tx.insert(operatorDecisions).values({id:randomUUID(),rundownId:'@security',kind:'SCHEDULE_RULE_EDITED',actorUsername:access.identity(request)?.username??null,payload:details,createdAt:new Date().toISOString()}).run()
        },
      })
      reply.header('cache-control','private, no-store').header('etag',saved.eTag)
      try{onChange();return saved}catch{return {...saved,refreshError:'Faixa gravada; atualização da tela não confirmada. Reabra antes de outra alteração.'}}
    }catch(error){return automationError(reply,error)}
  }
  server.post('/api/channels/:id/rules',(request,reply)=>changeRule(request,reply,'CREATE'))
  server.patch('/api/rules/:id',(request,reply)=>changeRule(request,reply,'UPDATE'))
  server.delete('/api/rules/:id',(request,reply)=>changeRule(request,reply,'DELETE'))

  /**
   * Monta o dia inteiro pela pauta.
   *
   * Cada faixa vira um bloco que começa na hora dela: o primeiro item entra com
   * âncora de hora fixa e o resto vai no fluxo. Sem a âncora, um atraso na
   * faixa da manhã empurraria a noite inteira -- que é exatamente o que a pauta
   * existe para evitar.
   */
  const handleFill = async (request:FastifyRequest, reply:import('fastify').FastifyReply, kind:'WINDOW'|'DAY') => {
    const {id}=request.params as {id:string}
    const parsed=z.object({
      minutes:z.number().positive().max(1440).optional(),categories:z.array(z.string()).optional(),
      avoidHours:z.number().min(0).max(720).optional(),preview:z.boolean().optional(),proposalId:z.string().uuid().optional(),
      insertAtMinute:z.number().min(0).max(1440).optional(),insertAfterItemId:z.string().optional(),insertAtOrder:z.number().optional(),
    }).strict().safeParse(request.body)
    if(!parsed.success)return reply.code(400).send({error:parsed.error.flatten()})
    const body=parsed.data,actor=access.identity(request)?.username??null
    try {
      if(body.preview){
        if(kind==='WINDOW' && body.minutes===undefined)return reply.code(400).send({error:'Informe a duração a preencher.'})
        const result=app.db.transaction(tx=>{
          const state=readEditorialState(app.db,id)
          if(!state)throw new CollaborativeEditError(404,{error:'Grade ativa não encontrada.'})
          assertEditorialAccess(request,state.channel.id)
          // An optional captured header protects the opening context. Review
          // itself only persists the encrypted proposal, never grade or PGM.
          if(request.headers['if-match'])requireEditorialRevision(app.concurrency,id,request.headers['if-match'],state.editorialRevision)
          return proposeFill(tx,state,kind,body.minutes===undefined?undefined:{...body,minutes:body.minutes},actor)
        },{behavior:'immediate'})
        return result
      }
      const result=mutateEditorial(app.db,app.concurrency,id,request.headers['if-match'],(tx,state)=>{
        assertEditorialAccess(request,state.channel.id)
        if(body.proposalId && Object.keys(body).some(key=>key!=='proposalId'&&key!=='preview'))
          throw new CollaborativeEditError(400,{error:'A aplicação aceita somente a proposta conferida, não novos critérios.'})
        const remember=app.history.prepareCapture(tx,id,'aplicar proposta de montagem',{wholeRundown:true})
        return {value:applyFillProposal(tx,state,body.proposalId,kind,actor),remember}
      })
      await app.runtimes.get((readEditorialState(app.db,id))!.channel.id)?.refresh()
      onChange()
      return {...result,...await editorialSnapshot(app,id)}
    }catch(error){if(error instanceof CollaborativeEditError)return reply.code(error.status).send(error.payload);throw error}
  }
  server.post('/api/rundowns/:id/autofill-day', (request,reply)=>handleFill(request,reply,'DAY'))

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
    const channel = await getChannel(app.db, id, true)
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

  const upgradeBackups=new UpgradeBackups(app.sqlite,app.backupDir)
  server.addHook('onClose',async()=>{upgradeBackups.close();await upgradeBackups.settled()})
  const upgradeBackupAccess=(request:FastifyRequest)=>{
    if(access.role(request)!=='ADMIN'||!can(access.role(request),'REPORT_EXPORT')||access.required()&&!access.identity(request))throw new Error('Backup de atualização exige administrador com sessão válida e acesso global.')
  }
  server.get('/api/backups/upgrade/:requestId',async(request,reply)=>{
    try{upgradeBackupAccess(request);reply.header('Cache-Control','private, no-store');return upgradeBackups.query(request.params)}
    catch{return reply.code(409).send({error:'Não foi possível consultar o pedido de backup. Confira acesso e UUID.'})}
  })
  server.post('/api/backups/upgrade',async(request,reply)=>{
    const body=upgradeBackupRequest.safeParse(request.body)
    if(!body.success)return reply.code(400).send({error:'Informe UUID único do pedido de backup.'})
    const actor=access.identity(request)?.id??null
    const authorize=()=>{upgradeBackupAccess(request);if((access.identity(request)?.id??null)!==actor)throw new Error('Sessão mudou durante o backup.')}
    try{reply.header('Cache-Control','private, no-store');return upgradeBackups.create(body.data,authorize)}
    catch{return reply.code(409).send({error:'Backup não iniciado ou resultado desconhecido. Consulte este UUID antes de repetir; confira sessão e pedidos anteriores.'})}
  })
  server.post('/api/backups/upgrade/:requestId/reconcile',async(request,reply)=>{
    const body=z.object({confirm:z.literal(true)}).strict().safeParse(request.body)
    if(!body.success)return reply.code(400).send({error:'Confirmação explícita obrigatória; reconciliação não repete o backup.'})
    try{reply.header('Cache-Control','private, no-store');return upgradeBackups.reconcile({...request.params as {requestId:string},confirm:true},()=>upgradeBackupAccess(request))}
    catch{return reply.code(409).send({error:'Reconciliação recusada. Criador vivo, remoto ou desconhecido não será liberado; arquivos preservados.'})}
  })

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

  server.post('/api/rundowns/:id/autofill', (request,reply)=>handleFill(request,reply,'WINDOW'))

  // ---- retorno explícito de VT interrompido -----------------------------
  const insertions=new OperationalInsertions(app.db)
  const insertionError=(reply:any,error:unknown)=>error instanceof CollaborativeEditError?reply.code(error.status).send(error.payload):reply.code(409).send({error:sanitizeDiagnostic(error instanceof Error?error.message:'Inserção não confirmada; confira o registro sem repetir o TAKE.')})
  const insertionInput=z.object({requestId:z.string().uuid(),mode:z.enum(['NEXT','NOW']),mediaId:z.string().min(1).optional(),sourceId:z.string().min(1).optional(),durationFrames:z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional()}).strict()
  const assertInsertionAccess=(request:FastifyRequest,id:string)=>{
    if(access.required()&&!access.identity(request) || !can(access.role(request),'TRANSPORT') || !access.channelAllowed(request,id))throw new CollaborativeEditError(403,{error:'Sessão/permissão de operação deste canal mudou.'})
    const row=app.db.select().from(channels).where(eq(channels.id,id)).get()
    if(!row || row.archivedAt)throw new CollaborativeEditError(404,{error:'Canal ativo não encontrado.'})
  }
  server.post('/api/channels/:id/operational-insert/review',async(request,reply)=>{
    const {id}=request.params as {id:string},body=insertionInput.safeParse(request.body)
    if(!body.success)return reply.code(400).send({error:'Escolha um vídeo/entrada e o modo de inserção.'})
    try{
      return app.db.transaction(()=>{
        assertInsertionAccess(request,id);const runtime=app.runtimes.get(id)
        if(!runtime)throw new CollaborativeEditError(409,{error:'Canal sem execução carregada.'})
        const reason=runtime.reconfigurationStatus().reason;if(reason)throw new CollaborativeEditError(409,{error:reason})
        const plan=inspectInsertion(app.db,runtime.insertionContext(),body.data)
        reply.header('Cache-Control','private, no-store')
        return {reviewToken:plan.reviewToken,input:plan.input,item:{id:plan.itemId,title:plan.view.items.find(row=>row.item.id===plan.itemId)!.item.title},sourceRevisionId:plan.context.revisionId,conflicts:runtime.insertionTiming(plan.view,body.data).schedule.conflicts,nativeEngine:runtime.transport instanceof EngineTransport,estimatedTiming:true,notice:'Intervenção somente na revisão operacional. Não publica rascunhos. Timing é recalculado na execução; uma entrada descoberta ainda precisa entregar quadro. NEXT não altera PGM/CUE; NOW corta somente após confirmação.'}
      })
    }catch(error){return insertionError(reply,error)}
  })
  server.get('/api/channels/:id/operational-insert/:requestId',async(request,reply)=>{
    const {id,requestId}=request.params as {id:string;requestId:string}
    try{return app.db.transaction(()=>{
      assertInsertionAccess(request,id);const run=insertions.read(requestId)
      if(!run || run.channelId!==id)throw new CollaborativeEditError(404,{error:'Pedido deste canal não encontrado.'})
      reply.header('Cache-Control','private, no-store')
      return {run:insertions.publicRun(run),configurationOperation:app.configurationChanges.status(id),automaticTake:false}
    })}catch(error){return insertionError(reply,error)}
  })
  server.post('/api/channels/:id/operational-insert',async(request,reply)=>{
    const {id}=request.params as {id:string},body=z.object({input:insertionInput,reviewToken:z.string().regex(/^[A-Za-z0-9_-]{43}$/),confirm:z.literal(true)}).strict().safeParse(request.body)
    if(!body.success)return reply.code(400).send({error:'Confira a inserção e confirme o pedido original.'})
    const {input,reviewToken}=body.data,actor=await usernameOf(request),runtime=app.runtimes.get(id)
    try{
      assertInsertionAccess(request,id)
      const duplicate=insertions.read(input.requestId)
      if(duplicate){
        if(duplicate.channelId!==id || duplicate.digest!==insertions.digest(input,reviewToken,actor))throw new CollaborativeEditError(409,{error:'Identificador pertence a outra inserção/decisão.'})
        return reply.code(duplicate.phase==='CONFIRMED'?200:409).send({ok:duplicate.phase==='CONFIRMED',...(duplicate.phase==='CONFIRMED'?{}:{error:duplicate.message??'Inserção em andamento/inconclusiva. Nenhum TAKE será repetido.'}),deduplicated:true,run:insertions.publicRun(duplicate)})
      }
      if(!runtime)throw new CollaborativeEditError(409,{error:'Canal sem execução carregada.'})
      if(input.mode==='NOW' && !(runtime.transport instanceof EngineTransport))throw new CollaborativeEditError(409,{error:'Inserir agora exige confirmação do engine nativo. Simulação não comprova corte de PGM.'})
      const initial=inspectInsertion(app.db,runtime.insertionContext(),input);requireInsertionReview(initial,reviewToken)
      const reason=runtime.reconfigurationStatus().reason;if(reason)throw new CollaborativeEditError(409,{error:reason})
      const native=runtime.transport instanceof EngineTransport?runtime.transport:null
      return await app.configurationChanges.execute(id,native?.processId()??null,actor,'OPERATIONAL_INSERT_'+input.mode,async lease=>{
        const guard=(afterTake=false)=>{
          assertInsertionAccess(request,id);lease.assertOwned(app.db)
          if(app.runtimes.get(id)!==runtime)throw new CollaborativeEditError(409,{error:'Runtime mudou; nenhuma nova inserção será enviada.'})
          const current=runtime.insertionContext(),old=initial.context
          if(current.rundownId!==old.rundownId || current.revisionId!==old.revisionId || current.executionId!==old.executionId || (!afterTake && current.onAirItemId!==old.onAirItemId) || (afterTake && current.onAirItemId!==initial.itemId))throw new CollaborativeEditError(409,{error:'A ocorrência de PGM/edição mudou durante a preparação.'})
          const reason=runtime.reconfigurationStatus(false).reason;if(reason)throw new CollaborativeEditError(409,{error:reason})
          requireInsertionReview(inspectInsertion(app.db,initial.context,input),reviewToken)
        }
        app.db.transaction(tx=>{guard();insertions.claim(input,initial,reviewToken,actor,lease.runId);lease.record(tx,'INSERT_PREPARING')},{behavior:'immediate'})
        let dispatched=false,committed=false
        const work=async(controls:Parameters<EngineTransport['insertOperational']>[0] extends (commands:infer T)=>unknown?T:never)=>{
          guard();const view=await runtime.prepareInsertionView(initial.payload);guard()
          const current=()=>{guard();return true}
          const commit=(previous:{itemId:string;frames:number}|null)=>{
            const timedView=runtime.insertionTiming(view,input)
            let revision
            try{revision=app.db.transaction(tx=>{
              guard(input.mode==='NOW')
              const revision=insertions.commit(initial,actor,input.mode==='NOW',timedView)
              lease.record(tx,'COMMITTED',{requestId:input.requestId,revisionId:revision.id});return revision
            },{behavior:'immediate'})}
            catch(error){if(input.mode==='NOW')runtime.observeUnconfirmedInsertion(view);throw error}
            committed=true;runtime.installInsertion(initial.payload,timedView,revision,input,previous)
          }
          if(input.mode==='NEXT'){
            if(native)await controls.prepare(view,initial.itemId,current)
            guard();commit(null)
          }else await controls.take(view,initial.itemId,current,()=>app.db.transaction(tx=>{guard();lease.record(tx,'INSERT_SWITCHING',{requestId:input.requestId});insertions.phase(input.requestId,'SWITCHING');dispatched=true},{behavior:'immediate'}),commit)
        }
        try{
          if(native)await native.insertOperational(work)
          else await work({prepare:async()=>{},take:async()=>{throw new Error('Sem engine nativo')}})
          onChange();return {ok:true,deduplicated:false,run:insertions.publicRun(insertions.read(input.requestId)!),...snapshot(app,runtime)}
        }catch(error){
          const message=sanitizeDiagnostic(error instanceof Error?error.message:'Inserção não confirmada.')
          if(committed){onChange();return {ok:true,run:insertions.publicRun(insertions.read(input.requestId)!),message:'Revisão confirmada; confira limpeza de PVW/checkpoint. '+message,...snapshot(app,runtime)}}
          if(dispatched){lease.markUncertain('TAKE de inserção inconclusivo. Pare PGM/limpe CUE e reconcilie a configuração sem repetir o pedido. '+message);insertions.phase(input.requestId,'UNCERTAIN',{message})}
          else insertions.phase(input.requestId,'FAILED',{message})
          throw error
        }
      })
    }catch(error){return insertionError(reply,error)}
  })
  const interruptedItems=new Interruptions(app.sqlite)
  const assertInterruptionAccess=(request:FastifyRequest,id:string,action:Action='TRANSPORT')=>{
    if(access.required()&&!access.identity(request) || !can(access.role(request),action) || !access.channelAllowed(request,id))throw new CollaborativeEditError(403,{error:'A sessão ou a permissão de operação deste canal mudou.'})
    const channel=app.db.select().from(channels).where(eq(channels.id,id)).get()
    if(!channel || channel.archivedAt)throw new CollaborativeEditError(404,{error:'Canal ativo não encontrado.'})
  }
  const interruptionReview=(row:InterruptedItem,runtime:ChannelRuntime|undefined)=>installationVault().reviewIdentity(JSON.stringify({
    row:{id:row.id,channelId:row.channel_id,rundownId:row.rundown_id,itemId:row.item_id,revisionId:row.revision_id,frames:row.frames},
    context:runtime?.interruptionContext()??null,configurationRevision:configurationRevision(app.db,row.channel_id),
    editorialRevision:new EditorialVersions(app.sqlite).read(row.rundown_id),entry:runtime?.executionView?.items.find(entry=>entry.item.id===row.item_id)??null,
    media:app.db.select().from(mediaAssets).where(eq(mediaAssets.id,runtime?.executionView?.items.find(entry=>entry.item.id===row.item_id)?.item.mediaId??'')).get()??null,
    qc:app.db.select().from(qcDecisions).where(eq(qcDecisions.assetId,runtime?.executionView?.items.find(entry=>entry.item.id===row.item_id)?.item.mediaId??'')).orderBy(asc(qcDecisions.createdAt),asc(qcDecisions.id)).all(),
  }),'interrupted-return:v1')
  const requireInterruptionReview=(row:InterruptedItem,runtime:ChannelRuntime|undefined,token:string)=>{
    if(interruptionReview(row,runtime)!==token)throw new CollaborativeEditError(409,{error:'A execução, edição, mídia/QC ou configuração mudou depois da conferência. Atualize a lista; nenhum TAKE foi enviado.'})
  }
  server.get('/api/channels/:id/interruptions', async (request, reply) => {
    const {id}=request.params as {id:string}
    try{return app.db.transaction(()=>{
      assertInterruptionAccess(request,id)
      const runtime=app.runtimes.get(id)
      reply.header('Cache-Control','private, no-store')
      return {items:interruptedItems.list(id).map(row=>{const run=app.interruptionCommands.current(row.id);return {...row,reviewToken:interruptionReview(row,runtime),operation:run?app.interruptionCommands.publicRun(run):null,canReconcile:can(access.role(request),'OUTPUT_CONTROL') && app.interruptionCommands.canReconcile(row.id)}}),cursorEvidence:'LAST_ENGINE_REPORT'}
    })}catch(error){if(error instanceof CollaborativeEditError)return reply.code(error.status).send(error.payload);throw error}
  })
  server.post('/api/channels/:id/interruptions/:interruptionId', async (request, reply) => {
    if (!(await allowed(request, 'TRANSPORT'))) return reply.code(403).send({ error: 'Sem permissão para operar o PGM.' })
    const { id, interruptionId } = request.params as { id: string; interruptionId: string }
    const body = z.object({ action: z.enum(['RESUME', 'DISCARD']),requestId:z.string().uuid(),reviewToken:z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict().safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: 'Confira o retorno e envie a decisão, seu identificador e a conferência original.' })
    const runtime = app.runtimes.get(id)
    const actor = await usernameOf(request)
    const authorize=()=>assertInterruptionAccess(request,id)
    const claim=()=>{
      if(app.runtimes.get(id)!==runtime)throw new CollaborativeEditError(409,{error:'O runtime mudou. Confira novamente o retorno.'})
      const row=interruptedItems.list(id).find(item=>item.id===interruptionId)
      if(!row)throw new CollaborativeEditError(409,{error:'Interrupção mudou ou já foi resolvida.'})
      requireInterruptionReview(row,runtime,body.data.reviewToken)
      if(body.data.action==='RESUME'){
        const view=runtime?.executionView,entry=view?.items.find(item=>item.item.id===row.item_id)
        if(!runtime || !view || !entry)throw new CollaborativeEditError(409,{error:'O VT não está na playlist operacional carregada.'})
        const reason=runtime.reconfigurationStatus(true,false).reason;if(reason)throw new CollaborativeEditError(409,{error:reason})
        if(runtime.transport.state().onAir?.itemId===row.item_id)throw new CollaborativeEditError(409,{error:'O VT já está no PGM. Não é seguro repetir seu cursor de retorno.'})
        interruptedItems.validateEntry(id,interruptionId,view.rundown.id,entry)
        const media=entry.asset,latest=media?app.db.select().from(mediaAssets).where(eq(mediaAssets.id,media.id)).get():undefined
        const base=media&&latest?.contentHash===media.contentHash?{...media,...toAsset(latest),path:media.path}:media
        const checked=base?applyQcDecisionsNow(app.db,new Map([[base.id,base]]),id).get(base.id):null
        const channel=app.db.select().from(channels).where(eq(channels.id,id)).get()!
        if(!checked || checked.probeError || checked.ignored || !qcApproved(checked.qcStatus??'APPROVED') || !assessQc(checked,channel.qcProfile??DEFAULT_QC_PROFILE).playable)throw new CollaborativeEditError(409,{error:'A versão do VT está indisponível ou não está aprovada no QC deste canal. PGM anterior preservado.'})
      }
    }
    try{
      const result=await app.interruptionCommands.execute(body.data.requestId,{channelId:id,interruptionId,action:body.data.action,reviewToken:body.data.reviewToken},actor,runtime?.transport instanceof EngineTransport?runtime.transport.processId():null,authorize,claim,async lifecycle=>{
        const row=interruptedItems.list(id).find(item=>item.id===interruptionId)!,view=runtime!.executionView!
        if(runtime!.transport instanceof EngineTransport)await runtime!.transport.takeWithLifecycle(view.rundown.id,row.item_id,row.frames,lifecycle)
        else{lifecycle.validate();lifecycle.beforeTake();await runtime!.transport.take(view.rundown.id,row.item_id,row.frames);if(runtime!.transport.state().onAir?.itemId!==row.item_id)throw new Error('Simulador não confirmou o retorno.');lifecycle.confirmed(false)}
      })
      onChange()
      if(result.run.phase!=='CONFIRMED')return reply.code(409).send({error:result.run.message??'Retorno em andamento ou inconclusivo; nenhum TAKE será repetido.',...result})
      return {ok:true,...result,cursorEvidence:'LAST_ENGINE_REPORT'}
    }catch(error){if(error instanceof CollaborativeEditError)return reply.code(error.status).send(error.payload);return reply.code(409).send({error:sanitizeDiagnostic(error instanceof Error?error.message:'Retorno não confirmado; confira a pendência.')})}
  })
  // Native live source replacement (PREPARE/COMMIT/CANCEL/STATUS). Inert with
  // an engine that does not advertise the protocol: nativeLiveSelection and
  // the wire refuse before any byte. Never a LOAD/TAKE or metadata fallback.
  const replacementTransaction=z.string().regex(/^[A-Za-z0-9_-]{43}$/)
  const replacementSession=(request:FastifyRequest,id:string)=>{
    assertInterruptionAccess(request,id,'TRANSPORT')
    const runtime=app.runtimes.get(id)
    if(!runtime||!(runtime.transport instanceof EngineTransport))throw new CollaborativeEditError(409,{error:'Canal sem engine nativo ativo; troca de fonte indisponível.'})
    const identity=access.identity(request),actorId=identity?.id??null
    // Re-run per command inside the engine queue: session expiry, role,
    // channel scope, same operator and same runtime instance.
    return runtime.nativeReplacementSession({id:actorId,name:identity?.username??null},()=>{
      assertInterruptionAccess(request,id,'TRANSPORT')
      if((access.identity(request)?.id??null)!==actorId)throw new CollaborativeEditError(403,{error:'A sessão mudou de operador; nenhum comando de troca foi enviado.'})
      if(app.runtimes.get(id)!==runtime)throw new CollaborativeEditError(409,{error:'O runtime do canal mudou; confira novamente a troca.'})
    })
  }
  const replacementError=(reply:import('fastify').FastifyReply,error:unknown)=>{
    if(error instanceof CollaborativeEditError)return reply.code(error.status).send(error.payload)
    return reply.code(409).send({error:sanitizeDiagnostic(error instanceof Error?error.message:'Troca de fonte não confirmada.'),
      outcomeUnknown:error instanceof NativeLiveReplacementUnknown,nativeProgramConfirmed:false,physicalOutputValidated:false})
  }
  server.post('/api/channels/:id/live-replacement',async(request,reply)=>{
    const {id}=request.params as {id:string}
    const body=z.object({targetSourceId:z.string().min(1).max(256)}).strict().safeParse(request.body)
    if(!body.success)return reply.code(400).send({error:'Informe a fonte alternativa (par cadastrado) da live no PGM.'})
    try{
      const result=await replacementSession(request,id).prepare(request.headers['idempotency-key'],body.data.targetSourceId)
      onChange();return {ok:true,...result}
    }catch(error){onChange();return replacementError(reply,error)}
  })
  server.get('/api/channels/:id/live-replacement/:transactionId',async(request,reply)=>{
    const {id,transactionId}=request.params as {id:string;transactionId:string}
    if(!replacementTransaction.safeParse(transactionId).success)return reply.code(400).send({error:'Transação inválida.'})
    try{return replacementSession(request,id).receipt(transactionId)}catch(error){return replacementError(reply,error)}
  })
  server.post('/api/channels/:id/live-replacement/:transactionId/:operation',async(request,reply)=>{
    const {id,transactionId,operation}=request.params as {id:string;transactionId:string;operation:string}
    if(!replacementTransaction.safeParse(transactionId).success||!['commit','cancel','status'].includes(operation))return reply.code(400).send({error:'Transação ou operação inválida.'})
    if(operation!=='status'&&!z.object({confirm:z.literal(true)}).strict().safeParse(request.body).success)return reply.code(400).send({error:'Confirme explicitamente o corte/cancelamento da fonte no PGM.'})
    try{
      const session=replacementSession(request,id)
      const result=operation==='commit'?await session.commit(transactionId):operation==='cancel'?await session.cancel(transactionId):await session.status(transactionId)
      onChange()
      if(operation==='commit'&&!result.nativeProgramConfirmed)return reply.code(409).send({error:'Corte nativo não confirmado; consulte a mesma transação, sem reenviar COMMIT.',...result})
      return {ok:true,...result}
    }catch(error){onChange();return replacementError(reply,error)}
  })
  server.post('/api/channels/:id/interruptions/:interruptionId/acknowledge',async(request,reply)=>{
    const {id,interruptionId}=request.params as {id:string;interruptionId:string}
    const body=z.object({requestId:z.string().uuid(),reviewToken:z.string().regex(/^[A-Za-z0-9_-]{43}$/),confirm:z.literal(true)}).strict().safeParse(request.body)
    if(!body.success)return reply.code(400).send({error:'Confira e confirme o encerramento da pendência, sem retorno automático.'})
    const runtime=app.runtimes.get(id)
    try{
      const work=()=>app.interruptionCommands.acknowledge(id,interruptionId,body.data.requestId,access.identity(request)?.username??null,()=>{
        assertInterruptionAccess(request,id,'OUTPUT_CONTROL')
        const row=interruptedItems.list(id).find(item=>item.id===interruptionId)
        if(!row || app.runtimes.get(id)!==runtime)throw new CollaborativeEditError(409,{error:'A pendência/runtime mudou; confira novamente.'})
        requireInterruptionReview(row,runtime,body.data.reviewToken)
        const state=runtime?.transport.state(),reason=runtime?.reconfigurationStatus(false,false).reason
        if(reason || state?.playing || state?.onAir || state?.preview)throw new CollaborativeEditError(409,{error:reason??'Pare o PGM e limpe o CUE antes de encerrar a pendência.'})
        const checkpoints=new Checkpoints(app.sqlite),saved=checkpoints.read(id)
        if(saved)checkpoints.write(stoppedCheckpoint(saved))
      })
      const result=await (runtime?.transport instanceof EngineTransport?runtime.transport.mutatePlaylist(async()=>work()):work())
      onChange();return result
    }catch(error){if(error instanceof CollaborativeEditError)return reply.code(error.status).send(error.payload);return reply.code(409).send({error:sanitizeDiagnostic(error instanceof Error?error.message:'Pendência não encerrada.')})}
  })

  // ---- as-run ------------------------------------------------------------

  server.get('/api/channels/:id/asrun', async (request, reply) => {
    const { id } = request.params as { id: string }
    const { since, until, limit } = request.query as { since?: string; until?: string; limit?: string }
    const channel = await getChannel(app.db, id, true)
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

  /** Feed XMLTV da grade planejada para operadoras e distribuidores OTT. */
  const getXmltvHandler = async (
    request: { headers: Record<string, string | string[] | undefined>; query: { channelId?: string; date?: string }; params?: { id?: string } },
    reply: any,
  ) => {
    if (!(await allowed(request, 'REPORT_EXPORT'))) return reply.code(403).send({ error: 'Sem permissão para exportar EPG.' })
    const channelId = request.params?.id ?? request.query.channelId
    if (!channelId) return reply.code(400).send({ error: 'Informe channelId.' })
    const channel = await getChannel(app.db, channelId)
    if (!channel) return reply.code(404).send({ error: 'Canal não encontrado.' })
    const allRundowns = await listRundowns(app.db, channelId)
    const selected = request.query.date ? allRundowns.filter((rundown) => rundown.date === request.query.date) : allRundowns
    const assets = await assetMap(app.db)
    const payload = exportXmltv({
      channel,
      assets,
      rundowns: await Promise.all(selected.map(async (rundown) => ({ rundown, items: await listItems(app.db, rundown.id) }))),
    })
    return reply
      .header('content-type', 'application/xml; charset=utf-8')
      .header('content-disposition', `attachment; filename="epg-${channel.name.replace(/\W+/g, '-')}.xml"`)
      .send(payload)
  }
  server.get('/api/channels/:id/epg.xml', getXmltvHandler as any)
  server.get('/api/v1/epg/xmltv', getXmltvHandler as any)

  /**
   * Comprovante imprimível de veiculação comercial. O PDF só inclui dados do
   * as-run, jamais a previsão da grade, para não certificar inserções que não
   * chegaram ao ar.
   */
  const getCommercialReportHandler = async (
    request: { headers: Record<string, string | string[] | undefined>; query: { channelId?: string; since?: string; until?: string; limit?: string }; params?: { id?: string } },
    reply: any,
  ) => {
    if (!(await allowed(request, 'REPORT_EXPORT'))) return reply.code(403).send({ error: 'Sem permissão para exportar relatórios.' })
    const channelId = request.params?.id ?? request.query.channelId
    if (!channelId) return reply.code(400).send({ error: 'Informe channelId.' })
    const channel = await getChannel(app.db, channelId, true)
    if (!channel) return reply.code(404).send({ error: 'Canal não encontrado.' })
    const since = request.query.since ?? new Date(Date.now() - 24 * 3600 * 1000).toISOString()
    const limit = Math.min(10_000, Math.max(1, Number(request.query.limit ?? 5000) || 5000))
    const entries = await listAsRun(app.db, channelId, since, limit, request.query.until)
    const report = buildCommercialComplianceReport(entries, channel.rate, { since, until: request.query.until ?? null })
    const pdf = renderCommercialCompliancePdf(channel.name, report)
    return reply
      .header('content-type', 'application/pdf')
      .header('content-disposition', `attachment; filename="comprovante-veiculacao-${channel.name.replace(/\W+/g, '-')}-${since.slice(0, 10)}.pdf"`)
      .send(pdf)
  }
  server.get('/api/channels/:id/reports/commercial.pdf', getCommercialReportHandler as any)
  server.get('/api/v1/reports/commercial.pdf', getCommercialReportHandler as any)

  // ---- grafismo ----------------------------------------------------------

  server.get('/api/graphics', async (request) => {
    const { channelId } = request.query as { channelId?: string }
    const rows = await app.db.select().from(graphicTemplates).orderBy(asc(graphicTemplates.name))
    // Template sem canal vale para todos; com canal, só para o dele.
    return {
      templates: rows.filter(
        (row) => (row.channelId === null || access.channelAllowed(request,row.channelId)) && (!channelId || row.channelId === null || row.channelId === channelId),
      ),
    }
  })

  server.get('/api/graphics/review',async(request,reply)=>{
    const query=z.object({channelId:z.string().min(1).optional()}).strict().safeParse(request.query)
    if(!query.success)return reply.code(400).send({error:'Escopo de artes inválido.'})
    try{
      const ownerId=access.identity(request)?.id??null,result=readGraphicsReview(app.db,query.data.channelId??null,graphicsAuthority(request,ownerId,false))
      reply.header('cache-control','private, no-store').header('etag',graphicsETag(result));return result
    }catch(error){if(error instanceof CollaborativeEditError)return reply.code(error.status).send(error.payload);throw error}
  })
  const changeGraphic=(operation:'CREATE'|'UPDATE'|'DELETE')=>async(request:FastifyRequest,reply:any)=>{
    try{
      const target=(request.params as {id?:string}).id,result=editGraphicTemplate(app.db,operation,target,request.body,request.headers['if-match'],graphicsHooks(request,'GRAPHIC_TEMPLATE_EDITED'))
      reply.header('cache-control','private, no-store').header('etag',result.eTag)
      try{onChange();return result}catch(error){return {...result,refreshError:sanitizeDiagnostic(error instanceof Error?error.message:'Arte gravada; atualização de tela não confirmada.')}}
    }catch(error){if(error instanceof CollaborativeEditError)return reply.code(error.status).send(error.payload);throw error}
  }
  server.post('/api/graphics',changeGraphic('CREATE'))
  server.patch('/api/graphics/:id',changeGraphic('UPDATE'))
  server.delete('/api/graphics/:id',changeGraphic('DELETE'))

  const fireSchema = z.object({
    templateId: z.string(),
    values: z.record(z.string(), z.string()).optional(),
  }).strict()
  const assertGraphicAccess=(request:FastifyRequest,id:string,action:Action,ownerId:string|null)=>{
    const current=access.identity(request)
    if((current?.id??null)!==ownerId||access.required()&&!current||!can(access.role(request),action)||!access.channelAllowed(request,id))throw new CollaborativeEditError(403,{error:'Sessão ou acesso ao canal mudou; grafismo não enviado.'})
  }
  const assertGraphicAuthority=(request:FastifyRequest,id:string,action:Action,ownerId:string|null)=>{
    assertGraphicAccess(request,id,action,ownerId)
    const runtime=app.runtimes.get(id)
    if(runtime?.emergencyOverlay||runtime?.emergencyCommandPending)throw new CollaborativeEditError(409,{error:'Slate de emergência ativo ou aguardando confirmação; encerre a intervenção antes de substituir o grafismo.'})
  }
  const graphicCommand=<T>(request:FastifyRequest,id:string,selection:object,authorize:()=>void,work:(beforeSend:()=>void)=>Promise<T>)=>{
    const actor=access.identity(request)
    const runtime=app.runtimes.get(id),context=runtime?.graphicContext()??null
    const boundAuthorize=()=>{
      authorize()
      if(JSON.stringify(runtime?.graphicContext()??null)!==JSON.stringify(context))throw new CollaborativeEditError(409,{error:'Ocorrência de PGM mudou durante a espera; atualize antes de enviar o grafismo.'})
    }
    return new GraphicCommandLedger(app.db,id).execute({key:request.headers['idempotency-key'],actorId:actor?.id??null,actorName:actor?.username??null,selection,context:()=>runtime?.graphicContext()??null,native:runtime?.transport.state().mode==='NATIVE'},boundAuthorize,work)
  }
  server.get('/api/channels/:id/graphic-commands',async(request,reply)=>{
    const {id}=request.params as {id:string},actor=access.identity(request)
    try{assertGraphicAccess(request,id,'PLAYLIST_EDIT',actor?.id??null);return reply.header('Cache-Control','private, no-store').send({commands:new GraphicCommandLedger(app.db,id).list(),canReview:can(access.role(request),'OUTPUT_CONTROL')})}catch(error){return automationError(reply,error)}
  })
  server.post('/api/channels/:id/graphic-commands/:commandId/review',async(request,reply)=>{
    const {id,commandId}=request.params as {id:string;commandId:string},actor=access.identity(request)
    const body=z.object({reviewToken:z.string().min(1),note:z.string().trim().min(1).max(500),imageAndEngineChecked:z.literal(true)}).strict().safeParse(request.body)
    if(!body.success)return reply.code(400).send({error:'Confirme a conferência do engine e da imagem com uma observação.'})
    try{return {graphicCommand:new GraphicCommandLedger(app.db,id).review(commandId,body.data.reviewToken,body.data.note,actor?.username??null,()=>assertGraphicAccess(request,id,'OUTPUT_CONTROL',actor?.id??null)),signalRecovered:false}}catch(error){return automationError(reply,error)}
  })

  server.post('/api/channels/:id/graphic', async (request, reply) => {
    const { id } = request.params as { id: string }
    if (!(await allowed(request, 'PLAYLIST_EDIT'))) return reply.code(403).send({ error: 'Seu papel não pode colocar grafismos no ar.' })
    const body = fireSchema.safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const ownerId=access.identity(request)?.id??null
    const runtime = await runtimeFor(app, id)
    if (!runtime) return reply.code(404).send({ error: 'Canal não encontrado.' })

    const [template] = await app.db
      .select()
      .from(graphicTemplates)
      .where(eq(graphicTemplates.id, body.data.templateId))
    if (!template) return reply.code(404).send({ error: 'Template não existe.' })
    if (template.channelId && template.channelId !== id) return reply.code(400).send({error:'Template não pertence a este canal.'})

    let receipt:import('./domain/graphic-command-ledger.js').GraphicCommandReceipt
    const authorize=()=>assertGraphicAuthority(request,id,'PLAYLIST_EDIT',ownerId)
    try{receipt=(await graphicCommand(request,id,{action:'SHOW',templateSnapshot:template,values:body.data.values??{}},authorize,beforeSend=>runtime.graphics.showConfirmed(template,body.data.values??{},authorize,beforeSend))).receipt}catch(error){return automationError(reply,error)}
    onChange()
    return {...await snapshot(app, runtime),graphicCommand:receipt}
  })

  // ---- overlays 1–8 (títulos GT, como no vMix) -------------------------------
  server.get('/api/channels/:id/overlays', async (request, reply) => {
    const { id } = request.params as { id: string }
    if (!access.channelAllowed(request, id)) return reply.code(403).send({ error: 'Sem acesso a este canal.' })
    const runtime = await runtimeFor(app, id)
    if (!runtime) return reply.code(404).send({ error: 'Canal não encontrado.' })
    return reply.header('cache-control', 'private, no-store').send({ slots: overlayDeckOf(runtime).list() })
  })
  server.post('/api/channels/:id/overlays/:slot', async (request, reply) => {
    const { id, slot } = request.params as { id: string; slot: string }
    if (!(await allowed(request, 'PLAYLIST_EDIT'))) return reply.code(403).send({ error: 'Seu papel não pode operar overlays.' })
    if (!access.channelAllowed(request, id)) return reply.code(403).send({ error: 'Sem acesso a este canal.' })
    const body = overlayCommandSchema.safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: 'Comando de overlay inválido.' })
    const runtime = await runtimeFor(app, id)
    if (!runtime) return reply.code(404).send({ error: 'Canal não encontrado.' })
    if (runtime.emergencyOverlay || runtime.emergencyCommandPending) return reply.code(409).send({ error: 'Slate de emergência ativo; encerre a intervenção antes de operar overlays.' })
    let template: GraphicTemplate | null = null
    if (body.data.action === 'IN' || body.data.action === 'CUT') {
      const templateId = body.data.templateId ?? overlayDeckOf(runtime).list().find(entry => entry.slot === Number(slot))?.templateId
      if (!templateId) return reply.code(400).send({ error: 'Escolha a arte do overlay.' })
      const [row] = await app.db.select().from(graphicTemplates).where(eq(graphicTemplates.id, templateId))
      if (!row) return reply.code(404).send({ error: 'Arte não existe.' })
      if (row.channelId && row.channelId !== id) return reply.code(400).send({ error: 'Arte não pertence a este canal.' })
      template = row as unknown as GraphicTemplate
    }
    try {
      const actor = access.identity(request)?.username ?? null
      const result = await overlayDeckOf(runtime).command(runtime.transport, Number(slot), body.data, template, actor)
      // Registro operacional do overlay (quem pôs/tirou o quê e quando).
      try{app.db.insert(operatorDecisions).values({id:randomUUID(),rundownId:'@overlays',itemId:null,kind:`OVERLAY_${body.data.action}`,payload:{channelId:id,slot:Number(slot),templateId:result?.templateId??null,name:result?.name??null,values:result?.values??{}},actorUsername:actor,createdAt:new Date().toISOString()}).run()}catch{/* registro não derruba o comando já confirmado */}
      onChange()
      return { slot: result, slots: overlayDeckOf(runtime).list() }
    } catch (error) {
      if (error instanceof OverlayError) return reply.code(error.status).send({ error: error.message })
      return reply.code(502).send({ error: sanitizeDiagnostic(error instanceof Error ? error.message : 'Engine não confirmou o overlay.') })
    }
  })

  server.delete('/api/channels/:id/graphic', async (request, reply) => {
    const { id } = request.params as { id: string }
    if (!(await allowed(request, 'PLAYLIST_EDIT'))) return reply.code(403).send({ error: 'Seu papel não pode retirar grafismos.' })
    const ownerId=access.identity(request)?.id??null
    const runtime = await runtimeFor(app, id)
    if (!runtime) return reply.code(404).send({ error: 'Canal não encontrado.' })
    let receipt:import('./domain/graphic-command-ledger.js').GraphicCommandReceipt
    const authorize=()=>assertGraphicAuthority(request,id,'PLAYLIST_EDIT',ownerId)
    try{receipt=(await graphicCommand(request,id,{action:'HIDE_ALL'},authorize,beforeSend=>runtime.graphics.hideConfirmed(authorize,300,beforeSend))).receipt}catch(error){return automationError(reply,error)}
    onChange()
    return {...await snapshot(app, runtime),graphicCommand:receipt}
  })

  server.get('/api/items/:id/graphics', async (request, reply) => {
    const { id } = request.params as { id: string }
    const current=readItemAutomationState(app.db,id)
    if(!current)return reply.code(404).send({error:'Item não encontrado.'})
    try{if(request.headers['if-match'])requireEditorialRevision(app.concurrency,current.rundownId,request.headers['if-match'],current.editorialRevision,id)}catch(error){return automationError(reply,error)}
    return current
  })

  const cueSchema = z.object({
    templateId: z.string(),
    values: z.record(z.string(), z.string()).optional(),
    atSeconds: z.number().int().min(0).max(86_400),
  })

  const secondarySchema = z.object({
    name:z.string().trim().min(1).max(120), targetLayer:z.enum(['STATION_LOGO','ONAIR_CLOCK','CRAWL_TICKER','LOWER_THIRD']),
    triggerMode:z.enum(['OFFSET_FROM_START','OFFSET_BEFORE_END','MANUAL']),offsetFrames:z.number().int().min(0).max(100_000_000),
    durationFrames:z.number().int().positive().max(100_000_000).optional(),templateId:z.string().default(''),
    payload:z.record(z.unknown()).default({}),enabled:z.boolean().default(true),type:z.enum(['GRAPHICS_OVERLAY','SCTE_TRIGGER','DEVICE_AUTOMATION']).default('GRAPHICS_OVERLAY'),
    deviceConfig: scheduledDeviceSchema.optional(),
  }).refine(value=>value.type==='GRAPHICS_OVERLAY' || !value.durationFrames,'SCTE/equipamento não possui descarte automático; use evento separado para retorno.')
    .refine(value=>value.type==='DEVICE_AUTOMATION' ? Boolean(value.deviceConfig) : !value.deviceConfig,'Configuração de equipamento exige tipo DEVICE_AUTOMATION explícito.')
  server.get('/api/items/:id/secondary-events',async (request,reply)=>{
    const {id}=request.params as {id:string}
    const current=readItemAutomationState(app.db,id)
    return current??reply.code(404).send({error:'Item não encontrado.'})
  })
  server.post('/api/items/:id/secondary-events',async (request,reply)=>{
    if (!(await allowed(request,'PLAYLIST_EDIT'))) return reply.code(403).send({error:'Sem permissão para programar eventos.'})
    const {id}=request.params as {id:string},body=secondarySchema.safeParse(request.body)
    if (!body.success) return reply.code(400).send({error:'Evento inválido; informe nome, camada, offset inteiro e tipo válido.'})
    if (body.data.type==='DEVICE_AUTOMATION' && !(await allowed(request,'OUTPUT_CONTROL'))) return reply.code(403).send({error:'Programar equipamento exige permissão de controle de saídas.'})
    try{
      const result=editItemAutomation(request,id,'SECONDARY_EVENT_ADDED',(tx,state)=>{
        if(body.data.type==='DEVICE_AUTOMATION'&&!can(access.role(request),'OUTPUT_CONTROL'))throw new CollaborativeEditError(403,{error:'Programar equipamento exige permissão atual de controle de saídas.'})
        if(body.data.type==='GRAPHICS_OVERLAY'&&body.data.templateId){
          const template=tx.select().from(graphicTemplates).where(eq(graphicTemplates.id,body.data.templateId)).get()
          if(!template||template.channelId&&template.channelId!==state.channel.id)throw new CollaborativeEditError(400,{error:'Template não pertence a este canal.'})
        }
        const definition={...body.data,id:randomUUID(),channelId:state.channel.id,rundownItemId:id}
        if(definition.type==='DEVICE_AUTOMATION'){
          try{freezeDeviceAutomation(tx,definition)}catch(error){throw new CollaborativeEditError(400,{error:error instanceof Error?error.message:'Equipamento inválido.'})}
          const {configurationHash:_hash,...editorialDevice}=definition.deviceConfig!;definition.deviceConfig=editorialDevice
        }
        const now=new Date().toISOString()
        tx.insert(secondaryEvents).values({id:definition.id,channelId:state.channel.id,itemId:id,definition,createdAt:now,updatedAt:now}).run()
        return {event:definition}
      })
      await app.runtimes.get(result.channelId)?.refresh();onChange();return result
    }catch(error){return automationError(reply,error)}
  })
  server.delete('/api/items/:id/secondary-events/:eventId',async (request,reply)=>{
    if (!(await allowed(request,'PLAYLIST_EDIT'))) return reply.code(403).send({error:'Sem permissão para remover eventos.'})
    const {id,eventId}=request.params as {id:string;eventId:string}
    try{
      const result=editItemAutomation(request,id,'SECONDARY_EVENT_REMOVED',(tx)=>{
        const stored=tx.select().from(secondaryEvents).where(and(eq(secondaryEvents.id,eventId),eq(secondaryEvents.itemId,id))).get()
        if(!stored)throw new CollaborativeEditError(404,{error:'Evento não pertence ao item.'})
        if((stored.definition.type==='DEVICE_AUTOMATION'||stored.definition.deviceConfig)&&!can(access.role(request),'OUTPUT_CONTROL'))throw new CollaborativeEditError(403,{error:'Remover automação de equipamento exige permissão atual de controle de saídas.'})
        tx.delete(secondaryEvents).where(eq(secondaryEvents.id,eventId)).run();return {ok:true,eventId}
      })
      await app.runtimes.get(result.channelId)?.refresh();onChange();return result
    }catch(error){return automationError(reply,error)}
  })
  server.get('/api/channels/:id/secondary-event-runs',async (request,reply)=>{
    if (!(await allowed(request,'REPORT_EXPORT'))) return reply.code(403).send({error:'Sem permissão para consultar execução.'})
    const {id}=request.params as {id:string}
    return {runs:await app.db.select().from(secondaryEventRuns).where(eq(secondaryEventRuns.channelId,id)).orderBy(desc(secondaryEventRuns.createdAt)).limit(100),
      uncertainState:'FIRING indica processo interrompido ou comando em andamento; não há reenvio automático nem garantia física de execução.'}
  })
  server.post('/api/channels/:id/secondary-events/:eventId/fire',async (request,reply)=>{
    if (!(await allowed(request,'OUTPUT_CONTROL'))) return reply.code(403).send({error:'Sem permissão para disparar eventos.'})
    const {id,eventId}=request.params as {id:string;eventId:string}
    const runtime=app.runtimes.get(id),onAir=runtime?.transport.state().onAir
    const event=runtime?.graphics.scheduler.getEvents().find(event=>event.id===eventId)
    if (!runtime || !onAir || !event?.enabled || event.rundownItemId!==onAir.itemId) return reply.code(409).send({error:'Evento não pertence ao item publicado e confirmado no PGM.'})
    try {
      const run=await runtime.fireSecondaryEvent(eventId)
      if (run.state!=='EXECUTED') return reply.code(409).send({error:run.state==='FIRING' ? 'Execução em andamento ou incerta após interrupção; confirme no destino antes de repetir.' : run.error ?? 'Evento falhou e não será repetido automaticamente.',run,physicalExecutionConfirmed:false})
      return {ok:true,status:'EXECUTED',run,physicalExecutionConfirmed:false}
    } catch {return reply.code(409).send({error:'Comando não executado; consulte o registro de eventos e o estado do canal.'})}
  })

  server.post('/api/items/:id/graphics', async (request, reply) => {
    const { id } = request.params as { id: string }
    if (!(await allowed(request, 'PLAYLIST_EDIT'))) return reply.code(403).send({ error: 'Seu papel não pode programar grafismos.' })
    const body = cueSchema.safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    try{
      const result=editItemAutomation(request,id,'ITEM_GRAPHIC_ADDED',(tx,state)=>{
        const template=tx.select().from(graphicTemplates).where(eq(graphicTemplates.id,body.data.templateId)).get()
        if(!template||template.channelId&&template.channelId!==state.channel.id)throw new CollaborativeEditError(400,{error:'Template não pertence a este canal.'})
        const cueId=randomUUID()
        tx.insert(itemGraphics).values({id:cueId,itemId:id,templateId:template.id,values:body.data.values??{},atSeconds:body.data.atSeconds,createdAt:new Date().toISOString()}).run()
        return {cueId}
      })
      await app.runtimes.get(result.channelId)?.refresh();onChange();return result
    }catch(error){return automationError(reply,error)}
  })

  server.delete('/api/item-graphics/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    if (!(await allowed(request, 'PLAYLIST_EDIT'))) return reply.code(403).send({ error: 'Seu papel não pode remover grafismos programados.' })
    const [cue] = await app.db.select().from(itemGraphics).where(eq(itemGraphics.id, id))
    if (!cue) return reply.code(404).send({ error: 'Deixa não existe.' })

    try{
      const result=editItemAutomation(request,cue.itemId,'ITEM_GRAPHIC_REMOVED',(tx)=>{
        const current=tx.select().from(itemGraphics).where(eq(itemGraphics.id,id)).get()
        if(!current||current.itemId!==cue.itemId)throw new CollaborativeEditError(404,{error:'Deixa não pertence mais ao item.'})
        tx.delete(itemGraphics).where(eq(itemGraphics.id,id)).run();return {cueId:id}
      })
      await app.runtimes.get(result.channelId)?.refresh();onChange();return result
    }catch(error){return automationError(reply,error)}
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

  server.post('/api/channels/:id/qc/inspection', async (request,reply)=>{
    const {id}=request.params as {id:string}
    const body=z.object({viewerId:z.string().uuid(),sourceRef:z.string().min(1).max(16_384),watching:z.boolean()}).strict().safeParse(request.body)
    if(!body.success)return reply.code(400).send({error:'Pedido de inspeção inválido.'})
    const runtime=await runtimeFor(app,id)
    if(!runtime)return reply.code(404).send({error:'Canal não encontrado.'})
    const token=sessionToken(request)
    const owner=token?sessionDigest(token):`${await usernameOf(request) ?? '@local'}:${request.ip}`
    const originalUser=access.identity(request)?.id??null
    const authorize=()=>{
      const current=access.identity(request)
      if(access.required()&&!current || (current?.id??null)!==originalUser || !access.channelAllowed(request,id))throw new CollaborativeEditError(403,{error:'A sessão ou a permissão do QC mudou. Entre novamente antes de inspecionar.'})
    }
    try {
      await runtime.qcInspection.watch(`${owner}:${body.data.viewerId}`,body.data.sourceRef,body.data.watching,authorize)
      return {ok:true,rendition:'qc-encoded',profileFromSource:true,maxWidth:3840,maxHeight:2160,maxFps:60,maxBitrateKbps:50000}
    } catch(error){
      if(error instanceof CollaborativeEditError)return reply.code(error.status).send(error.payload)
      return reply.code(409).send({error:error instanceof Error?error.message:'Inspeção em qualidade indisponível.'})
    }
  })

  // ---- perfis de saída ---------------------------------------------------

  server.get('/api/channels/:id/outputs', async (request,reply) => {
    const { id } = request.params as { id: string }
    const host = lanAddress()
    const path = app.paths.find((entry) => entry.channelId === id)
    const snapshot=app.db.transaction(tx=>{
      const row=tx.select().from(channels).where(eq(channels.id,id)).get()
      if(!row)return null
      return {rows:tx.select().from(outputProfiles).where(eq(outputProfiles.channelId,id)).orderBy(asc(outputProfiles.createdAt)).all(),canal:toChannel(row),configurationRevision:configurationRevision(tx,id)}
    })
    if(!snapshot)return reply.code(404).send({error:'Canal não encontrado.'})
    const {rows,canal}=snapshot
    reply.header('ETag',channelConfigurationETag(id,snapshot.configurationRevision)).header('Cache-Control','private, no-store')
    return {
      configurationRevision:snapshot.configurationRevision,
      configurationOperation:app.configurationChanges.status(id),
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
          configurationRevision:snapshot.configurationRevision,
          // Destino efetivo: derivado nos gerenciados, guardado nos demais.
          streamUrls,
          // Saídas externas podem conter a passphrase SRT ou a stream key
          // RTMP. A configuração real só sai do SQLite para o engine.
          target: redactUrl(row.target || primaryUrl || ''),
          resolvedTarget: redactUrl(targetOf(row, path) ?? ''),
          displayUrl: primaryUrl ? redactUrl(primaryUrl) : null,
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

  server.get('/api/channels/:id/configuration-operation',async(request,reply)=>{
    const {id}=request.params as {id:string}
    if(!app.db.select({id:channels.id}).from(channels).where(eq(channels.id,id)).get())return reply.code(404).send({error:'Canal não encontrado.'})
    reply.header('Cache-Control','private, no-store')
    return app.configurationChanges.status(id)
  })
  server.post('/api/channels/:id/configuration-operation/reconcile',async(request,reply)=>{
    const {id}=request.params as {id:string}
    const body=z.object({runId:z.string().uuid(),confirm:z.literal(true)}).strict().safeParse(request.body)
    if(!body.success)return reply.code(400).send({error:'Confira a operação inconclusiva e confirme sua identificação antes de reconciliar.'})
    if(!(await allowed(request,'OUTPUT_CONTROL')))return reply.code(403).send({error:'Seu papel não pode reconciliar configurações.'})
    const previous=app.runtimes.get(id)
    const authorize=(tx:EditorialTransaction)=>{
      assertConfigurationAccess(request,id)
      const channel=tx.select().from(channels).where(eq(channels.id,id)).get()
      if(!channel || channel.archivedAt)throw new CollaborativeEditError(409,{error:'Canal ativo não encontrado.'})
      requireChannelConfiguration(tx,id,request.headers['if-match'])
      const runtimeReason=previous?.reconfigurationStatus(false).reason
      if(runtimeReason)throw new CollaborativeEditError(409,{error:runtimeReason})
      const state=previous?.transport.state()
      if(app.runtimes.get(id)!==previous || state?.playing || state?.onAir || state?.preview || previous?.contingencyPending)throw new CollaborativeEditError(409,{error:'Pare o PGM e limpe o CUE antes de reconciliar. Nenhum TAKE será automático.'})
    }
    const work=()=>app.configurationChanges.execute(id,previous?.transport instanceof EngineTransport?previous.transport.processId():null,access.identity(request)?.username??null,'EXPLICIT_RECONCILIATION',async lease=>{
      try{
        previous?.checkpoint(true);previous?.close();app.runtimes.delete(id)
        const current=await runtimeFor(app,id)
        if(!current)throw new Error('Não foi possível reconstruir o canal.')
        // No checkpoint recovery here: opening the canonical profiles is an
        // explicitly authorized STOP operation, never a replay of TAKE.
        await current.transport.stop()
        if(previous?.view)await current.load(previous.view.rundown.id)
        current.checkpoint(true)
        app.db.transaction(tx=>{assertConfigurationAccess(request,id);lease.record(tx,'RECONCILED',{automaticTake:false,physicalOutputValidated:false})},{behavior:'immediate'})
        onChange();return {ok:true,reconciled:true,automaticTake:false,physicalOutputValidated:false}
      }catch(error){lease.markUncertain('Reconciliação não confirmada: '+(error instanceof Error?error.message:'falha no engine'));throw error}
    },{runId:body.data.runId,authorize})
    try{return await (previous?.transport instanceof EngineTransport?previous.transport.mutateConfiguration(work):work())}
    catch(error){if(error instanceof CollaborativeEditError)return reply.code(error.status).send(error.payload);return reply.code(409).send({error:sanitizeDiagnostic(error instanceof Error?error.message:'Reconciliação não confirmada.'),configurationUncertain:true})}
  })

  const outputTransaction=(request:FastifyRequest,id:string,lease:ConfigurationLease,work:(tx:EditorialTransaction)=>Record<string,unknown>)=>app.db.transaction(tx=>{
    if(app.mediamtx||app.hostFence)app.distributionOwnership.assertOwned()
    lease.assertOwned(tx);assertConfigurationAccess(request,id)
    const channel=tx.select().from(channels).where(eq(channels.id,id)).get()
    if(!channel || channel.archivedAt)throw new CollaborativeEditError(404,{error:'Canal ativo não encontrado.'})
    const revisionBefore=requireChannelConfiguration(tx,id,request.headers['if-match'])
    const changed=work(tx)
    return {...changed,configurationRevision:configurationRevision(tx,id),revisionBefore}
  },{behavior:'immediate'})
  const auditOutput=(tx:EditorialTransaction,request:FastifyRequest,channelId:string,kind:string,details:Record<string,unknown>)=>{
    auditChannels.set(request,[channelId])
    tx.insert(operatorDecisions).values({id:randomUUID(),rundownId:'@security',kind,payload:{channelId,...details},actorUsername:access.identity(request)?.username??null,createdAt:new Date().toISOString()}).run()
  }

  // ---- presets de transmissão ------------------------------------------

  const presetBody = z.object({
    name: z.string().trim().min(1).max(120),
    kind: z.enum(['SRT', 'RTMP']),
    target: z.string().trim().min(1).max(2048),
  }).strict().refine(value=>{
    try{const url=new URL(value.target);return Boolean(url.hostname) && (value.kind==='SRT'?url.protocol==='srt:':['rtmp:','rtmps:'].includes(url.protocol))}catch{return false}
  },{message:'O destino precisa ser uma URL válida do protocolo selecionado.'})

  const mutatePresets=(request:FastifyRequest,id:string,kind:string,work:(tx:EditorialTransaction)=>{value:Record<string,unknown>;details:Record<string,unknown>})=>app.db.transaction(tx=>{
    assertConfigurationAccess(request,id)
    const channel=tx.select().from(channels).where(eq(channels.id,id)).get()
    if(!channel)throw new CollaborativeEditError(404,{error:'Canal não encontrado.'})
    if(channel.archivedAt)throw new CollaborativeEditError(409,{error:'Reative o canal antes de alterar seus presets.'})
    const revisionBefore=requireChannelConfiguration(tx,id,request.headers['if-match'])
    const result=work(tx),revisionAfter=configurationRevision(tx,id)
    tx.insert(operatorDecisions).values({id:randomUUID(),rundownId:'@configuration',kind,payload:{channelId:id,...result.details,revisionBefore,revisionAfter},actorUsername:access.identity(request)?.username??null,createdAt:new Date().toISOString()}).run()
    auditChannels.set(request,[id])
    return {...result.value,configurationRevision:revisionAfter,applied:true}
  },{behavior:'immediate'})

  const presentPreset = (row: { id: string; channelId: string; name: string; kind: 'SRT' | 'RTMP'; target: string; createdAt: string }) => ({
    ...row,
    target: redactUrl(row.target),
  })

  server.get('/api/channels/:id/transmission-presets', async (request,reply) => {
    const { id } = request.params as { id: string }
    const snapshot=app.db.transaction(tx=>{
      if(!tx.select({id:channels.id}).from(channels).where(eq(channels.id,id)).get())return null
      const rows=tx.select().from(transmissionPresets).where(eq(transmissionPresets.channelId,id)).orderBy(asc(transmissionPresets.createdAt)).all()
      return {presets:rows.map(presentPreset),configurationRevision:configurationRevision(tx,id)}
    })
    if(!snapshot)return reply.code(404).send({error:'Canal não encontrado.'})
    reply.header('ETag',channelConfigurationETag(id,snapshot.configurationRevision)).header('Cache-Control','private, no-store')
    return snapshot
  })

  server.post('/api/channels/:id/transmission-presets', async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = presetBody.safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: 'Informe nome, protocolo SRT/RTMP e destino do preset.' })
    if (!(await allowed(request, 'OUTPUT_CONTROL'))) return reply.code(403).send({ error: 'Seu papel não pode salvar presets de transmissão.' })
    let target: string
    try { target = credentialAddress(body.data.target) }
    catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : 'Conexão do preset inválida.' }) }
    const row = { id: randomUUID(), channelId: id, ...body.data, target, createdAt: new Date().toISOString() }
    return configureChannel(id,reply,async()=>reply.code(201).send(mutatePresets(request,id,'TRANSMISSION_PRESET_CREATED',tx=>{
      tx.insert(transmissionPresets).values(row).run()
      return {value:{preset:presentPreset(row)},details:{presetId:row.id,name:row.name,kind:row.kind}}
    })))
  })

  server.post('/api/channels/:id/transmission-presets/:presetId/apply', async (request, reply) => {
    const { id, presetId } = request.params as { id: string; presetId: string }
    const body = z.object({ name: z.string().trim().min(1).max(120).optional() }).strict().safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: 'Nome de saída inválido.' })
    if (!(await allowed(request, 'OUTPUT_CONTROL'))) return reply.code(403).send({ error: 'Seu papel não pode aplicar presets de transmissão.' })
    return configureChannel(id, reply, async () => {
      const changed=mutatePresets(request,id,'TRANSMISSION_PRESET_APPLIED',tx=>{
        const preset=tx.select().from(transmissionPresets).where(and(eq(transmissionPresets.id,presetId),eq(transmissionPresets.channelId,id))).get()
        if(!preset)throw new CollaborativeEditError(404,{error:'Preset não encontrado neste canal.'})
        if(!presetBody.safeParse(preset && {name:preset.name,kind:preset.kind,target:preset.target}).success)throw new CollaborativeEditError(422,{error:'O preset antigo tem nome ou destino incompatível com o protocolo. Remova-o e cadastre a conexão completa.'})
        const output=newOutputProfile(id,{name:body.data.name??preset.name,kind:preset.kind,target:preset.target})
        tx.insert(outputProfiles).values(output).run()
        return {value:{output:{...output,target:redactUrl(output.target)}},details:{presetId,outputId:output.id,kind:output.kind,recovery:'CONTROLLED_RESTART_REQUESTED'}}
      })
      // Configuration is committed already. Never imply rollback if rebuilding
      // or restoration fails after the commit, nor claim physical delivery.
      try{
        const recovery=await rebuildChannel(id)
        await syncDistribution(app)
        return reply.code(201).send({...changed,restartRequired:true,engineError:recovery.recoveryError,...recovery})
      }catch(error){onChange();return reply.code(201).send({...changed,restartRequired:true,engineError:sanitizeDiagnostic(error instanceof Error?error.message:'Engine não reconstruído. Confira o diagnóstico.')})}
    })
  })

  server.delete('/api/channels/:id/transmission-presets/:presetId', async (request, reply) => {
    const { id, presetId } = request.params as { id: string; presetId: string }
    if (!(await allowed(request, 'OUTPUT_CONTROL'))) return reply.code(403).send({ error: 'Seu papel não pode remover presets de transmissão.' })
    return configureChannel(id,reply,async()=>mutatePresets(request,id,'TRANSMISSION_PRESET_REMOVED',tx=>{
      const preset=tx.select().from(transmissionPresets).where(and(eq(transmissionPresets.id,presetId),eq(transmissionPresets.channelId,id))).get()
      if(!preset)throw new CollaborativeEditError(404,{error:'Preset não encontrado neste canal.'})
      tx.delete(transmissionPresets).where(and(eq(transmissionPresets.id,presetId),eq(transmissionPresets.channelId,id))).run()
      return {value:{ok:true},details:{presetId,name:preset.name,kind:preset.kind}}
    }))
  })

  server.post('/api/channels/:id/outputs', async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = z
      .object({
        name: z.string().trim().min(1).max(120),
        kind: z.enum(['RTMP', 'SRT', 'FILE', 'SDI', 'NDI', 'OMT']),
        target: z.string().trim().min(1).max(2048),
        enabled:z.boolean().optional(),
        bitrateKbps:z.number().int().min(50).max(80000).nullable().optional(),
      }).strict()
      .safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: 'Dê um nome e um destino.' })
    if (!(await allowed(request, 'OUTPUT_CONTROL'))) {
      return reply.code(403).send({ error: 'Seu papel não pode criar saídas.' })
    }
    const capability = outputCapability(body.data.kind)
    if (!capability.available) return reply.code(422).send({ error: capability.reason })
    // Na placa o destino é o número do conector, e só isso.
    if (body.data.kind === 'SDI' && !/^\d+$/.test(body.data.target.trim())) {
      return reply.code(400).send({ error: 'Na SDI o destino é o número do conector: 0, 1, 2…' })
    }

    if (!(await getChannel(app.db, id))) return reply.code(404).send({ error: 'Canal não encontrado.' })
    let row:OutputProfileRow
    try{row=newOutputProfile(id,body.data);validateOutputProfile(row)}catch(error){return reply.code(400).send({error:error instanceof Error?error.message:'Endereço inválido.'})}
    return configureChannel(id, reply, async (_apply,lease) => {
      const changed=outputTransaction(request,id,lease!,tx=>{
        tx.insert(outputProfiles).values(row).run()
        auditOutput(tx,request,id,'OUTPUT_CREATED',{outputId:row.id,kind:row.kind})
        return {output:{...row,target:redactUrl(row.target)},applied:true}
      })
      try{const recovery=await rebuildChannel(id);await syncDistribution(app);return {...changed,restartRequired:true,engineError:recovery.recoveryError,...recovery}}
      catch(error){return {...changed,restartRequired:true,engineError:sanitizeDiagnostic(error instanceof Error?error.message:'Engine não reconstruído.')}}
    })
  })

  server.patch('/api/outputs/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = z
      .object({
        name: z.string().trim().min(1).max(120).optional(),
        target: z.string().trim().min(1).max(2048).optional(),
        kind: z.enum(['RTMP', 'SRT', 'FILE', 'SDI', 'NDI', 'OMT']).optional(),
        width: z.number().int().positive().max(8192).nullable().optional(),
        height: z.number().int().positive().max(8192).nullable().optional(),
        rateNum: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable().optional(),
        rateDen: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable().optional(),
        scan: z.enum(['PROGRESSIVE', 'INTERLACED']).nullable().optional(),
        bitrateKbps: z.number().int().min(50).max(80000).nullable().optional(),
        enabled: z.boolean().optional(),
      }).strict().refine(value=>Object.keys(value).length>0,{message:'Informe pelo menos um campo para alterar.'})
      .safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })
    if (!(await allowed(request, 'OUTPUT_CONTROL'))) {
      return reply.code(403).send({ error: 'Seu papel não pode alterar saídas.' })
    }
    if (body.data.kind) {
      const capability = outputCapability(body.data.kind)
      if (!capability.available) return reply.code(422).send({ error: capability.reason })
    }

    const [profile] = await app.db.select().from(outputProfiles).where(eq(outputProfiles.id, id))
    if (!profile) return reply.code(404).send({ error: 'Saída não encontrada.' })
    return configureChannel(profile.channelId, reply, async (applyOutput,lease) => {
      let current:OutputProfileRow,patch:Partial<OutputProfileRow>
      const prepared=outputTransaction(request,profile.channelId,lease!,tx=>{
        const row=tx.select().from(outputProfiles).where(eq(outputProfiles.id,id)).get()
        if(!row || row.channelId!==profile.channelId)throw new CollaborativeEditError(409,{error:'A saída mudou de canal ou foi removida. Reabra a lista.'})
        if(row.role!=='EXTRA' && (body.data.target!==undefined || body.data.kind!==undefined))throw new CollaborativeEditError(422,{error:'Destino e protocolo das saídas gerenciadas são definidos pelo servidor.'})
        current=row as OutputProfileRow
        try{patch=outputUpdatePatch(current,body.data);const channel=tx.select().from(channels).where(eq(channels.id,profile.channelId)).get()!;validateOutputProfile({...current,...patch},channel)}catch(error){throw new CollaborativeEditError(400,{error:error instanceof Error?error.message:'Endereço inválido.'})}
        return {}
      })
      current=current!;patch=patch!
      const updated = { ...current, ...patch } as OutputProfileRow
      const hotKinds = new Set(['RTMP', 'SRT', 'FILE'])
      const canHotReplace = applyOutput && current.enabled && current.role === 'EXTRA' &&
        hotKinds.has(current.kind) && updated.enabled && hotKinds.has(updated.kind)
      if (canHotReplace) {
        const target = toEngineProfile(updated, app.paths.find(entry => entry.channelId === updated.channelId))
        const previousTarget=toEngineProfile(current,app.paths.find(entry=>entry.channelId===current.channelId))
        if (target && typeof target !== 'string' && previousTarget && typeof previousTarget!=='string') {
          outputTransaction(request,profile.channelId,lease!,tx=>{lease!.record(tx,'HOT_DISPATCHED',{outputId:id,revisionBefore:prepared.revisionBefore,before:current,after:updated});return {}})
          let changed:Record<string,unknown>
          try{
            await applyOutput!(target as HotOutputProfile)
            changed=outputTransaction(request,profile.channelId,lease!,tx=>{
              const row=tx.select().from(outputProfiles).where(eq(outputProfiles.id,id)).get()
              if(JSON.stringify(row)!==JSON.stringify(current))throw new CollaborativeEditError(409,{error:'O perfil mudou durante a troca.'})
              tx.update(outputProfiles).set(patch).where(eq(outputProfiles.id,id)).run()
              auditOutput(tx,request,profile.channelId,'OUTPUT_UPDATED',{outputId:id,fields:Object.keys(patch),applied:'PUBLISHER_ACK',physicalOutputValidated:false})
              lease!.record(tx,'COMMITTED',{revisionAfter:configurationRevision(tx,profile.channelId)})
              return {ok:true,applied:'hot',restartRequired:false}
            })
          }catch(error){
            // Only restore the exact prior profile if no uncooperative writer
            // changed this channel. Do not guess an engine/database pairing.
            try{
              const intact=()=>app.db.transaction(tx=>{lease!.assertOwned(tx);return configurationRevision(tx,profile.channelId)===prepared.revisionBefore && JSON.stringify(tx.select().from(outputProfiles).where(eq(outputProfiles.id,id)).get())===JSON.stringify(current)})
              if(!intact())throw new Error('A configuração mudou durante a troca; retorno automático recusado.')
              await applyOutput!(previousTarget as HotOutputProfile)
              if(!intact())throw new Error('A configuração mudou durante o retorno; resultado incerto.')
              app.db.transaction(tx=>lease!.record(tx,'RESTORED',{softwareRestorationAcknowledged:true,physicalOutputValidated:false}),{behavior:'immediate'})
            }catch(restorationError){
              lease!.markUncertain('Troca/retorno de saída sem confirmação: '+(restorationError instanceof Error?restorationError.message:'falha no engine'))
              throw new CollaborativeEditError(409,{error:'A saída ficou com resultado incerto. PGM não foi trocado. Pare o canal, limpe o CUE e reconcilie a configuração antes de outra mudança.',configurationUncertain:true,configurationRunId:lease!.runId})
            }
            if(error instanceof CollaborativeEditError)throw new CollaborativeEditError(error.status,{...error.payload,previousProfileRestored:true,physicalOutputValidated:false})
            throw new CollaborativeEditError(409,{error:sanitizeDiagnostic(error instanceof Error?error.message:'Troca não gravada.'),previousProfileRestored:true,physicalOutputValidated:false})
          }
          try{
            const runtime=app.runtimes.get(profile.channelId)
            if(!(runtime?.transport instanceof EngineTransport))throw new Error('O runtime mudou após o commit da saída.')
            runtime.transport.commitOutputProfile(target as HotOutputProfile)
            await syncDistribution(app)
            return {...changed,physicalOutputValidated:false}
          }catch(error){
            lease!.markUncertain('Configuração gravada, mas perfil de recuperação não confirmado: '+(error instanceof Error?error.message:'falha'))
            return {...changed,configurationUncertain:true,configurationRunId:lease!.runId,engineError:'Configuração gravada; reconcilie o canal antes de outra troca.',physicalOutputValidated:false}
          }
        }
      }
      const changed=outputTransaction(request,profile.channelId,lease!,tx=>{
        tx.update(outputProfiles).set(patch).where(and(eq(outputProfiles.id,id),eq(outputProfiles.channelId,profile.channelId))).run()
        auditOutput(tx,request,profile.channelId,'OUTPUT_UPDATED',{outputId:id,fields:Object.keys(patch),applied:'CONTROLLED_RESTART_REQUESTED'})
        return {ok:true,restartRequired:true,applied:'restart'}
      })
      try{const recovery=await rebuildChannel(profile.channelId);await syncDistribution(app);return {...changed,engineError:recovery.recoveryError,...recovery}}
      catch(error){return {...changed,engineError:sanitizeDiagnostic(error instanceof Error?error.message:'Engine não reconstruído.')}}
    })
  })

  server.delete('/api/outputs/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    if (!(await allowed(request, 'OUTPUT_CONTROL'))) {
      return reply.code(403).send({ error: 'Seu papel não pode remover saídas.' })
    }
    const [profile] = await app.db.select({ channelId: outputProfiles.channelId }).from(outputProfiles).where(eq(outputProfiles.id, id))
    if (!profile) return reply.code(404).send({ error: 'Saída não encontrada.' })
    return configureChannel(profile.channelId, reply, async (_apply,lease) => {
      const changed=outputTransaction(request,profile.channelId,lease!,tx=>{
        const row=tx.select().from(outputProfiles).where(eq(outputProfiles.id,id)).get()
        if(!row || row.channelId!==profile.channelId)throw new CollaborativeEditError(409,{error:'A saída mudou de canal ou foi removida. Reabra a lista.'})
        if(row.role!=='EXTRA')throw new CollaborativeEditError(409,{error:'Programa, preview e monitor não podem ser removidos.'})
        tx.delete(outputProfiles).where(and(eq(outputProfiles.id,id),eq(outputProfiles.channelId,profile.channelId))).run()
        auditOutput(tx,request,profile.channelId,'OUTPUT_REMOVED',{outputId:id})
        return {ok:true,restartRequired:true,applied:true}
      })
      try{const recovery=await rebuildChannel(profile.channelId);await syncDistribution(app);return {...changed,engineError:recovery.recoveryError,...recovery}}
      catch(error){return {...changed,engineError:sanitizeDiagnostic(error instanceof Error?error.message:'Engine não reconstruído.')}}
    })
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
    try { body.data.url = credentialAddress(body.data.url) }
    catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : 'Endereço de destino inválido.' }) }

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
    const [existing] = await app.db.select().from(destinations).where(eq(destinations.id, id))
    if (!existing) return reply.code(404).send({ error: 'Destino não encontrado.' })
    if (body.data.url !== undefined) {
      try { body.data.url = credentialAddress(body.data.url, existing.url) }
      catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : 'Endereço de destino inválido.' }) }
    }
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
    async (request: FastifyRequest, reply: { code: (n: number) => { send: (b: unknown) => unknown } }) => {
      const { id } = request.params as { id: string }
      if (!(await allowed(request as never, 'PLAYLIST_EDIT'))) return reply.code(403).send({ error: 'Seu papel não pode desfazer esta alteração.' })
      const runtime = await runtimeForRundown(app, id)
      if (!runtime?.view) return reply.code(404).send({ error: 'Rundown não encontrado.' })

      let label
      try{label=await(kind==='undo'?app.history.undo(app.db,id,historyGuard(request)):app.history.redo(app.db,id,historyGuard(request)))}
      catch(error){if(error instanceof CollaborativeEditError)return reply.code(error.status).send(error.payload);throw error}
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

    const blockId=randomUUID()
    let ordered:string[]
    try {
      ordered=mutateEditorial(app.db,app.concurrency,id,request.headers['if-match'],(tx,state)=>{
        assertEditorialAccess(request,state.channel.id)
        const ids=state.items.map(item=>item.id),chosen=[...new Set(body.data.itemIds)]
        if(chosen.length<2 || chosen.some(candidate=>!ids.includes(candidate)))throw new CollaborativeEditError(400,{error:'Selecione pelo menos dois itens distintos desta grade. Nenhum bloco foi alterado.'})
        const chosenSet=new Set(chosen),ordered=ids.filter(candidate=>chosenSet.has(candidate))
        const rest=ids.filter(candidate=>!chosenSet.has(candidate)),at=ids.indexOf(ordered[0]!)
        const before=ids.slice(0,at).filter(candidate=>!chosenSet.has(candidate))
        rest.splice(before.length,0,...ordered)
        const remember=app.history.prepareCapture(tx,id,'agrupar em bloco',{itemIds:ids})
        for(const [position,itemId] of rest.entries())tx.update(rundownItems).set({sortOrder:(position+1)*10,...(chosenSet.has(itemId)?{blockId}:{})}).where(eq(rundownItems.id,itemId)).run()
        return {value:ordered,remember}
      })
    }catch(error){if(error instanceof CollaborativeEditError)return reply.code(error.status).send(error.payload);throw error}

    await logDecision(app, id, null, 'BLOCK_CREATED', { blockId, itemIds: ordered })
    await runtime.refresh()
    onChange()
    return snapshot(app, runtime)
  })

  server.post('/api/blocks/:blockId/ungroup', async (request, reply) => {
    const { blockId } = request.params as { blockId: string }
    if (!(await allowed(request, 'PLAYLIST_EDIT'))) return reply.code(403).send({ error: 'Seu papel não pode desfazer blocos.' })
    const rows = await app.db
      .select({ rundownId: rundownItems.rundownId })
      .from(rundownItems)
      .where(eq(rundownItems.blockId, blockId))
    const row = rows[0]
    if (!row) return reply.code(404).send({ error: 'Bloco não encontrado.' })
    if (rows.some(other => other.rundownId !== row.rundownId)) return reply.code(409).send({error:'Este bloco aparece em mais de uma grade. Corrija os vínculos antes de desagrupar.'})

    const runtime = await runtimeForRundown(app, row.rundownId)
    if (!runtime?.view) return reply.code(404).send({ error: 'Rundown não encontrado.' })

    try {
      mutateEditorial(app.db,app.concurrency,row.rundownId,request.headers['if-match'],(tx,state)=>{
        assertEditorialAccess(request,state.channel.id)
        const members=tx.select().from(rundownItems).where(eq(rundownItems.blockId,blockId)).all()
        if(!members.length)throw new CollaborativeEditError(404,{error:'Bloco não encontrado.'})
        if(members.some(item=>item.rundownId!==state.rundown.id))throw new CollaborativeEditError(409,{error:'Este bloco aparece em mais de uma grade. Nenhum vínculo foi alterado.'})
        const remember=app.history.prepareCapture(tx,state.rundown.id,'desfazer bloco',{itemIds:members.map(item=>item.id)})
        tx.update(rundownItems).set({blockId:null}).where(and(eq(rundownItems.blockId,blockId),eq(rundownItems.rundownId,state.rundown.id))).run()
        return {value:true,remember}
      })
    }catch(error){if(error instanceof CollaborativeEditError)return reply.code(error.status).send(error.payload);throw error}

    await logDecision(app, row.rundownId, null, 'BLOCK_REMOVED', { blockId })
    await runtime.refresh()
    onChange()
    return snapshot(app, runtime)
  })

  // ---- transporte ------------------------------------------------------

  server.post('/api/external/control', async (request, reply) => {
    if (!EXTERNAL_CONTROL_TOKEN) return reply.code(503).send({ error: 'Controle externo não configurado.' })
    const token = request.headers['x-rplayout-control-token'] ?? request.headers.authorization?.replace(/^Bearer /i, '')
    if (typeof token !== 'string' || !secretEquals(token, EXTERNAL_CONTROL_TOKEN)) return reply.code(401).send({ error: 'Token de controle externo inválido.' })
    const body = z.object({
      channelId: z.string().min(1),
      action: z.enum(['take', 'cue', 'stop', 'park']),
      itemId: z.string().nullable().optional(),
      assetId: z.string().nullable().optional(),
    }).safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: 'Comando externo inválido.' })
    try{assertTransportOwnership(body.data.channelId)}catch(error){if(error instanceof CollaborativeEditError)return reply.code(error.status).send(error.payload);throw error}
    const runtime = await runtimeFor(app, body.data.channelId)
    if (!runtime?.view) return reply.code(404).send({ error: 'Canal sem grade carregada.' })
    try {
      const execution = runtime.executionView
      if(!execution && (['take','park'].includes(body.data.action) || body.data.action==='cue' && body.data.itemId))throw new Error('A grade convertida exige revisão e nova publicação antes de operar.')
      let requestedItemId = body.data.itemId ?? null
      if(['take','park'].includes(body.data.action) && app.interruptionCommands.blockedReason(runtime.channel.id))throw new Error(app.interruptionCommands.blockedReason(runtime.channel.id)!)
      if (body.data.action === 'take') {
        requestedItemId = resolveTakeTarget(execution!, runtime.transport.state(), body.data.itemId).itemId
        await runtime.transport.take(execution!.rundown.id, requestedItemId)
      }
      else if (body.data.action === 'cue') await runtime.transport.cue(body.data.itemId ? { kind: 'ITEM', id: body.data.itemId } : body.data.assetId ? { kind: 'ASSET', id: body.data.assetId } : null)
      else if (body.data.action === 'stop') {app.publishedContinuity.suspend(runtime.channel.id,'@external-control','STOP explícito; continuidade recorrente suspensa.');app.schedulePublication.suspend(runtime.channel.id,'@external-control','STOP explícito; publicação automática suspensa.');runtime.cancelQueuedBoundaryOnStop('@external-control');await runtime.transport.stop()}
      else if (body.data.itemId) await runtime.transport.park(body.data.itemId)
      else throw new Error('Informe o item publicado para armar a grade.')
      const state = runtime.transport.state()
      const nativeProgramConfirmed = runtime.transport instanceof EngineTransport && body.data.action === 'take' && state.onAir?.itemId === requestedItemId
      const evidence = { ...body.data, itemId: requestedItemId, source: 'external-control', transport: runtime.transport instanceof EngineTransport ? 'NATIVE' : 'SIMULATED', nativeProgramConfirmed, awaitingSignal: body.data.action === 'take' && state.onAir?.itemId !== requestedItemId, physicalOutputValidated: false }
      await logDecision(app, runtime.view.rundown.id, requestedItemId, `EXTERNAL_${body.data.action.toUpperCase()}`, evidence)
      await emitIntegrationEvent(app.db, `external.${body.data.action}`, evidence, body.data.channelId)
      return { ok: true, accepted: true, ...evidence }
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
        /** Entrada de rede aberta diretamente no PVW, sem virar arquivo MAM. */
        sourceRef: z.string().min(1).nullable().optional(),
        sourceTitle: z.string().max(200).nullable().optional(),
        bus: z.enum(['pgm', 'pvw']).optional(),
        frames: z.number().int().min(0).optional(),
      })
      .safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })
    const actionPermission = body.data.action === 'stop' ? 'CHANNEL_STOP' : 'PLAYLIST_EDIT'
    if (!(await allowed(request, actionPermission))) return reply.code(403).send({ error: 'Seu papel não pode executar esta ação.' })

    try{assertTransportOwnership(id)}catch(error){if(error instanceof CollaborativeEditError)return reply.code(error.status).send(error.payload);throw error}
    const runtime = await runtimeFor(app, id)
    // Editorial authority doesn't require a loaded PGM playlist. STOP must
    // still suspend that policy; no view is not permission to keep publishing.
    if(runtime && !runtime.view && body.data.action==='stop'){
      if(access.required()&&!access.identity(request)||!can(access.role(request),'CHANNEL_STOP')||!access.channelAllowed(request,id))return reply.code(403).send({error:'Sessão/permissão mudou; STOP não autorizado.'})
      const actor=await usernameOf(request)
      app.publishedContinuity.suspend(id,actor,'STOP explícito; continuidade recorrente suspensa.')
      app.schedulePublication.suspend(id,actor,'STOP explícito; publicação automática suspensa.')
      runtime.cancelQueuedBoundaryOnStop(actor)
      await runtime.transport.stop();onChange()
      return {accepted:true,action:'stop',channelId:id,transport:runtime.transport.state()}
    }
    if (!runtime?.view) return reply.code(404).send({ error: 'Canal sem grade carregada.' })

    const execution = runtime.executionView
    const interruptedReturnBlock=app.interruptionCommands.blockedReason(id)
    if(interruptedReturnBlock && (['take','park'].includes(body.data.action) || body.data.action==='seek' && body.data.bus!=='pvw'))return reply.code(409).send({error:interruptedReturnBlock})
    if(!execution && (['take','park'].includes(body.data.action) || body.data.action==='cue' && body.data.itemId || body.data.action==='seek' && body.data.bus==='pgm'))return reply.code(409).send({error:'A grade convertida exige revisão e nova publicação antes do CUE/TAKE de itens.'})
    switch (body.data.action) {
      case 'take': {
        const state = runtime.transport.state()
        const interruptedItemId = state.onAir?.itemId ?? null
        let target
        try { target = resolveTakeTarget(execution!, state, body.data.itemId) }
        catch (error) { return reply.code(error instanceof TakeTargetError ? error.statusCode : 409).send({ error: error instanceof Error ? error.message : 'TAKE recusado.' }) }
        const { itemId: resolvedItemId, item: targetItem } = target
        await runtime.transport.take(execution!.rundown.id, resolvedItemId)
        // Live é prioridade editorial, mas não pode virar uma troca invisível
        // no histórico. O TAKE pode permanecer pendente até o primeiro quadro;
        // este registro representa a solicitação, e o as-run registra a troca
        // real quando o engine a confirmar.
        if ((targetItem?.type === 'LIVE' || targetItem?.sourceRef) && interruptedItemId !== resolvedItemId) {
          const payload = {
            requestedItemId: resolvedItemId,
            interruptedItemId,
            sourceRef: targetItem?.sourceRef ?? null,
            title: targetItem?.title ?? 'Entrada ao vivo',
            awaitingSignal: runtime.transport.state().onAir?.itemId !== resolvedItemId,
          }
          await logDecision(app, runtime.view.rundown.id, resolvedItemId, 'LIVE_PRIORITY_TAKE_REQUESTED', payload, await usernameOf(request))
          void emitIntegrationEvent(app.db, 'live.take.requested', payload, runtime.channel.id)
        }
        break
      }
      case 'cue': {
        const target: PreviewTarget | null = body.data.sourceRef
          ? { kind: 'SOURCE', source: body.data.sourceRef, ...(body.data.sourceTitle ? { title: body.data.sourceTitle } : {}) }
          : body.data.assetId
          ? { kind: 'ASSET', id: body.data.assetId }
          : body.data.itemId
            ? { kind: 'ITEM', id: body.data.itemId }
            : null
        await runtime.transport.cue(target)
        break
      }
      case 'park': {
        const first = execution!.items[0]
        if (!first) return reply.code(400).send({ error: 'Grade vazia.' })
        await runtime.transport.park(first.item.id)
        break
      }
      case 'stop':
        if (!(await allowed(request, 'CHANNEL_STOP'))) {
          return reply.code(403).send({ error: 'Seu papel não pode parar o canal.' })
        }
        app.publishedContinuity.suspend(id,await usernameOf(request),'STOP explícito; continuidade recorrente suspensa.')
        app.schedulePublication.suspend(id,await usernameOf(request),'STOP explícito; publicação automática suspensa.')
        runtime.cancelQueuedBoundaryOnStop(await usernameOf(request))
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

    runtime.checkpoint(true)
    await runtime.refresh()
    onChange()
    return snapshot(app, runtime)
  })

  // ==========================================
  // FASE C: CONTINUIDADE, COMPLIANCE E SONDA DE PGM
  // ==========================================

  // 1. Telemetria e Cobertura de Cache de Continuidade (48h/7d)
  const cacheContext = async (channelId?: string) => {
    if (!channelId) return null // Legacy endpoint is explicitly library-only.
    return channelCachePlan(app,channelId)
  }
  const cacheStatus = async (context: Awaited<ReturnType<typeof cacheContext>>) => {
    if (!context) return app.continuityCache.getStatus(await listAssets(app.db))
    const status = await app.continuityCache.getStatus(context.assets48h, context.assets7d, context.sequence)
    const prepared = async (assets: typeof context.assets48h) => { let count=0; for (const asset of assets) if (await app.continuityCache.verified(asset)) count++; return count }
    return { ...status, channelId: context.channelId, revisionId: context.runtime?.operationalRevision?.id ?? null,
      prefetch:{ from:context.from, criticalUntil:context.criticalUntil,extendedUntil:context.extendedUntil,
        publishedRevisions:context.revisions.length, plannedFiles48h:context.assets48h.length,preparedFiles48h:await prepared(context.assets48h),
        plannedFiles7d:context.assets7d.length,preparedFiles7d:await prepared(context.assets7d),blockedItems:context.blockedItems,unversionedItems:context.unversionedItems },
      plannedHours: context.sequence.reduce((sum, entry) => sum + entry.durationSeconds, 0) / 3600,
      proofMessage: context.runtime?.operationalRevision ? 'Autonomia da playlist publicada carregada: interrompida em live, lacuna ou parada manual. Pré-cópia futura de 48h/7d não autoriza troca entre dias nem comprova transmissão contínua.' : 'Nenhuma playlist publicada carregada. Pré-cópia futura não comprova autonomia temporal.' }
  }
  const getCacheStatusHandler = async (
    request: { headers: Record<string, string | string[] | undefined>; query: unknown },
    reply: { code: (code: number) => { send: (body: unknown) => unknown } },
  ) => {
    if (!(await allowed(request, 'REPORT_EXPORT'))) {
      return reply.code(403).send({ error: 'Sem permissão para consultar cache de continuidade.' })
    }
    const query = z.object({ channelId: z.string().min(1).optional() }).safeParse(request.query)
    if (!query.success) return reply.code(400).send({ error: 'Canal inválido.' })
    try { return await cacheStatus(await cacheContext(query.data.channelId)) }
    catch (error) { return reply.code(404).send({ error: error instanceof Error ? error.message : 'Cache indisponível.' }) }
  }
  server.get('/api/v1/continuity/cache/status', getCacheStatusHandler)
  server.get('/api/v1/cache/status', getCacheStatusHandler)

  // 2. Pré-aquecimento de Cache de Continuidade
  const warmCacheHandler = async (
    request: { headers: Record<string, string | string[] | undefined>; query: unknown },
    reply: { code: (code: number) => { send: (body: unknown) => unknown } },
  ) => {
    if (!(await allowed(request, 'PLAYLIST_EDIT'))) {
      return reply.code(403).send({ error: 'Sem permissão para pré-aquecer cache.' })
    }
    const query = z.object({ channelId: z.string().min(1).optional() }).safeParse(request.query)
    if (!query.success) return reply.code(400).send({ error: 'Canal inválido.' })
    let context: Awaited<ReturnType<typeof cacheContext>>
    try { context = await cacheContext(query.data.channelId) }
    catch (error) { return reply.code(404).send({ error: error instanceof Error ? error.message : 'Cache indisponível.' }) }
    const result = context ? (await warmChannelCache(app,context.channelId)).result
      : await app.continuityCache.warmSchedule(await listAssets(app.db))
    const status = await cacheStatus(context ? await cacheContext(query.data.channelId) : null)
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
    request: { headers: Record<string, string | string[] | undefined>; query?: unknown },
    reply: { code: (code: number) => { send: (body: unknown) => unknown } },
  ) => {
    if (!(await allowed(request, 'REPORT_EXPORT'))) {
      return reply.code(403).send({ error: 'Sem permissão para acessar telemetria de engenharia.' })
    }
    const channelId = (request.query as { channelId?: string } | undefined)?.channelId
    if (!channelId) return reply.code(400).send({ error: 'Informe o canal da sonda PGM.' })
    return { ...pgmProbeFor(app, channelId).getStatus(), contingency: app.runtimes.get(channelId)?.contingencyState ?? null }
  }
  server.get('/api/v1/engineering/pgm-probe/status', getPgmProbeStatusHandler)
  server.get('/api/v1/probe/pgm/status', getPgmProbeStatusHandler)
  server.post('/api/v1/engineering/pgm-probe/policy', async (request, reply) => {
    if (!(await allowed(request, 'OUTPUT_CONTROL'))) return reply.code(403).send({ error: 'Sem permissão para mudar a política de contingência.' })
    const body = z.object({ channelId: z.string().min(1), automaticActions: z.boolean(), thresholds: z.object({
      blackThresholdMs: z.number().int().min(100).max(60_000).optional(),
      freezeThresholdMs: z.number().int().min(100).max(60_000).optional(),
      silenceThresholdMs: z.number().int().min(100).max(60_000).optional(),
      silenceDbfs: z.number().min(-100).max(0).optional(),
      defaultAutoAction: z.enum(['SLATE_INJECTED', 'CONTINGENCY_LOOP', 'FAILOVER_HOST_B']).optional(),
    }).optional() }).safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })
    const runtime = await runtimeFor(app, body.data.channelId)
    if (!runtime) return reply.code(404).send({ error: 'Canal não encontrado.' })
    const probe = pgmProbeFor(app, body.data.channelId)
    const thresholds = { ...probe.getThresholds(), ...body.data.thresholds }
    const policyRow = app.sqlite.prepare('SELECT payload FROM channel_operational_policies WHERE channel_id=?').get(body.data.channelId) as { payload: string } | undefined
    const savedPolicy = policyRow ? JSON.parse(policyRow.payload) as { loopRevisionId?: string | null } : {}
    if (body.data.automaticActions) {
      if (runtime.contingencyPending) return reply.code(409).send({ error: 'Aguarde a intervenção pendente antes de armar a sonda.' })
      if (thresholds.defaultAutoAction === 'FAILOVER_HOST_B') return reply.code(409).send({ error: 'O host standby ainda não possui destino configurado/homologado. Não é seguro armar a ação automática.' })
      if (!(runtime.transport instanceof EngineTransport)) return reply.code(409).send({ error: 'Não é possível armar intervenção automática em modo simulado.' })
      if (thresholds.defaultAutoAction === 'SLATE_INJECTED' && !runtime.channel.slateTemplateId) return reply.code(409).send({ error: 'Configure a arte de apresentação técnica antes de armar intervenção automática.' })
      if (thresholds.defaultAutoAction === 'CONTINGENCY_LOOP') {
        if (!savedPolicy.loopRevisionId) return reply.code(409).send({ error: 'Selecione uma revisão publicada para o loop de contingência.' })
        if (runtime.transport.state().onAir && !runtime.operationalRevision) return reply.code(409).send({ error: 'Publique a grade em execução para preservar um retorno versionado.' })
        try { await runtime.prepareContingency(savedPolicy.loopRevisionId) }
        catch (error) { return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) }) }
      }
    }
    const payload = { automaticActions: body.data.automaticActions, thresholds, loopRevisionId: savedPolicy.loopRevisionId ?? null }
    app.sqlite.prepare(`INSERT INTO channel_operational_policies VALUES (?, ?, ?)
      ON CONFLICT(channel_id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at`)
      .run(body.data.channelId, JSON.stringify(payload), new Date().toISOString())
    probe.setThresholds(thresholds); probe.setAutomaticActions(body.data.automaticActions)
    if (runtime.view) await logDecision(app, runtime.view.rundown.id, null, 'PGM_PROBE_POLICY_CHANGED', payload, await usernameOf(request))
    return { ok: true, status: probe.getStatus() }
  })

  server.get('/api/v1/engineering/pgm-probe/contingency-loop', async (request, reply) => {
    if (!(await allowed(request, 'REPORT_EXPORT'))) return reply.code(403).send({ error: 'Sem permissão para consultar contingência.' })
    const channelId = (request.query as { channelId?: string }).channelId
    if (!channelId) return reply.code(400).send({ error: 'Informe o canal.' })
    const runtime = await runtimeFor(app, channelId)
    if (!runtime) return reply.code(404).send({ error: 'Canal não encontrado.' })
    const policy = app.sqlite.prepare('SELECT payload FROM channel_operational_policies WHERE channel_id=?').get(channelId) as { payload: string } | undefined
    const saved = policy ? JSON.parse(policy.payload) as { loopRevisionId?: string | null } : {}
    const options = await app.db.select({ revisionId: operationalPlaylistRevisions.id, revision: operationalPlaylistRevisions.revision,
      rundownId: rundowns.id, name: rundowns.name, date: rundowns.date }).from(operationalPlaylistRevisions)
      .innerJoin(rundowns, eq(rundowns.id, operationalPlaylistRevisions.rundownId))
      .where(and(eq(rundowns.channelId, channelId), eq(operationalPlaylistRevisions.active, true))).orderBy(desc(operationalPlaylistRevisions.publishedAt))
    return { loopRevisionId: saved.loopRevisionId ?? null, origin: runtime.contingencyState,
      nativeEngine: runtime.transport instanceof EngineTransport, options }
  })
  server.post('/api/v1/engineering/pgm-probe/contingency-loop', async (request, reply) => {
    const body = z.object({ channelId: z.string().min(1), action: z.enum(['CONFIGURE', 'ENTER', 'RETURN']), revisionId: z.string().min(1).nullable().optional() }).safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })
    const { channelId, action } = body.data
    if (!(await allowed(request, action === 'CONFIGURE' ? 'OUTPUT_CONTROL' : 'TRANSPORT'))) return reply.code(403).send({ error: 'Sem permissão para esta ação de contingência.' })
    const runtime = await runtimeFor(app, channelId)
    if (!runtime) return reply.code(404).send({ error: 'Canal não encontrado.' })
    const probe = pgmProbeFor(app, channelId)
    try {
      if (action === 'CONFIGURE') {
        if (body.data.revisionId === undefined) return reply.code(400).send({ error: 'Informe a revisão ou null para remover a configuração.' })
        if (probe.getStatus().automaticActionsEnabled || runtime.contingencyState || runtime.contingencyPending) return reply.code(409).send({ error: 'Desligue a ação automática e conclua o retorno/intervenção antes de substituir a configuração.' })
        if (body.data.revisionId) {
          const prepared = await runtime.prepareContingency(body.data.revisionId)
          app.continuityCache.replaceProtection(`contingency:${channelId}`, [...prepared.assets.values()])
        } else app.continuityCache.replaceProtection(`contingency:${channelId}`, [])
        const policy = { automaticActions: false, thresholds: probe.getThresholds(), loopRevisionId: body.data.revisionId }
        app.sqlite.prepare(`INSERT INTO channel_operational_policies VALUES (?, ?, ?)
          ON CONFLICT(channel_id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at`)
          .run(channelId, JSON.stringify(policy), new Date().toISOString())
        if (runtime.view) await logDecision(app, runtime.view.rundown.id, null, 'CONTINGENCY_CONFIGURED', policy, await usernameOf(request))
        return { ok: true, loopRevisionId: body.data.revisionId }
      }
      if (action === 'RETURN') {
        if (probe.getStatus().automaticActionsEnabled) return reply.code(409).send({ error: 'Desligue a ação automática antes de retornar à grade.' })
        await runtime.returnFromContingency()
      } else {
        const alert = await probe.triggerAction('CONTINGENCY_LOOP', 'MANUAL_CONTINGENCY')
        if (alert.actionStatus !== 'SUCCEEDED') return reply.code(409).send({ error: alert.actionMessage, alert })
      }
      if (runtime.view) await logDecision(app, runtime.view.rundown.id, null, `CONTINGENCY_${action}_CONFIRMED`, { origin: runtime.contingencyState }, await usernameOf(request))
      return { ok: true, origin: runtime.contingencyState }
    } catch (error) { return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) }) }
  })

  // 4. Disparo Manual / Reset de Slate de Emergência
  server.post('/api/v1/engineering/pgm-probe/emergency-slate', async (request, reply) => {
    if (!(await allowed(request, 'PLAYLIST_EDIT'))) {
      return reply.code(403).send({ error: 'Sem permissão para acionar intervenções de emergência.' })
    }
    const parsed=z.object({channelId:z.string().min(1),action:z.enum(['TRIGGER','RESET']).default('TRIGGER'),reason:z.string().trim().min(1).max(500).optional()}).strict().safeParse(request.body)
    if(!parsed.success)return reply.code(400).send({error:'Informe canal, ação TRIGGER/RESET e motivo válido.'})
    const body=parsed.data,ownerId=access.identity(request)?.id??null
    const authorize=()=>assertGraphicAccess(request,body.channelId,'PLAYLIST_EDIT',ownerId)
    try{authorize()}catch(error){return automationError(reply,error)}
    const probe = pgmProbeFor(app, body.channelId)
    const runtime=await runtimeFor(app,body.channelId)
    if(!runtime)return reply.code(404).send({error:'Canal não encontrado.'})
    const command={key:request.headers['idempotency-key'],actorId:ownerId,actorName:await usernameOf(request),authorize}
    if (body.action === 'RESET') {
      try {
        const receipt=await runtime.setEmergencySlate(false,command)
        if(!runtime.emergencyOverlay)probe.resetEmergencySlate()
        return {ok:true,emergencySlateActive:runtime.emergencyOverlay,status:probe.getStatus(),graphicCommand:receipt}
      }catch(error){if(error instanceof CollaborativeEditError)return reply.code(error.status).send(error.payload);return reply.code(409).send({error:error instanceof Error?error.message:String(error)})}
    }
    let receipt:import('./domain/graphic-command-ledger.js').GraphicCommandReceipt|undefined
    const alert = await probe.triggerEmergencySlate(body.reason ?? 'MANUAL_EMERGENCY_DISPATCH',async()=>{
      receipt=await runtime.setEmergencySlate(true,command)
      return {ok:runtime.emergencyOverlay,message:runtime.emergencyOverlay?'Slate confirmado pelo engine.':'Pedido antigo confirmado no histórico; não reenviado e não está ativo agora.'}
    })
    if (alert.actionStatus !== 'SUCCEEDED') return reply.code(409).send({ error: alert.actionMessage ?? 'Slate não confirmado pelo engine.', alert, status: probe.getStatus() })
    if (runtime) void emitIntegrationEvent(app.db, 'pgm_probe.emergency_slate', { alert }, runtime.channel.id)
    return {
      ok: true,
      emergencySlateActive: true,
      alert,
      graphicCommand:receipt,
      status: probe.getStatus(),
    }
  })

  // 5. XML legado: não homologado por schema SMPTE/BXF.
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
    const channel = query.channelId ? await getChannel(app.db, query.channelId, true) : null
    const bxfXml = exportAsRunBxf(entries, {
      channelName: query.channelName ?? channel?.name ?? 'RPlayout Master',
      channelId: query.channelId ?? channel?.id ?? 'CH-01',
      rate: channel?.rate ?? RATE_PADRAO,
    })
    return reply
      .header('content-type', 'application/xml; charset=utf-8')
      .header('content-disposition', 'attachment; filename="asrun-draft.bxf.xml"')
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
    const channel = query.channelId ? await getChannel(app.db, query.channelId, true) : null
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
    const channel = query.channelId ? await getChannel(app.db, query.channelId, true) : null
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
      channelName: runtime.channel.name,
      rate: runtime.channel.rate,
      nowFrames: framesSinceMidnight(new Date(), runtime.channel.rate),
      simulated: !(runtime.transport instanceof EngineTransport),
      secondaryEvents: runtime.graphics.scheduler.getEvents().filter(event=>event.enabled && event.rundownItemId===runtime.transport.state().onAir?.itemId && event.triggerMode==='MANUAL'),
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
    const numMap: Record<string, GraphicsLayer> = {
      '0': 'STATION_LOGO',
      '1': 'ONAIR_CLOCK',
      '2': 'CRAWL_TICKER',
      '3': 'LOWER_THIRD',
    }
    const rawLayer = (params.layer || '').toUpperCase()
    const layer = numMap[rawLayer] ?? (rawLayer as GraphicsLayer)
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
    }).strict().safeParse(request.body)
    if (!body.success) {
      return reply.code(400).send({ error: 'Parâmetros inválidos.', details: body.error.format() })
    }
    const channelId = body.data.channelId
    if (!channelId) {
      return reply.code(400).send({ error: 'Selecione explicitamente o canal do grafismo.' })
    }
    const ownerId=access.identity(request)?.id??null
    try{assertGraphicAuthority(request,channelId,'OUTPUT_CONTROL',ownerId)}catch(error){return automationError(reply,error)}
    const runtime = await runtimeFor(app, channelId)
    if (!runtime) {
      return reply.code(404).send({ error: 'Canal não inicializado.' })
    }
    let template: import('@rplayout/protocol').GraphicTemplate | undefined
    if (body.data.templateId) {
      const [t] = await app.db.select().from(graphicTemplates).where(eq(graphicTemplates.id, body.data.templateId))
      template = t
      if(!template)return reply.code(404).send({error:'Template não encontrado; camada anterior preservada.'})
      if(template.channelId&&template.channelId!==channelId)return reply.code(403).send({error:'Template não pertence ao canal selecionado.'})
    }
    let command:{receipt:import('./domain/graphic-command-ledger.js').GraphicCommandReceipt;result?:import('@rplayout/protocol').GraphicLayerState}
    const authorize=()=>assertGraphicAuthority(request,channelId,'OUTPUT_CONTROL',ownerId)
    try{command = await graphicCommand(request,channelId,{layer,...body.data,templateSnapshot:template??null},authorize,beforeSend=>runtime.graphics.triggerLayerConfirmed(layer, body.data.action, {
      templateId: body.data.templateId,
      template,
      name: body.data.name,
      payload: body.data.payload,
      values: body.data.values,
      fadeMs: body.data.fadeMs,
      durationFrames: body.data.durationFrames,
      opacity: body.data.opacity,
    },authorize,beforeSend))}catch(error){return automationError(reply,error)}
    return { success: true, layerState: command.result??runtime.graphics.getLayers()[layer],graphicCommand:command.receipt,confirmation:command.receipt.state==='CONFIRMED'?'NATIVE_ACK':'SIMULATED',physicalOutputValidated:false }
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
    const occurredAt = new Date().toISOString()
    await app.db.insert(healthEvents).values({id:randomUUID(),channelId:channelId ?? null,component:'SCTE',state:'generated',severity:'INFO',message:`Evento ${scteMessage.spliceEventId} gerado e colocado na fila dos gateways configurados. Inserção física não confirmada.`,occurredAt})
    await emitIntegrationEvent(app.db,'scte.cue',{...scteMessage,scte35Hex:result.scte35.toString('hex'),scte104Hex:result.scte104.payload.toString('hex')},channelId)
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
      physicalInsertionConfirmed: false,
    }
  })

  // 4. Acionamento de hardware externo (ATEM, Videohub, GPIO) protegido por token
  const externalDeviceSchema = z.object({
    name: z.string().min(1).max(120),
    kind: z.enum(['ATEM_SWITCHER', 'VIDEOHUB_ROUTER', 'GPIO_RELAY']),
    host: z.string().min(1).max(255),
    port: z.number().int().min(1).max(65535),
    enabled: z.boolean().default(true),
  })

  // ---- projetos versionados por canal -------------------------------------

  server.get('/api/channels/:id/projects', async (request, reply) => {
    if (!(await allowed(request, 'REPORT_EXPORT'))) return reply.code(403).send({ error: 'Seu papel não pode consultar projetos.' })
    const channelId = (request.params as { id: string }).id
    reply.header('cache-control','private, no-store')
    return { projects: await listChannelProjects(app.db, channelId) }
  })

  server.post('/api/channels/:id/projects', async (request, reply) => {
    if (!(await allowed(request, 'PLAYLIST_EDIT'))) return reply.code(403).send({ error: 'Seu papel não pode salvar projetos.' })
    const channelId = (request.params as { id: string }).id
    const body = z.object({ label: z.string().trim().min(1).max(120) }).safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: 'Nome do ponto de restauração inválido.' })
    const ownerId=access.identity(request)?.id??null
    let project:Awaited<ReturnType<typeof saveChannelProject>>
    try{project = await saveChannelProject(app.db, channelId, body.data.label,{
      authorize:tx=>{
        assertEditorialAccess(request,channelId)
        if((access.identity(request)?.id??null)!==ownerId)throw new CollaborativeEditError(403,{error:'A sessão mudou antes da captura do projeto.'})
        const channel=tx.select().from(channels).where(eq(channels.id,channelId)).get()
        if(!channel)throw new CollaborativeEditError(404,{error:'Canal não encontrado.'})
        if(channel.archivedAt)throw new CollaborativeEditError(409,{error:'Canal arquivado: nenhuma captura foi gravada.'})
      },
      audit:(tx,details)=>{tx.insert(operatorDecisions).values({id:randomUUID(),rundownId:'@security',kind:'CHANNEL_PROJECT_SAVED',actorUsername:access.identity(request)?.username??null,createdAt:new Date().toISOString(),payload:{channelId,...details}}).run()},
    })}catch(error){return automationError(reply,error)}
    return { project, projects: await listChannelProjects(app.db, channelId) }
  })

  server.get('/api/channels/:id/projects/:projectId/restore-review',async(request,reply)=>{
    if(!(await allowed(request,'OUTPUT_CONTROL')))return reply.code(403).send({error:'A conferência de restauração exige Supervisor ou Administrador.'})
    const {id:channelId,projectId}=request.params as {id:string;projectId:string}
    const ownerId=access.identity(request)?.id??null
    try{
      const review=reviewChannelProject(app.db,channelId,projectId,ownerId,()=>{
        assertConfigurationAccess(request,channelId)
        if((access.identity(request)?.id??null)!==ownerId)throw new CollaborativeEditError(403,{error:'A sessão mudou antes da conferência.'})
      })
      reply.header('cache-control','private, no-store').header('etag',projectRestoreETag(review))
      return {review}
    }catch(error){
      if(error instanceof CollaborativeEditError)return automationError(reply,error)
      return reply.code(409).send({error:sanitizeDiagnostic(error instanceof Error?error.message:'Não foi possível conferir o projeto.')})
    }
  })
  server.post('/api/channels/:id/projects/:projectId/restore', async (request, reply) => {
    if (!(await allowed(request, 'OUTPUT_CONTROL'))) return reply.code(403).send({ error: 'Restaurar um projeto substitui entradas, formato e saídas; exige Supervisor ou Administrador.' })
    const { id: channelId, projectId } = request.params as { id: string; projectId: string }
    const ownerId=access.identity(request)?.id??null
    if (!(await getChannel(app.db,channelId))) return reply.code(404).send({error:'Canal não encontrado.'})
    return configureChannel(channelId, reply, async (_applyOutput,lease) => {
      const currentRuntime = app.runtimes.get(channelId), state = currentRuntime?.transport.state()
      if (state?.playing || state?.onAir || state?.preview) return reply.code(409).send({error:'Pare o PGM e limpe o CUE antes de restaurar o projeto. Entradas, formato e saídas serão substituídos com interrupção controlada.'})
      const restored=await restoreChannelProject(app.db,channelId,projectId,{header:request.headers['if-match'],token:(request.body as {reviewToken?:unknown}|null)?.reviewToken,actorId:ownerId},{
        authorize:tx=>{
          assertConfigurationAccess(request,channelId)
          if((access.identity(request)?.id??null)!==ownerId)throw new CollaborativeEditError(403,{error:'A sessão mudou antes da restauração.'})
          lease?.assertOwned(tx)
          const fresh=app.runtimes.get(channelId)?.transport.state()
          if(fresh?.playing||fresh?.onAir||fresh?.preview)throw new CollaborativeEditError(409,{error:'PGM/CUE mudou antes do commit. Nenhum projeto foi restaurado.'})
        },
        audit:(tx,details)=>{
          lease?.record(tx,'PROJECT_RESTORED',details)
          tx.insert(operatorDecisions).values({id:randomUUID(),rundownId:'@security',kind:'CHANNEL_PROJECT_RESTORED',actorUsername:access.identity(request)?.username??null,createdAt:new Date().toISOString(),payload:{channelId,...details}}).run()
        },
      })
      try{
        const recovery = await rebuildChannel(channelId,() => syncDistribution(app))
        const runtime = app.runtimes.get(channelId)
        if (runtime) {
          const first = (await listRundowns(app.db)).find((row) => row.channelId === channelId)
          if (first) await runtime.load(first.id)
          await runtime.refresh()
        }
        if(recovery.recoveryError)throw new Error(recovery.recoveryError)
        onChange()
        return { ok: true, applied:true,automaticTake:false,physicalOutputValidated:false,restored, ...recovery }
      }catch(error){
        const message=sanitizeDiagnostic(error instanceof Error?error.message:'Falha de aplicação da configuração após restauração.')
        try{lease?.markUncertain('Projeto gravado, mas aplicação no engine não confirmada: '+message)}catch{/* The durable slot remains blocked; do not falsely report rollback. */}
        return {ok:true,applied:true,automaticTake:false,physicalOutputValidated:false,restored,engineError:message,configurationUncertain:true}
      }
    })
  })
  server.get('/api/external/devices', async (request, reply) => {
    if (!(await allowed(request, 'OUTPUT_CONTROL'))) return reply.code(403).send({ error: 'Sem permissão para consultar automação externa.' })
    return { devices: await app.db.select().from(externalDevices) }
  })
  server.post('/api/external/devices', async (request, reply) => {
    if (!(await allowed(request, 'OUTPUT_CONTROL'))) return reply.code(403).send({ error: 'Sem permissão para configurar automação externa.' })
    const body = externalDeviceSchema.safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })
    const device = { id: randomUUID(), ...body.data, createdAt: new Date().toISOString() }
    await app.db.insert(externalDevices).values(device)
    return reply.code(201).send({ device })
  })
  server.patch('/api/external/devices/:id', async (request, reply) => {
    if (!(await allowed(request, 'OUTPUT_CONTROL'))) return reply.code(403).send({ error: 'Sem permissão para configurar automação externa.' })
    const body = externalDeviceSchema.partial().safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })
    if (!Object.keys(body.data).length) return reply.code(400).send({ error: 'Informe uma alteração do equipamento.' })
    const deviceId = (request.params as { id: string }).id
    if (!app.db.select().from(externalDevices).where(eq(externalDevices.id, deviceId)).get()) return reply.code(404).send({ error: 'Equipamento não encontrado.' })
    await app.db.update(externalDevices).set(body.data).where(eq(externalDevices.id, deviceId))
    globalStudioAutomationGateway.configureDevices(app.db.select().from(externalDevices).all())
    await logDecision(app, '@devices', null, 'DEVICE_CONFIG_UPDATED', { deviceId, changes: body.data, physicalCommandSent: false }, await usernameOf(request))
    return { ok: true }
  })
  server.get('/api/external/audit', async (request, reply) => {
    if (!(await allowed(request, 'OUTPUT_CONTROL'))) return reply.code(403).send({ error: 'Sem permissão para consultar automação externa.' })
    return { entries: globalStudioAutomationGateway.getAuditEntries(100) }
  })

  // Browser station uses its authenticated role, never learns the service
  // control token. Request IDs survive restart via the operator audit ledger.
  const deviceCommands = new ExternalCommandLedger(app.db)
  server.get('/api/external/commands', async (request, reply) => {
    if (!(await allowed(request, 'OUTPUT_CONTROL'))) return reply.code(403).send({ error: 'Sem permissão para consultar comandos externos.' })
    return { runs: deviceCommands.list(), uncertainState: 'FIRING significa pedido em andamento ou incerto após queda. Confira o equipamento; não há reenvio automático.' }
  })
  server.post('/api/external/commands/:id/acknowledge', async (request, reply) => {
    if (!(await allowed(request, 'OUTPUT_CONTROL'))) return reply.code(403).send({ error: 'Sem permissão para reconhecer a incerteza de comandos externos.' })
    const body = z.object({ note: z.string().trim().min(10).max(1000) }).safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: 'Registre o que foi conferido no equipamento (mínimo de 10 caracteres).' })
    try {
      if (!deviceCommands.acknowledge((request.params as { id: string }).id, await usernameOf(request), body.data.note)) return reply.code(409).send({ error: 'Pedido não encontrado ou não está incerto.' })
      return { ok: true, physicalExecutionConfirmed: false, message: 'Incerteza reconhecida pelo operador. O pedido original continua sem confirmação física; nenhum comando foi reenviado.' }
    } catch { return reply.code(409).send({ error: 'Pedido ainda em andamento. Aguarde a resposta antes de reconhecer a incerteza.' }) }
  })
  server.post('/api/external/devices/:id/control', async (request, reply) => {
    if (!(await allowed(request, 'OUTPUT_CONTROL'))) return reply.code(403).send({ error: 'Sem permissão para operar equipamentos externos.' })
    const body = z.object({ requestId: z.string().uuid(), action: z.enum(['PING', 'ROUTE_CROSSPOINT']),
      source: z.number().int().min(0).max(65_535).optional(), destination: z.number().int().min(0).max(65_535).optional() })
      .refine(value => value.action === 'PING' || value.source !== undefined && value.destination !== undefined).safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: 'Informe identificador do pedido, ação e portas inteiras a partir de zero para roteamento.' })
    const deviceId = (request.params as { id: string }).id
    const rows = await app.db.select().from(externalDevices)
    const device = rows.find(row => row.id === deviceId)
    if (!device) return reply.code(404).send({ error: 'Equipamento não encontrado.' })
    if (!device.enabled || device.kind !== 'VIDEOHUB_ROUTER') return reply.code(409).send({ error: 'Comando não enviado. Somente o driver Videohub está disponível; ATEM/GPIO exigem integração física própria.' })
    globalStudioAutomationGateway.configureDevices(rows)
    const { requestId, ...command } = body.data
    try {
      const outcome = await deviceCommands.execute(requestId, { deviceId, ...command }, await usernameOf(request), () =>
        globalStudioAutomationGateway.execute({ deviceId, targetDevice: device.kind, action: command.action, params: { source: command.source, destination: command.destination } }, EXTERNAL_CONTROL_TOKEN))
      if (outcome.run.state !== 'EXECUTED') return reply.code(409).send({ ...outcome, error: outcome.run.state === 'FIRING' ? 'Pedido em andamento ou incerto. Confira o equipamento antes de enviar um novo comando.' : outcome.run.result?.error ?? 'Equipamento não confirmou o pedido.' })
      return { ...outcome, physicalOutputValidated: false }
    } catch (error) {
      return reply.code(409).send({ error: error instanceof DeviceCommandConflict ? error.message : 'Pedido incerto. Confira o equipamento e o registro antes de repetir; não há reenvio automático.' })
    }
  })

  server.post('/api/v1/external/control', async (request, reply) => {
    const rawHeaderToken = request.headers['x-rplayout-control-token']
    const headerToken = Array.isArray(rawHeaderToken) ? rawHeaderToken[0] : rawHeaderToken

    const body = z.object({
      targetDevice: z.enum(['ATEM_SWITCHER', 'VIDEOHUB_ROUTER', 'GPIO_RELAY', 'BLACKMAGIC_ATEM', 'LEITCH_ROUTER']),
      deviceId: z.string().min(1).max(200),
      requestId: z.string().uuid(),
      action: z.string().min(1),
      parameters: z.record(z.unknown()).optional(),
      params: z.record(z.unknown()).optional(),
      token: z.string().optional(),
      channelId: z.string().optional(),
      clientMetadata: z.record(z.unknown()).optional(),
    }).safeParse(request.body)

    if (!body.success) {
      return reply.code(400).send({ error: 'Informe equipamento explícito, requestId UUID estável e parâmetros válidos. A rota de serviço não deduz equipamento nem repete pedidos sem identidade.' })
    }

    const token = body.data.token ?? headerToken ?? request.headers.authorization?.replace(/^Bearer /i, '')
    if (EXTERNAL_CONTROL_TOKEN && EXTERNAL_CONTROL_TOKEN.trim() !== '') {
      if (!token || !secretEquals(token, EXTERNAL_CONTROL_TOKEN)) {
        return reply.code(401).send({ error: 'Chave de controle externo inválida ou ausente (X-RPlayout-Control-Token).' })
      }
    } else {
      if (!(await allowed(request, 'OUTPUT_CONTROL'))) {
        return reply.code(403).send({ error: 'Sem permissão para operar dispositivos externos.' })
      }
    }

    const rows = await app.db.select().from(externalDevices)
    const device = rows.find(row => row.id === body.data.deviceId)
    if (!device) return reply.code(404).send({ error: 'Equipamento não encontrado.' })
    if (!device.enabled || device.kind !== 'VIDEOHUB_ROUTER' || body.data.targetDevice !== device.kind) return reply.code(409).send({ error: 'Comando não enviado: equipamento desativado, tipo diferente ou driver físico indisponível. Somente Videohub está implementado.' })
    if (body.data.parameters && body.data.params) return reply.code(400).send({ error: 'Use somente parameters ou params, sem configuração ambígua.' })
    const parsed = z.object({ source: z.number().int().min(0).max(65_535).optional(), destination: z.number().int().min(0).max(65_535).optional() }).strict().safeParse(body.data.parameters ?? body.data.params ?? {})
    if (!parsed.success || !['PING', 'ROUTE_CROSSPOINT'].includes(body.data.action) || body.data.action === 'ROUTE_CROSSPOINT' && (parsed.data.source === undefined || parsed.data.destination === undefined)) return reply.code(400).send({ error: 'Use PING ou ROUTE_CROSSPOINT com source/destination inteiros explícitos a partir de zero.' })
    globalStudioAutomationGateway.configureDevices(rows)
    const command = { deviceId: device.id, action: body.data.action as 'PING' | 'ROUTE_CROSSPOINT', ...parsed.data }
    const actor = EXTERNAL_CONTROL_TOKEN ? 'service:external-control' : await usernameOf(request)
    try {
      const outcome = await deviceCommands.execute(body.data.requestId, command, actor, () => globalStudioAutomationGateway.execute({ deviceId: device.id, targetDevice: device.kind, action: command.action, params: parsed.data }, EXTERNAL_CONTROL_TOKEN))
      if (outcome.run.state !== 'EXECUTED') return reply.code(409).send({ ...outcome, success: false, error: 'Pedido falhou ou ficou incerto. Consulte o registro e confira o equipamento; não há reenvio automático.' })
      return { ...outcome.run.result, ...outcome, physicalOutputValidated: false }
    } catch (error) {
      return reply.code(409).send({ success: false, error: error instanceof DeviceCommandConflict ? error.message : 'Pedido incerto. Confira o equipamento e o histórico antes de emitir novo comando.' })
    }
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
    if (!(await allowed(request,'PLAYLIST_EDIT'))) return reply.code(403).send({error:'Sem permissão para editar a grade.'})
    const { id } = request.params as { id: string }
    const body = z.object({
      itemId: z.string().optional(),
      userId: z.string().optional(),
      userName: z.string().optional(),
    }).safeParse(request.body ?? {})

    if (!body.success) {
      return reply.code(400).send({ error: 'Parâmetros de lock inválidos.', details: body.error.format() })
    }

    if (!await getRundown(app.db,id)) return reply.code(404).send({error:'Grade não encontrada.'})
    if (body.data.itemId && (await getItem(app.db,body.data.itemId))?.rundownId !== id) return reply.code(404).send({error:'Item não pertence a esta grade.'})
    const identity = access.identity(request)
    const userId = identity?.id ?? 'local-operator'
    const userName = identity?.username ?? 'Operador local'

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
    if (!(await allowed(request,'PLAYLIST_EDIT'))) return reply.code(403).send({error:'Sem permissão para editar a grade.'})
    const { id } = request.params as { id: string }
    const body = z.object({
      itemId: z.string().optional(),
      userId: z.string().optional(),
    }).safeParse(request.body ?? {})

    if (!body.success) {
      return reply.code(400).send({ error: 'Parâmetros de release inválidos.', details: body.error.format() })
    }

    if (!await getRundown(app.db,id)) return reply.code(404).send({error:'Grade não encontrada.'})
    if (body.data.itemId && (await getItem(app.db,body.data.itemId))?.rundownId !== id) return reply.code(404).send({error:'Item não pertence a esta grade.'})
    const userId = access.identity(request)?.id ?? 'local-operator'
    const result = globalConcurrencyManager.releaseLock({
      rundownId: id,
      itemId: body.data.itemId,
      userId,
    })

    if (!result.success) return reply.code(409).send({error:'Este bloqueio pertence a outro operador.',lockState:result.lockState})
    return { success: true, lockState: result.lockState }
  })

  // 3. Resolução e merge assistido de conflitos concorrentes
  server.post('/api/v1/rundowns/:id/resolve-conflict', async (request, reply) => {
    if (!(await allowed(request,'PLAYLIST_EDIT'))) return reply.code(403).send({error:'Sem permissão para editar a grade.'})
    const { id } = request.params as { id: string }
    const body = z.object({
      conflictId: z.string().optional(),
      itemId: z.string().min(1),
      clientRundownVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
      resolutionStrategy: z.enum(['OVERWRITE_FORCE', 'DISCARD_MINE', 'APPLY_MERGED_FIELDS']),
      mergedData: collaborativePatchSchema.optional(),
      patch: collaborativePatchSchema.optional(),
    }).safeParse(request.body)

    if (!body.success) {
      return reply.code(400).send({ error: 'Parâmetros de resolução de conflito inválidos.', details: body.error.format() })
    }

    const selectedPatch = body.data.resolutionStrategy === 'DISCARD_MINE' ? {} :
      body.data.resolutionStrategy === 'APPLY_MERGED_FIELDS' ? body.data.mergedData ?? body.data.patch ?? {} : body.data.patch ?? body.data.mergedData ?? {}
    let result
    try{
      result=applyCollaborativeEdit(app.db,globalConcurrencyManager,id,body.data.itemId,selectedPatch,
        {expectedRundownVersion:body.data.clientRundownVersion},item=>collaborativePatchSchema.safeParse({title:item.title,durationOverride:item.durationOverride,minDuration:item.minDuration}).success,body.data.resolutionStrategy==='DISCARD_MINE')
    }catch(error){
      if(error instanceof CollaborativeEditError)return reply.code(error.status).send(error.payload)
      throw error
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
      resolvedData: result.item,
    }
  })

  // 4. Atualização de item com validação de versão otimista e detecção de 409 Conflict
  server.get('/api/v1/rundowns/:id/revisions',async(request,reply)=>{
    const {id}=request.params as {id:string}
    const result=app.db.transaction(tx=>{
      const grade=tx.select().from(rundowns).where(eq(rundowns.id,id)).get()
      if(!grade)return null
      const items=tx.select().from(rundownItems).where(eq(rundownItems.rundownId,id)).orderBy(asc(rundownItems.sortOrder)).all()
      return {rundownId:id,rundownVersion:globalConcurrencyManager.getRundownVersion(id),
        items:items.map(row=>({item:toItem(row),lineVersion:globalConcurrencyManager.getLineVersion(id,row.id)})),eTag:globalConcurrencyManager.generateETag(id)}
    })
    if(!result)return reply.code(404).send({error:'Grade não encontrada.'})
    void reply.header('ETag',result.eTag)
    return result
  })

  server.put('/api/v1/rundowns/:id/items/:itemId', async (request, reply) => {
    if (!(await allowed(request,'PLAYLIST_EDIT'))) return reply.code(403).send({error:'Sem permissão para editar a grade.'})
    const { id, itemId } = request.params as { id: string; itemId: string }
    const rawIfMatch = request.headers['if-match']
    const ifMatchHeader = Array.isArray(rawIfMatch) ? rawIfMatch[0] : rawIfMatch

    const body = z.object({
      expectedRundownVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
      expectedLineVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
      patch: collaborativePatchSchema,
    }).safeParse(request.body)

    if (!body.success) {
      return reply.code(400).send({ error: 'Payload de atualização de item inválido.', details: body.error.format() })
    }

    let result
    try{
      result=applyCollaborativeEdit(app.db,globalConcurrencyManager,id,itemId,body.data.patch,
        {expectedRundownVersion:body.data.expectedRundownVersion,expectedLineVersion:body.data.expectedLineVersion,ifMatchHeader},item=>collaborativePatchSchema.safeParse({title:item.title,durationOverride:item.durationOverride,minDuration:item.minDuration}).success)
    }catch(error){
      if(error instanceof CollaborativeEditError)return reply.code(error.status).send(error.payload)
      throw error
    }
    const {newRundownVersion,newLineVersion}=result
    void reply.header('ETag',result.eTag)

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
      item: result.item,
    }
  })

  // Compatibility route is planning only. Applying the reviewed proposal uses
  // the canonical autofill workflow, never a fabricated tail/slate item.
  server.post('/api/v1/rundowns/:id/autofill-gap', async (request, reply) => {
    if (!(await allowed(request,'PLAYLIST_EDIT'))) return reply.code(403).send({error:'Sem permissão para planejar preenchimento.'})
    const { id } = request.params as { id: string }
    const body = z.object({
      gapStartMs: z.number().min(0).max(86_400_000).optional(),
      gapDurationMs: z.number().positive().max(86_400_000).default(30000),
      preferredCategory: z.string().optional().default('FILLER'),
      allowExtendPrevious: z.boolean().optional().default(true),
    }).safeParse(request.body ?? {})

    if (!body.success) {
      return reply.code(400).send({ error: 'Parâmetros de autofill inválidos.', details: body.error.format() })
    }

    try {
      return app.db.transaction(tx=>{
        const state=readEditorialState(app.db,id)
        if(!state)throw new CollaborativeEditError(404,{error:'Grade ativa não encontrada.'})
        assertEditorialAccess(request,state.channel.id)
        if(request.headers['if-match'])requireEditorialRevision(app.concurrency,id,request.headers['if-match'],state.editorialRevision)
        const result=proposeFill(tx,state,'WINDOW',{minutes:body.data.gapDurationMs/60000,categories:[body.data.preferredCategory],
          ...(body.data.gapStartMs===undefined?{}:{insertAtMinute:body.data.gapStartMs/60000})},access.identity(request)?.username??null)
        return {...result,success:true,strategyApplied:'REVIEW_FILL_PROPOSAL',requiresReview:true,applied:false,
          remainingGapMs:body.data.gapDurationMs,applyEndpoint:`/api/rundowns/${id}/autofill`,
          applyParameters:{proposalId:result.proposal.id},applyRevision:result.proposal.editorialRevision}
      },{behavior:'immediate'})
    }catch(error){if(error instanceof CollaborativeEditError)return reply.code(error.status).send(error.payload);throw error}
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
import {previewCadenceConversion,applyCadenceConversion} from './domain/cadence-conversion.js'
