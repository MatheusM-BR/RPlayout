import type {
  AudioLevel,
  AudioRouting,
  AudioMixAnalysisView,
  Anchor,
  EditScope,
  EditScopeReview,
  OperationalReview,
  GraphicTemplate,
  ItemGraphic,
  Trim,
  ScheduleEventType,
  TimingFlags,
  LiveSourceConfig,
  ManagedLiveSource,
  SrtTelemetry,
} from '@rplayout/protocol'
export interface NextPlaylistPlan {
  sourceRevisionId:string;targetRevisionId:string;sourceName:string;targetName:string;targetDate:string;firstItemTitle:string;notBeforeMs:number
}
export interface OperationalInsertionInput {requestId:string;mode:'NEXT'|'NOW';mediaId?:string;sourceId?:string;durationFrames?:number}
export interface OperationalInsertionReview {reviewToken:string;input:OperationalInsertionInput;item:{id:string;title:string};sourceRevisionId:string;conflicts:Array<{message:string;frames:number;severity:string}>;nativeEngine:boolean;estimatedTiming:true;notice:string}
export interface OperationalInsertionResult {ok:boolean;deduplicated?:boolean;run:{requestId:string;phase:string;mode:'NEXT'|'NOW';nativeProgramConfirmed:boolean;physicalOutputValidated:false};message?:string}
export interface HaMediaStatus {enabled:boolean;required:number;verified:number;ready:false;note:string;mbit:number;error:string|null;bytesReserved?:number;quotaBytes?:number}
export type HaAuthorityStatus={configured:false;nativeFencingRequired:false;physicalOutputValidated:false}|{configured:true;nativeFencingRequired:true;physicalOutputValidated:false;leases:Array<{channelId:string;term:number;confirmedAt:string|null;error:string|null}>}
export type HaReplicationStatus={configured:false;failoverReady:false;automaticTake:false;reason:string}|{configured:true;role:'PRIMARY'|'STANDBY';nodeId:string;peerNodeId:string;clusterId:string;sequence:number;confirmedAt:string|null;checkedAt:string|null;pending:boolean;error:string|null;mirroredChannels:number;mirroredAsRun:number;capturedAt:string|null;media:HaMediaStatus;authority?:HaAuthorityStatus;automaticTake:false;failoverReady:false;reason:string}
export interface PublishedContinuityStatus {channelId:string;version:number;state:'ENABLED'|'DISABLED'|'SUSPENDED';workerState:'OFF'|'CURRENT_SERVER'|'WAITING_RECOVERY'|'OTHER_OR_UNKNOWN_SERVER';mode:'PUBLISHED_ONLY';maxLateMinutes:number;message:string;sourceRevisionId:string|null;nativeEngine:boolean;canConfigure:boolean}
export interface PublishedContinuityReview {channelId:string;version:number;sourceRevisionId:string;sourceRundownId:string;maxLateMinutes:number;nextName:string;nextRevisionId:string;token:string}
export interface SchedulePublicationStatus {channelId:string;version:number;state:'ENABLED'|'DISABLED'|'SUSPENDED';mode:'OWNED_EMPTY_DAYS';daysAhead:number;maxItems:number;workerAvailable:boolean;canConfigure:boolean;message:string;jobs:Array<{id:string;date:string;state:'RUNNING'|'READY'|'FAILED';message:string;revisionId?:string;itemCount?:number;workerState:string}>}
export interface SchedulePublicationReview {channelId:string;version:number;daysAhead:number;maxItems:number;dates:string[];occupied:Array<{id:string;date:string;name:string;owned:boolean}>;token:string}
export interface NextPlaylistRun {id:string;state:'QUEUED'|'PREPARING'|'SWITCHING'|'CONFIRMED'|'FAILED'|'CANCELLED'|'UNCERTAIN';plan:NextPlaylistPlan;message?:string;updatedAt:string;createdAt:string}
export interface NextPlaylistReview extends NextPlaylistPlan {token:string;channelId:string;firstItemId:string;sourceRundownId:string;targetRundownId:string}
export interface NextPlaylistStatus {channelId:string;nativeEngine:boolean;sourceRevisionId:string|null;current:NextPlaylistRun|null;history:NextPlaylistRun[];canConfigure:boolean;canReconcile:boolean;automaticPolicy:'ONE_REVIEWED_EOS';options:Array<{revisionId:string;revision:number;name:string;date:string}>}
import type { Channel, MediaAsset, Rundown, RundownItem, ResolveResult } from '@rplayout/protocol'
import type {
  AsRunEntry,
  Distribution,
  FillPlan,
  ScheduleRule,
  LibraryFolder,
  MediaRoot,
  OutputProfile,
  ConfigurationOperation,
  TransmissionPreset,
  Categoria,
  PlaylistEntryView,
  PlaylistFile,
  RundownView,
  ScanStatus,
  Snapshot,
  SourceList,
} from './types.js'
import {requestResult} from './domain/json-request.js'
import {editorialHeaders} from './domain/editorial-revision.js'
import {configurationHeaders} from './domain/channel-configuration.js'
import {qcDecisionHeaders,qcAssetHeaders} from './domain/qc-review.js'

/**
 * O motivo da falha, em texto que serve para alguém agir.
 *
 * O servidor responde de duas formas: `error`, que é nossa e já vem escrita
 * para gente, e `message`, que é o que o Fastify põe quando algo estourou
 * antes de chegar na rota -- é onde mora, por exemplo, a queixa do banco de
 * dados. Ler só a primeira deixava o operador com "Falha em /api/…", que não
 * diz nada e não dá para me mandar.
 *
 * Detalhe de validação vem como objeto; virar "[object Object]" na tela seria
 * pior que não mostrar, então ele é serializado.
 */
export interface OperationalRevisionSummary {
  id: string
  revision: number
  state: string
  active: boolean
  publishedBy: string | null
  publishedAt: string
  activatedAt: string | null
}

export interface ManualExternalRun {
  requestId: string
  state: 'FIRING' | 'EXECUTED' | 'FAILED' | 'CLOSED_UNCERTAIN'
  command: { deviceId: string; action: string; source?: number; destination?: number }
  result?: import('@rplayout/protocol').ExternalControlResult
  createdAt: string
  actor: string | null
  acknowledgement?: string
}

