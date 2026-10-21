import { and, eq } from 'drizzle-orm'
import { randomUUID,createHash } from 'node:crypto'
import {captureGraphicDisplay} from './domain/graphic-composition.js'
import {primaryReturnMediaAdapter} from './domain/ha-return-local-media.js'
import {HA_GRAPHIC_RECEIPT_PREFIX,readHaGraphicComposition} from './domain/ha-graphic-receipts.js'
import {GraphicRecoveryIncident} from './domain/graphic-recovery-incident.js'
import {
  framesSinceMidnight,
  secondsToFrames,
  suggestedBitrateKbps,
  renderTemplate,
  type Channel,
  type GraphicTemplate,
  type ItemGraphic,
  type MediaAsset,
  type PreviewTarget,
} from '@rplayout/protocol'
import type Database from 'better-sqlite3'
import { openDatabase, type Db } from './db/client.js'
import { assetMap, getChannel, getRundown, listChannels, listItems } from './db/repo.js'
import { channelCadenceConversions, graphicTemplates, itemGraphics, rundownItems, operatorDecisions, secondaryEvents } from './db/schema.js'
import { buildView, type RundownView } from './domain/plan.js'
import {readEditorialState,editorialView} from './domain/editorial-state.js'
import { rundownClock, rundownFrames } from './domain/rundown-clock.js'
import { MediaWorkflow } from './domain/media-workflow.js'
import { simulateMeter, SILENCE, type MeterReading } from './domain/meters.js'
import { SimulatedTransport, type Transport } from './domain/transport.js'
import { EngineTransport,EngineCommandRejected, type EnginePlaylistBoundary } from './domain/engine.js'
import { PlaylistBoundaryLedger, inspectBoundary, requireBoundaryReview, boundaryProcessesGone, type BoundaryPlan, type BoundaryRun } from './domain/playlist-boundary.js'
import { PublishedContinuity } from './domain/published-continuity.js'
import { SchedulePublication,schedulePlannerBinary } from './domain/schedule-publication.js'
import { hostname } from 'node:os'
import { AsRun } from './domain/asrun.js'
import { ensureDefaultGraphics, Graphics,fitGraphicViewport } from './domain/graphics.js'
import {GraphicCommandLedger} from './domain/graphic-command-ledger.js'
import { History } from './domain/history.js'
import {ConcurrencyManager} from './domain/concurrency.js'
import {InterruptionCommands} from './domain/interruption-commands.js'
import {EditorialVersions} from './db/editorial-revisions.js'
import {
  ENGINE_BINARY,
  HOST_GUARD_BINARY,
  ENGINE_BITRATE_KBPS_EXPLICITO,
  ENGINE_OUTPUTS,
  MEDIAMTX_BINARY,
  MEDIAMTX_BIND,
  DEVICES_BINARY,
  MEDIAMTX_LOGLEVEL,
  BACKUP_DIR,
  MEDIA_ROOT,
  PROBE_BINARY,
  PROXY_BINARY,
  AUDIO_ANALYSIS_BINARY,
  RELAY_BINARY,
  THUMBNAIL_DIR,
  CONTINUITY_CACHE_MAX_BYTES,
} from './config.js'
import { MediaMtx, channelPaths, type ChannelPaths } from './domain/mediamtx.js'
import { Ingest } from './domain/ingest.js'
import { Sources } from './domain/sources.js'
import {
  encodeProfile,
  ensureManagedOutputs,
  listOutputs,
  toEngineProfile,
} from './domain/outputs.js'
import { RelaySupervisor } from './domain/relays.js'
import { destinations, guestKeys } from './db/schema.js'
import { existsSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'
import { ContinuityCache } from './domain/continuity-cache.js'
import { PgmProbe } from './domain/pgm-probe.js'
import { activeOperationalPlaylist, readOperationalPayload } from './domain/operational-playlist.js'
import { Checkpoints, type ChannelCheckpoint } from './domain/checkpoints.js'
import {resolveLiveProgramBinding} from './domain/live-program-binding.js'
import {assertPersistedLiveReplacementReceipt,unresolvedNativeReplacementJournals,type NativeLiveReplacementContext} from './domain/native-live-replacement-ledger.js'
import {createNativeReplacementSession,resolveStoppedPredecessorJournals,type NativeReplacementActor,type NativeReplacementAuthorization,type NativeReplacementRuntimePort,type NativeReplacementSession} from './domain/native-live-replacement-session.js'
import {assertProgramTrim} from './domain/program-trim.js'
import {programDurationFrames} from '@rplayout/protocol'
import {ExecutionOwnership,type ExecutionLease} from './domain/execution-ownership.js'
import {endPreviousPgmObservation} from './domain/pgm-signal-incidents.js'
import {persistRuntimeSignalIncidents,runtimeObservationSnapshot,RuntimeIncidentRecorder} from './domain/runtime-signal-incidents.js'
import {DistributionOwnership} from './domain/distribution-ownership.js'
import {HostDistributionFence} from './domain/host-distribution-fence.js'
import {LocalRestoredEngineGenerations} from './domain/local-restored-engine-lease.js'
import { Interruptions } from './domain/interruptions.js'
import { applyQcDecisions } from './domain/qc-workflow.js'
import { HostMetrics } from './domain/host-metrics.js'
import {captureOperationalMetrics} from './domain/operational-metrics.js'
import {operationalMetricLabels} from './domain/operational-metric-labels.js'
import {ProcessMetrics} from './domain/process-metrics.js'
import { IntegrationOutbox } from './domain/integration-outbox.js'
import { SecondaryEventLedger,SecondaryEventUncertain } from './domain/secondary-event-ledger.js'
import {secondaryGraphicWindow} from './domain/secondary-graphic-window.js'
import { emitIntegrationEvent } from './domain/integrations.js'
import { configuredContingencyAssets, prepareContingencyPlaylist } from './domain/contingency-playlist.js'
import { ScheduledDeviceAutomation } from './domain/device-automation.js'
import {AudioMixAnalysis} from './domain/audio-mix-analysis.js'
import {ConfigurationChanges} from './domain/configuration-changes.js'
import type {InsertionInput} from './domain/operational-insertion.js'
import type {OperationalPayload} from './domain/operational-playlist.js'
import {HaReplication,haOptions} from './domain/ha-replication.js'
import {appendHaHistory,queryHaHistoryImport} from './domain/ha-history-import.js'
import {preserveHaHistoryVariants,queryHaHistoryVariant} from './domain/ha-history-variant.js'
import type {HaLeaseClient} from './domain/ha-witness.js'
import {captureHaSnapshot} from './domain/ha-snapshot.js'
import {QcLiveInspection} from './domain/qc-live-inspection.js'
import {CollaborativeEditError} from './domain/collaborative-edit.js'

/**
 * Runtime de um canal. Guarda a grade já resolvida em cache porque o
 * transporte precisa dela de forma síncrona, a cada tick, e recalcular do
 * banco vinte vezes por segundo seria desperdício.
 */
/** O fim do endereço, que é a parte que identifica a saída para quem opera. */
const short = (url: string): string => url.split('/').slice(-2).join('/')

/**
 * Quanto tempo um monitor sobrevive sem ninguém dizendo que está olhando.
 *
 * Folgado de propósito: recarregar a página não pode derrubar e resubir a
 * codificação, porque subir custa abrir pipeline e reconectar ao servidor de
 * mídia -- piscar isso a cada F5 seria pior do que deixar ligado.
 */
const MONITOR_OCIOSO_MS = 20_000
const MONITOR_REAFIRMAR_MS = 5_000
const TELEMETRY_REFRESH_MIN_MS = 1_000
const CHECKPOINT_IDLE_REWRITE_MS = 30_000

export class ChannelRuntime {
  private lastIncidentCapture=0
  private incidentRecorder:RuntimeIncidentRecorder|null=null
  private recordNativeObservation():void{
    if(this.closed||!this.executionLease||!this.transport)return
    const recorder=this.incidentRecorder??=new RuntimeIncidentRecorder(this.db,this.executionLease)
    recorder.record(()=>runtimeObservationSnapshot(this,()=>operationalMetricLabels(this.db,this.channel.id,undefined,this.executionView)))
  }
  reconcileSignalIncidents(admissionOnly=false,path?:ChannelPaths):void{
    if(!this.executionLease)return
    if(!admissionOnly&&Date.now()-this.lastIncidentCapture<1000)return
    const capture=()=>runtimeObservationSnapshot(this,()=>operationalMetricLabels(this.db,this.channel.id,path,this.executionView))
    if(admissionOnly)persistRuntimeSignalIncidents(this.db,this.executionLease,capture(),undefined,true)
    else (this.incidentRecorder??=new RuntimeIncidentRecorder(this.db,this.executionLease)).persist(capture)
    if(!admissionOnly)this.lastIncidentCapture=Date.now()
  }
  get executionOwnerId():string|null{return this.executionLease?.identity.id??null}
  readonly qcInspection:QcLiveInspection
  view: RundownView | null = null
  operationalView: RundownView | null = null
  operationalRevision: { id: string; revision: number; publishedAt: string } | null = null
  /** Editorial edits never become execution edits once a revision is active. */
  private unconfirmedInsertionView:RundownView|null=null
  get executionView(): RundownView | null { return this.unconfirmedInsertionView ?? this.operationalView ?? (this.view?.rundown.publicationRequired ? null : this.view) }
  readonly transport: Transport
  /** Grafismo no ar deste canal. */
  readonly graphics: Graphics
  /** O que realmente foi ao ar. */
  readonly asRun: AsRun
  /** Acervo em memória: o medidor do preview precisa dele a cada tick. */
  private assets: Map<string, MediaAsset> = new Map()
  /** Grafismo preso a item, por item, e as artes que eles usam. */
  private cues: Map<string, ItemGraphic[]> = new Map()
  private templates: Map<string, GraphicTemplate> = new Map()
  private executionCues: Map<string, ItemGraphic[]> = new Map()
  private executionTemplates: Map<string, GraphicTemplate> = new Map()
  /** Qual item o disparo automático está acompanhando e o que já disparou. */
  private cuesFor: string | null = null
  /** Se a apresentação técnica está no ar por conta do canal vazio. */
  private slateUp = false
  private idleSlateIdentity:string|null=null
  private idleSlateLayer:import('@rplayout/protocol').GraphicsLayer|null=null
  private idleSlateGeneration=0
  private attemptedIdleSlate:string|null=null

  private fired = new Set<string>()
  private automaticGraphicsPending=false
  private attemptedGraphicExpiry:string|null=null
  private phase = 0
  private lastCheckpointAt = 0
  private recovering = false
  private readonly boundaryOwner = JSON.stringify({host:hostname(),pid:process.pid,boot:randomUUID()})
  private boundaryPins: MediaAsset[] = []
  private executionId: string | undefined
  graphicContext():import('./domain/graphic-recovery-incident.js').GraphicRecoveryContext|null {
    const item=this.transport.state().onAir
    return item&&this.executionId?{executionId:this.executionId,revisionId:this.operationalRevision?.id??null,itemId:item.itemId,startedAt:item.startedAt}:null
  }
  private executionItemId: string | null = null
  private simulatedStartedAt: number | null = null
  private graphicsExecutionId: string | undefined
  private restoreSecondaryGraphics = false
  private graphicRestoreReceiptId:string|null=null
  private graphicRecoveryIncident:GraphicRecoveryIncident|null=null
  private closed = false
  private loadEpoch = 0
  private pendingRecovery: ChannelCheckpoint | null = null
  private recoveryAttempt:ChannelCheckpoint|null=null
  private recoveryRetryAt=0
  private recoveryRetryCount=0
  /** Empty/refused recovery is not an operator STOP and must not erase evidence. */
  private recoveryCheckpointProtected=false
  recoveryError: string | null = null
  emergencyOverlay = false
  private contingencyOrigin: ChannelCheckpoint['contingency'] | null = null
  private pendingContingency: Promise<void> | null = null
  private pendingTelemetryRefresh: Promise<RundownView | null> | null = null
  private lastTelemetryRefreshAt = 0
  private lastCheckpointKey: string | null = null
  private lastCheckpointWrittenAt = 0
  get contingencyPending(): boolean { return this.pendingContingency !== null }
  get contingencyState() {
    return this.contingencyOrigin ? { ...this.contingencyOrigin, active: this.transport.state().rundownId === this.contingencyOrigin.loopRundownId } : null
  }
  public lastManualEditAt = 0

  markManualEdit(): void {
    this.lastManualEditAt = Date.now()
  }

  constructor(
    /**
     * O canal deste runtime. Não é `readonly` porque campos de operação
     * mudam com o canal no ar -- a arte de apresentação técnica, por exemplo --
     * e recriar o runtime para lê-los subiria um segundo engine.
     */
    public channel: Channel,
    private readonly db: Db,
    /** Para onde este canal sai. Vem do servidor local quando ele existe. */
    engineOutputs: readonly string[],
    /** Para onde o preview sai. Nulo deixa o canal sem barramento de preview. */
    previewOutput: string | null = null,
    /**
     * Quais monitores este canal tem de verdade.
     *
     * Sem servidor de mídia local não há caminho para publicar, então não há
     * monitor nenhum -- e a interface, que não sabia disso, continuava pedindo
     * para olhar. O engine respondia `não existe monitor chamado mon` a cada
     * dois segundos, e o operador via uma janela preta sem explicação.
     */
    private readonly monitores: ReadonlySet<'pvw' | 'mon'> = new Set(['pvw', 'mon']),
    /**
     * Por que cada monitor ausente está ausente.
     *
     * Um texto por barramento, porque as causas pedem coisas diferentes: perfil
     * desligado se resolve em Distribuição, servidor de mídia ausente se resolve
     * na instalação. Um alerta que junta as duas manda procurar no lugar errado.
     */
    private readonly motivoSemMonitor: ReadonlyMap<'pvw' | 'mon', string> = new Map(),
    private readonly continuityCache: ContinuityCache | null = null,
    private readonly checkpoints: Checkpoints | null = null,
    private readonly mediaWorkflow: MediaWorkflow | null = null,
    readonly interruptions: Interruptions | null = null,
    private readonly configurationChanges:ConfigurationChanges|null=null,
    private readonly interruptionCommands:InterruptionCommands|null=null,
    private readonly authority:HaLeaseClient|null=null,
    private readonly qcPreviewOutput:string|null=null,
    private readonly executionLease:ExecutionLease|null=null,
    private readonly distributionOwnership:DistributionOwnership|null=null,
    private readonly localRestorePreparation:{host:HostDistributionFence;assertAdmission:()=>void}|null=null,
  ) {
    if(ENGINE_BINARY&&!this.executionLease)throw new Error('Engine nativo exige posse durável do canal antes de abrir o processo.')
    if(this.localRestorePreparation&&(!ENGINE_BINARY||!this.executionLease||!this.distributionOwnership||this.authority))throw new Error('Preparação restaurada local exige engine/posse/distribuição próprios, sem autoridade HA.')
    const localRestoredLease=this.localRestorePreparation?new LocalRestoredEngineGenerations(this.executionLease!,this.distributionOwnership!,this.localRestorePreparation.host,()=>this.transport instanceof EngineTransport?this.transport.processId():null,this.localRestorePreparation.assertAdmission):null
    const eventLedger = new SecondaryEventLedger(db,channel.id)
    eventLedger.reconcileGraphicReceipts()
    eventLedger.reportUnconfirmed()
    // Sem engine configurado, a grade inteira continua operável no simulado:
    // é o que permite montar programação numa máquina sem GStreamer.
    this.transport = ENGINE_BINARY
      ? new EngineTransport(channel, () => this.executionView, (id) => this.assets.get(id) ?? null, {
          binary: ENGINE_BINARY,
          onSignalObservation:()=>this.recordNativeObservation(),
          assertExecutionOwned:()=>{this.executionLease?.assertOwned();this.distributionOwnership?.assertOwned()},
          beforeProcessStart:token=>this.executionLease?.beforeSpawn(token),
          onProcessExited:(pid,token)=>this.executionLease?.exited(pid,token),
          executionIdentity: () => this.operationalRevision?.id ?? null,
          executionOccurrenceId:()=>this.executionId??null,
          onPlaylistEnd: itemId => this.resolvePlaylistBoundary(itemId),
          onPreparePlaylistEnd: () => this.preparePlaylistBoundaryAhead(),
          canRecoverProgram:()=>!this.interruptionCommands?.blockedReason(this.channel.id) && this.configurationChanges?.canRecover(this.channel.id)!==false && !new PlaylistBoundaryLedger(this.db,this.channel.id).list().some(run=>['PREPARING','SWITCHING','UNCERTAIN'].includes(run.state)),
          canRestartEngine:()=>this.executionLease?.canSpawn()!==false&&this.distributionOwnership?.owns()!==false&&!this.interruptionCommands?.blockedReason(this.channel.id) && this.configurationChanges?.canRecover(this.channel.id)!==false,
          canStartProgram:()=>!this.interruptionCommands?.blockedReason(this.channel.id) && this.configurationChanges?.canRecover(this.channel.id)!==false,
          onProcessStarted:(pid,token)=>{if(pid!==null)this.executionLease?.spawned(pid,token);this.configurationChanges?.trackEngine(this.channel.id,pid)},
          onTakeConfirmed: (itemId, position, recovered, previous) => {
            if (this.closed) return
            if(recovered||this.recovering)this.recoveryError=null
            this.pendingRecovery=null;this.recoveryAttempt=null;this.recoveryRetryAt=0;this.recoveryRetryCount=0
            this.recoveryCheckpointProtected=false
            if (!((recovered || this.recovering) && this.executionId)) {this.executionId = randomUUID();this.restoreSecondaryGraphics=false}
            this.executionItemId = itemId
            if (this.contingencyOrigin && this.transport.state().rundownId !== this.contingencyOrigin.loopRundownId) this.contingencyOrigin = null
            if (previous) this.asRun.noteExit(previous.itemId,previous.reason,previous.frames)
            // Persist execution identity before any timed external event runs.
            this.checkpoint(true)
            // A periodic poll can miss VT -> live -> VT between two ticks.
            // Commit every confirmed TAKE to the same serialized as-run queue.
            void this.asRun.follow(itemId, this.executionView, this.operationalRevision?.id ?? null, position, true)
              .catch((error: unknown) => { this.recoveryError = 'Falha no registro de execução: ' + (error instanceof Error ? error.message : String(error)) })
          },
          onRecoveryRejected:(attempt,error)=>{
            const saved=this.recoveryAttempt
            if(saved&&saved.rundownId===attempt.rundownId&&saved.itemId===attempt.itemId&&saved.elapsed===attempt.frames)this.rejectRecovery(saved,error)
          },
          onHeldRecoveryConfirmed:async(attempt,proof)=>{
            const saved=this.checkpoints?.read(this.channel.id)
            if(!saved?.programHold||saved.rundownId!==attempt.rundownId||saved.itemId!==attempt.itemId||saved.elapsed!==attempt.frames||JSON.stringify(saved.programTrim)!==JSON.stringify(attempt.programTrim)||this.recovering||this.pendingRecovery)throw new Error('Watchdog pausado sem checkpoint/contexto correspondente; cursor preservado.')
            this.recoveryAttempt=saved;this.recoveryCheckpointProtected=true;this.recovering=true
            try{await this.commitHeldRecovery(saved,proof)}
            catch(error){this.recoveryError='Recuperação pausada do watchdog inconclusiva: '+(error instanceof Error?error.message:String(error));throw error}
            finally{this.recovering=false}
          },
          onStopDurable:proof=>this.resolveReplacementJournalsAfterStop(proof),
          onStopConfirmed:()=>{this.pendingRecovery=null;this.recoveryAttempt=null;this.recoveryRetryAt=0;this.recoveryRetryCount=0;this.recoveryCheckpointProtected=false;this.executionLease?.acknowledgeStoppedPredecessor()},
          onProgramCleared: (reason, position) => {
            if (this.closed) return
            if(reason==='STOP')this.recoveryCheckpointProtected=false
            if(reason==='STOP')this.executionLease?.acknowledgeStoppedPredecessor()
            if (reason === 'STOP') this.contingencyOrigin = null
            void this.asRun.finish(reason, position)
              .catch((error: unknown) => { this.recoveryError = 'Falha no registro de saída de PGM: ' + (error instanceof Error ? error.message : String(error)) })
          },
          onLivePriority: event => {
            this.db.insert(operatorDecisions).values({ id: randomUUID(), rundownId: event.rundownId, itemId: event.itemId, kind: `LIVE_PRIORITY_${event.kind}`, payload: { ...event, revisionId: this.operationalRevision?.id ?? null }, actorUsername: '@automation', createdAt: event.occurredAt }).run()
            if (event.kind === 'CONFIRMED') {
              this.asRun.noteExit(event.previousItemId, 'LIVE_PRIORITY', event.previousFrames)
              const entry = this.executionView?.items.find(candidate => candidate.item.id === event.previousItemId)
              if (entry) this.interruptions?.record(channel.id, event.rundownId, this.operationalRevision?.id ?? null, entry, event.previousFrames)
            }
          },
          outputs: engineOutputs,
          holdProgramOutputs:Boolean(localRestoredLease),
          fenceLease:this.authority?async(owner,nonce)=>{
            this.executionLease?.assertOwned()
            const grant=await this.authority!.obtain(channel.id,owner,nonce)
            this.executionLease?.assertOwned()
            return grant
          }:localRestoredLease?(owner,nonce)=>localRestoredLease.grant(owner,nonce):undefined,
          preview: previewOutput,
          qcPreview: qcPreviewOutput,
          // O padrão sai do formato do canal, não de um número fixo: 4 Mbps
          // eram folgados num 480p30 e pobres num 1080p50, que tem oito vezes
          // mais pixel por segundo -- e imagem pobre com bloco em movimento de
          // câmera foi o que o operador viu. `RPLAYOUT_ENGINE_BITRATE` ainda
          // manda, para quem tem motivo para mandar; cada saída pode ter o seu.
          bitrateKbps:
            ENGINE_BITRATE_KBPS_EXPLICITO ??
            suggestedBitrateKbps(channel.width, channel.height, channel.rate),
        })
      : new SimulatedTransport(channel.id, () => this.executionView)

    this.qcInspection=new QcLiveInspection(()=>{
      const preview=this.transport.state().preview
      return preview?.kind==='SOURCE'?preview.source:null
    },async(source,on,authorize)=>{
      if(!(this.transport instanceof EngineTransport) || !this.qcPreviewOutput)throw new Error('Inspeção ao vivo em qualidade exige engine e servidor de mídia ativos.')
      await this.transport.qcMonitor(source,on,authorize)
    })

    const deviceAutomation = new ScheduledDeviceAutomation(db)
    this.graphics = new Graphics(channel, this.transport, {
      template:id=>this.executionTemplates.get(id),
      remainingDurationFrames:event=>{
        const state=this.transport.state(),onAir=state.onAir
        if(!onAir||!this.executionId)throw new Error('Sem ocorrência em PGM para calcular duração do grafismo.')
        const duration=programDurationFrames(onAir,this.executionView?.schedule.items.find(item=>item.id===onAir.itemId)?.duration??0)
        const fired=eventLedger.fireFor({executionId:this.executionId,itemId:onAir.itemId,revisionId:this.operationalRevision?.id??null},event.id)
        const window=secondaryGraphicWindow(event,duration,onAir.elapsed,fired?.frames)
        if(window.expired)throw new Error('Janela do grafismo já encerrada; nenhum SHOW enviado.')
        return window.remainingFrames
      },
      scte:async (message,scte35Hex,scte104Hex)=>emitIntegrationEvent(db,'scte.cue',{...message,scte35Hex,scte104Hex,physicalInsertionConfirmed:false},channel.id),
      device: async event => {
        const state = this.transport.state(), executionId = this.executionId, revisionId = this.operationalRevision?.id
        if (!(this.transport instanceof EngineTransport) || !executionId || !revisionId || !state.onAir || state.onAir.itemId !== event.rundownItemId) throw new Error('Automação externa exige engine nativo, revisão publicada e item confirmado no PGM.')
        await deviceAutomation.execute({ channelId: channel.id, itemId: state.onAir.itemId, eventId: event.id, executionId, revisionId }, event, () =>
          !this.closed && this.executionId === executionId && this.operationalRevision?.id === revisionId && this.transport.state().onAir?.itemId === event.rundownItemId)
      },
      execute:async (event,mode,work) => {
        const state=this.transport.state()
        if (!state.onAir || !this.executionId || event.rundownItemId!==state.onAir.itemId) throw new Error('Evento secundário exige um item confirmado no PGM.')
        const executionId=this.executionId,revisionId=this.operationalRevision?.id??null
        const duration=programDurationFrames(state.onAir,this.executionView?.schedule.items.find(item=>item.id===state.onAir!.itemId)?.duration ?? 0)
        const previous=eventLedger.fireFor({executionId,itemId:state.onAir.itemId,revisionId},event.id)
        const window=secondaryGraphicWindow(event,duration,state.onAir.elapsed,previous?.frames)
        const graphic=!(event.type==='SCTE_TRIGGER'||event.scteConfig||event.type==='DEVICE_AUTOMATION'||event.deviceConfig)
        const authorize=()=>{
          if(this.closed||this.emergencyOverlay||this.emergencyCommandPending||this.executionId!==executionId||(this.operationalRevision?.id??null)!==revisionId||this.transport.state().onAir?.itemId!==event.rundownItemId)throw new Error('Execução mudou ou emergência ativa; grafismo automático não enviado.')
          if(graphic&&mode==='FIRE'&&window.end!==null&&this.transport.state().onAir!.elapsed>=window.end)throw new Error('Janela do grafismo terminou na fila; SHOW não enviado.')
          if(graphic&&mode==='DISMISS'&&previous?.state!=='EXECUTED')throw new Error('Evento sem FIRE confirmado; retirada automática não enviada.')
        }
        // Restore the whole confirmed composition, never historical SHOWs over
        // a later manual replacement. External effects are never replayed.
        const canRestore=false
        await eventLedger.execute({executionId,itemId:state.onAir.itemId,revisionId,frames:Math.max(0,Math.floor(state.onAir.elapsed))},event,mode,async secondaryRunId => {
          // Persist a refused request too, so the page never reports mere
          // scheduler acceptance or silently retries it after reconnection.
          if (!(this.transport instanceof EngineTransport) && (event.type==='SCTE_TRIGGER' || event.type==='DEVICE_AUTOMATION' || event.deviceConfig)) throw new Error('Automação externa não executada em canal simulado.')
          authorize()
          if(!graphic){await work(authorize);return}
          const key='secondary-'+createHash('sha256').update(JSON.stringify([executionId,event.id,mode,canRestore?this.boundaryOwner:null])).digest('hex')
          let sent=false
          try{
            await new GraphicCommandLedger(db,channel.id).execute({key,context:()=>this.graphicContext(),actorId:null,actorName:'AUTOMATIC',native:state.mode==='NATIVE',...(secondaryRunId?{secondaryRunId}:{}),selection:{action:'SECONDARY_'+mode,event:structuredClone(event),revisionId,executionId,template:structuredClone(this.executionTemplates.get(event.templateId)??null)}},authorize,send=>work(authorize,()=>{send();sent=true}))
          }catch(error){
            const receipt=error instanceof CollaborativeEditError?error.payload.graphicCommand as {state?:string}|undefined:undefined
            if(sent&&receipt?.state==='UNCERTAIN')throw new SecondaryEventUncertain('Grafismo secundário sem confirmação durável.',{cause:error})
            throw error
          }
        },canRestore)
      },
    })
    this.asRun = new AsRun(db, channel, this.transport instanceof EngineTransport ? 'NATIVE' : 'SIMULATED',this.executionLease)
  }

  /** Explicit operator activation, distinct from telemetry/editorial refresh.
   * Recheck inside the native queue, not before a TAKE finishes preparing. */
  activateRundown(rundownId: string): Promise<RundownView | null> {
    const validate = () => {
      if (this.closed) throw new Error('O runtime do canal foi encerrado. Atualize a página.')
      if (this.recovering || this.pendingRecovery || this.contingencyPending || this.contingencyState?.active) throw new Error('Conclua a recuperação ou o retorno da contingência antes de carregar outra grade.')
      const state = this.transport.state(), current = this.executionView?.rundown.id
      if (state.onAir && current !== rundownId) throw new Error('Há um item em PGM. Pare a execução antes de carregar outra grade; publicar outra data não troca o programa no ar.')
      if (state.preview?.kind === 'ITEM' && current !== rundownId) throw new Error('Há um item da grade anterior em CUE. Limpe o CUE antes de carregar outra grade; a seleção não transfere o preview antigo.')
    }
    const work = async () => {
      validate()
      const loaded = await this.load(rundownId, validate)
      validate()
      if (loaded && loaded.rundown.id !== rundownId) throw new Error('Outra seleção substituiu este carregamento. Confira a grade atual antes de repetir.')
      return loaded
    }
    return this.transport instanceof EngineTransport ? this.transport.mutatePlaylist(work) : work()
  }

  async load(rundownId: string, beforeInstall?: () => void): Promise<RundownView | null> {
    const epoch = ++this.loadEpoch
    const editorial=readEditorialState(this.db,rundownId)
    if (!editorial) return null
    const {rundown,items,assets,templates,cues,channel,revision}=editorial
    if (rundown.channelId !== this.channel.id) throw new Error('A grade pertence a outro canal.')

    const decoderAssets = new Map(await Promise.all([...assets.entries()].map(async ([id, asset]) => {
      const cached = this.continuityCache?.pathFor(asset)
      return [id, cached && await this.continuityCache?.verified(asset) ? { ...asset, path: cached } : asset] as const
    })))

    // Grafismo preso a item anda junto com a grade: recarregar a grade e
    // deixar as deixas velhas em memória é como um crédito antigo volta ao ar.
    const editorialTemplates = new Map(templates.map((row) => [row.id, row]))
    // O canal é relido do banco: campos de operação mudam com o canal no ar, e
    // a cópia em memória não pode ficar para trás.
    const editorialCues = new Map<string, ItemGraphic[]>()
    for (const row of cues) {
      const cue = row.item_graphics
      const list = editorialCues.get(cue.itemId) ?? []
      list.push({
        ...cue,
        templateName: editorialTemplates.get(cue.templateId)?.name ?? 'arte removida',
      })
      editorialCues.set(cue.itemId, list)
    }
    for (const list of editorialCues.values()) list.sort((a, b) => a.atSeconds - b.atSeconds)
    let executionCues = editorialCues, executionTemplates = editorialTemplates
    let operationalView: RundownView | null = null
    if (revision) {
      const payload = readOperationalPayload(revision.payload)
      assertOperationalCadence(this.db,channel,payload)
      // An old revision without a graphic snapshot must not read today's edits.
      executionCues = new Map()
      executionTemplates = new Map((payload.graphics?.templates ?? []).map(template => [template.id, template]))
      for (const cue of payload.graphics?.cues ?? []) {
        const list = executionCues.get(cue.itemId) ?? []
        list.push(cue); executionCues.set(cue.itemId, list)
      }
      for (const list of executionCues.values()) list.sort((a,b) => a.atSeconds-b.atSeconds)
      const pinned = new Map(await Promise.all((payload.assets ?? [...assets.values()]).map(async (asset) => {
        const current = assets.get(asset.id)
        const cached = this.continuityCache?.pathFor(asset)
        const archived = await this.mediaWorkflow?.archived(asset.id, asset.contentHash)
        const path = archived ?? (cached && await this.continuityCache?.verified(asset) ? cached : asset.path)
        const changed = current && current.contentHash !== asset.contentHash && path === asset.path
        return [asset.id, { ...asset, path,
          qcStatus: current?.contentHash === asset.contentHash ? current.qcStatus : asset.qcStatus,
          ignored: current?.contentHash === asset.contentHash ? current.ignored : asset.ignored,
          probeError: changed ? 'Arquivo alterado após a publicação; publique uma nova versão ou restaure a mídia original.' : asset.probeError,
        }] as const
      })))
      const approvedVersions = await applyQcDecisions(this.db, pinned, channel.id)
      for (const [id, asset] of approvedVersions) decoderAssets.set(id, asset)
      const clock = rundownClock(payload.rundown.date, channel.rate, new Date(), this.transport.state().onAir)
      operationalView = buildView(payload.rundown, channel, payload.items, approvedVersions, clock.now, clock.onAir)
    }
    // A refresh started before a confirmed playlist cut must not reinstall its
    // old plan after asynchronous archive/hash work completes. All execution
    // lookup maps are installed together, never half-old/half-new during awaits.
    if (this.closed || epoch !== this.loadEpoch) return this.view
    beforeInstall?.()
    this.channel = channel
    this.assets = decoderAssets
    this.templates = editorialTemplates
    this.cues = editorialCues
    this.executionCues = executionCues
    this.executionTemplates = executionTemplates
    const clock = rundownClock(editorial.rundown.date, channel.rate, new Date(), this.transport.state().onAir)
    this.view = editorialView(editorial,clock.now,clock.onAir)
    this.operationalRevision = revision ? { id: revision.id, revision: revision.revision, publishedAt: revision.publishedAt } : null
    this.operationalView = operationalView
    this.graphics.scheduler.setEvents(revision ? readOperationalPayload(revision.payload).secondaryEvents ?? [] : [])
    return this.view
  }

  /** Recalcula a grade corrente. Chamado depois de toda alteração. */
  applyCommittedQcProfile(profile:NonNullable<Channel['qcProfile']>):void {
    // Fence asynchronous loads that captured the previous profile. Eligibility
    // changes immediately; the decoder and current PGM are not reconfigured.
    ++this.loadEpoch
    this.channel={...this.channel,qcProfile:profile}
    for(const key of ['view','operationalView','unconfirmedInsertionView'] as const){
      const current=this[key]
      if(current){
        const updatedChannel={...current.channel,qcProfile:profile}
        const pinned=new Map(current.items.flatMap(entry=>entry.asset?[[entry.asset.id,entry.asset] as const]:[]))
        const clock=rundownClock(current.rundown.date,updatedChannel.rate,new Date(),this.transport.state().onAir)
        this[key]={...current,...buildView(current.rundown,updatedChannel,current.items.map(entry=>entry.item),pinned,clock.now,clock.onAir)}
      }
    }
  }

  invalidateCatalogRemoval(assetIds:readonly string[]): void {
    // Fence every earlier async load before returning from the catalog commit.
    // This is editorial invalidation, never CUE/TAKE/STOP or re-publication.
    ++this.loadEpoch
    const id=this.view?.rundown.id
    for(const assetId of assetIds)this.assets.delete(assetId)
    if(!id)return
    this.view=null
    const editorial=readEditorialState(this.db,id)
    if(!editorial){this.view=null;return}
    const clock=rundownClock(editorial.rundown.date,editorial.channel.rate,new Date(),this.transport.state().onAir)
    this.view=editorialView(editorial,clock.now,clock.onAir)
    for(const [assetId,asset]of editorial.assets){
      const previous=this.assets.get(assetId)
      this.assets.set(assetId,previous?.contentHash===asset.contentHash?{...asset,path:previous.path}:asset)
    }
    for(const assetId of this.assets.keys())if(!editorial.assets.has(assetId)&&!this.operationalView?.items.some(row=>row.asset?.id===assetId))this.assets.delete(assetId)
    const itemIds=new Set(editorial.items.map(row=>row.id))
    for(const itemId of this.cues.keys())if(!itemIds.has(itemId))this.cues.delete(itemId)
    if(!this.operationalView)this.executionCues=this.cues
  }

  async refresh(): Promise<RundownView | null> {
    if(this.unconfirmedInsertionView)return this.view
    const id = this.view?.rundown.id
    return id ? this.load(id) : null
  }

  /** Polling never starts duplicate hash/archive reads while a previous
   * telemetry refresh is pending. Explicit editorial loads still supersede it. */
  refreshForTelemetry(): Promise<RundownView | null> {
    if (this.pendingTelemetryRefresh) return this.pendingTelemetryRefresh
    // Live source telemetry marks the transport dirty several times per
    // second; each refresh re-reads the whole grade from storage. At most one
    // per second, the later one coalescing every mark made meanwhile.
    const wait = TELEMETRY_REFRESH_MIN_MS - (Date.now() - this.lastTelemetryRefreshAt)
    const start = (): Promise<RundownView | null> => { this.lastTelemetryRefreshAt = Date.now(); return this.closed ? Promise.resolve(this.view) : this.refresh() }
    const work = wait > 0 ? new Promise<void>(done => setTimeout(done, wait)).then(start) : start()
    this.pendingTelemetryRefresh = work
    void work.finally(() => { if (this.pendingTelemetryRefresh === work) this.pendingTelemetryRefresh = null }).catch(() => {})
    return work
  }

  /** Refresh only decoder lookup paths after warming. No date/revision/CUE
   * reload is permitted here; concurrent publication may replace the map. */
  async refreshCachedMediaPaths(): Promise<void> {
    if (!this.continuityCache) return
    for (const [id,asset] of [...this.assets]) {
      if (await this.continuityCache.verified(asset) && this.assets.get(id) === asset) {
        this.assets.set(id,{...asset,path:this.continuityCache.pathFor(asset)})
      }
    }
  }

  cachePins(): MediaAsset[] {
    const state = this.transport.state()
    const ids = [state.onAir?.itemId,state.preparedItemId,state.preparingItemId,
      state.preview?.kind === 'ITEM' ? state.preview.id : null]
      .flatMap(itemId => this.executionView?.items.find(entry=>entry.item.id===itemId)?.item.mediaId ?? [])
    if (state.preview?.kind === 'ASSET') ids.push(state.preview.id)
    return [...new Set(ids)].flatMap(id=>this.assets.get(id) ?? []).concat(this.boundaryPins)
  }

  /** Reconfiguration must not retire a decoder while recovery is in flight. */
  reconfigurationStatus(includeConfigurationFence=true,includeInterruptionFence=true): { ready: boolean; reason: string | null } {
    const reason = this.closed ? 'O runtime deste canal foi encerrado.' :
      this.recovering || this.pendingRecovery || this.contingencyPending ? 'Aguarde a recuperação/troca de contingência antes de reconfigurar o canal.' : (includeInterruptionFence?this.interruptionCommands?.blockedReason(this.channel.id):null)??(includeConfigurationFence?this.configurationChanges?.blockedReason(this.channel.id)??null:null)
    return { ready: reason === null, reason }
  }

  assertReconfigurationReady(): void {
    const { reason } = this.reconfigurationStatus()
    if (reason) throw new Error(reason)
  }

  /** Resume a real PGM, never turn a simulator checkpoint into air. */
  async recoverCheckpoint(): Promise<boolean> {
    if (!this.checkpoints || !(this.transport instanceof EngineTransport)) return false
    this.recoveryCheckpointProtected=true
    try {
      if(this.interruptionCommands?.blockedReason(this.channel.id))throw new Error(this.interruptionCommands.blockedReason(this.channel.id)!)
      if (new PlaylistBoundaryLedger(this.db,this.channel.id).list().some(run=>['PREPARING','SWITCHING','UNCERTAIN'].includes(run.state))) throw new Error('Há passagem de playlist sem conclusão durável. Confira e encerre os processos anteriores antes de retomar; TAKE não será reenviado automaticamente.')
      const saved = this.checkpoints.read(this.channel.id)
      if(saved?.realEngine&&!saved.playing&&saved.itemId&&!saved.programHold)throw new Error('PGM pausado exige recuperação de quadro congelado; cursor preservado.')
      if (!saved?.realEngine || (!saved.playing&&!saved.programHold) || !saved.rundownId || !saved.itemId) {this.recoveryCheckpointProtected=false;return false}
      const owner=this.executionLease?.assertOwned()
      if(!owner||!saved.ownerRunId||!this.executionLease!.canRecoverCursorFrom(saved.ownerRunId))throw new Error('Checkpoint não pertence à execução atual ou à cadeia não resolvida de predecessores comprovadamente parados. Cursor preservado; recuperação automática recusada.')
      if (saved.rate && BigInt(saved.rate.num) * BigInt(this.channel.rate.den) !== BigInt(this.channel.rate.num) * BigInt(saved.rate.den)) throw new Error('A cadência do canal mudou desde o checkpoint; o cursor não será reinterpretado. Revise a grade e faça CUE/TAKE explicitamente.')
      if((saved.audioChannels??2)!==(this.channel.audioChannels??2))throw new Error('O barramento de áudio mudou desde o checkpoint. Confira os pares, publique a grade e faça CUE/TAKE explicitamente.')
      const view = await this.load(saved.rundownId)
      if (!view || saved.revisionId !== (this.operationalRevision?.id ?? null)) throw new Error('A revisão publicada mudou desde o checkpoint; faça CUE/TAKE explicitamente.')
      if (!this.executionView?.items.some((entry) => entry.item.id === saved.itemId)) throw new Error('O item do checkpoint não existe na playlist operacional.')
      if(saved.liveProgramBinding){
        resolveLiveProgramBinding(saved.liveProgramBinding,saved)
        assertPersistedLiveReplacementReceipt(this.db,saved.liveProgramBinding)
      }
      const entry=this.executionView.items.find(row=>row.item.id===saved.itemId)!
      if(entry.asset&&!entry.item.sourceRef&&!entry.item.liveEndpoint&&!entry.item.liveConfig?.sourceEndpoint){
        if(!saved.programTrim)throw new Error('Checkpoint antigo sem corte confirmado do PGM. Cursor preservado; confira CUE/TAKE explicitamente.')
        assertProgramTrim(entry,saved.programTrim,saved.elapsed,this.channel.rate)
      }else if(saved.programTrim)throw new Error('Checkpoint de arquivo não pode ser retomado como entrada ao vivo.')
      // Operator policy: resume automatically at the LAST DURABLE cursor,
      // never extrapolate through an unobserved storage outage. Audit intent
      // before requesting native recovery; this is not a TAKE/PGM receipt.
      this.db.insert(operatorDecisions).values({id:randomUUID(),rundownId:saved.rundownId,itemId:saved.itemId,
        kind:'CHECKPOINT_AUTO_RECOVERY_REQUESTED',actorUsername:'@runtime',createdAt:new Date().toISOString(),
        payload:{channelId:this.channel.id,policy:'LAST_SAVED_CHECKPOINT',sourceOwnerRunId:saved.ownerRunId,
          ownerRunId:owner.id,positionFrames:saved.elapsed,rate:this.channel.rate,held:Boolean(saved.programHold),
          possibleReplay:true,unpersistedEndKnown:false,operatorConfirmationRequired:false,nativeRecoveryConfirmed:false}}).run()
      this.pendingRecovery = saved
      this.recoveryRetryAt=0;this.recoveryRetryCount=0
      this.contingencyOrigin = saved.contingency ?? null
      this.executionId = saved.executionId ?? randomUUID()
      this.executionItemId = saved.itemId
      this.restoreSecondaryGraphics = true
      this.graphicRestoreReceiptId=saved.graphicReceiptId??null
      return true
    } catch (error) { this.recoveryError = error instanceof Error ? error.message : String(error); return false }
  }

  private rejectRecovery(saved:ChannelCheckpoint,error:Error):void {
    if(this.recoveryAttempt!==saved)return
    this.recoveryAttempt=null
    this.recoveryError=`PGM não recuperado: ${error.message}`
    const entry=this.executionView?.items.find(row=>row.item.id===saved.itemId)
    const live=Boolean(entry&&(entry.item.sourceRef||entry.item.liveEndpoint||entry.item.liveConfig?.sourceEndpoint))
    // Positive opening ACK is not PGM. Only terminal, decoder-bound refusal
    // or negative command ACK allows a retry of this unchanged saved context.
    if(!this.closed&&live&&error instanceof EngineCommandRejected&&this.recoveryRetryCount<4&&
      !this.transport.state().onAir&&saved.executionId===this.executionId&&saved.revisionId===(this.operationalRevision?.id??null)&&saved.rundownId===this.executionView?.rundown.id&&this.recoveryCheckpointProtected){
      try{
        const owner=this.executionLease?.assertOwned()
        if(!owner||!saved.ownerRunId||!this.executionLease!.canRecoverCursorFrom(saved.ownerRunId))return
        this.recoveryRetryCount++
        this.recoveryRetryAt=Date.now()+Math.min(8000,1000*2**(this.recoveryRetryCount-1))
        this.pendingRecovery=saved
        this.recoveryError+='; aguardando nova tentativa limitada da mesma live após recusa confirmada.'
      }catch{/* Ownership uncertainty retains the checkpoint, no retry. */}
    }
  }

  private async commitHeldRecovery(saved:ChannelCheckpoint,proof:{itemId:string;decoderId:number;frames:number}):Promise<void>{
    const assertCurrent=(committed=false)=>{
      if(!(this.transport instanceof EngineTransport)||this.closed||this.recoveryAttempt!==saved||!saved.programHold||proof.itemId!==saved.itemId||proof.frames!==saved.elapsed||!saved.programTrim||this.operationalRevision?.id!==saved.revisionId||this.executionView?.rundown.id!==saved.rundownId||(saved.executionId&&saved.executionId!==this.executionId))throw new Error('Contexto da recuperação pausada mudou; checkpoint preservado.')
      const owner=this.executionLease?.assertOwned(),state=this.transport.state(),hold=this.transport.health().programHold
      const persisted=committed?this.checkpoints?.read(this.channel.id):null
      const ownerValid=committed?Boolean(persisted&&persisted.ownerRunId===owner?.id&&persisted.itemId===proof.itemId&&persisted.elapsed===proof.frames&&persisted.executionId===this.executionId&&persisted.programHold?.decoderId===proof.decoderId):Boolean(saved.ownerRunId&&this.executionLease!.canRecoverCursorFrom(saved.ownerRunId))
      if(!owner||!ownerValid||state.playing||state.onAir?.itemId!==proof.itemId||hold?.status!=='HELD'||hold.decoderId!==proof.decoderId||hold.frames!==proof.frames||JSON.stringify(state.programTrim)!==JSON.stringify(saved.programTrim))throw new Error('Posse/PGM pausado não corresponde ao checkpoint; confirmação recusada.')
    }
    assertCurrent()
    // Recovery is a continuation segment, not a newly requested TAKE.
    if(!this.checkpoints)throw new Error('Recuperação pausada exige checkpoint durável.')
    await this.asRun.followHeldWithCommit(proof.itemId,this.executionView,this.operationalRevision?.id??null,proof.frames,()=>{
      assertCurrent()
      this.executionLease!.acknowledgeStoppedPredecessor()
      this.checkpoints!.write({...saved,executionId:this.executionId??undefined,playing:false,elapsed:proof.frames,
        programHold:{status:'HELD',decoderId:proof.decoderId,frames:proof.frames},rate:this.channel.rate,audioChannels:this.channel.audioChannels??2})
    })
    assertCurrent(true)
    this.executionItemId=proof.itemId;this.pendingRecovery=null;this.recoveryAttempt=null
    this.recoveryRetryAt=0;this.recoveryRetryCount=0;this.recoveryError=null
    this.recoveryCheckpointProtected=false
  }

  /** Port for the native live replacement factory. Every member reads the
   * CURRENT runtime; nothing is captured from the request that created it. */
  private nativeReplacementPort():NativeReplacementRuntimePort{
    const transport=this.transport
    if(!(transport instanceof EngineTransport)||!this.checkpoints||!this.executionLease)throw new Error('Troca nativa exige engine real, checkpoint durável e posse do canal.')
    const lease=this.executionLease
    return {
      channelId:this.channel.id,db:this.db,checkpoints:this.checkpoints,transport,
      ownerRunId:()=>lease.assertOwned().id,
      stoppedPredecessorRunIds:()=>lease.recoverablePredecessorRunIds(),
      context:()=>this.nativeReplacementContext(),
      capture:()=>this.replacementCursor(),
    }
  }
  private nativeReplacementContext():NativeLiveReplacementContext{
    if(this.closed||!(this.transport instanceof EngineTransport))throw new Error('Canal sem engine nativo ativo.')
    const owner=this.executionLease?.assertOwned()
    if(!owner)throw new Error('Troca nativa exige posse durável do canal.')
    const blocked=this.recovering||this.pendingRecovery||this.recoveryAttempt?'Aguarde a recuperação do PGM antes de trocar a fonte.'
      :this.contingencyPending?'Aguarde a troca de contingência antes de trocar a fonte.'
      :this.interruptionCommands?.blockedReason(this.channel.id)
        ??(new PlaylistBoundaryLedger(this.db,this.channel.id).list().some(run=>['PREPARING','SWITCHING','UNCERTAIN'].includes(run.state))?'Há passagem de playlist sem conclusão durável.':null)
    if(blocked)throw new Error(blocked)
    const view=this.executionView,revision=this.operationalRevision,occurrence=this.asRun.openOccurrence(),selection=this.transport.nativeLiveSelection()
    if(!view||!revision||!this.executionId||!occurrence||occurrence.itemId!==selection.itemId||this.transport.state().onAir?.itemId!==selection.itemId)throw new Error('PGM sem ocorrência publicada/registrada para esta live; aguarde o as-run da entrada.')
    return {channelId:this.channel.id,rundownId:view.rundown.id,revisionId:revision.id,executionId:this.executionId,occurrenceId:occurrence.id,
      ownerRunId:owner.id,engineGeneration:selection.engineGeneration,itemId:selection.itemId,decoderId:selection.decoderId,sourceId:selection.sourceId,
      sourceConnectionSignature:selection.sourceConnectionSignature,policySignature:selection.policySignature}
  }
  /** Same fields as the periodic checkpoint; the commit helper adds v2/binding. */
  private replacementCursor():ChannelCheckpoint{
    const state=this.transport.state()
    return {version:1,channelId:this.channel.id,rundownId:this.executionView?.rundown.id??null,revisionId:this.operationalRevision?.id??null,
      itemId:state.onAir?.itemId??null,elapsed:Math.max(0,Math.floor(state.onAir?.elapsed??0)),playing:state.playing,
      graphicReceiptId:new GraphicCommandLedger(this.db,this.channel.id).latestNativeCompositionId()??undefined,
      realEngine:this.transport instanceof EngineTransport,programTrim:state.programTrim??undefined,rate:this.channel.rate,
      audioChannels:this.channel.audioChannels??2,executionId:this.executionId,contingency:this.contingencyOrigin??undefined}
  }
  /** Authorized factory: one session per operator action. `authorize` is called
   * again at each command inside the engine queue (session/role/channel). */
  nativeReplacementSession(actor:NativeReplacementActor,authorize:NativeReplacementAuthorization):NativeReplacementSession{
    return createNativeReplacementSession(this.nativeReplacementPort(),actor,authorize)
  }
  private replacementJournalCache:{at:number;openTransactionId:string|null}|null=null
  /** Operator-facing capability, no URI/credential. Journal read is throttled. */
  liveReplacementStatus():{supported:boolean;selectionUncertain:boolean;pgmSourceId:string|null;openTransactionId:string|null}|null{
    if(!(this.transport instanceof EngineTransport))return null
    // Feeds the whole live snapshot: an indicator must never break it.
    const health=(()=>{try{return this.transport instanceof EngineTransport?this.transport.health().nativeLiveReplacement:null}catch{return null}})()
    if(!health)return null
    let pgmSourceId:string|null=null
    try{pgmSourceId=this.transport.nativeLiveSelection().sourceId}catch{/* no catalogued live in PGM */}
    if(!this.replacementJournalCache||Date.now()-this.replacementJournalCache.at>1000){
      let openTransactionId:string|null=null
      try{openTransactionId=unresolvedNativeReplacementJournals(this.db,this.channel.id).find(row=>row.prepareSent)?.transactionId??null}catch{openTransactionId=null}
      this.replacementJournalCache={at:Date.now(),openTransactionId}
    }
    return {supported:health.supported,selectionUncertain:health.selectionUncertain,pgmSourceId,openTransactionId:this.replacementJournalCache.openTransactionId}
  }
  private resolveReplacementJournalsAfterStop(proof:{engineGeneration:string|null;nativeRequestId:number}):void{
    if(!(this.transport instanceof EngineTransport)||!this.checkpoints||!this.executionLease)return
    const transport=this.transport
    try{
      const result=resolveStoppedPredecessorJournals(this.nativeReplacementPort(),proof,id=>transport.ownsNativeReplacementSession(id))
      if(result.preserved.length)this.recoveryError='Há troca nativa de outra execução sem parada comprovada; novas trocas continuam bloqueadas até reconciliação.'
    }catch(error){
      // A failed journal write keeps the rows open (blocking new cuts); it
      // must not turn a confirmed native STOP into an uncertain program.
      this.recoveryError='Journal de troca nativa não resolvido no STOP: '+(error instanceof Error?error.message:String(error))
    }
  }

  checkpoint(force = false): void {
    if (this.closed || !this.checkpoints) return
    // The empty state during an engine restart is not an intentional STOP.
    if (!this.transport.health().ready || this.recovering) return
    if (this.pendingRecovery) {
      if(Date.now()<this.recoveryRetryAt)return
      const saved = this.pendingRecovery
      if(this.recoveryRetryCount>0){
        try{
          const owner=this.executionLease?.assertOwned()
          if(this.transport.state().onAir||saved.executionId!==this.executionId||saved.revisionId!==(this.operationalRevision?.id??null)||saved.rundownId!==this.executionView?.rundown.id||!owner||!saved.ownerRunId||!this.executionLease!.canRecoverCursorFrom(saved.ownerRunId))throw new Error('Contexto/posse mudou durante a espera; recuperação anterior não reenviada.')
        }catch(error){this.pendingRecovery=null;this.recoveryError=error instanceof Error?error.message:String(error);return}
      }
      this.pendingRecovery = null
      this.recoveryAttempt=saved
      this.recovering = true
      void Promise.resolve(this.transport instanceof EngineTransport ? saved.programHold
        ? this.transport.recoverHeld(saved.rundownId!,saved.itemId!,saved.elapsed,saved.programTrim!,proof=>this.commitHeldRecovery(saved,proof))
        : saved.liveProgramBinding?this.transport.recover(saved.rundownId!,saved.itemId!,saved.elapsed,saved.programTrim,saved.liveProgramBinding)
          :this.transport.recover(saved.rundownId!, saved.itemId!, saved.elapsed,saved.programTrim) : this.transport.take(saved.rundownId!, saved.itemId!, saved.elapsed))
        .then(() => { if(this.recoveryAttempt===saved&&!this.pendingRecovery)this.recoveryError = null })
        .catch((error: Error) => {
          this.rejectRecovery(saved,error)
        })
        .finally(() => { this.recovering = false; this.checkpoint(true) })
      return
    }
    if (!force && Date.now() - this.lastCheckpointAt < 1000) return
    const state = this.transport.state()
    if(this.recoveryCheckpointProtected)return
    const hold=this.transport instanceof EngineTransport?this.transport.health().programHold:null
    if(hold?.status==='UNCONFIRMED'){this.recoveryError='Pausa nativa inconclusiva; checkpoint anterior preservado.';return}
    if(this.transport instanceof EngineTransport&&state.onAir&&!state.playing&&hold?.status!=='HELD'){this.recoveryError='Estado pausado sem confirmação nativa; checkpoint anterior preservado.';return}
    if(hold?.status==='HELD'&&hold.itemId!==state.onAir?.itemId){this.recoveryError='Pausa pertence a outro item; checkpoint anterior preservado.';return}
    const held=hold?.status==='HELD'&&hold.itemId===state.onAir?.itemId?hold:null
    if(held&&(!state.programTrim||!this.operationalRevision)){this.recoveryError='Pausa sem corte/revisão confirmados; checkpoint anterior preservado.';return}
    const liveProgramBinding=this.transport instanceof EngineTransport?this.transport.liveProgramBindingSnapshot?.()??undefined:undefined
    const now=Date.now()
    try{
      const value={ version: liveProgramBinding?2 as const:1 as const,liveProgramBinding,channelId: this.channel.id, rundownId: this.executionView?.rundown.id ?? null,
        revisionId: this.operationalRevision?.id ?? null, itemId: state.onAir?.itemId ?? null,
        elapsed: held?.frames??Math.max(0, Math.floor(state.onAir?.elapsed ?? 0)), playing: held?false:state.playing,
        programHold:held?{status:'HELD' as const,decoderId:held.decoderId,frames:held.frames!}:undefined,
        graphicReceiptId:new GraphicCommandLedger(this.db,this.channel.id).latestNativeCompositionId()??undefined,
        realEngine: this.transport instanceof EngineTransport, programTrim:state.programTrim??undefined, rate: this.channel.rate,audioChannels:this.channel.audioChannels??2, executionId: this.executionId, contingency: this.contingencyOrigin ?? undefined }
      // Nothing on air: the cursor does not move, so rewriting the same row
      // every second only cost a write transaction. Still rewritten at least
      // every 30 s, and always when anything in it changes or when forced.
      const key=JSON.stringify(value)
      if(!force&&!state.onAir&&key===this.lastCheckpointKey&&now-this.lastCheckpointWrittenAt<CHECKPOINT_IDLE_REWRITE_MS){this.lastCheckpointAt=now;return}
      this.checkpoints.write(value as Parameters<Checkpoints['write']>[0])
      this.lastCheckpointKey=key;this.lastCheckpointWrittenAt=now
    }catch(error){this.lastCheckpointKey=null;this.recoveryError=error instanceof Error?error.message:String(error);return}
    this.lastCheckpointAt = now
  }

  /** Cancel runtime persistence before terminating its owned engine. */
  private cancelPersistenceForClose():boolean {
    if(this.closed)return false
    this.closed = true
    this.loadEpoch++
    if(this.executionLease)try{
      (this.incidentRecorder??=new RuntimeIncidentRecorder(this.db,this.executionLease)).drainAndSeal()
    }catch(error){this.recoveryError=error instanceof Error?error.message:String(error)}
    return true
  }
  private releaseClosingLease(){
    try{this.executionLease?.release()}catch(error){this.recoveryError=error instanceof Error?error.message:String(error)}
  }
  close(): void {
    if(!this.cancelPersistenceForClose())return
    this.transport.close();this.releaseClosingLease()
  }
  closeGracefully():Promise<import('./domain/engine.js').NativeShutdownResult>{
    this.cancelPersistenceForClose()
    const proof=this.transport instanceof EngineTransport?this.transport.closeGracefully():(this.transport.close(),Promise.resolve({ownedNativeProcessesStopped:true,graceful:true,forceRequested:false}))
    // Whole-application normal shutdown must retain the active lease while
    // app.flush() closes the pending as-run. Releasing it here makes that
    // final authorized write fail. App.close() performs final release only
    // after the native generation has actually exited; quick close() keeps
    // its separate reconfiguration/fencing contract.
    return proof
  }

  private meterForItem(itemId: string | null): MeterReading {
    if (!itemId || !this.view) return SILENCE
    const item = this.executionView?.items.find((v) => v.item.id === itemId)
    if (!item) return SILENCE
    return simulateMeter(
      this.channel,
      item.audio.measured?.integratedLufs ?? item.asset?.loudnessFile?.integratedLufs ?? null,
      item.audio.measured?.truePeakDbtp ?? item.asset?.loudnessFile?.truePeakDbtp ?? null,
      item.gainDb,
      this.phase,
    )
  }

  /** Arquivo aberto direto do explorador: sem nivelamento, como ele veio. */
  private meterForAsset(assetId: string): MeterReading {
    const asset = this.assets.get(assetId)
    if (!asset?.loudnessFile) return SILENCE
    return simulateMeter(
      this.channel,
      asset.loudnessFile.integratedLufs,
      asset.loudnessFile.truePeakDbtp,
      0,
      this.phase,
    )
  }

  private meterForPreview(target: PreviewTarget | null): MeterReading {
    if (!target) return SILENCE
    if (target.kind === 'ITEM') return this.meterForItem(target.id)
    if (target.kind === 'ASSET') return this.meterForAsset(target.id)
    return SILENCE
  }

  /** As deixas de grafismo de um item, para a interface listar. */
  cuesOf(itemId: string): ItemGraphic[] {
    return this.cues.get(itemId) ?? []
  }

  /**
   * Dispara o grafismo preso ao item no ar quando chega a hora dele.
   *
   * O que já disparou é lembrado por passagem do item: o mesmo VT indo ao ar
   * de novo, mais tarde na grade, dispara de novo -- que é o comportamento
   * esperado de uma reprise.
   */
  /**
   * Troca a arte de apresentação técnica sem derrubar o canal.
   *
   * Recriar o runtime para ler um campo novo subiria um segundo engine e
   * deixaria dois processos publicando no mesmo destino -- a interface veria
   * um canal só e a saída teria duas.
   */
  setSlate(templateId: string | null): void {
    this.channel = { ...this.channel, slateTemplateId: templateId }
    this.followSlate()
  }

  /**
   * Apresentação técnica: entra quando nada está no ar.
   *
   * Preto no ar é honesto e não diz nada a quem está assistindo. Com uma arte
   * escolhida, o canal mostra que está de pé e por que não há programa -- e ela
   * sai sozinha assim que um item entra.
   */
  followSlate(): void {
    if(this.closed||this.automaticGraphicsPending||this.graphics.commandPending||this.emergencyCommandPending)return
    if (this.emergencyOverlay) return
    const ledger=new GraphicCommandLedger(this.db,this.channel.id)
    if(ledger.hasUnresolved())return
    const onAir = this.transport.state().onAir !== null
    const slateId = this.channel.slateTemplateId
    const composition=JSON.stringify(this.graphics.getLayers())
    // A manual/event overlay can replace the idle composition. It is no longer
    // owned by the idle presentation and must not be removed as a side effect.
    if(this.slateUp&&(!this.idleSlateLayer||this.idleSlateIdentity!==JSON.stringify(this.graphics.getLayers()[this.idleSlateLayer]))){
      this.slateUp=false;this.idleSlateIdentity=null;this.idleSlateLayer=null;this.idleSlateGeneration++
    }
    const remove=onAir||!slateId
    if(remove?!this.slateUp:this.slateUp||!!this.graphics.onAir())return
    const template=remove?null:this.templates.get(slateId!)
    if(!remove&&(!template||template.channelId!=null&&template.channelId!==this.channel.id))return
    const frozen=template?structuredClone({...template,holdSeconds:null}):null
    const key='idle-'+createHash('sha256').update(JSON.stringify([this.boundaryOwner,this.idleSlateGeneration,remove,slateId,frozen,composition])).digest('hex')
    if(this.attemptedIdleSlate===key)return
    const authorize=()=>{
      if(this.closed||this.emergencyOverlay||this.emergencyCommandPending||this.channel.slateTemplateId!==slateId||(this.transport.state().onAir!==null)!==onAir||JSON.stringify(this.graphics.getLayers())!==composition)throw new Error('Estado mudou; apresentação automática antiga não enviada.')
    }
    this.attemptedIdleSlate=key;this.automaticGraphicsPending=true
    void ledger.execute({key,context:()=>this.graphicContext(),actorId:null,actorName:'AUTOMATIC',native:this.transport.state().mode==='NATIVE',selection:{action:remove?'IDLE_HIDE':'IDLE_SHOW',template:frozen,composition}},authorize,async send=>{
      if(remove)await this.graphics.triggerLayerConfirmed(this.idleSlateLayer!,'HIDE',{fadeMs:0},authorize,send)
      else await this.graphics.showConfirmed(frozen!,{},authorize,send)
      this.slateUp=!remove;this.idleSlateLayer=remove?null:this.graphics.onAirLayer();this.idleSlateIdentity=this.idleSlateLayer?JSON.stringify(this.graphics.getLayers()[this.idleSlateLayer]):null;this.idleSlateGeneration++
    }).catch(()=>{this.recoveryError='Apresentação automática sem confirmação; confira imagem e histórico. Nenhum reenvio automático.'})
      .finally(()=>{this.automaticGraphicsPending=false})
  }

  /**
   * Anota no as-run o que está no ar.
   *
   * Roda a cada volta do laço e só escreve quando o item muda -- inclusive
   * quando ele muda para nada, porque preto no ar também é informação.
   */
  async followAsRun(): Promise<void> {
    // Native execution is recorded at confirmed TAKE/clear events. Polling a
    // state preceding its ACK could otherwise create a duplicate first row or
    // miss a rapid STOP/retake of the same item between two periodic ticks.
    if (this.transport instanceof EngineTransport) return
    const state = this.transport.state()
    await this.asRun.follow(state.onAir?.itemId ?? null, this.executionView, this.operationalRevision?.id ?? null, state.onAir?.elapsed ?? 0)
  }
  emergencyCommandPending=false
  async setEmergencySlate(enabled: boolean,command:{key?:unknown;actorId?:string|null;actorName?:string|null;authorize?:()=>void}={}):Promise<import('./domain/graphic-command-ledger.js').GraphicCommandReceipt> {
    if(this.graphics.commandPending)throw new Error('Grafismo aguarda confirmação; atualize o estado antes de alterar a emergência.')
    if(this.emergencyCommandPending)throw new Error('Emergência aguarda confirmação; nenhum segundo comando foi enviado.')
    this.emergencyCommandPending=true
    try{
    const transport=this.transport
    if (!(transport instanceof EngineTransport)) throw new Error('Slate não enviado: canal está em modo simulado, sem engine real.')
    const authorize=()=>{command.authorize?.();if(this.closed)throw new Error('Runtime encerrado; emergência não enviada.')}
    authorize()
    let template:GraphicTemplate|null=null,svg:string|null=null
    if(enabled){
      const current=await getChannel(this.db,this.channel.id)
      if(!current?.slateTemplateId)throw new Error('Escolha a arte de apresentação técnica do canal antes de acionar o slate.')
      const row=this.db.select().from(graphicTemplates).where(eq(graphicTemplates.id,current.slateTemplateId)).get()
      if(!row||(row.channelId!=null&&row.channelId!==this.channel.id))throw new Error('Arte de apresentação técnica ausente ou de outro canal.')
      template=row
      svg='<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080"><rect width="1920" height="1080" fill="black"/>'+fitGraphicViewport(renderTemplate(row,{}))+'</svg>'
    }
    const result=await new GraphicCommandLedger(this.db,this.channel.id).execute({key:command.key,context:()=>this.graphicContext(),actorId:command.actorId??null,actorName:command.actorName??'AUTOMATIC',native:true,selection:{action:enabled?'EMERGENCY_SHOW':'EMERGENCY_RESET',template}},authorize,async send=>{
      if(enabled)await transport.graphicConfirmed(svg,0,()=>{authorize();send()})
      else await this.graphics.hideConfirmed(authorize,0,send)
      this.emergencyOverlay=enabled
      if(enabled)captureGraphicDisplay({...this.graphics.displaySnapshot(),emergencySvg:svg})
    })
    return result.receipt
    }finally{this.emergencyCommandPending=false}
  }

  async prepareContingency(revisionId: string, loop = true) {
    const cache = this.continuityCache
    return prepareContingencyPlaylist(this.db, this.channel, revisionId, async asset => {
      const archived = await this.mediaWorkflow?.archived(asset.id, asset.contentHash)
      if (archived) return archived
      return cache && await cache.verified(asset) ? cache.pathFor(asset) : null
    }, loop)
  }

  boundaryStatus() {
    const runs = new PlaylistBoundaryLedger(this.db,this.channel.id).list()
    return { nativeEngine:this.transport instanceof EngineTransport, sourceRevisionId:this.operationalRevision?.id ?? null,
      current:runs.find(run=>!['CONFIRMED','FAILED','CANCELLED'].includes(run.state)) ?? runs[0] ?? null,
      history:runs.slice(0,20), automaticPolicy:'ONE_REVIEWED_EOS' as const }
  }

  /** Identifies the occurrence, not merely the item (a repeated VT is new air). */
  telemetryIdentity(){return {revisionId:this.operationalRevision?.id??null,executionId:this.executionId??null}}
  interruptionContext(){
    const state=this.transport.state()
    if(!(this.transport instanceof EngineTransport) && state.onAir && (this.executionItemId!==state.onAir.itemId || this.simulatedStartedAt!==state.onAir.startedAt)){
      this.executionId=randomUUID();this.executionItemId=state.onAir.itemId;this.simulatedStartedAt=state.onAir.startedAt
    }
    return {rundownId:this.executionView?.rundown.id??null,revisionId:this.operationalRevision?.id??null,executionId:this.executionId??null,onAirItemId:state.onAir?.itemId??null,native:this.transport instanceof EngineTransport}
  }

  insertionContext(){
    const context=this.interruptionContext()
    if(!context.rundownId || !context.revisionId || this.contingencyOrigin || this.emergencyOverlay || this.boundaryStatus().current?.state==='QUEUED')throw new Error('A inserção exige uma revisão publicada em execução, sem contingência, slate ou passagem enfileirada. Confira/cancele a passagem antes de intervir.')
    return {channelId:this.channel.id,rundownId:context.rundownId,revisionId:context.revisionId,executionId:context.executionId,onAirItemId:context.onAirItemId}
  }
  async prepareInsertionView(payload:OperationalPayload){
    const assets=new Map(await Promise.all((payload.assets??[]).map(async asset=>{
      const archived=await this.mediaWorkflow?.archived(asset.id,asset.contentHash)
      const cached=await this.continuityCache?.verified(asset)?this.continuityCache!.pathFor(asset):null
      return [asset.id,{...asset,path:archived??cached??asset.path}] as const
    })))
    return buildView(payload.rundown,this.channel,payload.items,assets,null,null)
  }
  insertionTiming(view:RundownView,input:InsertionInput){
    const state=this.transport.state(),now=new Date()
    const onAir=input.mode==='NOW'?{itemId:`urgent:${input.requestId}`,startedAt:framesSinceMidnight(now,this.channel.rate),elapsed:0}:state.onAir
    const clock=rundownClock(view.rundown.date,this.channel.rate,now,onAir)
    return buildView(view.rundown,this.channel,view.items.map(entry=>entry.item),new Map(view.items.flatMap(entry=>entry.asset?[[entry.asset.id,entry.asset] as const]:[])),clock.now,clock.onAir)
  }
  installInsertion(payload:OperationalPayload,view:RundownView,revision:{id:string;revision:number;publishedAt:string},input:InsertionInput,previous:{itemId:string;frames:number}|null){
    const old=this.executionView,oldRevision=this.operationalRevision
    this.installContingency({payload,view,revision,assets:new Map(view.items.flatMap(entry=>entry.asset?[[entry.asset.id,entry.asset] as const]:[])),isCurrent:()=>true},true)
    if(input.mode==='NOW' && previous){
      const entry=old?.items.find(entry=>entry.item.id===previous.itemId)
      if(entry)try{this.interruptions?.record(this.channel.id,old!.rundown.id,oldRevision?.id??null,entry,Math.floor(previous.frames))}catch(error){this.recoveryError='PGM confirmou inserção, mas o registro do VT interrompido falhou: '+String(error)}
    }
    if(input.mode==='NEXT')this.checkpoint(true)
  }
  observeUnconfirmedInsertion(view:RundownView){
    this.unconfirmedInsertionView=view;this.operationalRevision=null
    for(const entry of view.items)if(entry.asset)this.assets.set(entry.asset.id,entry.asset)
    this.recoveryError='Engine confirmou o item inserido, mas a revisão/auditoria não pôde ser confirmada. Não repita TAKE; pare PGM e confira a operação inconclusiva.'
  }

  restoreBoundaryProtection():void {
    this.boundaryPins=new PlaylistBoundaryLedger(this.db,this.channel.id).list().filter((run,index)=>!['CONFIRMED','FAILED','CANCELLED'].includes(run.state) || index===0 && run.state==='FAILED')
      .flatMap(run=>configuredContingencyAssets(this.db,this.channel.id,run.plan.targetRevisionId))
    this.continuityCache?.replaceProtection(`boundary:${this.channel.id}`,this.boundaryPins)
  }

  cancelQueuedBoundaryOnStop(actor:string|null):void {
    const ledger=new PlaylistBoundaryLedger(this.db,this.channel.id)
    for(const run of ledger.list().filter(entry=>entry.state==='QUEUED'||entry.state==='PREPARING'))
      ledger.phase(run.id,[run.state],'CANCELLED',()=>true,{message:'Cancelada por STOP explícito do canal.'},actor)
    this.restoreBoundaryProtection()
  }

  reconcilePlaylistBoundary(id:string,actor:string|null):void {
    const ledger=new PlaylistBoundaryLedger(this.db,this.channel.id),run=ledger.read(id)
    if(!run || !['PREPARING','SWITCHING','UNCERTAIN'].includes(run.state))throw new Error('Não há passagem incerta para reconhecer.')
    const state=this.transport.state()
    const owner=JSON.parse(run.processOwner ?? '{}'),currentOwner=JSON.parse(this.boundaryOwner)
    const sameProcess=owner.host===currentOwner.host && owner.pid===currentOwner.pid && owner.boot===currentOwner.boot
    if(state.playing || state.preview || (!sameProcess && !boundaryProcessesGone(run)))throw new Error('Faça STOP e limpe o CUE; os processos antigos de servidor e engine devem estar comprovadamente encerrados. Dono remoto/desconhecido não pode ser liberado por este host.')
    ledger.phase(id,[run.state],'CANCELLED',()=>!this.transport.state().playing && !this.transport.state().preview,{message:'Incerteza reconhecida com canal parado; nenhum TAKE repetido.'},actor)
    this.restoreBoundaryProtection()
  }

  /** Explicitly queued one-shot authorization. No load/take/publication here. */
  async queuePlaylistBoundary(id:string,plan:BoundaryPlan,token?:string,authorize:()=>void=()=>{}):Promise<BoundaryRun> {
    authorize()
    if (!(this.transport instanceof EngineTransport)) throw new Error('Passagem automática exige engine nativo; o simulador não pode anunciar troca real.')
    if (this.closed || this.operationalRevision?.id!==plan.sourceRevisionId || this.contingencyOrigin || this.emergencyOverlay) throw new Error('A origem mudou ou há intervenção de contingência; confira novamente a passagem.')
    requireBoundaryReview(inspectBoundary(this.db,this.channel.id,plan.sourceRevisionId,plan.targetRevisionId,plan.owner),token)
    const frozen = configuredContingencyAssets(this.db,this.channel.id,plan.targetRevisionId)
    // Reserve before potentially slow copy/hash work; restore old protection
    // on refusal so a concurrent command cannot quietly replace this intent.
    const pinOwner=`boundary-review:${id}`
    this.continuityCache?.replaceProtection(pinOwner,frozen)
    try {
      await this.continuityCache?.warmSchedule(frozen,frozen,{owner:pinOwner})
      const prepared=await this.prepareContingency(plan.targetRevisionId,false)
      if (prepared.view.items[0]?.item.id!==plan.firstItemId || prepared.view.schedule.items[0]?.state==='DROPPED' || prepared.view.items[0]?.asset?.probeError || !prepared.isCurrent()) throw new Error('Primeiro vídeo sem cópia verificada/aprovação. Prepare o cache e confira novamente.')
      const current=inspectBoundary(this.db,this.channel.id,plan.sourceRevisionId,plan.targetRevisionId,plan.owner)
      requireBoundaryReview(current,token)
      if(this.closed || this.operationalRevision?.id!==plan.sourceRevisionId)throw new Error('A execução mudou durante a preparação; nenhum pedido foi enfileirado.')
      const run=new PlaylistBoundaryLedger(this.db,this.channel.id).enqueue(id,current,()=>{authorize();return !this.closed && this.operationalRevision?.id===plan.sourceRevisionId})
      this.boundaryPins=frozen
      this.continuityCache?.replaceProtection(`boundary:${this.channel.id}`,frozen)
      return run
    } finally {this.continuityCache?.replaceProtection(pinOwner,[])}
  }

  private async resolvePlaylistBoundary(itemId:string):Promise<EnginePlaylistBoundary|null> {
    const ledger=new PlaylistBoundaryLedger(this.db,this.channel.id),source=this.operationalRevision?.id
    const run=ledger.list().find(entry=>entry.plan.sourceRevisionId===source && entry.state!=='CANCELLED')
    if(!run || run.state==='CONFIRMED')return null
    if(run.state!=='QUEUED')return {kind:'HOLD',reason:'Passagem anterior falhou, está em preparação ou é incerta. Confira o PGM e o registro; não haverá novo TAKE automático.'}
    const sourceCurrent=()=>!this.closed && this.operationalRevision?.id===run.plan.sourceRevisionId && this.transport.state().onAir?.itemId===itemId && !this.contingencyOrigin && !this.emergencyOverlay
    const reviewCurrent=()=>{
      try{return sourceCurrent() && inspectBoundary(this.db,this.channel.id,run.plan.sourceRevisionId,run.plan.targetRevisionId,run.plan.owner).token===run.plan.token}catch{return false}
    }
    let claimed=false
    try {
      if(Date.now()+1000*this.channel.rate.den/this.channel.rate.num<run.plan.notBeforeMs)throw new Error('A origem terminou antes do horário publicado do destino. Corrija o intervalo; a próxima grade não será adiantada.')
      ledger.phase(run.id,['QUEUED'],'PREPARING',reviewCurrent,{processOwner:JSON.stringify({...JSON.parse(this.boundaryOwner),enginePid:this.transport.processId()})})
      claimed=true
      const prepared=await this.prepareContingency(run.plan.targetRevisionId,false)
      const first=prepared.view.items[0]
      if(first?.item.id!==run.plan.firstItemId || first.asset?.probeError || prepared.view.schedule.items[0]?.state==='DROPPED')throw new Error('Primeiro vídeo não reproduzível; nenhum outro item será escolhido silenciosamente.')
      const stillCurrent=()=>ledger.read(run.id)?.state==='PREPARING' && reviewCurrent() && prepared.isCurrent()
      return {kind:'TAKE',view:prepared.view,itemId:run.plan.firstItemId,stillCurrent,
        beforeTake:()=>{ledger.phase(run.id,['PREPARING'],'SWITCHING',stillCurrent)},
        commit:previous=>{
          // Native program identity wins even if persistence fails after cut.
          // Install first so checkpoint/as-run never describe the old edition.
          this.installContingency(prepared);this.boundaryPins=[]
          this.continuityCache?.replaceProtection(`boundary:${this.channel.id}`,[])
          try {ledger.phase(run.id,['SWITCHING'],'CONFIRMED',()=>true,{previousItemId:previous?.itemId,previousFrames:previous?.frames})}
          catch(error){this.recoveryError='PGM confirmou a passagem, mas o registro permanece incerto: '+String(error)}
        },
        failed:error=>{
          const state=ledger.read(run.id)?.state
          if(state==='PREPARING'||state==='SWITCHING')ledger.phase(run.id,[state],state==='SWITCHING'?'UNCERTAIN':'FAILED',()=>true,{message:error.message})
        }}
    } catch(error) {
      const state=ledger.read(run.id)?.state
      if(state==='QUEUED'||state==='PREPARING'&&claimed)ledger.phase(run.id,[state],'FAILED',()=>true,{message:error instanceof Error?error.message:String(error)})
      return {kind:'HOLD',reason:'Passagem não preparada; PGM anterior preservado. '+(error instanceof Error?error.message:String(error))}
    }
  }

  private async preparePlaylistBoundaryAhead() {
    const ledger=new PlaylistBoundaryLedger(this.db,this.channel.id),source=this.operationalRevision?.id
    const run=ledger.list().find(entry=>entry.plan.sourceRevisionId===source&&entry.state==='QUEUED')
    if(!run || this.closed || this.contingencyOrigin || this.emergencyOverlay)return null
    const current=()=>{
      try {return !this.closed && this.operationalRevision?.id===source && ledger.read(run.id)?.state==='QUEUED' && inspectBoundary(this.db,this.channel.id,run.plan.sourceRevisionId,run.plan.targetRevisionId,run.plan.owner).token===run.plan.token}
      catch{return false}
    }
    if(!current())return null
    const prepared=await this.prepareContingency(run.plan.targetRevisionId,false)
    return {view:prepared.view,itemId:run.plan.firstItemId,stillCurrent:()=>current()&&prepared.isCurrent()}
  }

  private installContingency(prepared: Awaited<ReturnType<ChannelRuntime['prepareContingency']>>,preserveEditorial=false): void {
    this.loadEpoch++
    if(!preserveEditorial)this.view = prepared.view
    this.operationalView = prepared.view
    this.operationalRevision = prepared.revision
    for (const [id, asset] of prepared.assets) this.assets.set(id, asset)
    this.executionTemplates = new Map((prepared.payload.graphics?.templates ?? []).map(template => [template.id, template]))
    this.executionCues = new Map()
    for (const cue of prepared.payload.graphics?.cues ?? []) {
      const list = this.executionCues.get(cue.itemId) ?? []
      list.push(cue); this.executionCues.set(cue.itemId, list)
    }
    for (const list of this.executionCues.values()) list.sort((a,b) => a.atSeconds-b.atSeconds)
    this.graphics.scheduler.setEvents(prepared.payload.secondaryEvents ?? [])
  }

  /** Only one activation/return can prepare at a time. Neither operation loads
   * a mutable editorial rundown before the file is confirmed by the engine. */
  enterContingency(revisionId: string): Promise<void> {
    if (this.pendingContingency) return this.pendingContingency
    if (this.contingencyState?.active && this.contingencyOrigin?.loopRevisionId === revisionId) return Promise.resolve()
    const work = (async () => {
      if (!(this.transport instanceof EngineTransport)) throw new Error('Contingência não enviada: canal simulado, sem engine real.')
      if (this.contingencyOrigin) throw new Error('Há uma contingência com retorno pendente. Confira o PGM antes de substituir a reserva.')
      if (this.emergencyOverlay) throw new Error('Retire o slate opaco antes de acionar o loop de contingência.')
      const baseline = this.executionView, revision = this.operationalRevision, prior = this.transport.state().onAir
      if (prior && !revision) throw new Error('Publique a grade em execução para preservar um retorno versionado antes de configurar a contingência.')
      const prepared = await this.prepareContingency(revisionId)
      const candidate = prepared.view.items[0]!
      this.continuityCache?.replaceProtection(`contingency:${this.channel.id}`, [...prepared.assets.values()])
      await this.transport.takeFromPlaylist(prepared.view, candidate.item.id, previous => {
        this.contingencyOrigin = { loopRevisionId: revisionId, loopRundownId: prepared.view.rundown.id, rundownId: baseline?.rundown.id ?? null,
          revisionId: revision?.id ?? null, itemId: previous?.itemId ?? null, elapsed: previous?.frames ?? 0, activatedAt: new Date().toISOString() }
        this.installContingency(prepared)
      }, () => !this.closed && this.executionView?.rundown.id === baseline?.rundown.id && this.operationalRevision?.id === revision?.id && prepared.isCurrent())
    })()
    this.pendingContingency = work
    void work.finally(() => { if (this.pendingContingency === work) this.pendingContingency = null }).catch(() => {})
    return work
  }

  returnFromContingency(): Promise<void> {
    if (this.pendingContingency) return Promise.reject(new Error('Aguarde a intervenção pendente antes de retornar à grade.'))
    const work = (async () => {
      if (!(this.transport instanceof EngineTransport)) throw new Error('Retorno exige engine real.')
      const origin = this.contingencyOrigin, baseline = this.executionView
      if (!origin || !this.contingencyState?.active) throw new Error('Não há loop ativo com retorno preservado.')
      if (!origin.revisionId || !origin.itemId) throw new Error('O loop foi acionado sem item anterior no PGM. Faça CUE/TAKE explícito para sair da contingência.')
      if (this.emergencyOverlay) throw new Error('Retire o slate opaco antes de retornar à grade.')
      const prepared = await this.prepareContingency(origin.revisionId, false)
      const previous = prepared.view.items.find(entry => entry.item.id === origin.itemId)
      if (!previous || previous.item.type === 'LIVE' || previous.item.sourceRef || previous.item.liveEndpoint) throw new Error('O item anterior não é um VT recuperável. Confira o sinal e faça CUE/TAKE explícito.')
      const duration = previous.trim.out - previous.trim.in
      if (origin.elapsed >= duration) throw new Error('O VT anterior já terminou. Selecione o próximo item e faça CUE/TAKE explícito.')
      await this.transport.takeFromPlaylist(prepared.view, origin.itemId, () => {
        this.installContingency(prepared)
        this.contingencyOrigin = null
      }, () => !this.closed && this.executionView?.rundown.id === baseline?.rundown.id && this.contingencyOrigin === origin && prepared.isCurrent(), origin.elapsed, 'CONTINGENCY_RETURN')
    })()
    this.pendingContingency = work
    void work.finally(() => { if (this.pendingContingency === work) this.pendingContingency = null }).catch(() => {})
    return work
  }

  fireDueGraphics(): boolean {
    if(this.closed||this.automaticGraphicsPending||this.graphics.commandPending||this.emergencyCommandPending)return false
    if(this.transport instanceof EngineTransport&&(!this.transport.health().ready||this.recovering||this.pendingRecovery))return false
    if(new GraphicCommandLedger(this.db,this.channel.id).hasUnresolved())return false
    const onAir = this.transport.state().onAir
    if (!onAir) {
      this.cuesFor = null
      this.graphics.scheduler.resetItem(null)
      return false
    }
    if(this.restoreSecondaryGraphics){
      this.restoreSecondaryGraphics=false
      const sourceReceipt=this.graphicRestoreReceiptId,executionId=this.executionId,revisionId=this.operationalRevision?.id??null,itemId=onAir.itemId,startedAt=onAir.startedAt
      const ledger=new GraphicCommandLedger(this.db,this.channel.id)
      if(sourceReceipt){
        const readDisplay=()=>sourceReceipt.startsWith(HA_GRAPHIC_RECEIPT_PREFIX)?readHaGraphicComposition(this.db,this.channel.id,sourceReceipt):ledger.confirmedDisplay(sourceReceipt)
        this.automaticGraphicsPending=true
        const authorize=()=>{
          if(this.closed||this.emergencyCommandPending||this.executionId!==executionId||(this.operationalRevision?.id??null)!==revisionId||this.transport.state().onAir?.itemId!==itemId||this.transport.state().onAir?.startedAt!==startedAt)throw new Error('Execução mudou; composição de recuperação não enviada.')
          this.executionLease?.assertOwned()
          readDisplay()
        }
        const key='restore-display-'+createHash('sha256').update(JSON.stringify([this.boundaryOwner,sourceReceipt,executionId,revisionId,itemId])).digest('hex')
        void (async()=>{
          authorize();const display=readDisplay()
          await ledger.execute({key,context:()=>this.graphicContext(),actorId:null,actorName:'RECOVERY',native:this.transport.state().mode==='NATIVE',selection:{action:'COMPOSITION_RESTORE',sourceReceipt,executionId,revisionId,itemId}},authorize,async send=>{
            await this.graphics.restoreDisplayConfirmed(display,authorize,send)
            this.emergencyOverlay=display.emergencySvg!==null
          })
          this.checkpoint(true)
        })().catch(error=>{
          const message='Composição não recuperada; confira o histórico e a imagem: '+(error instanceof Error?error.message:String(error))
          try{this.graphicRecoveryIncident=new GraphicRecoveryIncident(this.db,this.channel.id,{executionId,revisionId,itemId,startedAt},sourceReceipt,message)}catch{this.recoveryError=message+'; falha ao registrar incidente gráfico.'}
        })
          .finally(()=>{this.automaticGraphicsPending=false})
        return false
      }
      if(ledger.latestNativeCompositionId()){
        const message='Checkpoint antigo sem vínculo de composição gráfica; nenhum SHOW histórico foi reenviado. Confira a imagem e faça intervenção explícita.'
        try{this.graphicRecoveryIncident=new GraphicRecoveryIncident(this.db,this.channel.id,{executionId,revisionId,itemId,startedAt},ledger.latestNativeCompositionId(),message)}catch{this.recoveryError=message+'; falha ao registrar incidente gráfico.'}
        return false
      }
    }
    if (this.emergencyOverlay) return false
    // A confirmed saved composition may be restored above while HELD, but
    // elapsed cues/device events must not fire until playback is released.
    if(!this.transport.state().playing)return false
    if (!(this.transport instanceof EngineTransport) && (this.executionItemId !== onAir.itemId || this.simulatedStartedAt !== onAir.startedAt)) {
      this.executionId=randomUUID();this.executionItemId=onAir.itemId;this.simulatedStartedAt=onAir.startedAt
    }
    if (this.cuesFor !== onAir.itemId || this.graphicsExecutionId !== this.executionId) {
      this.cuesFor = onAir.itemId
      this.graphicsExecutionId = this.executionId
      this.fired = this.executionId?new GraphicCommandLedger(this.db,this.channel.id).confirmedCueIds(this.executionId,onAir.itemId,this.operationalRevision?.id??null):new Set()
      this.graphics.scheduler.resetItem(onAir.itemId)
    }

    const itemEntry = this.executionView?.items.find((entry) => entry.item.id === onAir.itemId)
    const duration = programDurationFrames(onAir,this.executionView?.schedule.items.find(item=>item.id===onAir.itemId)?.duration
      ?? itemEntry?.item.durationOverride ?? itemEntry?.asset?.durationFrames ?? 18000)
    void this.graphics.scheduler.tick(onAir.itemId, onAir.elapsed, duration)
      .catch((error:unknown)=>{this.recoveryError='Falha no evento secundário: '+(error instanceof Error ? error.message : String(error))})
    // A secondary command can claim the durable composition synchronously,
    // before Graphics marks its asynchronous native work pending. Defer legacy
    // cues instead of consuming them as failed concurrent requests.
    if(new GraphicCommandLedger(this.db,this.channel.id).hasUnresolved())return false



    let changed = false
    for (const cue of this.executionCues.get(onAir.itemId) ?? []) {
      if (this.fired.has(cue.id)) continue
      if (onAir.elapsed < secondsToFrames(cue.atSeconds, this.channel.rate)) continue
      const template = this.executionTemplates.get(cue.templateId)
      this.fired.add(cue.id)
      if (!template){this.recoveryError='Deixa gráfica sem template publicado; nenhum comando enviado.';continue}
      const executionId=this.executionId,revisionId=this.operationalRevision?.id??null,itemId=onAir.itemId,startedAt=onAir.startedAt
      const authorize=()=>{
        const current=this.transport.state().onAir
        if(this.closed||this.emergencyOverlay||this.emergencyCommandPending||this.executionId!==executionId||(this.operationalRevision?.id??null)!==revisionId||current?.itemId!==itemId||current.startedAt!==startedAt)throw new Error('Execução mudou; deixa antiga não enviada.')
      }
      const key='cue-'+createHash('sha256').update(JSON.stringify([executionId,itemId,startedAt,cue.id])).digest('hex')
      this.automaticGraphicsPending=true
      void new GraphicCommandLedger(this.db,this.channel.id).execute({key,context:()=>this.graphicContext(),actorId:null,actorName:'AUTOMATIC',native:this.transport.state().mode==='NATIVE',selection:{action:'LEGACY_CUE',executionId,itemId,revisionId,cue:structuredClone(cue),template:structuredClone(template)}},authorize,send=>this.graphics.showConfirmed(template,cue.values,authorize,send))
        .catch(()=>{this.recoveryError='Deixa gráfica sem confirmação; confira o histórico de comandos e a imagem. Nenhum reenvio automático.'})
        .finally(()=>{this.automaticGraphicsPending=false})
      changed = true
      break // One durable automatic composition owns this cycle.
    }
    return changed
  }

  /** Automatic expiry is a durable command, not an optimistic UI mutation. */
  expireGraphics():boolean{
    if(this.closed||this.automaticGraphicsPending||this.graphics.commandPending||this.emergencyOverlay||this.emergencyCommandPending||!this.graphics.hasExpiredLayers())return false
    if(new GraphicCommandLedger(this.db,this.channel.id).hasUnresolved())return false
    const layers=structuredClone(this.graphics.getLayers()),signature=JSON.stringify(layers)
    const key='expire-'+createHash('sha256').update(signature).digest('hex')
    if(this.attemptedGraphicExpiry===key)return false
    const authorize=()=>{
      if(this.closed||this.emergencyOverlay||this.emergencyCommandPending||JSON.stringify(this.graphics.getLayers())!==signature)throw new Error('Composição mudou; expiração antiga não enviada.')
    }
    this.attemptedGraphicExpiry=key;this.automaticGraphicsPending=true
    void new GraphicCommandLedger(this.db,this.channel.id).execute({key,context:()=>this.graphicContext(),actorId:null,actorName:'AUTOMATIC',native:this.transport.state().mode==='NATIVE',selection:{action:'EXPIRE',layers}},authorize,send=>this.graphics.expireConfirmed(authorize,send))
      .catch(()=>{this.recoveryError='Retirada automática sem confirmação; confira a imagem e o histórico. Nenhum reenvio automático.'})
      .finally(()=>{this.automaticGraphicsPending=false})
    return true
  }

  /** Return the persisted outcome, not merely acceptance by the scheduler. */
  async fireSecondaryEvent(eventId:string) {
    this.fireDueGraphics()
    const onAir=this.transport.state().onAir, executionId=this.executionId,revisionId=this.operationalRevision?.id??null
    const event=this.graphics.scheduler.getEvents().find(event=>event.id===eventId)
    if (!onAir || !executionId || !event?.enabled || event.triggerMode!=='MANUAL' || event.rundownItemId!==onAir.itemId) throw new Error('Evento manual exige o item publicado no PGM.')
    await this.graphics.scheduler.triggerManual(eventId)
    const run=new SecondaryEventLedger(this.db,this.channel.id).fireFor({executionId,itemId:onAir.itemId,revisionId},eventId)
    if (!run) throw new Error('O pedido não foi registrado.')
    return {id:run.id,state:run.state,error:run.error}
  }

  /**
   * O que está errado agora, em uma linha por problema.
   *
   * Saída morta só era visível para quem abrisse o painel de distribuição --
   * ou seja, para quem já desconfiava. Num playout, o que está quebrado tem de
   * aparecer na tela em que o operador já está olhando.
   */
  /**
   * Quando cada monitor foi visto por último, por barramento.
   *
   * A interface avisa que está olhando enquanto a janela existe. Passado o
   * silêncio, o monitor desliga: quem fechou a aba, ou quem foi almoçar com o
   * navegador fechado, não deve custar uma codificação.
   */
  private readonly olhando = new Map<'pvw' | 'mon', number>()
  private readonly monitorLigado = new Map<'pvw' | 'mon', boolean>()
  private readonly monitorReafirmado = new Map<'pvw' | 'mon', number>()
  /** Monitores que alguém tentou abrir e que este canal não tem. */
  private readonly monitorPedidoSemExistir = new Set<'pvw' | 'mon'>()

  /**
   * Há decodificador de AAC nesta instalação? Nulo enquanto não se sabe.
   *
   * Injetado de fora porque o runtime não conhece a descoberta de
   * dispositivos, e não deve conhecer: ele cuida de um canal.
   */
  aacDisponivel: () => boolean | null = () => null

  /** Este canal tem este monitor? */
  temMonitor(bus: 'pvw' | 'mon'): boolean {
    return this.monitores.has(bus)
  }

  /** A interface diz que alguém está com este monitor aberto. */
  watching(bus: 'pvw' | 'mon'): void {
    if (!this.monitores.has(bus)) {
      // Mandar ligar o que não existe só rende erro no log. Guarda o pedido
      // para o alerta poder dizer ao operador por que a janela está preta.
      this.monitorPedidoSemExistir.add(bus)
      return
    }
    const agora = Date.now()
    this.olhando.set(bus, agora)
    if (this.monitorLigado.get(bus) !== true) {
      this.monitorLigado.set(bus, true)
      this.monitorReafirmado.set(bus, agora)
      console.info(`[monitor] ligando ${bus}: alguém abriu a janela`)
      this.transport.setMonitor(bus, true)
      return
    }
    // A primeira ordem pode se perder: chegar antes de o engine criar as
    // saídas, ou cair entre uma reconfiguração e outra. Sem reafirmar, o
    // monitor ficava desligado para sempre enquanto a janela continuasse
    // avisando (o "PGM/PVW não abrem"). Ligar o que já está ligado não mexe
    // na saída do engine; no máximo uma linha a cada 5 s por monitor.
    if (agora - (this.monitorReafirmado.get(bus) ?? 0) >= MONITOR_REAFIRMAR_MS) {
      this.monitorReafirmado.set(bus, agora)
      this.transport.setMonitor(bus, true)
    }
  }

  /**
   * Desliga o que ninguém está olhando há um tempo.
   *
   * A folga existe para recarregar a página não derrubar e resubir a
   * codificação: subir custa abrir pipeline e reconectar ao servidor de mídia,
   * e piscar isso a cada F5 seria pior que deixar ligado.
   */
  private podarMonitores(): void {
    void this.qcInspection.tick().catch(()=>{})
    const limite = Date.now() - MONITOR_OCIOSO_MS
    for (const bus of ['pvw', 'mon'] as const) {
      if (this.monitorLigado.get(bus) !== true) continue
      if ((this.olhando.get(bus) ?? 0) > limite) continue
      this.monitorLigado.set(bus, false)
      console.info(`[monitor] desligando ${bus}: ninguém olhando há mais de 20s`)
      this.transport.setMonitor(bus, false)
    }
  }

  alerts(): { kind: 'OUTPUT' | 'ENGINE'; message: string }[] {
    const found: { kind: 'OUTPUT' | 'ENGINE'; message: string }[] = []
    if(this.graphicRecoveryIncident){
      try{if(this.graphicRecoveryIncident.reconcile(this.graphicContext()))this.graphicRecoveryIncident=null}catch{/* Failed audit retains the active warning. */}
      if(this.graphicRecoveryIncident)found.push({kind:'ENGINE',message:this.graphicRecoveryIncident.message})
    }
    if (this.recoveryError) found.push({ kind: 'ENGINE', message: this.recoveryError })

    for (const publisher of this.transport.publishers()) {
      if (publisher.health === 'onAir' || publisher.health === 'connecting') continue
      // Monitor desligado não é falha: é uma janela que ninguém abriu, e
      // alarme para isso encheria o sino com o funcionamento normal.
      if (publisher.health === 'idle') continue

      // O motivo vai junto. "Caiu e está tentando voltar" sozinho manda o
      // operador procurar no escuro -- a causa quase sempre está na primeira
      // linha do erro do GStreamer.
      const motivo = publisher.error?.split('\n')[0]?.trim()
      found.push({
        kind: 'OUTPUT',
        message:
          `saída ${short(publisher.url)} ${
            publisher.health === 'retrying' ? 'caiu e está tentando voltar' : publisher.health === 'failed' ? 'falhou; ação do operador necessária' : 'parou'
          }` + (motivo ? `: ${motivo.slice(0, 120)}` : ''),
      })
    }

    // Item no ar cujo arquivo tem trilha, mas nada chega ao medidor.
    //
    // Silêncio no ar é o defeito que ninguém percebe olhando a tela: a imagem
    // está lá, o VT anda, e só quem está de fone descobre. A causa quase
    // sempre é decodificador ausente -- AAC costuma vir do gst-libav, e uma
    // instalação parcial do GStreamer entrega o vídeo e engole o som.
    //
    // Só reclama depois de dois segundos no ar: no primeiro instante o medidor
    // ainda não recebeu bloco nenhum, e avisar ali seria alarme falso a cada
    // entrada.
    const noAr = this.transport.state().onAir
    const emSilencio =
      noAr !== null && noAr.elapsed > secondsToFrames(2, this.channel.rate)
        ? this.transport.programMeter()
        : null
    if (noAr && emSilencio && emSilencio.peakDbfs.every((pico) => pico <= -89)) {
      const item = this.executionView?.items.find((entry) => entry.item.id === noAr.itemId)
      // Quem decide é a loudness medida, não a existência da trilha: VT de
      // intervalo com trilha muda é normal, e reclamar dele encheria o sino de
      // alarme falso. Loudness acima de -60 LUFS quer dizer que a leitura do
      // arquivo achou som de verdade -- e aí silêncio no ar é defeito.
      const medida = item?.asset?.loudnessFile?.integratedLufs
      // E o silêncio não pode ser obra do próprio operador: quem baixou o
      // ganho deste item a -90 dB queria silêncio, e culpar o decodificador
      // seria acusar a instalação de um defeito que é uma decisão.
      const abaixado = (item?.gainDb ?? 0) <= -40 || item?.audio.mode === 'OFF'
      if (
        item?.asset?.probe?.hasAudio === true &&
        medida !== undefined &&
        medida > -60 &&
        !abaixado
      ) {
        // "Pode faltar o decodificador" manda procurar sem dizer onde. A
        // instalação sabe a resposta: se não há decodificador de AAC, isso não
        // é suspeita, é a causa -- e o arquivo está indo ao ar mudo agora.
        const temAac = this.aacDisponivel()
        found.push({
          kind: 'ENGINE',
          message:
            temAac === false
              ? `"${item.item.title}" está indo ao ar MUDO: esta instalação não tem ` +
                'decodificador de AAC (instale o gst-libav, ou o faad)'
              : `"${item.item.title}" tem trilha de áudio mas nada chega ao medidor` +
                (temAac === true
                  ? ' — o decodificador de AAC está instalado, então o problema é do arquivo'
                  : ' — pode faltar o decodificador (AAC vem do gst-libav)'),
        })
      }
    }

    // Janela de monitor aberta num canal que não tem monitor. Só reclama
    // quando alguém de fato tentou olhar: um canal sem servidor de mídia numa
    // máquina headless funciona bem assim, e alarme constante para isso seria
    // ruído. Quem abriu a janela, esse sim precisa saber por que está preta.
    for (const bus of this.monitorPedidoSemExistir) {
      const onde = bus === 'pvw' ? 'preview' : 'monitor do programa'
      found.push({
        kind: 'ENGINE',
        message: `o ${onde} não está no ar: ${this.motivoSemMonitor.get(bus) ?? 'este canal não tem esse barramento'}`,
      })
    }

    // Máquina apertada é a explicação de "a imagem está engasgando", e até
    // agora ela só existia no stderr do engine.
    const aviso = this.transport.warning()
    if (aviso !== null) found.push({ kind: 'ENGINE', message: aviso })

    const health = this.transport.health()
    if (health.error) found.push({ kind: 'ENGINE', message: health.error })
    if (health.restarts > 0) {
      // O motivo vai junto. Um motor que morreu sozinho e um motor que nós
      // matamos por não estar entregando quadro são defeitos diferentes, e o
      // alerta antigo -- só a contagem -- mandava procurar queda de processo
      // mesmo quando nenhum processo tinha caído.
      const causas = [
        health.deaths > 0 ? `${health.deaths} por queda do processo` : null,
        health.stalls > 0 ? `${health.stalls} por ficar sem entregar quadro` : null,
      ].filter((causa): causa is string => causa !== null)
      found.push({
        kind: 'ENGINE',
        message:
          `o motor precisou ser levantado ${health.restarts}x nesta sessão` +
          (causas.length > 0 ? ` (${causas.join(', ')})` : ''),
      })
    }
    return found
  }

  /** Estado que vai para a interface a cada frame de atualização. */
  live() {
    this.podarMonitores()
    this.phase += 0.12
    const state = this.transport.state()
    return {
      transport: state,
      reconfiguration: this.reconfigurationStatus(),
      liveReplacement: this.liveReplacementStatus(),
      // QC "em qualidade" and the Master share this PVW: say so before a CUE.
      qcInspection: this.qcInspection.inspecting(),
      graphic: this.graphics.onAir(),
      alerts: this.alerts(),
      now: this.view ? rundownFrames(this.view.rundown.date, this.channel.rate) ?? framesSinceMidnight(new Date(), this.channel.rate) : framesSinceMidnight(new Date(), this.channel.rate),
      meters: {
        // Havendo engine, os dois medidores são medição de verdade, pela
        // BS.1770-4 sobre as amostras de cada barramento.
        program: this.transport.programMeter() ?? (ENGINE_BINARY ? SILENCE : this.meterForItem(state.onAir?.itemId ?? null)),
        preview: this.transport.previewMeter() ?? (ENGINE_BINARY ? SILENCE : this.meterForPreview(state.preview)),
      },
    }
  }
}

export interface App {
  readonly restoredAdmission:RestoredBackendAdmission|null
  readonly haExecutionAdmission?:HaExecutionAdmission|null
  readonly ha:HaReplication|null
  readonly db: Db
  readonly runtimes: Map<string, ChannelRuntime>
  readonly history: History
  readonly concurrency:ConcurrencyManager
  readonly configurationChanges:ConfigurationChanges
  readonly executionOwnership:ExecutionOwnership
  readonly distributionOwnership:DistributionOwnership
  readonly hostFence:HostDistributionFence|null
  readonly interruptionCommands:InterruptionCommands
  /** Servidor de mídia local. Nulo quando não há binário configurado. */
  readonly mediamtx: MediaMtx | null
  readonly relays: RelaySupervisor
  readonly ingest: Ingest
  readonly sources: Sources
  readonly mediaRoot: string
  readonly thumbnailDir: string
  /** Caminho de cada canal no servidor local. */
  paths: ChannelPaths[]
  /** Handle do SQLite, para a cópia de segurança sem parar o servidor. */
  readonly sqlite: Database.Database
  readonly backupDir: string
  readonly continuityCache: ContinuityCache
  /** Cada canal possui uma sonda independente. */
  readonly pgmProbes: Map<string, PgmProbe>
  readonly mediaWorkflow: MediaWorkflow
  readonly audioMixAnalysis:AudioMixAnalysis
  readonly publishedContinuity:PublishedContinuity
  readonly schedulePublication:SchedulePublication
  readonly hostMetrics: HostMetrics
  readonly integrationOutbox: IntegrationOutbox
  /** Fecha o que precisa de escrita antes de o processo sair. */
  flush(): Promise<void>
  close(): void|Promise<void>
}

import {initializeRoots} from './domain/roots.js'
import {ServerInstanceRegistration} from './domain/server-instances.js'
import {assertRestoredAdmission,type RestoredBackendAdmission} from './domain/restored-execution-review.js'
import {isRecoveryRehearsal} from './domain/recovery-rehearsal.js'
import {assertHaExecutionAdmission,type HaExecutionAdmission} from './domain/ha-execution-admission.js'
import {startupTrace} from './domain/startup-trace.js'
export async function createApp(file: string,options:{restoredAdmission?:RestoredBackendAdmission;haExecutionAdmission?:HaExecutionAdmission}={}): Promise<App> {
  startupTrace('application construction entered')
  const haAdmission=options.haExecutionAdmission
  if(haAdmission){assertHaExecutionAdmission(haAdmission);haAdmission.assertHeld();if(resolvePath(file)!==resolvePath(haAdmission.copy.file))throw new Error('Backend HA exige o banco copiado da admissão exata.');if(options.restoredAdmission)throw new Error('Admissões HA/restauração não podem ser combinadas.')}
  const haConfig=haAdmission?null:haOptions(file)
  const admission=options.restoredAdmission
  if(admission){assertRestoredAdmission(admission);if(haConfig?.role==='STANDBY')throw new Error('Admissão restaurada não promove nó standby.')}
  let instance!:ServerInstanceRegistration
  const { db, sqlite } = openDatabase(file,{maintenance:haAdmission?.maintenance??admission?.maintenance,assertAdmission:haAdmission?sqlite=>haAdmission.assertBeforeOpen(sqlite):admission?sqlite=>admission.assertBeforeOpen(sqlite):undefined,onOpened:sqlite=>{instance=haAdmission?haAdmission.register(sqlite):admission?admission.register(sqlite):new ServerInstanceRegistration(sqlite)}})
  startupTrace('database opened and registered')
  if(haAdmission){try{haAdmission.completeTransfer(sqlite)}catch(error){sqlite.close();throw error}}
  if(admission){try{admission.completeTransfer(sqlite)}catch(error){sqlite.close();throw error}}
  if(!haAdmission)await initializeRoots(db,MEDIA_ROOT)
  startupTrace('media roots initialized')
  const runtimes = new Map<string, ChannelRuntime>()
  let closeStarted=false,closeResult:Promise<void>|void=undefined,flushResult:Promise<void>|null=null
  // Admission precedes construction of publishers and discovery helpers.
  // A standby/rehearsal never claims the primary host's distribution family.
  const rehearsal=isRecoveryRehearsal(sqlite)
  const hostFence=haAdmission?.hostFence??admission?.hostFence??((ENGINE_BINARY||MEDIAMTX_BINARY||RELAY_BINARY)&&haConfig?.role!=='STANDBY'&&!rehearsal?new HostDistributionFence(HOST_GUARD_BINARY):null)
  if(hostFence&&!admission&&!haAdmission)await hostFence.acquire()
  startupTrace('host admission checked')
  const executionOwnership=new ExecutionOwnership(db),distributionOwnership=new DistributionOwnership(db,executionOwnership.identity,undefined,hostFence,haAdmission?()=>haAdmission.assertNativeActivation():admission?()=>admission.assertNativeActivation(sqlite):null)
  const mediaWorkflow = new MediaWorkflow(sqlite, process.env.RPLAYOUT_MEDIA_VERSIONS ?? resolvePath(THUMBNAIL_DIR, '../.media-versions'), PROXY_BINARY)
  const mediamtx = MEDIAMTX_BINARY && haConfig?.role!=='STANDBY'&&!haAdmission
    ? new MediaMtx({
        binary: MEDIAMTX_BINARY,
        configPath: resolvePath(process.cwd(), 'mediamtx.yml'),
        bind: MEDIAMTX_BIND,
        logLevel: MEDIAMTX_LOGLEVEL,
        ownership:distributionOwnership,
        hostFence,
        requireAppliedConfig:true,
      })
    : null

  const app: App = {
    ha:haConfig?new HaReplication(haConfig,()=>captureHaSnapshot(app),fetch,PROBE_BINARY||null,null,{commit:(request,rows,authorize,actor)=>appendHaHistory(app.sqlite,request,rows,authorize,actor),query:(importId,channelId)=>queryHaHistoryImport(app.sqlite,importId,channelId)},{commit:(request,received,authorize,actor)=>preserveHaHistoryVariants(app.sqlite,request,received,authorize,actor),query:(decisionId,channelId)=>queryHaHistoryVariant(app.sqlite,decisionId,channelId)},{lookup:(channelId,hashes)=>primaryReturnMediaAdapter(app.db).lookup(channelId,hashes)}):null,
    db,
    runtimes,
    history: new History(),
    concurrency:new ConcurrencyManager(new EditorialVersions(sqlite)),
    configurationChanges:new ConfigurationChanges(db),
    executionOwnership,
    distributionOwnership,
    hostFence,
    restoredAdmission:admission??null,
    haExecutionAdmission:haAdmission??null,
    interruptionCommands:new InterruptionCommands(db,sqlite),
    mediamtx,
    relays: new RelaySupervisor(RELAY_BINARY,distributionOwnership,()=>!mediamtx||mediamtx.readyForPublish,haConfig?.witnessUrl?{binding:target=>{
      if(!target.channelId)return null
      const runtime=runtimes.get(target.channelId),transport=runtime?.transport
      if(!(transport instanceof EngineTransport))return null
      const binding=transport.fenceBinding(),authority=app.ha?.witness
      if(!binding||!authority)return null
      return {...binding,obtain:(consumerId,nonce)=>{
        if(transport.fenceBinding()?.ownerId!==binding.ownerId)throw new Error('Engine mudou; relay antigo não será renovado.')
        return authority.obtainOutput(target.channelId!,binding.ownerId,consumerId,nonce)
      }}
    }}:undefined),
    ingest: new Ingest(db, PROBE_BINARY, THUMBNAIL_DIR, mediaWorkflow, sqlite),
    mediaWorkflow,
    audioMixAnalysis:new AudioMixAnalysis(db,AUDIO_ANALYSIS_BINARY,(id,hash,path)=>mediaWorkflow.inspectionOriginal(id,hash,path)),
    publishedContinuity:new PublishedContinuity({db,runtimes}),
    schedulePublication:new SchedulePublication(db,schedulePlannerBinary(),(id,hash,path)=>mediaWorkflow.inspectionOriginal(id,hash,path)),
    hostMetrics: new HostMetrics(sqlite, MEDIA_ROOT),
    integrationOutbox: new IntegrationOutbox(db),
    sources: new Sources(db, DEVICES_BINARY),
    mediaRoot: MEDIA_ROOT,
    thumbnailDir: THUMBNAIL_DIR,
    paths: [],
    sqlite,
    backupDir: BACKUP_DIR,
    continuityCache: new ContinuityCache(process.env.RPLAYOUT_CACHE ?? resolvePath(process.cwd(), '.continuity-cache'), CONTINUITY_CACHE_MAX_BYTES),
    pgmProbes: new Map(),
    /**
     * Fecha as linhas de as-run abertas antes de o processo sair.
     *
     * Precisa ser esperado: o `close` é síncrono e o processo terminaria antes
     * de a escrita chegar ao disco -- o item que estava no ar ficaria para
     * sempre sem hora de saída.
     */
    flush: () => {
      // Terminal drain, not a retryable save. A caller may already have seen
      // an uncertain SQL result; close() must await that SAME outcome rather
      // than submitting the pending write again or certifying storage closed.
      if(flushResult)return flushResult
      const pendingRuntimes=[...runtimes.values()]
      flushResult=(async()=>{
        await app.ingest.close()
        // Abort copy/transcode and await stream/child cleanup before SQLite closes.
        await mediaWorkflow.close()
        app.integrationOutbox.close();await app.integrationOutbox.settled()
        for (const runtime of pendingRuntimes) await runtime.asRun.finish('SHUTDOWN')
      })()
      return flushResult
    },
    close: () => {
      if(closeStarted)return closeResult
      closeStarted=true
      blockRuntimeCreation(app)
      const errors:unknown[]=[],drains:Promise<void>[]=[]
      const collect=(work:()=>unknown)=>{
        try{const value=work();if(value&&typeof (value as PromiseLike<unknown>).then==='function')drains.push(Promise.resolve(value).then(()=>{},error=>{errors.push(error)}))}
        catch(error){errors.push(error)}
      }
      collect(()=>app.ha?.close())
      // O processo do engine mantém pipes e timers próprios. Fechar apenas o
      // SQLite deixa motores órfãos e, na próxima subida, dois playouts podem
      // disputar o mesmo canal.
      const closingRuntimes=[...app.runtimes.values()]
      const ordinaryLocal=!app.ha&&!app.restoredAdmission&&!app.haExecutionAdmission
      const normalProofs:Promise<import('./domain/engine.js').NativeShutdownResult>[]=[]
      for (const runtime of closingRuntimes){
        if(ordinaryLocal&&runtime.transport instanceof EngineTransport){
          try{normalProofs.push(runtime.closeGracefully())}
          catch(error){errors.push(error);normalProofs.push((runtime.transport as EngineTransport).closeConfirmed(5000).then(proof=>({...proof,graceful:false,forceRequested:true})))}
        }else collect(()=>runtime.close())
      }
      // Direct ordinary native callers need the same history drain as index.
      // Runtime persistence is cancelled above, but its lease remains active
      // until this drain and actual native exit both succeed. Capture runtimes
      // inside flush() BEFORE clearing the map. HA/restored policy is unchanged.
      if(ordinaryLocal&&closingRuntimes.some(runtime=>runtime.transport instanceof EngineTransport))collect(()=>app.flush())
      app.runtimes.clear()
      // Keep SQLite/ownership alive until actual native exit callbacks retire
      // their generation. Closing storage immediately loses those callbacks.
      const nativeDrain=ordinaryLocal?Promise.all(normalProofs).then(proofs=>{
        if(proofs.some(proof=>!proof.ownedNativeProcessesStopped))throw new Error('Encerramento nativo inconclusivo; storage/posse preservados, não inicie outra instância.')
        if(proofs.some(proof=>!proof.graceful))throw new Error('Engine não confirmou encerramento normal; finalização de gravação e storage não serão declarados concluídos.')
      }):Promise.all(closingRuntimes.filter(runtime=>runtime.transport instanceof EngineTransport).map(async runtime=>{
        const stopped=await (runtime.transport as EngineTransport).closeConfirmed(5000)
        if(!stopped.ownedNativeProcessesStopped)throw new Error('Encerramento nativo inconclusivo; storage/posse preservados, não inicie outra instância.')
      }))
      // Attach rejection handlers BEFORE another controller can throw. Finish
      // all own cleanup attempts, then propagate failure; never invent closure.
      collect(()=>nativeDrain)
      collect(()=>app.relays.closeAll())
      collect(()=>mediamtx?.stop())
      collect(()=>mediaWorkflow.close())
      collect(()=>app.publishedContinuity.close())
      collect(()=>app.schedulePublication.close())
      collect(()=>app.audioMixAnalysis.close())
      collect(()=>app.hostMetrics.close())
      collect(()=>app.integrationOutbox.close())
      collect(()=>app.integrationOutbox.settled())
      collect(()=>app.ingest.close())
      collect(()=>app.ha?.settled())
      const closeStorage=()=>{app.executionOwnership.close();try{app.distributionOwnership.close()}catch{/* Preserve uncertain resource ownership. */}try{if(sqlite.open){try{instance.storageClosed();admission?.releaseForShutdown(sqlite)}finally{if(!haAdmission)sqlite.close()}}}finally{if(!haAdmission)hostFence?.close()}}
      // Legacy callers may close without flush; keep storage alive until the
      // cancelled worker releases only its own claim after stream/child exit.
      const assertClean=()=>{if(errors.length===1)throw errors[0];if(errors.length)throw new AggregateError(errors,'Falha ao encerrar recursos; storage/posse não serão declarados concluídos.')}
      const asynchronous=closingRuntimes.some(runtime=>runtime.transport instanceof EngineTransport)||mediaWorkflow.isDraining||app.integrationOutbox.isDraining||app.ingest.isDraining||app.ha?.isDraining
      if(asynchronous){closeResult=Promise.all(drains).then(()=>{assertClean();closeStorage()});return closeResult}
      // Preserve immediate SQLite closure for legacy idle/simulated callers.
      try{assertClean();closeStorage()}catch(error){if(!errors.includes(error))errors.push(error)}
      closeResult=Promise.all(drains).then(assertClean);return closeResult
    },
  }

  // Descobre o que a instalação tem uma vez ao subir. Sem isto o primeiro
  // alerta de áudio sairia com "pode faltar" só porque ninguém tinha aberto o
  // diálogo de fontes ainda -- e "pode" é o que este alerta deixou de ser.
  if(!haAdmission)void app.sources.list().catch(() => {
    // Máquina sem descoberta funciona: os alertas voltam a dizer "pode".
  })

  const historicalProcessMetrics=new ProcessMetrics()
  app.hostMetrics.onCapture=()=>captureOperationalMetrics(app.runtimes,historicalProcessMetrics,runtime=>operationalMetricLabels(app.db,runtime.channel.id,app.paths.find(path=>path.channelId===runtime.channel.id),app.runtimes.get(runtime.channel.id)?.executionView??null))
  startupTrace('application construction completed')
  return app
}

export async function runtimeFor(app: App, channelId: string): Promise<ChannelRuntime | null> {
  if(closingApplications.has(app))return null
  if(app.haExecutionAdmission)return null
  if(app.ha?.options.role==='STANDBY')return null
  // Rehearsal DBs are evidence, not a promoted operational installation.
  // Even explicitly unarchiving one in a normal backend must not bypass
  // binding/QC/authority review and start foreign published live endpoints.
  if(isRecoveryRehearsal(app.sqlite)&&!app.restoredAdmission?.nativeStageAllowed(app.sqlite))return null
  const existing = app.runtimes.get(channelId)
  if (existing) return existing
  if(app.configurationChanges.blockedReason(channelId) && !app.configurationChanges.owns(channelId))return null
  if(app.interruptionCommands.blockedReason(channelId))return null
  let pending = runtimeCreations.get(app)
  if (!pending) { pending = new Map(); runtimeCreations.set(app, pending) }
  const current = pending.get(channelId)
  if (current) return current
  const creation = createRuntime(app, channelId).finally(() => pending!.delete(channelId))
  pending.set(channelId, creation)
  return creation
}

const runtimeCreations = new WeakMap<App, Map<string, Promise<ChannelRuntime | null>>>()
const closingApplications=new WeakSet<App>()
export function blockRuntimeCreation(app:App):void{closingApplications.add(app)}

async function createRuntime(app: App, channelId: string): Promise<ChannelRuntime | null> {

  const channel = await getChannel(app.db, channelId)
  if (!channel) return null
  if(app.mediamtx||ENGINE_BINARY){
    try{app.distributionOwnership.claim();await app.hostFence?.freshProof()}catch(error){if(error instanceof CollaborativeEditError||app.hostFence)return null;throw error}
    if(app.mediamtx&&!(await app.mediamtx.waitUntilReady(2000)))return null
  }

  let lease:ExecutionLease|null=null
  if(ENGINE_BINARY){
    try{lease=await app.executionOwnership.claimWhenReady(channelId)}catch(error){if(error instanceof CollaborativeEditError)return null;throw error}
  }
  let created:ChannelRuntime|null=null
  try{

  // No simulated, standby, foreign-owner or quarantined runtime can retire
  // predecessor observations. Existing same-instance probes remain intact.
  if(lease)endPreviousPgmObservation(app.db,channelId,lease,undefined,app.pgmProbes.get(channelId))

  const path = app.paths.find((entry) => entry.channelId === channelId)
  if (app.mediamtx) await ensureManagedOutputs(app.db, channel, path)
  await ensureDefaultGraphics(app.db)

  const profiles = await listOutputs(app.db, channelId)
  const forRole = (role: 'PROGRAM' | 'PREVIEW'): string | null => {
    const row = profiles.find((entry) => entry.role === role)
    const profile = row ? toEngineProfile(row, path) : null
    return profile ? encodeProfile(profile) : null
  }

  // Sem servidor de mídia local não há caminho para publicar, e aí vale o que
  // as variáveis de ambiente disserem -- é o que mantém um canal operável numa
  // máquina que só tem o engine.
  const program = forRole('PROGRAM')
  const extras = profiles
    .filter((entry) => entry.role === 'EXTRA' || entry.role === 'MONITOR')
    .map((entry) => toEngineProfile(entry, path))
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    .map(encodeProfile)

  const outputs = program ? [program, ...extras] : [...ENGINE_OUTPUTS, ...extras]

  // O canal só tem monitor quando existe um perfil vivo para ele -- e quando
  // não existe, o motivo importa mais que o fato: perfil desligado se resolve
  // em Distribuição, servidor de mídia ausente se resolve na instalação.
  const previewOutput = forRole('PREVIEW')
  const monitores = new Set<'pvw' | 'mon'>()
  const motivos = new Map<'pvw' | 'mon', string>()
  const conferir = (bus: 'pvw' | 'mon', role: 'PREVIEW' | 'MONITOR'): void => {
    const row = profiles.find((entry) => entry.role === role)
    if (row && toEngineProfile(row, path) !== null) {
      monitores.add(bus)
      return
    }
    if (!app.mediamtx) {
      motivos.set(bus, 'esta instalação não tem servidor de mídia local (mediamtx)')
    } else if (!path) {
      motivos.set(bus, 'este canal não tem caminho no servidor de mídia')
    } else if (!row) {
      motivos.set(bus, 'o perfil dele não existe neste canal')
    } else if (!row.enabled) {
      motivos.set(bus, `o perfil "${row.name}" está desligado em Distribuição`)
    } else {
      motivos.set(bus, `o perfil "${row.name}" não tem destino`)
    }
  }
  conferir('pvw', 'PREVIEW')
  conferir('mon', 'MONITOR')

  if(app.configurationChanges.blockedReason(channelId) && !app.configurationChanges.owns(channelId)){lease?.release();return null}
  if(app.interruptionCommands.blockedReason(channelId)){lease?.release();return null}
  const qcPreviewOutput = app.mediamtx && path?.inspection && monitores.has('pvw')
    ? JSON.stringify({kind:'srt',target:MediaMtx.loopbackSrt(path.inspection)}) : null
  if(closingApplications.has(app)){lease?.release();return null}
  const runtime = new ChannelRuntime(channel, app.db, outputs, previewOutput, monitores, motivos, app.continuityCache, new Checkpoints(app.sqlite,lease), app.mediaWorkflow, new Interruptions(app.sqlite),app.configurationChanges,app.interruptionCommands,app.ha?.witness??null,qcPreviewOutput,lease,(app.mediamtx||ENGINE_BINARY)?app.distributionOwnership:null,app.restoredAdmission?{host:app.hostFence!,assertAdmission:()=>app.restoredAdmission!.assertLocalEngineLease(app.sqlite)}:null)
  created=runtime
  runtime.reconcileSignalIncidents(true,path)
  app.configurationChanges.trackEngine(channelId,runtime.transport instanceof EngineTransport?runtime.transport.processId():null)
  // Os alertas precisam saber o que falta na instalação, e não podem esperar
  // por uma descoberta a cada tique: perguntam ao que já foi descoberto.
  runtime.aacDisponivel = () => app.sources.temDecodificadorAac()
  app.runtimes.set(channelId, runtime)
  runtime.restoreBoundaryProtection()
  pgmProbeFor(app, channelId)
  return runtime
  }catch(error){
    if(created){created.close();if(app.runtimes.get(channelId)===created)app.runtimes.delete(channelId)}
    else try{lease?.release()}catch{}
    throw error
  }
}

/** Sonda isolada por canal, criada cedo para a UI poder informar sem amostra. */
export function pgmProbeFor(app: App, channelId: string): PgmProbe {
  const existing = app.pgmProbes.get(channelId)
  if (existing) return existing
  const probe = new PgmProbe()
  const policy = app.sqlite.prepare('SELECT payload FROM channel_operational_policies WHERE channel_id=?').get(channelId) as { payload: string } | undefined
  if (policy) {
    const saved = JSON.parse(policy.payload) as { automaticActions: boolean; thresholds?: Parameters<PgmProbe['setThresholds']>[0]; loopRevisionId?: string | null }
    probe.setAutomaticActions(saved.automaticActions === true)
    if (saved.thresholds) probe.setThresholds(saved.thresholds)
    if (saved.loopRevisionId) app.continuityCache.replaceProtection(`contingency:${channelId}`, configuredContingencyAssets(app.db, channelId, saved.loopRevisionId))
  }
  probe.onAction(async (action,alert) => {
    const runtime = await runtimeFor(app, channelId)
    if (!runtime) return { ok: false, message: 'Canal não encontrado.' }
    if (action === 'FAILOVER_HOST_B') return { ok: false, message: 'Standby físico ainda não configurado/homologado; PGM não foi alterado.' }
    if (action === 'CONTINGENCY_LOOP') {
      const row = app.sqlite.prepare('SELECT payload FROM channel_operational_policies WHERE channel_id=?').get(channelId) as { payload: string } | undefined
      const revisionId = row ? (JSON.parse(row.payload) as { loopRevisionId?: string | null }).loopRevisionId : null
      if (!revisionId) return { ok: false, message: 'Selecione uma revisão publicada para a contingência antes de acionar o loop.' }
      await runtime.enterContingency(revisionId)
      return { ok: true, message: 'Arquivo da playlist de contingência confirmado pelo engine no PGM; origem/posição de retorno preservadas.' }
    }
    await runtime.setEmergencySlate(true,{key:'probe-'+alert.id,actorName:'AUTOMATIC',authorize:()=>{if(!probe.getStatus().automaticActionsEnabled)throw new Error('Intervenção automática desarmada antes do envio.')}})
    return { ok: true, message: 'Slate opaco confirmado pelo engine; transmissão subjacente preservada.' }
  })
  app.pgmProbes.set(channelId, probe)
  return probe
}

/** Runtime do canal dono deste rundown, com a grade já carregada. */
export async function runtimeForRundown(
  app: App,
  rundownId: string,
): Promise<ChannelRuntime | null> {
  const rundown = await getRundown(app.db, rundownId)
  if (!rundown) return null

  const runtime = await runtimeFor(app, rundown.channelId)
  if (!runtime) return null
  if (runtime.view?.rundown.id !== rundownId) await runtime.activateRundown(rundownId)
  return runtime
}

/** Runtime do canal dono deste item. */
export async function runtimeForItem(app: App, itemId: string): Promise<ChannelRuntime | null> {
  const [row] = await app.db
    .select({ rundownId: rundownItems.rundownId })
    .from(rundownItems)
    .where(eq(rundownItems.id, itemId))
  return row ? runtimeForRundown(app, row.rundownId) : null
}

/**
 * Põe o servidor local e os relays de acordo com o banco.
 *
 * Chamado na subida e depois de toda mudança em chave de convidado ou destino.
 * Reescrever a config não derruba quem está no ar: o MediaMTX observa o próprio
 * arquivo e recarrega.
 */
export async function syncDistribution(app: App): Promise<void> {
  if(app.haExecutionAdmission)return
  const channels = await listChannels(app.db)
  app.paths = channelPaths(channels)

  if (!app.mediamtx) return
  try{app.distributionOwnership.claim()}catch(error){if(error instanceof CollaborativeEditError){app.mediamtx.lastError=error.message;return}throw error}

  const guests = await app.db.select().from(guestKeys)
  const activeChannelIds = new Set(channels.map(channel=>channel.id))
  try{await app.mediamtx.apply(
    app.paths,
    guests
      .filter((guest) => guest.enabled && activeChannelIds.has(guest.channelId))
      .map((guest) => ({ label: guest.label, streamKey: guest.streamKey })),
  )}catch(error){app.mediamtx.lastError='Configuração da distribuição não foi autorizada; arquivo anterior preservado.';throw error}
  await app.mediamtx.start()
  if (!(await app.mediamtx.waitUntilReady())) {
    console.error('[rplayout] o servidor de mídia local não respondeu; as saídas ficarão mudas.')
    return
  }

  const targets = await app.db.select().from(destinations)
  if(!(await app.mediamtx.waitUntilReady(2000)))return
  app.relays.sync(targets.filter((target) => target.enabled).flatMap((target) => {
    const path = app.paths.find((path) => path.channelId === target.channelId)
    return path ? [{ id: target.id, channelId:target.channelId,name: target.name, url: target.url,
      source: MediaMtx.internalRead(path.program),
      transport: target.url.toLowerCase().startsWith('srt:') ? 'SRT' as const : target.url.toLowerCase().startsWith('rtmp:') || target.url.toLowerCase().startsWith('rtmps:') ? 'RTMP' as const : 'OTHER' as const,
      mode: (() => { try { const value = new URL(target.url).searchParams.get('mode')?.toUpperCase(); return value === 'CALLER' || value === 'LISTENER' || value === 'RENDEZVOUS' ? value : 'UNKNOWN' as const } catch { return 'UNKNOWN' as const } })(),
      latencyMs: (() => { try { const value = Number(new URL(target.url).searchParams.get('latency')); return Number.isFinite(value) && value >= 0 ? value : null } catch { return null } })(),
      primary: (() => { try { return new URL(target.url).searchParams.get('primary') !== 'false' } catch { return true } })(),
      backupFor: (() => { try { return new URL(target.url).searchParams.get('backupFor') } catch { return null } })(),
    }] : []
  }))
}
import {assertOperationalCadence} from './domain/operational-cadence.js'
