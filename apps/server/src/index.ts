import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import cors from '@fastify/cors'
import fastifyStatic from '@fastify/static'
import websocket from '@fastify/websocket'
import Fastify from 'fastify'
import { eq } from 'drizzle-orm'
import { createApp, runtimeFor, syncDistribution } from './app.js'
import { BACKUP_EVERY_HOURS, DB_FILE, HOST, PORT, HEALTH_RETENTION_DAYS } from './config.js'
import { listChannels, listRundowns } from './db/repo.js'
import { backupDatabase } from './domain/backup.js'
import { listRoots } from './domain/roots.js'
import { registerRoutes } from './routes.js'
import { healthEvents, scheduleRules } from './db/schema.js'
import { severityOf } from './domain/health.js'
import { emitIntegrationEvent } from './domain/integrations.js'
import { framesSinceMidnight } from '@rplayout/protocol'
import { shouldFillHorizon } from './domain/continuous.js'

/** Cadência do estado ao vivo. Vinte por segundo já engana o olho no medidor. */
const LIVE_HZ = 20

async function main(): Promise<void> {
  const app = await createApp(DB_FILE)
  const server = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } })

  await server.register(cors, { origin: true })
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
  const web = resolve(dirname(fileURLToPath(import.meta.url)), '../../web/dist')
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

  const sockets = new Set<{ send: (data: string) => void }>()

  const broadcast = (payload: unknown): void => {
    const data = JSON.stringify(payload)
    for (const socket of sockets) {
      try {
        socket.send(data)
      } catch {
        sockets.delete(socket)
      }
    }
  }

  /** Uma alteração no rundown vale por uma grade inteira nova na tela. */
  const pushViews = (): void => {
    for (const runtime of app.runtimes.values()) {
      broadcast({ type: 'view', channelId: runtime.channel.id, view: runtime.view })
    }
  }

  registerRoutes(app, server, pushViews)

  server.get('/ws', { websocket: true }, (socket) => {
    sockets.add(socket)
    for (const runtime of app.runtimes.values()) {
      socket.send(
        JSON.stringify({ type: 'view', channelId: runtime.channel.id, view: runtime.view }),
      )
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
    if (runtime && first) await runtime.load(first.id)
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
  const timer = setInterval(async () => {
    // MediaMTX é um processo único do servidor: seu watchdog deve rodar uma
    // vez por ciclo, independentemente da quantidade de canais.
    app.mediamtx?.watchdog()
    // Reconnecta destinos externos de forma isolada e com backoff; uma queda
    // não deve criar uma tempestade de processos nem exigir reinício manual.
    app.relays.tick()
    if (Date.now() - lastCacheWarm >= 60_000) {
      lastCacheWarm = Date.now()
      const assets = [...app.runtimes.values()].flatMap((runtime) => runtime.view?.items.map((entry) => entry.asset).filter((asset): asset is NonNullable<typeof asset> => Boolean(asset)) ?? [])
      void app.continuityCache.warm([...new Map(assets.map((asset) => [asset.id, asset])).values()])
    }
    for (const runtime of app.runtimes.values()) {
      // O canal anda com ou sem interface aberta. Amarrar isto à presença de
      // um navegador seria congelar a grade e o nivelamento no instante em que
      // o último operador fecha a aba -- num sistema que fica no ar sozinho a
      // madrugada inteira, isso é o defeito mais caro que existe.
      // Antes de qualquer coisa: o motor está de pé e produzindo?
      runtime.transport.watchdog()
      const health = runtime.transport.health()
      const state = health.error ? 'error' : 'running'
      const key = `engine:${runtime.channel.id}`
      const signature = `${state}|${health.error ?? ''}|${health.restarts}|${runtime.transport.processId() ?? ''}`
      if (recorded.get(key) !== signature) {
        recorded.set(key, signature)
        void app.db.insert(healthEvents).values({ id: randomUUID(), channelId: runtime.channel.id, component: 'ENGINE', state, severity: severityOf('ENGINE', state, health.error), message: health.error, occurredAt: new Date().toISOString() }).run()
        void emitIntegrationEvent(app.db, `engine.${state}`, { message: health.error, restarts: health.restarts }, runtime.channel.id)
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
      // Uma grade que está prestes a acabar é um risco operacional antes de
      // virar tela preta. O aviso é deduplicado pelo relógio e desaparece
      // quando o operador publica ou monta material novo.
      const agora = framesSinceMidnight(new Date(), runtime.channel.rate)
      const fim = runtime.view?.schedule.endsAt ?? agora
      const janela = Math.round(runtime.channel.rate.num * 60 * 5 / runtime.channel.rate.den)
      const horizon = shouldFillHorizon(agora, fim, janela)
      const horizonKey = `horizon:${runtime.channel.id}`
      const horizonSignature = horizon ? `warn:${Math.floor(fim / Math.max(1, janela))}` : 'ok'
      if (recorded.get(horizonKey) !== horizonSignature) {
        recorded.set(horizonKey, horizonSignature)
        if (horizon) {
          const message = 'A grade termina em menos de cinco minutos; publique ou monte a próxima faixa.'
          void app.db.insert(healthEvents).values({ id: randomUUID(), channelId: runtime.channel.id, component: 'SCHEDULER', state: 'degraded', severity: 'WARN', message, occurredAt: new Date().toISOString() }).run()
          void emitIntegrationEvent(app.db, 'scheduler.degraded', { message, endsAt: fim }, runtime.channel.id)

          // Em operação 24/7, o aviso também aciona a montagem automática da
          // pauta. A assinatura da janela acima funciona como trava: não
          // dispara uma segunda publicação a cada tique enquanto o acervo é
          // processado. A rota continua sendo a única dona da mutação, da
          // captura de histórico e da proteção do item atualmente no ar.
          const rundownId = runtime.view?.rundown.id
          const weekday = String(new Date(`${runtime.view?.rundown.date ?? new Date().toISOString().slice(0, 10)}T12:00:00`).getDay())
          let rulesToday: Array<{ id: string; weekdays: string }> = []
          try {
            rulesToday = await app.db.select({ id: scheduleRules.id, weekdays: scheduleRules.weekdays }).from(scheduleRules)
              .where(eq(scheduleRules.channelId, runtime.channel.id))
          } catch (error: unknown) {
            server.log.warn({ error }, `scheduler: não foi possível ler a pauta de ${runtime.channel.id}`)
          }
          if (rundownId && rulesToday.some((rule) => rule.weekdays.includes(weekday))) {
            void server.inject({
              method: 'POST',
              url: `/api/rundowns/${encodeURIComponent(rundownId)}/autofill-day`,
              headers: { 'x-rplayout-role': 'OPERATOR' },
            }).then((response) => {
              if (response.statusCode >= 400) {
                server.log.warn(`scheduler: montagem automática recusada (${response.statusCode})`)
              } else {
                server.log.info(`scheduler: próxima faixa montada para ${runtime.channel.id}`)
                void app.db.insert(healthEvents).values({
                  id: randomUUID(),
                  channelId: runtime.channel.id,
                  component: 'SCHEDULER',
                  state: 'autofilled',
                  severity: 'INFO',
                  message: 'Próxima faixa montada automaticamente pela pauta.',
                  occurredAt: new Date().toISOString(),
                }).run()
              }
            }).catch((error: unknown) => {
              server.log.warn({ error }, `scheduler: não foi possível montar ${runtime.channel.id}`)
            })
          }
        }
      }
      for (const publisher of runtime.transport.publishers()) {
        const outputKey = `output:${runtime.channel.id}:${publisher.url}`
        const outputSignature = `${publisher.health}|${publisher.error ?? ''}|${publisher.attempts}`
        if (recorded.get(outputKey) === outputSignature) continue
        recorded.set(outputKey, outputSignature)
        void app.db.insert(healthEvents).values({ id: randomUUID(), channelId: runtime.channel.id, component: 'OUTPUT', state: publisher.health, severity: severityOf('OUTPUT', publisher.health, publisher.error ?? null), message: publisher.error ?? null, occurredAt: new Date().toISOString() }).run()
        void emitIntegrationEvent(app.db, `output.${publisher.health}`, { url: publisher.url, error: publisher.error ?? null, attempts: publisher.attempts }, runtime.channel.id)
      }
      if (runtime.transport.tick()) {
        void runtime.refresh().then(pushViews)
      }
      // Crédito que fica no ar porque ninguém lembrou de tirar é erro clássico
      // de operação: o template diz quanto dura e quem cumpre é o servidor.
      runtime.graphics.tick()
      // Deixa de grafismo presa a item entra sozinha na hora marcada.
      runtime.fireDueGraphics()
      // E o que passou fica escrito: a grade diz o que era para acontecer, o
      // as-run diz o que aconteceu.
      runtime.followAsRun()
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
    clearInterval(timer)
    if (backupTimer) clearInterval(backupTimer)
    clearInterval(retentionTimer)
    for (const runtime of app.runtimes.values()) runtime.transport.close()
    await app.flush()
    await server.close()
    app.close()
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown())
  process.on('SIGTERM', () => void shutdown())

  await server.listen({ port: PORT, host: HOST })
  server.log.info(`RPlayout · banco em ${DB_FILE}`)
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
