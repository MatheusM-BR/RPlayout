import cors from '@fastify/cors'
import websocket from '@fastify/websocket'
import Fastify from 'fastify'
import { createApp, runtimeFor, syncDistribution } from './app.js'
import { DB_FILE, HOST, PORT } from './config.js'
import { listChannels, listRundowns } from './db/repo.js'
import { registerRoutes } from './routes.js'

/** Cadência do estado ao vivo. Vinte por segundo já engana o olho no medidor. */
const LIVE_HZ = 20

async function main(): Promise<void> {
  const app = await createApp(DB_FILE)
  const server = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } })

  await server.register(cors, { origin: true })
  await server.register(websocket)

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
      pushViews,
    )
  }

  const timer = setInterval(() => {
    for (const runtime of app.runtimes.values()) {
      // O canal anda com ou sem interface aberta. Amarrar isto à presença de
      // um navegador seria congelar a grade e o nivelamento no instante em que
      // o último operador fecha a aba -- num sistema que fica no ar sozinho a
      // madrugada inteira, isso é o defeito mais caro que existe.
      if (runtime.transport.tick()) {
        void runtime.refresh().then(pushViews)
      }
      // Crédito que fica no ar porque ninguém lembrou de tirar é erro clássico
      // de operação: o template diz quanto dura e quem cumpre é o servidor.
      runtime.graphics.tick()
      // Deixa de grafismo presa a item entra sozinha na hora marcada.
      runtime.fireDueGraphics()
      // Só o desenho depende de audiência: medir e transmitir para ninguém é
      // que não faz sentido.
      if (sockets.size > 0) {
        broadcast({ type: 'live', channelId: runtime.channel.id, ...runtime.live() })
      }
    }
  }, 1000 / LIVE_HZ)

  const shutdown = async (): Promise<void> => {
    clearInterval(timer)
    for (const runtime of app.runtimes.values()) runtime.transport.close()
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
