import { existsSync, mkdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import cors from '@fastify/cors'
import fastifyStatic from '@fastify/static'
import websocket from '@fastify/websocket'
import Fastify from 'fastify'
import { createApp, pgmProbeFor, runtimeFor, syncDistribution,blockRuntimeCreation } from './app.js'
import {EngineTransport} from './domain/engine.js'
import { sealAudit, verifyAudit } from './domain/audit-seal.js'
import { BACKUP_EVERY_HOURS, BACKUP_MIRROR_DIR, DB_FILE, HOST, PORT, HEALTH_RETENTION_DAYS, HTTP_AUDIT_RETENTION_DAYS } from './config.js'
import { listChannels, listRundowns } from './db/repo.js'
import { backupDatabase, backupDue, mirrorNewestBackup } from './domain/backup.js'
import { listRoots } from './domain/roots.js'
import { registerRoutes } from './routes.js'
import { healthEvents } from './db/schema.js'
import { AlertNotifier } from './domain/alert-notifier.js'
import { severityOf } from './domain/health.js'
import { emitIntegrationEvent } from './domain/integrations.js'
import {persistPgmSignalIncidents} from './domain/pgm-signal-incidents.js'
import {captureIncidentContext} from './domain/incident-context.js'
import {operationalMetricLabels} from './domain/operational-metric-labels.js'
import {pruneHealthHistory,pruneHttpAudit} from './domain/health-retention.js'
import { executionHorizon, horizonWarning } from './domain/continuous.js'
import { recordHorizonWarning } from './domain/horizon-ledger.js'
import { AccessControl } from './domain/access.js'
import {expireSessions} from './domain/session-expiry.js'
import { warmChannelCache } from './domain/published-cache-plan.js'
import { redactUrl } from './domain/relays.js'
import { sourceWire } from './domain/source-wire.js'
import {isRecoveryRehearsal} from './domain/recovery-rehearsal.js'
import {createStagedRestoredApp} from './domain/staged-restored-app.js'
import {activateRestoredApp} from './domain/activate-restored-app.js'
import {databaseStorageStatus} from './db/process-database.js'
import {prepareUpgradeProfileAdoption} from './domain/upgrade-profile-adoption.js'
import {startupTrace} from './domain/startup-trace.js'
import {recoverInterruptedReservationAtStartup} from './domain/startup-reservation-recovery.js'
import {BackgroundTaskGuard} from './domain/background-task-guard.js'
import {privateHttpLogger,privateStartupDiagnostic,registerHttpPrivacy} from './domain/http-privacy.js'
import {parseAllowedOrigins} from './domain/http-origin-policy.js'
import {parseAllowedHosts,createHttpHostPolicy,registerHttpHostPolicy} from './domain/http-host-policy.js'
import {registerLauncherDiscovery} from './domain/launcher-discovery.js'
import {internalFailureDiagnostic} from './domain/http-privacy.js'

/** Cadência do estado ao vivo. Vinte por segundo já engana o olho no medidor. */
const LIVE_HZ = 20
const SOCKET_AUTH_TTL_MS = 1_000

async function main(): Promise<void> {
  startupTrace('main entered')
  // A rejected background promise must not end the process: the engine is a
  // child of this server, so exiting takes the PGM off air (22/10). Record it
  // (function names only, no message/paths) and keep the channel running.
  process.on('unhandledRejection',reason=>{
    try{console.error('RPlayout · falha assíncrona não tratada; servidor mantido no ar.',JSON.stringify(internalFailureDiagnostic(reason)))}catch{}
  })
  const allowedOrigins=parseAllowedOrigins(process.env.RPLAYOUT_ALLOWED_ORIGINS)
  const hostPolicy=createHttpHostPolicy({bindHost:HOST,listenPort:PORT,aliases:parseAllowedHosts(process.env.RPLAYOUT_ALLOWED_HOSTS)})
  const args=process.argv.slice(2)
  if(args.length&&(args.length!==2||!['--stage-restored','--activate-restored'].includes(args[0]!)||!args[1]||args[1].startsWith('--')))throw new Error('Use sem argumentos, --stage-restored ou --activate-restored seguido do manifesto.')
  const activated=args[0]==='--activate-restored'
  const adoptionFile=process.env.RPLAYOUT_ADOPT_UPGRADE_PROFILE
  if(adoptionFile&&(!activated||!process.env.RPLAYOUT_INSTALL_ROOT))throw new Error('Adoção de perfil exige ativação restaurada explícita e instalação definida.')
  const adopt=adoptionFile?prepareUpgradeProfileAdoption(adoptionFile,process.env.RPLAYOUT_INSTALL_ROOT!,DB_FILE):null
  if(!args.length){
    const recovery=await recoverInterruptedReservationAtStartup(DB_FILE)
    if(recovery.check==='RECOVER')console.log(recovery.recovered?'RPlayout · reserva do banco deixada por um encerramento anterior foi liberada pela recuperação oficial.':`RPlayout · reserva do banco preservada; recuperação recusada: ${recovery.detail??'sem detalhe'}`)
    startupTrace('interrupted reservation checked')
  }
  const app = activated?await activateRestoredApp(DB_FILE,args[1]!):args.length?await createStagedRestoredApp(DB_FILE,args[1]!):await createApp(DB_FILE)
  startupTrace('application ready')
  if(adopt)try{await adopt(app)}catch(error){await app.close();throw error}
  app.hostMetrics.onIncident = (state,message,sample) => { void emitIntegrationEvent(app.db,`host.${state}`,{message,sampledAt:sample.generatedAt,cpu:sample.cpu.percent,memory:sample.memory.percent,disk:sample.disk.percentUsed}) }
  if (app.mediaRoot) {
    try {
      mkdirSync(resolve(app.mediaRoot), { recursive: true })
    } catch {
      // Ignora erro se não conseguir criar pasta de mídia padrão
    }
  }
  const server = Fastify({ logger: privateHttpLogger(process.env.LOG_LEVEL ?? 'info') })
  registerHttpPrivacy(server,{notFound:false})
  registerHttpHostPolicy(server,hostPolicy)

  await server.register(cors, { origin: allowedOrigins.length ? allowedOrigins : false, credentials: true })
  await server.register(websocket)

  /**
   * A interface construída, servida pelo próprio servidor.
   *
   * Numa máquina de playout não se roda servidor de desenvolvimento: são dois
   * processos para o operador cuidar, e o `vite` não é feito para ficar meses
   * no ar. Com `pnpm build` feito, tudo sai de uma porta só.
   *
   * Sem a pasta construída o servidor sobe do mesmo jeito -- é o modo de
   * desenvolvimento, em que quem serve a interface é o `vite` na 5173.
   */
  // No pacote o servidor é um único CommonJS em `apps/server/dist`; usar a
  // pasta da instalação evita depender de `import.meta.url` ou de um runner
  // TypeScript. Em desenvolvimento o pnpm normalmente inicia em apps/server.
  const installRoot = process.env.RPLAYOUT_INSTALL_ROOT
    ?? (existsSync(resolve(process.cwd(), 'apps/web/dist')) ? process.cwd() : resolve(process.cwd(), '../..'))
  const web = resolve(installRoot, 'apps/web/dist')
  const launcherDiscovery=registerLauncherDiscovery(server,{enabled:process.env.RPLAYOUT_LAUNCHER_DISCOVERY==='1',root:installRoot,database:DB_FILE,port:PORT})
  if (existsSync(join(web, 'index.html'))) {
    await server.register(fastifyStatic, {
      root: web,
      // O index é o manifesto do bundle. Sem isto o Chrome pode conservar uma
      // versão antiga e o operador acreditar que a build não mudou.
      setHeaders: (response, filePath) => {
        if (filePath.endsWith('index.html')) response.raw.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate')
      },
    })

    // A interface é uma página só: qualquer caminho que não seja da API nem
    // arquivo existente devolve o `index.html`, senão recarregar numa rota
    // interna daria 404.
    server.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api') || request.url.startsWith('/ws')) {
        return reply.code(404).send({ error: 'Rota não existe.' })
      }
      return reply.sendFile('index.html')
    })
    server.log.info(`RPlayout · interface servida de ${web}`)
  }else server.setNotFoundHandler((_,reply)=>reply.code(404).send({error:'Rota não existe.'}))

  const access = new AccessControl(app.sqlite)
  const sockets = new Map<{ send: (data: string) => void; close: (code?: number, reason?: string) => void }, { headers: Record<string, string | string[] | undefined>; ip: string }>()
  const storageConnected=()=>databaseStorageStatus(app.sqlite).connected
  const background=new BackgroundTaskGuard(storageConnected,()=>{
    for(const socket of sockets.keys())try{socket.close(4503,'Banco indisponível; controle bloqueado. Confira o servidor.')}catch{}
    sockets.clear()
    server.log.error('Banco indisponível; tarefas agendadas desta instância suspensas, sem reabertura ou reenvio automático.')
  },(task,error)=>server.log.error({err:error,task},'Falha em tarefa de segundo plano; nenhum reenvio feito por esta chamada.'))

  // The live feed goes out 20x per second per channel. Re-reading users,
  // session and access policy from storage for every socket on every frame
  // was the largest storage load with several Master/QC windows open. The
  // decision per socket is reused for at most one second: a revoked session
  // or narrowed channel scope takes effect within that second.
  const socketAuth = new WeakMap<object, { at: number; closed: boolean; channelIds: string[] | null }>()
  const authFor = (socket: object, request: { headers: Record<string, unknown>; ip?: string }) => {
    const now = Date.now(), cached = socketAuth.get(socket)
    if (cached && now - cached.at < SOCKET_AUTH_TTL_MS) return cached
    const identity = access.identity(request as never), required = identity ? true : access.required()
    // Same rules as AccessControl.channelAllowed: identity scope, or open
    // installation (no users) allows everything; required without identity closes.
    const decision = { at: now, closed: required && !identity, channelIds: identity ? identity.channelIds : null }
    socketAuth.set(socket, decision)
    return decision
  }
  const broadcast = (payload: unknown): void => {
    const data = JSON.stringify(sourceWire().publicValue(payload))
    for (const [socket, request] of sockets) {
      try {
        const auth = authFor(socket, request)
        if (auth.closed) {
          socket.close(4401, 'Sessão encerrada. Entre novamente.'); sockets.delete(socket); continue
        }
        const channelId = payload && typeof payload === 'object' && 'channelId' in payload ? (payload as { channelId?: unknown }).channelId : null
        if (typeof channelId === 'string' && auth.channelIds !== null && !auth.channelIds.includes(channelId)) continue
        socket.send(data)
      } catch {
        try{socket.close(storageConnected()?1011:4503,'Controle indisponível; confira o servidor.')}catch{}
        sockets.delete(socket)
      }
    }
  }

  /** Uma alteração no rundown vale por uma grade inteira nova na tela. */
  const pushViews = (): void => {
    for (const runtime of app.runtimes.values()) {
      // Protect current decoders independently of a slow rolling-window copy.
      app.continuityCache.replaceProtection(`runtime:${runtime.channel.id}`,runtime.cachePins())
      broadcast({ type: 'view', channelId: runtime.channel.id, view: runtime.view, executionView: runtime.executionView, operationalRevision: runtime.operationalRevision })
    }
  }

  registerRoutes(app, server, pushViews)

  server.get('/ws', { websocket: true }, (socket, request) => {
    sockets.set(socket, { headers: request.headers, ip: request.ip })
    for (const runtime of app.runtimes.values()) {
      if (!access.channelAllowed(request, runtime.channel.id)) continue
      socket.send(
        JSON.stringify(sourceWire().publicValue({ type: 'view', channelId: runtime.channel.id, view: runtime.view, executionView: runtime.executionView, operationalRevision: runtime.operationalRevision })),
      )
      // A grade por si só não descreve o barramento. Sem este primeiro estado
      // a tela recém-aberta pode ficar até um segundo dizendo que não há PVW
      // ou PGM, apesar de o motor já estar reproduzindo. Isso também elimina a
      // corrida entre o snapshot HTTP inicial e o primeiro tick do WebSocket.
      socket.send(JSON.stringify(sourceWire().publicValue({ type: 'live', channelId: runtime.channel.id, ...runtime.live() })))
    }
    socket.on('close', () => sockets.delete(socket))
  })

  // O servidor de mídia sobe antes dos canais: é nele que o engine publica.
  try{if(!activated)await syncDistribution(app)}catch(error){
    // Keep diagnostics/editorial access available, but runtime admission and
    // the watchdog refuse unconfirmed media/configuration. Never load an old
    // installation's config just because a foreign HTTP endpoint responds.
    server.log.error({err:error},'Distribuição bloqueada na partida; nenhum canal nativo será aberto sem prontidão confirmada')
  }

  // Carrega a primeira grade de cada canal para que o transporte tenha o que
  // executar assim que o servidor sobe.
  for (const channel of activated?[]:await listChannels(app.db)) {
    const runtime = await runtimeFor(app, channel.id)
    const [first] = await listRundowns(app.db, channel.id)
    if (runtime && !(await runtime.recoverCheckpoint()) && first) await runtime.load(first.id)
  }

  // Medição nova precisa chegar à grade: o nivelamento automático sai da
  // loudness do arquivo, e ela acabou de mudar.
  app.ingest.onFinished = () => {
    void background.run('ingest-refresh',async()=>{
      await Promise.all([...app.runtimes.values()].map(runtime=>runtime.refresh()))
      if(storageConnected()){pushViews();broadcast({type:'library'})}
    })
  }

  let checkingLibrary = false
  let libraryClosing = false
  const updateLibrary = async (): Promise<void> => {
    if(!databaseStorageStatus(app.sqlite).connected)return
    if(app.ha?.options.role==='STANDBY'||isRecoveryRehearsal(app.sqlite))return
    if (checkingLibrary || libraryClosing || app.ingest.status().running) return
    checkingLibrary = true
    try {
      if (await app.ingest.reconcileAvailability()) app.ingest.onFinished?.()
      if (libraryClosing) return
      if(app.ingest.resumePending())return
      const roots = await listRoots(app.db, app.mediaRoot)
      // A procura automática é rápida. A medição completa continua disponível
      // em LER PASTA e não muda de modo quando outro operador pede uma busca.
      app.ingest.start(roots.map((root) => root.path), false)
    } catch (error) {
      server.log.error({err:error},'Falha na atualização periódica do acervo.')
    } finally {
      checkingLibrary = false
    }
  }
  const libraryTimer = setInterval(() => void background.run('library',updateLibrary), 60_000)
  const primaryTasks=()=>storageConnected()&&app.ha?.options.role!=='STANDBY'&&!isRecoveryRehearsal(app.sqlite)
  void background.run('startup-media',()=>{app.ingest.resumePending();return app.mediaWorkflow.tick()},primaryTasks)
  void background.run('startup-audio',()=>app.audioMixAnalysis.tick(),primaryTasks)
  const mediaWorkflowTimer=setInterval(()=>void background.run('media-workflow',()=>app.mediaWorkflow.tick(),primaryTasks),2000)
  const audioAnalysisTimer=setInterval(()=>void background.run('audio-analysis',()=>app.audioMixAnalysis.tick(),primaryTasks),2000)
  const publishedContinuityTimer=setInterval(()=>void background.run('published-continuity',()=>app.publishedContinuity.tick(),primaryTasks),1000)
  const schedulePublicationTimer=setInterval(()=>void background.run('schedule-publication',()=>app.schedulePublication.tick(),primaryTasks),15000)
  const haTimer=app.ha?.options.role==='PRIMARY'?setInterval(()=>void background.run('ha-state',()=>app.ha?.tick(),()=>!isRecoveryRehearsal(app.sqlite)),5000):null
  const haMediaTimer=app.ha?.options.role==='PRIMARY'?setInterval(()=>void background.run('ha-media',()=>app.ha?.mediaTick(async asset=>{
    const archive=await app.mediaWorkflow.archived(asset.id,asset.contentHash)
    if(archive)return archive
    if(await app.continuityCache.verified(asset))return app.continuityCache.pathFor(asset)
    return asset.path
  }),()=>!isRecoveryRehearsal(app.sqlite)),250):null
  void background.run('startup-library',updateLibrary)

  // Selagem da auditoria de segurança: cadeia de hashes que denuncia adulteração.
  const sealAndCheck=()=>void background.run('audit-seal',()=>{
    try{
      sealAudit(app.sqlite)
      const integrity=verifyAudit(app.sqlite)
      if(!integrity.ok){
        server.log.error(`Auditoria de segurança ADULTERADA: ${integrity.problem} (selo ${integrity.firstBrokenSeal}).`)
        const open=app.sqlite.prepare("SELECT 1 FROM health_events WHERE component='AUDIT' AND state='tampered' AND resolved_at IS NULL LIMIT 1").get()
        if(!open)void app.db.insert(healthEvents).values({id:randomUUID(),channelId:null,component:'AUDIT',state:'tampered',severity:'CRITICAL',message:`Auditoria de segurança adulterada: ${integrity.problem}`,occurredAt:new Date().toISOString()}).run()
      }
    }catch(error){server.log.warn(`Selagem da auditoria falhou: ${error instanceof Error?error.message:String(error)}`)}
  },()=>!isRecoveryRehearsal(app.sqlite))
  const sealTimer=setInterval(sealAndCheck,10*60*1000)
  const sealStartTimer=setTimeout(sealAndCheck,30*1000)

  // Cópia de segurança periódica. Um playout que roda meses sem ninguém olhar
  // precisa de cópia sem depender de alguém lembrar de pedir.
  let backingUp=false
  const periodicBackup=()=>void background.run('backup',async()=>{
    if(backingUp)return
    backingUp=true
    try{
      if(await backupDue(app.backupDir,BACKUP_EVERY_HOURS)){await backupDatabase(app.sqlite,app.backupDir);server.log.info('Cópia de segurança do banco concluída.')}
      if(BACKUP_MIRROR_DIR){
        try{const mirrored=await mirrorNewestBackup(app.backupDir,BACKUP_MIRROR_DIR);if(mirrored.copied)server.log.info(`Cópia do banco espelhada em ${BACKUP_MIRROR_DIR}.`)}
        catch(error){server.log.warn(`Espelho da cópia do banco falhou (${BACKUP_MIRROR_DIR}): ${error instanceof Error?error.message:String(error)}`);void app.db.insert(healthEvents).values({id:randomUUID(),channelId:null,component:'BACKUP',state:'mirror_failed',severity:'CRITICAL',message:`Espelho da cópia do banco falhou em ${BACKUP_MIRROR_DIR}: ${error instanceof Error?error.message:String(error)}`,occurredAt:new Date().toISOString()}).run()}
      }
    }finally{backingUp=false}
  },()=>!isRecoveryRehearsal(app.sqlite))
  // Checked every 10 min against the newest copy on disk, and once 5 min after
  // start (outside the startup load), so restarts don't postpone it forever.
  const backupTimer = BACKUP_EVERY_HOURS > 0 ? setInterval(periodicBackup, 10 * 60 * 1000) : null
  const backupStartTimer = BACKUP_EVERY_HOURS > 0 ? setTimeout(periodicBackup, 5 * 60 * 1000) : null

  // Retenção evita crescimento infinito em operação 24/7. Eventos não
  // reconhecidos ficam preservados até serem reconhecidos, mesmo que antigos.
  const retentionTimer = setInterval(() => void background.run('health-retention',() => {
    if (Number.isFinite(HEALTH_RETENTION_DAYS) && HEALTH_RETENTION_DAYS > 0) pruneHealthHistory(app.sqlite,HEALTH_RETENTION_DAYS)
    // Batches of 5 000 every 10 minutes clear a large backlog without a long lock.
    pruneHttpAudit(app.sqlite,HTTP_AUDIT_RETENTION_DAYS)
  },()=>!isRecoveryRehearsal(app.sqlite)), 10 * 60 * 1000)
  const expireSessionBatch=()=>{
    if(!storageConnected())return
    try{expireSessions(app.db)}catch(error){server.log.error({err:error},'Expiração de sessões não auditada; lote preservado para nova tentativa.')}
  }
  void background.run('startup-session-expiry',expireSessionBatch)
  const sessionExpiryTimer=setInterval(()=>void background.run('session-expiry',expireSessionBatch),60_000)

  const recorded = new Map<string, string>()
  let lastCacheWarm = 0
  let cacheWarming = false
  let distributionChecking=false
  // Do not run native socket/HTTP probes at the preview frame cadence. Only a
  // freshly verified local source authorizes new/restarted relays.
  const distributionTimer=setInterval(()=>void background.run('distribution',async()=>{
    if(distributionChecking)return
    distributionChecking=true
    try{
      app.mediamtx?.watchdog()
      if((!app.mediamtx||await app.mediamtx.waitUntilReady(500))&&storageConnected())app.relays.tick()
    }finally{distributionChecking=false}
  }),1000)
  const timer = setInterval(() => void background.run('live-cycle',() => {
    // No new scheduled native effects from stale storage authority. Preserve
    // existing PGM; never replay an uncertain write to reopen this connection.
    // MediaMTX é um processo único do servidor: seu watchdog deve rodar uma
    // vez por ciclo, independentemente da quantidade de canais.
    // Reconnecta destinos externos de forma isolada e com backoff; uma queda
    // não deve criar uma tempestade de processos nem exigir reinício manual.
    if (!cacheWarming && Date.now() - lastCacheWarm >= 60_000) {
      lastCacheWarm = Date.now()
      cacheWarming = true
      void background.run('published-cache',async () => {
        // Include published dates even when no operator has loaded the grade.
        for (const channel of await listChannels(app.db)) await warmChannelCache(app,channel.id)
      }).finally(() => {cacheWarming=false})
    }
    for (const runtime of app.runtimes.values()) {
      app.continuityCache.replaceProtection(`runtime:${runtime.channel.id}`,runtime.cachePins())
      try{runtime.reconcileSignalIncidents(false,app.paths.find(path=>path.channelId===runtime.channel.id))}
      catch(error){server.log.error({err:error},'Incidentes de fontes/saídas não persistidos; nova tentativa sem alterar PGM.')}
      if(!storageConnected())return
      // O canal anda com ou sem interface aberta. Amarrar isto à presença de
      // um navegador seria congelar a grade e o nivelamento no instante em que
      // o último operador fecha a aba -- num sistema que fica no ar sozinho a
      // madrugada inteira, isso é o defeito mais caro que existe.
      // Antes de qualquer coisa: o motor está de pé e produzindo?
      runtime.transport.watchdog()
      const health = runtime.transport.health()
      const state = health.error ? 'error' : 'running'
      const key = `engine:${runtime.channel.id}`
      const signature = `${state}|${health.error ?? ''}|${health.restarts}|${health.deaths}|${health.stalls}|${runtime.transport.processId() ?? ''}`
      if (recorded.get(key) !== signature) {
        void app.db.insert(healthEvents).values({ id: randomUUID(), channelId: runtime.channel.id, component: 'ENGINE', state, severity: severityOf('ENGINE', state, health.error), message: health.error, occurredAt: new Date().toISOString() }).run()
        recorded.set(key, signature)
        void emitIntegrationEvent(app.db, `engine.${state}`, { message: health.error, restarts: health.restarts }, runtime.channel.id)
      }
      const videoHealthKey = `video-health:${runtime.channel.id}`
      const videoHealth = health.stalls > 0 ? 'stalled' : 'running'
      if (recorded.get(videoHealthKey) !== videoHealth) {
        const message = videoHealth === 'stalled'
          ? `Engine detectou ${health.stalls} congelamento(s) de vídeo.`
          : 'Fluxo de vídeo recuperado.'
        void app.db.insert(healthEvents).values({ id: randomUUID(), channelId: runtime.channel.id, component: 'VIDEO', state: videoHealth, severity: videoHealth === 'stalled' ? 'CRITICAL' : 'INFO', message, occurredAt: new Date().toISOString() }).run()
        recorded.set(videoHealthKey, videoHealth)
        void emitIntegrationEvent(app.db, `video.${videoHealth}`, { stalls: health.stalls, deaths: health.deaths }, runtime.channel.id)
      }
      const warning = runtime.transport.warning()
      const warningKey = `engine-warning:${runtime.channel.id}`
      if (warning && recorded.get(warningKey) !== warning) {
        void app.db.insert(healthEvents).values({ id: randomUUID(), channelId: runtime.channel.id, component: 'ENGINE', state:'warning', severity:'WARN', message: warning, occurredAt: new Date().toISOString() }).run()
        recorded.set(warningKey, warning)
        void emitIntegrationEvent(app.db,'engine.warning', { message: warning }, runtime.channel.id)
      }
      // Silêncio sustentado no programa é uma falha operacional diferente de
      // engine parado. O medidor já vem do pipeline real (ou do simulador),
      // portanto não inferimos áudio a partir de conexão WebRTC.
      const {meter,videoProbe}=runtime.transport.signalSample()
      pgmProbeFor(app,runtime.channel.id).onContext(()=>captureIncidentContext(runtime,operationalMetricLabels(app.db,runtime.channel.id,app.paths.find(path=>path.channelId===runtime.channel.id),runtime.executionView)))
      // A sonda recebe somente leituras publicadas pelo engine: áudio BS.1770
      // e o quadro reduzido após o compositor PGM. O navegador não participa
      // desta decisão, então não cria falso black/freeze por WebRTC atrasado.
      if ((meter !== null || videoProbe !== null) && runtime.transport.state().playing) {
        pgmProbeFor(app, runtime.channel.id).feedMetrics({
          // dBFS is not LUFS. Peak gives a conservative silence gate: do not
          // declare silence while any measured channel contains audible peaks.
          audioDbfs: meter ? Math.max(...meter.peakDbfs) : undefined,
          isBlack: videoProbe?.black,
          isFreeze: runtime.executionView?.items.find((entry) => entry.item.id === runtime.transport.state().onAir?.itemId)?.asset?.kind === 'STILL' ? false : videoProbe?.freeze,
          freezeDurationMs: runtime.executionView?.items.find((entry) => entry.item.id === runtime.transport.state().onAir?.itemId)?.asset?.kind === 'STILL' ? 0 : videoProbe?.freezeDurationMs,
        })
      } else pgmProbeFor(app, runtime.channel.id).idle()
      try{persistPgmSignalIncidents(app.db,runtime.channel.id,pgmProbeFor(app,runtime.channel.id))}
      catch(error){server.log.error({err:error},'Incidente PGM não persistido; transição retida para nova tentativa.')}
      if(!storageConnected())return
      // Only the loaded execution can tell us when the channel may end.
      // Editing tomorrow's schedule neither extends today's coverage nor
      // authorizes a blind automatic fill/publication/TAKE through HTTP.
      const horizon = executionHorizon(runtime.executionView, runtime.transport.state().onAir,
        runtime.operationalRevision?.id ?? null)
      const janela = Math.round(runtime.channel.rate.num * 60 * 5 / runtime.channel.rate.den)
      const horizonNotice = horizonWarning(horizon, runtime.transport.state().playing, janela)
      const horizonKey = `horizon:${runtime.channel.id}`
      const horizonSignature = horizonNotice ? JSON.stringify([horizonNotice, runtime.operationalRevision ? null : runtime.executionView?.editorialRevision]) : 'ok'
      if (recorded.get(horizonKey) !== horizonSignature) {
        try {
          if (horizonNotice && recordHorizonWarning(app.db, runtime.channel.id, horizonNotice, runtime.executionView?.editorialRevision ?? null)) {
            const passage=runtime.boundaryStatus()
            void emitIntegrationEvent(app.db, 'scheduler.degraded', { message: horizonNotice.message,
              rundownId: horizon.rundownId, revisionId: horizon.revisionId, date: horizon.rundownDate,
              endsAt: horizon.endsAtFrames, nextPlaylistState:passage.current?.state ?? null,
              automaticHandover:passage.nativeEngine && passage.current?.state==='QUEUED' && passage.current.plan.sourceRevisionId===passage.sourceRevisionId }, runtime.channel.id)
          }
          recorded.set(horizonKey, horizonSignature)
        } catch (error: unknown) {
          server.log.warn({err:error},'scheduler: aviso não persistido; nova tentativa sem alterar PGM.')
        }
      }
      if(!storageConnected())return
      if (runtime.transport.tick()) {
        void background.run('telemetry-refresh',async()=>{await runtime.refreshForTelemetry();if(storageConnected())pushViews()})
      }
      // Crédito que fica no ar porque ninguém lembrou de tirar é erro clássico
      // de operação: o template diz quanto dura e quem cumpre é o servidor.
      runtime.expireGraphics()
      // Deixa de grafismo presa a item entra sozinha na hora marcada.
      runtime.fireDueGraphics()
      // E o que passou fica escrito: a grade diz o que era para acontecer, o
      // as-run diz o que aconteceu.
      void background.run('as-run',()=>runtime.followAsRun())
      runtime.checkpoint()
      if(!storageConnected())return
      // Canal vazio mostra apresentação técnica, quando há uma escolhida.
      runtime.followSlate()
      // Só o desenho depende de audiência: medir e transmitir para ninguém é
      // que não faz sentido.
      if (sockets.size > 0) {
        broadcast({ type: 'live', channelId: runtime.channel.id, ...runtime.live() })
      }
    }
    if (app.mediamtx) {
      const key = 'mediamtx'
      const state = app.mediamtx.running ? 'running' : 'stopped'
      const signature = `${state}|${app.mediamtx.processId ?? ''}|${app.mediamtx.lastError ?? ''}`
      if (recorded.get(key) !== signature) {
        void app.db.insert(healthEvents).values({ id: randomUUID(), channelId: null, component: 'MEDIAMTX', state, severity: severityOf('MEDIAMTX', state, app.mediamtx.lastError), message: app.mediamtx.lastError, occurredAt: new Date().toISOString() }).run()
        recorded.set(key, signature)
      }
    }
  }), 1000 / LIVE_HZ)

  let shuttingDown = false
  const shutdown = async (exitCode=0): Promise<void> => {
    if (shuttingDown) return
    shuttingDown = true
    background.close()
    libraryClosing = true
    clearInterval(libraryTimer)
    clearInterval(mediaWorkflowTimer)
    clearInterval(audioAnalysisTimer)
    clearInterval(publishedContinuityTimer)
    clearInterval(schedulePublicationTimer)
    if(haTimer)clearInterval(haTimer)
    if(haMediaTimer)clearInterval(haMediaTimer)
    clearInterval(timer)
    clearInterval(distributionTimer)
    if (backupTimer) clearInterval(backupTimer)
    clearInterval(sealTimer);clearTimeout(sealStartTimer)
    if (backupStartTimer) clearTimeout(backupStartTimer)
    clearInterval(retentionTimer)
    clearInterval(sessionExpiryTimer)
    blockRuntimeCreation(app)
    const failures:unknown[]=[],normalClosures:Promise<void>[]=[]
    const failed=(error:unknown)=>{failures.push(error);try{server.log.error(privateStartupDiagnostic(error),'Falha no encerramento; nenhum fechamento será anunciado como bem-sucedido.')}catch{}}
    const attempt=async(work:()=>unknown)=>{try{await work()}catch(error){failed(error)}}
    const ordinaryLocal=!app.ha&&!app.restoredAdmission&&!app.haExecutionAdmission
    for (const runtime of app.runtimes.values()) {
      try{runtime.checkpoint(true)}catch(error){failed(error)}
      try{
        if(ordinaryLocal&&runtime.transport instanceof EngineTransport)normalClosures.push(runtime.closeGracefully().then(proof=>{
          if(!proof.ownedNativeProcessesStopped||!proof.graceful)failed(new Error('Engine não confirmou encerramento normal.'))
        },failed))
        else runtime.close()
      }catch(error){failed(error)}
    }
    // A flush/HTTP/storage failure must not skip cleanup of our native handles.
    await attempt(()=>app.flush())
    await attempt(()=>server.close())
    await attempt(async()=>{app.ha?.close();await app.ha?.settled()})
    await attempt(()=>app.close())
    await Promise.all(normalClosures)
    process.exit(failures.length?1:exitCode)
  }
  process.on('SIGINT', () => void shutdown())
  process.on('SIGTERM', () => void shutdown())

  startupTrace('HTTP listen requested')
  await server.listen({ port: PORT, host: HOST })
  try{await launcherDiscovery.publish()}catch(error){server.log.error(privateStartupDiagnostic(error),'Identificação privada do launcher não foi publicada; encerrando somente esta partida.');await shutdown(1)}
  startupTrace('HTTP listening')
  void background.run('startup-ha',()=>app.ha?.tick(),()=>!isRecoveryRehearsal(app.sqlite))
  app.hostMetrics.start()
  if(primaryTasks())app.integrationOutbox.start()
  // Alertas críticos/avisos para fora da tela (Telegram/webhook), com lembrete sem ciente.
  const alertNotifier=new AlertNotifier(app.db)
  if(primaryTasks())alertNotifier.start()
  server.log.info(`RPlayout · banco em ${DB_FILE}`)
}

main().catch((error: unknown) => {
  console.error('RPlayout não iniciou:',privateStartupDiagnostic(error))
  process.exit(1)
})
