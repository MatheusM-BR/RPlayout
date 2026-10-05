import { existsSync, mkdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import cors from '@fastify/cors'
import fastifyStatic from '@fastify/static'
import websocket from '@fastify/websocket'
import Fastify from 'fastify'
import { createApp, pgmProbeFor, runtimeFor, syncDistribution } from './app.js'
import { BACKUP_EVERY_HOURS, DB_FILE, HOST, PORT, HEALTH_RETENTION_DAYS } from './config.js'
import { listChannels, listRundowns } from './db/repo.js'
import { backupDatabase } from './domain/backup.js'
import { listRoots } from './domain/roots.js'
import { registerRoutes } from './routes.js'
import { healthEvents } from './db/schema.js'
import { severityOf } from './domain/health.js'
import { emitIntegrationEvent } from './domain/integrations.js'
import { executionHorizon, horizonWarning } from './domain/continuous.js'
import { recordHorizonWarning } from './domain/horizon-ledger.js'
import { AccessControl } from './domain/access.js'
import { warmChannelCache } from './domain/published-cache-plan.js'
import { redactUrl } from './domain/relays.js'
import { sourceWire } from './domain/source-wire.js'

/** Cadência do estado ao vivo. Vinte por segundo já engana o olho no medidor. */
const LIVE_HZ = 20

async function main(): Promise<void> {
  const app = await createApp(DB_FILE)
  app.hostMetrics.onIncident = (state,message,sample) => { void emitIntegrationEvent(app.db,`host.${state}`,{message,sampledAt:sample.generatedAt,cpu:sample.cpu.percent,memory:sample.memory.percent,disk:sample.disk.percentUsed}) }
  if (app.mediaRoot) {
    try {
      mkdirSync(resolve(app.mediaRoot), { recursive: true })
    } catch {
      // Ignora erro se não conseguir criar pasta de mídia padrão
    }
  }
  const server = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } })

  const allowedOrigins = (process.env.RPLAYOUT_ALLOWED_ORIGINS ?? '').split(',').map(value => value.trim()).filter(Boolean)
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
  }

  const access = new AccessControl(app.sqlite)
  const sockets = new Map<{ send: (data: string) => void; close: (code?: number, reason?: string) => void }, { headers: Record<string, string | string[] | undefined>; ip: string }>()

  const broadcast = (payload: unknown): void => {
    const data = JSON.stringify(sourceWire().publicValue(payload))
    for (const [socket, request] of sockets) {
      try {
        if (access.required() && !access.identity(request)) {
          socket.close(4401, 'Sessão encerrada. Entre novamente.'); sockets.delete(socket); continue
        }
        const channelId = payload && typeof payload === 'object' && 'channelId' in payload ? (payload as { channelId?: unknown }).channelId : null
        if (typeof channelId === 'string' && !access.channelAllowed(request, channelId)) continue
        socket.send(data)
      } catch {
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
  await syncDistribution(app)

  // Carrega a primeira grade de cada canal para que o transporte tenha o que
  // executar assim que o servidor sobe.
  for (const channel of await listChannels(app.db)) {
    const runtime = await runtimeFor(app, channel.id)
    const [first] = await listRundowns(app.db, channel.id)
    if (runtime && !(await runtime.recoverCheckpoint()) && first) await runtime.load(first.id)
  }

  // Medição nova precisa chegar à grade: o nivelamento automático sai da
  // loudness do arquivo, e ela acabou de mudar.
  app.ingest.onFinished = () => {
    void Promise.all([...app.runtimes.values()].map((runtime) => runtime.refresh())).then(
      () => { pushViews(); broadcast({ type: 'library' }) },
    ).catch((error: unknown) => server.log.error(error))
  }

  let checkingLibrary = false
  let libraryClosing = false
  const updateLibrary = async (): Promise<void> => {
    if(app.ha?.options.role==='STANDBY')return
    if (checkingLibrary || libraryClosing || app.ingest.status().running) return
    checkingLibrary = true
    try {
      if (await app.ingest.reconcileAvailability()) app.ingest.onFinished?.()
      if (libraryClosing) return
      const roots = await listRoots(app.db, app.mediaRoot)
      // A procura automática é rápida. A medição completa continua disponível
      // em LER PASTA e não muda de modo quando outro operador pede uma busca.
      app.ingest.start(roots.map((root) => root.path), false)
    } catch (error) {
      server.log.error(error)
    } finally {
      checkingLibrary = false
    }
  }
  const libraryTimer = setInterval(() => void updateLibrary(), 60_000)
  const primaryTasks=app.ha?.options.role!=='STANDBY'
  if(primaryTasks){app.ingest.resumePending();void app.mediaWorkflow.tick();void app.audioMixAnalysis.tick().catch(error=>server.log.error(error))}
  const audioAnalysisTimer=setInterval(()=>{if(primaryTasks)void app.audioMixAnalysis.tick().catch(error=>server.log.error(error))},2000)
  const publishedContinuityTimer=setInterval(()=>{if(primaryTasks)void app.publishedContinuity.tick().catch(error=>server.log.error(error))},1000)
  const schedulePublicationTimer=setInterval(()=>{if(primaryTasks)void app.schedulePublication.tick().catch(error=>server.log.error(error))},15000)
  const haTimer=app.ha?.options.role==='PRIMARY'?setInterval(()=>void app.ha?.tick(),5000):null
  const haMediaTimer=app.ha?.options.role==='PRIMARY'?setInterval(()=>void app.ha?.mediaTick(async asset=>{
    const archive=await app.mediaWorkflow.archived(asset.id,asset.contentHash)
    if(archive)return archive
    if(await app.continuityCache.verified(asset))return app.continuityCache.pathFor(asset)
    return asset.path
  }),250):null
  void updateLibrary()

  // Cópia de segurança periódica. Um playout que roda meses sem ninguém olhar
  // precisa de cópia sem depender de alguém lembrar de pedir.
  const backupTimer =
    BACKUP_EVERY_HOURS > 0
      ? setInterval(
          () => {
            void backupDatabase(app.sqlite, app.backupDir)
              .then((result) => console.log(`[rplayout] cópia de segurança em ${result.file}`))
              .catch((failure: unknown) => {
                console.error('[rplayout] a cópia de segurança falhou:', failure)
              })
          },
          BACKUP_EVERY_HOURS * 3_600_000,
        )
      : null

  // Retenção evita crescimento infinito em operação 24/7. Eventos não
  // reconhecidos ficam preservados até serem reconhecidos, mesmo que antigos.
  const retentionTimer = setInterval(() => {
    if (!Number.isFinite(HEALTH_RETENTION_DAYS) || HEALTH_RETENTION_DAYS <= 0) return
    const cutoff = new Date(Date.now() - HEALTH_RETENTION_DAYS * 86_400_000).toISOString()
    app.sqlite.prepare('DELETE FROM health_events WHERE occurred_at < ? AND acknowledged_at IS NOT NULL').run(cutoff)
    app.sqlite.prepare('DELETE FROM sessions WHERE expires_at < ?').run(new Date().toISOString())
  }, 6 * 60 * 60 * 1000)

  const recorded = new Map<string, string>()
  const silenceSince = new Map<string, number>()
  let lastCacheWarm = 0
  let cacheWarming = false
  const timer = setInterval(async () => {
    // MediaMTX é um processo único do servidor: seu watchdog deve rodar uma
    // vez por ciclo, independentemente da quantidade de canais.
    app.mediamtx?.watchdog()
    // Reconnecta destinos externos de forma isolada e com backoff; uma queda
    // não deve criar uma tempestade de processos nem exigir reinício manual.
    app.relays.tick()
    if (!cacheWarming && Date.now() - lastCacheWarm >= 60_000) {
      lastCacheWarm = Date.now()
      cacheWarming = true
      void (async () => {
        // Include published dates even when no operator has loaded the grade.
        for (const channel of await listChannels(app.db)) await warmChannelCache(app,channel.id)
      })()
        .catch(error => server.log.error(error,'Falha ao aquecer cache publicado')).finally(() => {cacheWarming=false})
    }
    for (const runtime of app.runtimes.values()) {
      app.continuityCache.replaceProtection(`runtime:${runtime.channel.id}`,runtime.cachePins())
      for (const source of runtime.transport.state().liveSources) {
        for (const [bus,state] of Object.entries(source.busStates ?? {})) {
          const key = `source:${runtime.channel.id}:${source.source}:${bus}`
          if (recorded.get(key) === state) continue
          recorded.set(key,state)
          const sourceRef = redactUrl(source.source)
          app.db.insert(healthEvents).values({id:randomUUID(),channelId:runtime.channel.id,component:'LIVE_SOURCE',state,severity:['LOST','FAILED'].includes(state) ? 'CRITICAL' : state === 'CUEING' ? 'WARN' : 'INFO',message:`${bus.toUpperCase()} · ${sourceRef} · ${state}`,occurredAt:new Date().toISOString()}).run()
          void emitIntegrationEvent(app.db,`source.${state.toLowerCase()}`,{source:sourceRef,bus,state,measurement:source.measurements?.[bus as 'pgm'|'pvw'] ?? null},runtime.channel.id)
        }
      }
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
        recorded.set(key, signature)
        void app.db.insert(healthEvents).values({ id: randomUUID(), channelId: runtime.channel.id, component: 'ENGINE', state, severity: severityOf('ENGINE', state, health.error), message: health.error, occurredAt: new Date().toISOString() }).run()
        void emitIntegrationEvent(app.db, `engine.${state}`, { message: health.error, restarts: health.restarts }, runtime.channel.id)
      }
      const videoHealthKey = `video-health:${runtime.channel.id}`
      const videoHealth = health.stalls > 0 ? 'stalled' : 'running'
      if (recorded.get(videoHealthKey) !== videoHealth) {
        recorded.set(videoHealthKey, videoHealth)
        const message = videoHealth === 'stalled'
          ? `Engine detectou ${health.stalls} congelamento(s) de vídeo.`
          : 'Fluxo de vídeo recuperado.'
        void app.db.insert(healthEvents).values({ id: randomUUID(), channelId: runtime.channel.id, component: 'VIDEO', state: videoHealth, severity: videoHealth === 'stalled' ? 'CRITICAL' : 'INFO', message, occurredAt: new Date().toISOString() }).run()
        void emitIntegrationEvent(app.db, `video.${videoHealth}`, { stalls: health.stalls, deaths: health.deaths }, runtime.channel.id)
      }
      const warning = runtime.transport.warning()
      const warningKey = `engine-warning:${runtime.channel.id}`
      if (warning && recorded.get(warningKey) !== warning) {
        recorded.set(warningKey, warning)
        const black = warning.includes('preto')
        void app.db.insert(healthEvents).values({ id: randomUUID(), channelId: runtime.channel.id, component: 'SIGNAL', state: black ? 'black' : 'warning', severity: black ? 'CRITICAL' : 'WARN', message: warning, occurredAt: new Date().toISOString() }).run()
        void emitIntegrationEvent(app.db, black ? 'signal.black' : 'engine.warning', { message: warning }, runtime.channel.id)
      }
      // Silêncio sustentado no programa é uma falha operacional diferente de
      // engine parado. O medidor já vem do pipeline real (ou do simulador),
      // portanto não inferimos áudio a partir de conexão WebRTC.
      const meter = runtime.transport.programMeter()
      const videoProbe = runtime.transport.videoProbe()
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
        })
      } else if (!runtime.transport.state().playing) pgmProbeFor(app, runtime.channel.id).idle()
      const silent = meter !== null && meter.momentaryLufs <= -65
      const signalKey = `signal:${runtime.channel.id}`
      if (silent) {
        const started = silenceSince.get(signalKey) ?? Date.now()
        silenceSince.set(signalKey, started)
        const elapsed = Date.now() - started
        const signature = elapsed >= 5000 ? 'silence' : 'ok'
        if (elapsed >= 5000 && recorded.get(signalKey) !== signature) {
          recorded.set(signalKey, signature)
          const message = 'Silêncio sustentado no PGM por mais de 5 segundos.'
          void app.db.insert(healthEvents).values({ id: randomUUID(), channelId: runtime.channel.id, component: 'SIGNAL', state: 'silence', severity: 'CRITICAL', message, occurredAt: new Date().toISOString() }).run()
          void emitIntegrationEvent(app.db, 'signal.silence', { durationMs: elapsed }, runtime.channel.id)
        }
      } else {
        silenceSince.delete(signalKey)
        if (recorded.get(signalKey) === 'silence') {
          recorded.set(signalKey, 'ok')
          const message = 'Áudio do PGM voltou a apresentar nível.'
          void app.db.insert(healthEvents).values({ id: randomUUID(), channelId: runtime.channel.id, component: 'SIGNAL', state: 'running', severity: 'INFO', message, occurredAt: new Date().toISOString() }).run()
          void emitIntegrationEvent(app.db, 'signal.recovered', {}, runtime.channel.id)
        }
      }
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
          server.log.warn({ error }, `scheduler: aviso não persistido para ${runtime.channel.id}`)
        }
      }
      for (const publisher of runtime.transport.publishers()) {
        const outputKey = `output:${runtime.channel.id}:${publisher.url}`
        const outputSignature = `${publisher.health}|${publisher.error ?? ''}|${publisher.attempts}`
        if (recorded.get(outputKey) === outputSignature) continue
        recorded.set(outputKey, outputSignature)
        void app.db.insert(healthEvents).values({ id: randomUUID(), channelId: runtime.channel.id, component: 'OUTPUT', state: publisher.health, severity: severityOf('OUTPUT', publisher.health, publisher.error ?? null), message: publisher.error ?? null, occurredAt: new Date().toISOString() }).run()
        void emitIntegrationEvent(app.db, `output.${publisher.health}`, { url: redactUrl(publisher.url), error: publisher.error ?? null, attempts: publisher.attempts }, runtime.channel.id)
      }
      if (runtime.transport.tick()) {
        void runtime.refreshForTelemetry().then(pushViews)
      }
      // Crédito que fica no ar porque ninguém lembrou de tirar é erro clássico
      // de operação: o template diz quanto dura e quem cumpre é o servidor.
      if (!runtime.emergencyOverlay) runtime.graphics.tick()
      // Deixa de grafismo presa a item entra sozinha na hora marcada.
      runtime.fireDueGraphics()
      // E o que passou fica escrito: a grade diz o que era para acontecer, o
      // as-run diz o que aconteceu.
      void runtime.followAsRun().catch((error: unknown) => server.log.error(error))
      runtime.checkpoint()
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
        recorded.set(key, signature)
        void app.db.insert(healthEvents).values({ id: randomUUID(), channelId: null, component: 'MEDIAMTX', state, severity: severityOf('MEDIAMTX', state, app.mediamtx.lastError), message: app.mediamtx.lastError, occurredAt: new Date().toISOString() }).run()
      }
    }
  }, 1000 / LIVE_HZ)

  let shuttingDown = false
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return
    shuttingDown = true
    libraryClosing = true
    clearInterval(libraryTimer)
    clearInterval(audioAnalysisTimer)
    clearInterval(publishedContinuityTimer)
    clearInterval(schedulePublicationTimer)
    if(haTimer)clearInterval(haTimer)
    if(haMediaTimer)clearInterval(haMediaTimer)
    clearInterval(timer)
    if (backupTimer) clearInterval(backupTimer)
    clearInterval(retentionTimer)
    for (const runtime of app.runtimes.values()) { runtime.checkpoint(true); runtime.close() }
    await app.flush()
    await server.close()
    app.ha?.close();await app.ha?.settled()
    app.close()
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown())
  process.on('SIGTERM', () => void shutdown())

  await server.listen({ port: PORT, host: HOST })
  void app.ha?.tick()
  app.hostMetrics.start()
  if(primaryTasks)app.integrationOutbox.start()
  server.log.info(`RPlayout · banco em ${DB_FILE}`)
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