export interface HostMetricSample {
  generatedAt: string
  sampleIntervalSeconds: number
  cpu: { percent: number | null; cores: number }
  memory: { totalBytes: number; usedBytes: number; freeBytes: number; percent: number | null }
  process: { rssBytes: number; heapUsedBytes: number }
  gpu: { utilizationPercent: number | null; memoryUsedMiB: number | null; memoryTotalMiB: number | null; temperatureC: number | null; name: string | null; error: string | null }
  disk: { path: string; totalBytes: number | null; freeBytes: number | null; percentUsed: number | null; error: string | null }
  network: { receivedBytesPerSecond: number | null; sentBytesPerSecond: number | null; source: string | null; error: string | null }
}

export interface ItemAutomationState {
  itemId:string;rundownId:string;channelId:string;editorialRevision:number
  rate:import('@rplayout/protocol').Rate;requiresPublication:boolean
  templates:GraphicTemplate[];cues:ItemGraphic[];events:import('@rplayout/protocol').SecondaryEvent[]
}
export interface OperationalSimulation {
  review:OperationalReview
  simulated: { rundown: Rundown; items: RundownItem[]; schedule: ResolveResult }
  activeRevision: number | null
  differences: { added: string[]; removed: string[]; changed: Array<{ itemId: string; fields: string[] }>; graphicsChanged?: string[]; timingPolicyChanged?: boolean }
}

async function send<T>(path: string, init?: RequestInit): Promise<T> {
  return (await requestResult<T>(path,init)).body
}

const post = <T>(path: string, body: unknown): Promise<T> =>
  send<T>(path, { method: 'POST', body: JSON.stringify(body) })

export const api = {
  cadencePreview: (id:string, rate:import('@rplayout/protocol').Rate,format:Partial<Pick<Channel,'name'|'width'|'height'|'scan'|'fieldOrder'|'targetLufs'|'ceilingDbtp'>>,revision:number|undefined) => send<{report:import('@rplayout/protocol').CadenceConversionReport}>(`/api/channels/${encodeURIComponent(id)}/cadence-preview`,{method:'POST',headers:configurationHeaders(id,revision),body:JSON.stringify({rateNum:rate.num,rateDen:rate.den,format})}),
  cadenceConvert: (id:string, rate:import('@rplayout/protocol').Rate, fingerprint:string, format:Partial<Pick<Channel,'name'|'width'|'height'|'scan'|'fieldOrder'|'targetLufs'|'ceilingDbtp'>>,revision:number|undefined) => send<{applied:true;engineError:string|null;report:import('@rplayout/protocol').CadenceConversionReport}>(`/api/channels/${encodeURIComponent(id)}/cadence-convert`,{method:'POST',headers:configurationHeaders(id,revision),body:JSON.stringify({rateNum:rate.num,rateDen:rate.den,fingerprint,format,confirm:true})}),
  audit: (signal?:AbortSignal) => send<{entries:Array<{id:string;actorUsername:string|null;kind:string;itemId:string|null;createdAt:string;payload:Record<string,unknown>}>}>('/api/audit?limit=1000',{signal}),
  pgmProbeStatus: (channelId: string) =>
    send<{
      alerts: import('@rplayout/protocol').PgmProbeAlert[]
      activeAlerts: import('@rplayout/protocol').PgmProbeAlert[]
      automaticActionsEnabled: boolean
      emergencySlateActive: boolean
      lastIncidentAt?: string
      lastSampleAt?: string
      contingency?: { active: boolean; loopRevisionId: string; loopRundownId: string; rundownId: string | null; revisionId: string | null; itemId: string | null; elapsed: number; activatedAt: string } | null
      metrics: { blackDurationMs: number; freezeDurationMs: number; silenceDurationMs: number; audioDbfs: number | null }
      thresholds: { blackThresholdMs: number; silenceThresholdMs: number; freezeThresholdMs: number; silenceDbfs: number; defaultAutoAction: import('@rplayout/protocol').PgmProbeAutoAction }
    }>(`/api/v1/engineering/pgm-probe/status?channelId=${encodeURIComponent(channelId)}`),
  setPgmEmergencySlate: (channelId: string, action: 'TRIGGER' | 'RESET') =>
    post<{ ok: boolean; emergencySlateActive: boolean }>('/api/v1/engineering/pgm-probe/emergency-slate', { channelId, action }),
  setPgmProbePolicy: (channelId: string, automaticActions: boolean, defaultAutoAction?: import('@rplayout/protocol').PgmProbeAutoAction) => post<{ ok: boolean }>('/api/v1/engineering/pgm-probe/policy', { channelId, automaticActions, ...(defaultAutoAction ? { thresholds: { defaultAutoAction } } : {}) }),
  contingencyLoop: (channelId: string) => send<{ loopRevisionId: string | null; origin: { active: boolean; rundownId: string | null; itemId: string | null; elapsed: number } | null; nativeEngine: boolean; options: Array<{ revisionId: string; revision: number; rundownId: string; name: string; date: string }> }>(`/api/v1/engineering/pgm-probe/contingency-loop?channelId=${encodeURIComponent(channelId)}`),
  setContingencyLoop: (channelId: string, action: 'CONFIGURE' | 'ENTER' | 'RETURN', revisionId?: string | null) => post<{ ok: true }>('/api/v1/engineering/pgm-probe/contingency-loop', { channelId, action, ...(revisionId !== undefined ? { revisionId } : {}) }),
  session: () => send<{ role: string; label: string; authenticated: boolean; required: boolean }>('/api/session'),
  logout: () => post<{ ok: true }>('/api/auth/logout', {}),
  users: () => send<{ users: Array<{ id: string; username: string; role: string; enabled: boolean; createdAt: string; channelIds: string[] | null; stationIps: string[] | null }> }>('/api/users'),
  addUser: (body: { username: string; password: string; role: string }) => post<{ requiresLogin: boolean }>('/api/users', body),
  patchUser: (id: string, body: Record<string, unknown>) => send<{ ok: true }>(`/api/users/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  revokeUserSessions: (id: string) => send<{ ok: true }>(`/api/users/${id}/sessions`, { method: 'DELETE' }),
  userAccess: (id: string, body: { channelIds: string[] | null; stationIps: string[] | null }) => send<{ ok: true }>(`/api/users/${id}/access`, { method: 'PUT', body: JSON.stringify(body) }),
  integrations: (channelId?: string) => send<{ integrations: Array<{ id: string; name: string; url: string; events: string[]; enabled: boolean; channelId: string | null }> }>(`/api/integrations${channelId ? `?channelId=${encodeURIComponent(channelId)}` : ''}`),
  addIntegration: (body: { channelId: string | null; name: string; url: string; events: string[] }) => post('/api/integrations', body),
  patchIntegration: (id: string, body: Record<string, unknown>) => send<{ ok: true }>(`/api/integrations/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  testIntegration: (id: string) => post<{ ok: boolean; status?: number; error?: string }>(`/api/integrations/${id}/test`, {}),
  integrationDeliveries: (channelId: string) => send<{ deliveries: Array<{id:string;integrationId:string;channelId:string|null;event:string;state:'QUEUED'|'SENDING'|'DELIVERED'|'FAILED'|'CANCELLED';attempts:number;nextAttemptAt:string;lastError:string|null;createdAt:string;deliveredAt:string|null}>;limit:number;deliverySemantics:string }>(`/api/integration-deliveries?channelId=${encodeURIComponent(channelId)}`),
  retryIntegrationDelivery: (id: string) => post<{ok:true}>(`/api/integration-deliveries/${id}/retry`,{}),
  state: () => send<{ channels: Channel[]; rundowns: Rundown[] }>('/api/state'),
  patchChannel: (
    id: string,
    body: {
      name?: string
      width?: number
      height?: number
      rateNum?: number
      rateDen?: number
      scan?: string
      fieldOrder?: string
      targetLufs?: number
      ceilingDbtp?: number
      audioChannels?:2|8|16
      expectedAudioChannels?:2|8|16
    },
    revision:number|undefined,
  ) =>
    send<{ ok: boolean; restarted?: boolean; formatChanged: boolean;engineError:string|null;configurationRevision:number }>(`/api/channels/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers:configurationHeaders(id,revision),
      body: JSON.stringify(body),
    }),
  channelConfiguration:(id:string)=>send<{channel:Channel}>(`/api/channels/${encodeURIComponent(id)}/configuration`),
  addChannel: (name: string) =>
    post<{ channelId: string; rundownId: string }>('/api/channels', { name }),
  assets: () => send<{ assets: MediaAsset[] }>('/api/assets'),
  qcAssessment: (id: string, channelId: string) => send<{ contentHash: string; review:import('@rplayout/protocol').QcReview;profile: import('@rplayout/protocol').QcProfile; checks: ReturnType<typeof import('@rplayout/protocol').assessQc>; decisions: Array<{ channelId:string;status: string; notes: string | null; createdAt: string }> }>(`/api/assets/${encodeURIComponent(id)}/qc?channelId=${encodeURIComponent(channelId)}`),
  qcDecision: (id: string, body: { channelId: string; contentHash: string; status: 'PENDING' | 'ANALYSIS' | 'APPROVED' | 'APPROVED_WITH_NOTES' | 'REJECTED' | 'BLOCKED'; notes?: string },review:import('@rplayout/protocol').QcReview|undefined) => send<{ok:true;refreshError:string|null}>(`/api/assets/${encodeURIComponent(id)}/qc`,{method:'POST',headers:qcDecisionHeaders(id,body.channelId,body.contentHash,review),body:JSON.stringify(body)}),
  qcProfile: (channelId: string) => send<{ profile: import('@rplayout/protocol').QcProfile;configurationRevision:number }>(`/api/channels/${encodeURIComponent(channelId)}/qc-profile`),
  setQcProfile: (channelId: string, profile: import('@rplayout/protocol').QcProfile,revision:number|undefined) => send<{ message: string;configurationRevision:number;refreshError:string|null }>(`/api/channels/${encodeURIComponent(channelId)}/qc-profile`, { method: 'PUT',headers:configurationHeaders(channelId,revision), body: JSON.stringify(profile) }),
  interruptions: (channelId: string) => send<{ items: Array<{ id: string; item_id: string; title: string; frames: number; state: string; revision_id: string | null;reviewToken:string;canReconcile:boolean;operation:{requestId:string;phase:string;message:string|null}|null }> }>(`/api/channels/${encodeURIComponent(channelId)}/interruptions`),
  resolveInterruption: (channelId: string, id: string, action: 'RESUME' | 'DISCARD',requestId:string,reviewToken:string) => post<{ok:true;run:{phase:string;nativeProgramConfirmed:boolean;message:string|null};deduplicated:boolean}>(`/api/channels/${encodeURIComponent(channelId)}/interruptions/${encodeURIComponent(id)}`, { action,requestId,reviewToken }),
  acknowledgeInterruption:(channelId:string,id:string,requestId:string,reviewToken:string)=>post(`/api/channels/${encodeURIComponent(channelId)}/interruptions/${encodeURIComponent(id)}/acknowledge`,{requestId,reviewToken,confirm:true}),
  adjustLiveDuration: (channelId: string, deltaSeconds: number) => post<{ revision: number }>(`/api/channels/${channelId}/live-duration`, { deltaSeconds }),
  mediaWorkflow: (id: string, hash?:string) => send<{ previewReady: boolean; previewUrl: string | null; versions: Array<{ id: string; revision: number; content_hash: string; jobs: Array<{ id: string; kind: string; state: string; error: string | null }> }> }>(`/api/assets/${encodeURIComponent(id)}/workflow${hash===undefined?'':`?hash=${encodeURIComponent(hash)}`}`),
  retryMediaJob: (id: string) => post<{ ok: boolean }>(`/api/media/jobs/${id}/retry`, {}),
  library: (channelId?: string) => send<{ folders: LibraryFolder[]; roots: MediaRoot[] }>(`/api/library${channelId ? `?channelId=${channelId}` : ''}`),
  pickMediaRoot: async () => {
    const {status,body}=await requestResult<{root:MediaRoot;scanning:boolean}>('/api/library/roots/pick',{method:'POST'})
    if(status===204)return null
    return body
  },
  recordingTarget: (folder: string, filename: string) => post<{ path: string }>('/api/files/target', { folder, filename }),

  patchAsset: (id: string, body: { title?: string; categoryId?: string | null; ignored?: boolean; qcStatus?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'FAILED'; qcNotes?: string | null },qcRevision?:number) =>
    send<{ ok: true;refreshError:string|null }>(`/api/assets/${encodeURIComponent(id)}`, { method: 'PATCH',headers:body.qcStatus!==undefined||body.ignored!==undefined||body.qcNotes!==undefined?qcAssetHeaders(id,qcRevision):undefined, body: JSON.stringify(body) }),
  /**
   * Tira do acervo. Arquivo em uso responde conflito em vez de sair calado --
   * a grade que aponta para ele perderia a referência.
   */
  removeAsset: async (id: string, force = false) => {
    const {status,body:corpo}=await requestResult<{error?:string;items?:number}>(`/api/assets/${id}${force ? '?force=1' : ''}`,{method:'DELETE'},{acceptedStatuses:[409]})
    if(status===409)return {conflito:corpo.error,items:corpo.items}
    return { conflito: null }
  },
  pruneAssets: () =>
    post<{ removed: number; removedItems: number }>('/api/assets/prune', {}),
  /** Levanta o canal de novo, para os perfis de saída de agora valerem. */
  restartChannel: (id: string) => post<{ ok: true }>(`/api/channels/${id}/restart`, {}),
  warmContinuityCache: (channelId?: string) => post<{ ok: boolean; cached48h: number; missing48h: number }>(`/api/v1/continuity/cache/warm${channelId ? '?channelId=' + encodeURIComponent(channelId) : ''}`, {}),
  continuityCacheStatus: (channelId?: string) => send<import('@rplayout/protocol').ContinuityCacheStatus>(`/api/v1/continuity/cache/status${channelId ? '?channelId=' + encodeURIComponent(channelId) : ''}`),
  removeChannel: (id: string) =>
    send<{ ok: true; archived: true; historyPreserved: true }>(`/api/channels/${id}`, { method: 'DELETE' }),
  archivedChannels: () => send<{channels:Channel[]}>('/api/channels/archived'),
  reactivateChannel: (id:string) => post<{ok:true;archived:false;automaticTake:false}>(`/api/channels/${encodeURIComponent(id)}/reactivate`,{}),
  channelProjects: (channelId: string) =>
    send<{ projects: Array<{ id: string; label: string; createdAt: string }> }>(`/api/channels/${encodeURIComponent(channelId)}/projects`),
  saveChannelProject: (channelId: string, label: string) =>
    post<{ project: { id: string; label: string; createdAt: string }; projects: Array<{ id: string; label: string; createdAt: string }> }>(`/api/channels/${encodeURIComponent(channelId)}/projects`, { label }),
  restoreChannelProject: (channelId: string, projectId: string) =>
    post<{ ok: true; restored: { label: string; createdAt: string; rundowns: number } }>(`/api/channels/${encodeURIComponent(channelId)}/projects/${encodeURIComponent(projectId)}/restore`, {}),
  scanStatus: () => send<ScanStatus>('/api/library/scan'),
  mediaRoots: () => send<{ roots: MediaRoot[] }>('/api/library/roots'),
  browseMediaRoot: (path?: string) =>
    send<import('./types.js').ServerFolderBrowser>(`/api/library/roots/browse${path ? `?path=${encodeURIComponent(path)}` : ''}`),
  /**
   * Lê uma lista arrastada para a janela.
   *
   * Vai o conteúdo, não o caminho: o navegador não entrega o caminho de um
   * arquivo arrastado, e é por isso que este caminho existe separado do que
   * lê as listas que moram na pasta do acervo.
   */
  readPlaylist: (name: string, text: string) =>
    post<{ name: string; date: string | null; entries: PlaylistEntryView[]; missing: number }>(
      '/api/playlists/read',
      { name, text },
    ),
  addMediaRoot: (path: string, label?: string) =>
    post<{ root: MediaRoot; scanning: boolean }>('/api/library/roots', { path, label }),
  removeMediaRoot: (id: string) =>
    send<{ ok: true }>(`/api/library/roots/${id}`, { method: 'DELETE' }),
  outputs: (channelId: string) =>
    send<{ outputs: OutputProfile[];configurationRevision:number;configurationOperation:ConfigurationOperation }>(`/api/channels/${encodeURIComponent(channelId)}/outputs`),
  reconcileConfiguration:(channelId:string,runId:string,revision:number|undefined)=>send<{ok:true;reconciled:true;automaticTake:false}>(`/api/channels/${encodeURIComponent(channelId)}/configuration-operation/reconcile`,{method:'POST',headers:configurationHeaders(channelId,revision),body:JSON.stringify({runId,confirm:true})}),
  addOutput: (channelId: string, body: { name: string; kind: string; target: string;bitrateKbps?:number|null;enabled?:boolean },revision:number|undefined) =>
    send<{ restartRequired: boolean;configurationRevision:number;engineError?:string|null;configurationUncertain?:boolean }>(`/api/channels/${encodeURIComponent(channelId)}/outputs`,{method:'POST',headers:configurationHeaders(channelId,revision),body:JSON.stringify(body)}),
  patchOutput: (id: string, body: Record<string, unknown>,channelId:string,revision:number|undefined) =>
    send<{ ok: boolean;restartRequired:boolean;configurationRevision:number;engineError?:string|null;configurationUncertain?:boolean }>(`/api/outputs/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers:configurationHeaders(channelId,revision),
      body: JSON.stringify(body),
    }),
  removeOutput: (id: string,channelId:string,revision:number|undefined) => send<{ ok: boolean;engineError?:string|null;configurationRevision:number }>(`/api/outputs/${encodeURIComponent(id)}`, { method: 'DELETE',headers:configurationHeaders(channelId,revision) }),
  transmissionPresets: (channelId: string) =>
    send<{ presets: TransmissionPreset[];configurationRevision:number }>(`/api/channels/${encodeURIComponent(channelId)}/transmission-presets`),
  addTransmissionPreset: (channelId: string, body: { name: string; kind: 'SRT' | 'RTMP'; target: string },revision:number|undefined) =>
    send<{ preset: TransmissionPreset;configurationRevision:number;applied:true }>(`/api/channels/${encodeURIComponent(channelId)}/transmission-presets`,{method:'POST',headers:configurationHeaders(channelId,revision),body:JSON.stringify(body)}),
  applyTransmissionPreset: (channelId: string, presetId: string,revision:number|undefined) =>
    send<{ restartRequired: boolean;configurationRevision:number;applied:true;engineError:string|null }>(`/api/channels/${encodeURIComponent(channelId)}/transmission-presets/${encodeURIComponent(presetId)}/apply`,{method:'POST',headers:configurationHeaders(channelId,revision),body:JSON.stringify({})}),
  removeTransmissionPreset: (channelId: string, presetId: string,revision:number|undefined) =>
    send<{ ok: true;configurationRevision:number;applied:true }>(`/api/channels/${encodeURIComponent(channelId)}/transmission-presets/${encodeURIComponent(presetId)}`, { method: 'DELETE',headers:configurationHeaders(channelId,revision) }),
  /** `measure` desligado lê muito mais rápido e deixa a loudness para depois. */
  scan: (measure = true) =>
    send<ScanStatus>('/api/library/scan', {
      method: 'POST',
      body: JSON.stringify({ measure }),
    }),
  /** `refresh` força uma varredura nova em vez de usar o resultado guardado. */
  sources: (refresh = false) => send<SourceList>(`/api/sources${refresh ? '?refresh=1' : ''}`),
  /** Fontes configuradas para o multiview; não inventa feeds de demonstração. */
  liveSources: (channelId: string) =>
    send<ManagedLiveSource[]>(`/api/sources/live?channelId=${encodeURIComponent(channelId)}`),
  reviewOperationalInsertion:(channelId:string,input:OperationalInsertionInput)=>post<OperationalInsertionReview>(`/api/channels/${encodeURIComponent(channelId)}/operational-insert/review`,input),
  operationalInsertion:(channelId:string,review:OperationalInsertionReview)=>post<OperationalInsertionResult>(`/api/channels/${encodeURIComponent(channelId)}/operational-insert`,{input:review.input,reviewToken:review.reviewToken,confirm:true}),
  operationalInsertionStatus:(channelId:string,requestId:string)=>send<{run:OperationalInsertionResult['run']&{message?:string};configurationOperation:{state:string;reason:string|null};automaticTake:false}>(`/api/channels/${encodeURIComponent(channelId)}/operational-insert/${encodeURIComponent(requestId)}`),
  createLiveSource: (body: {
    channelId: string
    name: string
    kind: 'SRT' | 'RTMP' | 'SDI' | 'NDI' | 'OMT'
    targetUrl: string
    srtConfig?: unknown
    failoverConfig?: unknown
  }) => post<ManagedLiveSource>('/api/sources/live', body),
  updateLiveSource: (id: string, body: Partial<{
    name: string
    kind: 'SRT' | 'RTMP' | 'SDI' | 'NDI' | 'OMT'
    targetUrl: string
    enabled: boolean
  }>) =>
    send<ManagedLiveSource>(`/api/sources/live/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  deleteLiveSource: (id: string) =>
    send<{ success: boolean }>(`/api/sources/live/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  /** Telemetria recebida pelo manager SRT, indexada pelo id da fonte. */
  srtTelemetry: () => send<Record<string, SrtTelemetry>>('/api/srt/telemetry'),
  triggerFailover: (sourceId: string, targetRole: 'PRIMARY' | 'BACKUP', reason?: string) =>
    post<{ ok: boolean; event: { sourceId: string; fromRole: string; toRole: string; reason: string; timestamp: string } }>('/api/engineering/failover/trigger', { sourceId, targetRole, reason }),
  rundown: (id: string) => send<Snapshot>(`/api/rundowns/${id}`),
  operationalRevisions: (id: string) => send<{ revisions: OperationalRevisionSummary[] }>(`/api/rundowns/${encodeURIComponent(id)}/operational-playlists`),
  simulateOperationalPlaylist: (id: string) => send<OperationalSimulation>(`/api/rundowns/${encodeURIComponent(id)}/operational-simulation`),
  saveProtectedZones: (id: string, zones: readonly import('@rplayout/protocol').ProtectedTimingZone[], expectedZones: readonly import('@rplayout/protocol').ProtectedTimingZone[],revision:number|undefined) => send<Snapshot & { publicationRequired: boolean }>(`/api/rundowns/${encodeURIComponent(id)}/protected-zones`, { method: 'PUT',headers:editorialHeaders(revision), body: JSON.stringify({ zones, expectedZones }) }),
  reviewOperationalRollback: (id:string,revisionId:string,editorialRevision:number) => send<OperationalSimulation & {sourceRevision:number}>(`/api/rundowns/${encodeURIComponent(id)}/operational-rollback-review?revisionId=${encodeURIComponent(revisionId)}`,{headers:editorialHeaders(editorialRevision)}),
  rollbackOperationalPlaylist: (id: string, revisionId: string,editorialRevision:number,reviewToken:string) => send<Snapshot & { revision: number }>(`/api/rundowns/${encodeURIComponent(id)}/operational-rollback`, {method:'POST',headers:editorialHeaders(editorialRevision),body:JSON.stringify({revisionId,reviewToken})}),
  publishOperationalPlaylist: (rundownId: string,editorialRevision:number,reviewToken:string) =>
    send<{ id: string; revision: number; publishedAt: string; conflicts: RundownView['schedule']['conflicts'] }>(
      `/api/rundowns/${encodeURIComponent(rundownId)}/operational-publish`,
      {method:'POST',headers:editorialHeaders(editorialRevision),body:JSON.stringify({reviewToken})},
    ),

  addItem: (
    rundownId: string,
    body: {
      mediaId?: string | null
      sourceRef?: string | null
      type: 'VT' | 'LIVE' | 'GFX' | 'SLATE' | 'COMMERCIAL' | 'FILLER'
      title?: string
      anchor?: Anchor
      durationOverride?: number | null
      atIndex?: number
      eventType?: ScheduleEventType
      timingFlags?: TimingFlags
      trimmable?: boolean
      optional?: boolean
      protected?: boolean
      liveConfig?: LiveSourceConfig | null
    },
    revision:number|undefined,
  ) => send<Snapshot>(`/api/rundowns/${rundownId}/items`, {method:'POST',headers:editorialHeaders(revision),body:JSON.stringify(body)}),

  patchItem: (id: string, body: Record<string, unknown>,revision:number|undefined) =>
    send<Snapshot>(`/api/items/${id}`, { method: 'PATCH',headers:editorialHeaders(revision), body: JSON.stringify(body) }),

  removeItem: (id: string,revision:number|undefined) => send<Snapshot>(`/api/items/${id}`, { method: 'DELETE',headers:editorialHeaders(revision) }),

  bulkDeleteItems: (rundownId: string, ids: string[],revision:number|undefined) =>
    send<Snapshot>(`/api/rundowns/${encodeURIComponent(rundownId)}/items/bulk-delete`, {method:'POST',headers:editorialHeaders(revision),body:JSON.stringify({ids})}),

  moveItem: (id: string, toIndex: number,revision:number|undefined) =>
    send<Snapshot>(`/api/items/${id}/move`,{method:'POST',headers:editorialHeaders(revision),body:JSON.stringify({toIndex})}),

  editScope: (id:string,scope:EditScope,revision:number|undefined)=>send<{review:EditScopeReview}>(`/api/items/${encodeURIComponent(id)}/edit-scope?scope=${encodeURIComponent(scope)}`,{headers:editorialHeaders(revision)}),

  setTrim: (id: string, trim: Trim, scope: EditScope,revision:number|undefined,scopeReviewToken?:string) =>
    send<Snapshot & {result:{message:string}}>(`/api/items/${id}/trim`,{method:'POST',headers:editorialHeaders(revision),body:JSON.stringify({trim,scope,scopeReviewToken})}),

  analyzeAudioMix:(id:string,contentHash:string,audioTrack:number,routing:AudioRouting,revision:number|undefined)=>send<{analysis:AudioMixAnalysisView}>(`/api/items/${encodeURIComponent(id)}/audio-analysis`,{method:'POST',body:JSON.stringify({contentHash,audioTrack,routing}),headers:editorialHeaders(revision)}),
  audioMixAnalysis:(id:string,analysisId:string)=>send<{analysis:AudioMixAnalysisView}>(`/api/items/${encodeURIComponent(id)}/audio-analysis/${encodeURIComponent(analysisId)}`),
  setAudio: (id: string, audio: AudioLevel, scope: EditScope,revision:number|undefined,audioTrack?:number,scopeReviewToken?:string) =>
    send<Snapshot & {result:{message:string}}>(`/api/items/${id}/audio`,{method:'POST',headers:editorialHeaders(revision),body:JSON.stringify({audio,scope,audioTrack,scopeReviewToken})}),

  distribution: () => send<Distribution>('/api/distribution'),
  processes: () =>
    send<{
      generatedAt: string
      processes: Array<{
        id: string
        kind: 'ENGINE' | 'MEDIAMTX' | 'OUTPUT'
        channelId: string | null
        pid: number | null
        state: string
        cpuTimeMs: number | null
        memoryBytes: number | null
        details?: Record<string, unknown>
      }>
    }>('/api/processes'),
  hostMetrics: () => send<HostMetricSample>('/api/host-metrics'),
  hostMetricHistory: (hours = 1) => send<{ since: string; retainedDays: number; totalSamples: number; truncated: boolean; samples: HostMetricSample[] }>(`/api/host-metrics/history?hours=${hours}`),
  externalAutomationAudit: () => send<{
    entries: Array<{
      id: string
      timestamp: string
      pgmTimecode: string
      targetDevice: string
      action: string
      latencyMs: number
      executionStatus: 'SUCCESS' | 'FAILED' | 'ERROR_TIMEOUT'
      details?: Record<string, unknown>
      error?: string
    }>
  }>('/api/external/audit'),
  externalDevices: () => send<{ devices: Array<{ id: string; name: string; kind: 'ATEM_SWITCHER' | 'VIDEOHUB_ROUTER' | 'GPIO_RELAY'; host: string; port: number; enabled: boolean; createdAt: string }> }>('/api/external/devices'),
  addExternalDevice: (body: { name: string; kind: 'ATEM_SWITCHER' | 'VIDEOHUB_ROUTER' | 'GPIO_RELAY'; host: string; port: number; enabled: boolean }) => post<{ device: { id: string } }>('/api/external/devices', body),
  updateExternalDevice: (id: string, body: { enabled: boolean }) => send(`/api/external/devices/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }),
  externalCommandRuns: () => send<{ runs: ManualExternalRun[]; uncertainState: string }>('/api/external/commands'),
  acknowledgeExternalCommand: (requestId: string, note: string) => post(`/api/external/commands/${encodeURIComponent(requestId)}/acknowledge`, { note }),
  controlExternalDevice: (id: string, body: { requestId: string; action: 'PING' | 'ROUTE_CROSSPOINT'; source?: number; destination?: number }) => post<{ run: ManualExternalRun; deduplicated: boolean; physicalOutputValidated: false }>(`/api/external/devices/${encodeURIComponent(id)}/control`, body),
  healthEvents: (channelId?: string) => send<{ events: Array<{ id: string; channelId: string | null; component: string; state: string; severity: 'INFO' | 'WARN' | 'CRITICAL'; message: string | null; occurredAt: string; acknowledgedAt: string | null }> }>(`/api/health-events?limit=200${channelId ? `&channelId=${encodeURIComponent(channelId)}` : ''}`),
  acknowledgeHealth: (id: string) => post<{ ok: true }>(`/api/health-events/${id}/ack`, {}),
  schedulerStatus: () => send<{ checkedAt: string; channels: Array<{ channelId: string; rundownId: string | null; rundownDate: string | null; revisionId: string | null; source: 'NONE' | 'LEGACY' | 'PUBLISHED'; mode: 'FINITE' | 'LOOP' | 'OPEN_LIVE' | 'MANUAL_HOLD' | 'WAITING_START' | 'NO_EXECUTION' | 'INVALID_DATE'; reason: string | null; automaticHandover: boolean; nextPlaylist: {state:NextPlaylistRun['state'];targetName:string;targetRevisionId:string;policy:'ONE_REVIEWED_EOS'}|null; activeRule: { name: string; startMinute: number; endMinute: number } | null; endsAtFrames: number | null; minutesRemaining: number | null; coverageMinutes: number | null; coverageHours: number | null; targetHours: number; coverageReady: boolean }> }>('/api/scheduler/status'),
  nextPlaylist:(channelId:string)=>send<NextPlaylistStatus>(`/api/channels/${encodeURIComponent(channelId)}/next-playlist`),
  publishedContinuity:(channelId:string)=>send<PublishedContinuityStatus>(`/api/channels/${encodeURIComponent(channelId)}/published-continuity`),
  schedulePublication:(channelId:string)=>send<SchedulePublicationStatus>(`/api/channels/${encodeURIComponent(channelId)}/schedule-publication`),
  schedulePublicationReview:(channelId:string,daysAhead:number,maxItems:number)=>send<{review:SchedulePublicationReview}>(`/api/channels/${encodeURIComponent(channelId)}/schedule-publication/review?daysAhead=${daysAhead}&maxItems=${maxItems}`),
  setSchedulePublication:(channelId:string,body:{action:'ENABLE'|'DISABLE';version:number;daysAhead?:number;maxItems?:number;reviewToken?:string})=>post(`/api/channels/${encodeURIComponent(channelId)}/schedule-publication`,body),
  publishedContinuityReview:(channelId:string,maxLateMinutes:number)=>send<{review:PublishedContinuityReview}>(`/api/channels/${encodeURIComponent(channelId)}/published-continuity/review?maxLateMinutes=${maxLateMinutes}`),
  setPublishedContinuity:(channelId:string,body:{action:'ENABLE'|'DISABLE';version:number;maxLateMinutes?:number;reviewToken?:string})=>post(`/api/channels/${encodeURIComponent(channelId)}/published-continuity`,body),
  nextPlaylistReview:(channelId:string,revisionId:string)=>send<{review:NextPlaylistReview;nativeEngine:boolean}>(`/api/channels/${encodeURIComponent(channelId)}/next-playlist/review?revisionId=${encodeURIComponent(revisionId)}`),
  setNextPlaylist:(channelId:string,body:{action:'QUEUE'|'CANCEL'|'RECONCILE';requestId:string;sourceRevisionId?:string;targetRevisionId?:string;reviewToken?:string})=>post<{id:string;state:NextPlaylistRun['state'];nativeProgramConfirmed?:boolean;physicalOutputValidated?:false;replayed?:false}>(`/api/channels/${encodeURIComponent(channelId)}/next-playlist`,body),
  n1Status: () => send<{ configured: boolean; peer: string | null; reachable: boolean; latencyMs: number | null; checkedAt: string; error: string | null }>('/api/n1/status'),
  haStatus:()=>send<HaReplicationStatus>('/api/ha/status'),
  timeline: (channelId: string) => send<{ channelId: string; nowFrames: number; items: Array<{ itemId: string; title: string; type: string; start: number; end: number; duration: number; state: 'ON_AIR' | 'UP_NEXT' | 'AIRED' }> }>(`/api/channels/${encodeURIComponent(channelId)}/timeline`),
  scteCues: (channelId?: string) => send<{ cues: Array<{ id: string; channelId: string | null; state: string; message: string | null; occurredAt: string }> }>(`/api/cues/scte${channelId ? `?channelId=${encodeURIComponent(channelId)}` : ''}`),
  graphicLayers: (channelId: string) => send<{channelId:string;channelName:string;rate:{num:number;den:number};nowFrames:number;simulated:boolean;secondaryEvents:import('@rplayout/protocol').SecondaryEvent[];layers:Record<import('@rplayout/protocol').GraphicsLayer,import('@rplayout/protocol').GraphicLayerState>}>(`/api/v1/graphics/layers?channelId=${encodeURIComponent(channelId)}`),
  triggerGraphicLayer: (channelId:string,layer:import('@rplayout/protocol').GraphicsLayer,values:{action:'SHOW'|'HIDE';payload:Record<string,unknown>;durationFrames?:number}) => post('/api/v1/graphics/layers/'+layer+'/trigger',{channelId,...values}),
  requestScte: (channelId:string) => post<{spliceEventId:number;status:string;physicalInsertionConfirmed:boolean}>('/api/v1/scte/splice-insert',{channelId,prerollMs:4000,durationSeconds:30}),
  secondaryEvents: (itemId:string) => send<ItemAutomationState>(`/api/items/${itemId}/secondary-events`),
  addSecondaryEvent: (itemId:string,event:Omit<import('@rplayout/protocol').SecondaryEvent,'id'|'channelId'|'rundownItemId'>,revision:number) => send<ItemAutomationState>(`/api/items/${itemId}/secondary-events`,{method:'POST',headers:editorialHeaders(revision),body:JSON.stringify(event)}),
  removeSecondaryEvent: (itemId:string,eventId:string,revision:number) => send<ItemAutomationState>(`/api/items/${itemId}/secondary-events/${eventId}`,{method:'DELETE',headers:editorialHeaders(revision)}),
  secondaryEventRuns: (channelId:string) => send<{runs:Array<{id:string;itemId:string;revisionId:string|null;eventId:string;mode:string;state:string;frames:number;createdAt:string;error:string|null}>;uncertainState:string}>(`/api/channels/${channelId}/secondary-event-runs`),
  fireSecondaryEvent: (channelId:string,eventId:string) => post(`/api/channels/${channelId}/secondary-events/${eventId}/fire`,{}),

  autoFill: (
    rundownId: string,
    body: {
      minutes?: number
      proposalId?:string
      avoidHours?: number
      preview?: boolean
      insertAtMinute?: number
      insertAfterItemId?: string
      insertAtOrder?: number
    },
    revision:number|undefined,
  ) => send<import('./types.js').FillResponse>(`/api/rundowns/${rundownId}/autofill`,{method:'POST',headers:body.preview&&revision===undefined?{}:editorialHeaders(revision),body:JSON.stringify(body)}),

  asRun: (
    channelId: string,
    options?: { since?: string; until?: string; limit?: number },
  ) => {
    const params = new URLSearchParams()
    if (options?.since) params.set('since', options.since)
    if (options?.until) params.set('until', options.until)
    if (options?.limit) params.set('limit', String(options.limit))
    const qs = params.toString() ? `?${params.toString()}` : ''
    return send<{ entries: AsRunEntry[]; since?: string; until?: string | null }>(
      `/api/channels/${encodeURIComponent(channelId)}/asrun${qs}`,
    )
  },

  channelRundowns: (channelId: string, date?: string) =>
    send<{
      rundowns?: Rundown[]
      rundown?: Rundown | null
      view?: RundownView | null
    }>(
      `/api/channels/${encodeURIComponent(channelId)}/rundowns${
        date ? `?date=${encodeURIComponent(date)}` : ''
      }`,
    ),

  createChannelRundown: (
    channelId: string,
    body: { date: string; name?: string; copyFromRundownId?: string },
  ) =>
    post<{ rundown: any; view: RundownView }>(
      `/api/channels/${encodeURIComponent(channelId)}/rundowns`,
      body,
    ),

  loadChannelRundown: (channelId: string, rundownId: string) =>
    post<Snapshot>(`/api/channels/${encodeURIComponent(channelId)}/load-rundown`, { rundownId }),

  rules: (channelId: string) =>
    send<{ rules: ScheduleRule[] }>(`/api/channels/${channelId}/rules`),
  addRule: (
    channelId: string,
    body: {
      name: string
      weekdays: string
      startMinute: number
      endMinute: number
      categories: string[]
      avoidHours: number
    },
  ) => post<{ rule: ScheduleRule }>(`/api/channels/${channelId}/rules`, body),
  /** "Estou com este monitor aberto." O engine só codifica enquanto há aviso. */
  watching: (channelId: string, bus: 'pvw' | 'mon') =>
    post<{ ok: true; available?: boolean }>(`/api/channels/${channelId}/watching`, { bus }),
  qcLiveInspection:(channelId:string,viewerId:string,sourceRef:string,watching:boolean)=>
    post<{ok:true;rendition:'qc-encoded';profileFromSource:true;maxWidth:number;maxHeight:number;maxFps:number;maxBitrateKbps:number}>(`/api/channels/${channelId}/qc/inspection`,{viewerId,sourceRef,watching}),
  setWatching: (channelId: string, bus: 'pvw' | 'mon', watching = true) =>
    post<{ ok: true; available?: boolean }>(`/api/channels/${channelId}/watching`, { bus, watching }),

  playlists: () =>
    send<{ playlists: PlaylistFile[]; today: string | null; date: string }>('/api/playlists'),
  playlistEntries: (path: string) =>
    send<{ entries: PlaylistEntryView[] }>(
      `/api/playlists/entries?path=${encodeURIComponent(path)}`,
    ),
  loadPlaylist: (rundownId: string, path: string, replace: boolean, scheduledDate:string|undefined,revision:number|undefined) =>
    send<Snapshot & { loaded: number; skipped: number }>(
      `/api/rundowns/${rundownId}/playlist`,
      {method:'POST',headers:editorialHeaders(revision),body:JSON.stringify({path,replace,scheduledDate})},
    ),
  /** Lista arrastada para a janela: vai o conteúdo, porque não há caminho. */
  loadPlaylistText: (rundownId: string, text: string, replace: boolean, scheduledDate:string|undefined,revision:number|undefined) =>
    send<Snapshot & { loaded: number; skipped: number }>(
      `/api/rundowns/${rundownId}/playlist`,
      {method:'POST',headers:editorialHeaders(revision),body:JSON.stringify({text,replace,scheduledDate})},
    ),
  playlistVersions: (rundownId: string) =>
    send<{ versions: Array<{ id: string; sourceName: string; mode: 'APPEND' | 'PUBLISH_NEXT'; loaded: number; skipped: number; scheduledDate: string | null; publishedAt: string }> }>(
      `/api/rundowns/${rundownId}/playlist-versions`,
    ),

  categories: () => send<{ categories: Categoria[] }>('/api/categories'),
  setCategoryColor: (id: string, color: string) =>
    send<{ ok: true }>(`/api/categories/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify({ color }),
    }),
  removeCategory: (id: string) =>
    send<{ ok: true; soltos: number }>(`/api/categories/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  removeRule: (id: string) => send<{ ok: true }>(`/api/rules/${id}`, { method: 'DELETE' }),
  updateRule: (id: string, body: Partial<{ name: string; weekdays: string; startMinute: number; endMinute: number; categories: string[]; avoidHours: number }>) =>
    send<{ rule: ScheduleRule }>(`/api/rules/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  autoFillDay: (rundownId: string,revision:number|undefined,body:{preview?:boolean;proposalId?:string}={}) =>
    send<import('./types.js').FillResponse>(
      `/api/rundowns/${rundownId}/autofill-day`,
      {method:'POST',headers:body.preview&&revision===undefined?{}:editorialHeaders(revision),body:JSON.stringify(body)},
    ),

  graphics: (channelId: string) =>
    send<{ templates: GraphicTemplate[] }>(`/api/graphics?channelId=${channelId}`),
  showGraphic: (channelId: string, templateId: string, values: Record<string, string>) =>
    post<Snapshot>(`/api/channels/${channelId}/graphic`, { templateId, values }),
  hideGraphic: (channelId: string) =>
    send<Snapshot>(`/api/channels/${channelId}/graphic`, { method: 'DELETE' }),

  setSlate: (channelId: string, templateId: string | null) =>
    send<{ ok: true }>(`/api/channels/${channelId}/slate`, {
      method: 'PATCH',
      body: JSON.stringify({ templateId }),
    }),

  itemGraphics: (itemId: string,revision?:number) => send<ItemAutomationState>(`/api/items/${itemId}/graphics`,revision===undefined?undefined:{headers:editorialHeaders(revision)}),
  addItemGraphic: (
    itemId: string,
    templateId: string,
    values: Record<string, string>,
    atSeconds: number,
    revision:number,
  ) => send<ItemAutomationState>(`/api/items/${itemId}/graphics`,{method:'POST',headers:editorialHeaders(revision),body:JSON.stringify({templateId,values,atSeconds})}),
  removeItemGraphic: (id: string,revision:number) =>
    send<ItemAutomationState>(`/api/item-graphics/${id}`, { method: 'DELETE',headers:editorialHeaders(revision) }),

  addGuest: (channelId: string, label: string) =>
    post<{ streamKey: string; publishUrl: string }>(`/api/channels/${channelId}/guests`, { label }),
  removeGuest: (id: string) => send<{ ok: true }>(`/api/guests/${id}`, { method: 'DELETE' }),

  addDestination: (channelId: string, name: string, url: string) =>
    post<{ ok: true }>(`/api/channels/${channelId}/destinations`, { name, url }),
  setDestination: (id: string, body: { enabled?: boolean }) =>
    send<{ ok: true }>(`/api/destinations/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  removeDestination: (id: string) =>
    send<{ ok: true }>(`/api/destinations/${id}`, { method: 'DELETE' }),

  undo: (rundownId: string,revision:number|undefined) => send<Snapshot & { label: string }>(`/api/rundowns/${rundownId}/undo`, {method:'POST',headers:editorialHeaders(revision),body:'{}'}),
  redo: (rundownId: string,revision:number|undefined) => send<Snapshot & { label: string }>(`/api/rundowns/${rundownId}/redo`, {method:'POST',headers:editorialHeaders(revision),body:'{}'}),

  group: (rundownId: string, itemIds: string[],revision:number|undefined) =>
    send<Snapshot>(`/api/rundowns/${rundownId}/blocks`, {method:'POST',headers:editorialHeaders(revision),body:JSON.stringify({itemIds})}),
  ungroup: (blockId: string,revision:number|undefined) => send<Snapshot>(`/api/blocks/${blockId}/ungroup`, {method:'POST',headers:editorialHeaders(revision),body:'{}'}),

  transport: (
    channelId: string,
    action: 'take' | 'cue' | 'stop' | 'park' | 'seek',
    target?: { itemId?: string | null; assetId?: string | null; bus?: 'pgm' | 'pvw'; frames?: number },
  ) => post<Snapshot>(`/api/channels/${channelId}/transport`, { action, ...target }),
}
