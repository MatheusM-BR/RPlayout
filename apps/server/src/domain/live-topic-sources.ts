import type Database from 'better-sqlite3'
import type { App, ChannelRuntime } from '../app.js'
import { pgmProbeFor } from '../app.js'
import { engineStatusOf } from './engine-status.js'
import { Interruptions } from './interruptions.js'
import { readScanDiagnostics } from './scan-diagnostic.js'
import type { TopicSignature } from './live-topics.js'
import { HEALTH_CHANGE_SIGNATURE_SQL } from '../db/health-query-indexes.js'

/**
 * O que, de cada tela, conta como "mudou" -- e o que não conta.
 *
 * Cada assinatura espelha a rota HTTP que a interface relê ao receber a
 * revisão nova, sem os campos que andam sozinhos (relógio, duração em curso,
 * contadores de quadro). Nada aqui vai para o navegador: só a revisão.
 */
export function channelTopics(app: App, runtime: ChannelRuntime, interruptions: Interruptions, sqlite: Database.Database): Record<string, TopicSignature> {
  const channelId = runtime.channel.id
  const activeRevisions = sqlite.prepare(`SELECT r.id,r.revision FROM operational_playlist_revisions r JOIN rundowns d ON d.id=r.rundown_id
    WHERE d.channel_id=? AND r.active=1 ORDER BY r.id`)
  return {
    // GET /api/v1/graphics/layers (sem nowFrames).
    graphics: () => {
      const onAir = runtime.transport.state().onAir?.itemId ?? null
      return [onAir, runtime.graphics.getLayers(), runtime.graphics.scheduler.getEvents()
        .filter(event => event.enabled && event.rundownItemId === onAir && event.triggerMode === 'MANUAL').map(event => event.id)]
    },
    // GET /api/v1/engineering/pgm-probe/status sem métricas, amostra e duração.
    probe: () => {
      const status = pgmProbeFor(app, channelId).getStatus(), last = status.alerts.at(-1)
      const contingency = runtime.contingencyState
      return [status.automaticActionsEnabled, status.emergencySlateActive, status.thresholds,
        status.activeAlerts.map(alert => [alert.id, alert.occurrences ?? 1, alert.actionStatus ?? null]),
        status.alerts.length, last ? [last.id, last.active, last.occurrences ?? 1, last.actionStatus ?? null] : null,
        contingency ? [contingency.active, contingency.itemId ?? null] : null]
    },
    // GET /api/channels/:id/live-watchdog. Com entrada ao vivo, as métricas
    // medidas mudam a cada leitura e o tópico acompanha (mesma cadência de
    // antes); sem entrada, fica parado.
    watchdog: () => {
      const stored = runtime.watchdogPolicy(), history = runtime.liveWatchdog.history
      return [stored.revision, runtime.liveWatchdog.status(Date.now(), stored.policy).map(input => ({ ...input, waitRemainingMs: input.waitRemainingMs === null ? null : Math.ceil(input.waitRemainingMs / 1000) })),
        history.length, history.at(-1)?.at ?? null]
    },
    // GET /api/channels/:id/interruptions (lista indexada por canal/estado).
    interruptions: () => interruptions.list(channelId).map(row => {
      const run = app.interruptionCommands.current(row.id)
      return [row.id, row.state, row.frames, run ? app.interruptionCommands.publicRun(run) : null]
    }),
    // GET /api/channels/:id/next-playlist: passagem atual, histórico e opções.
    nextPlaylist: () => {
      const status = runtime.boundaryStatus()
      const active = activeRevisions.all(channelId)
      return [status.sourceRevisionId, status.current ? [status.current.id, status.current.state, status.current.updatedAt, status.current.message ?? null] : null,
        status.history.map(run => [run.id, run.state, run.updatedAt]), active]
    },
    // GET /api/channels/:id/published-continuity.
    continuity: () => [app.publishedContinuity.status(channelId), runtime.operationalRevision?.id ?? null],
    // GET /api/processes (estado de engine e saídas; os contadores de CPU e
    // memória são do Monitor, que tem leitura própria).
    engine: () => {
      const engine = engineStatusOf(runtime.transport), health = runtime.transport.health()
      return [engine.state, engine.message, engine.rejection, runtime.transport.processId(), health.restarts, health.deaths, health.stalls, health.ready,
        runtime.transport.publishers().map(publisher => [publisher.url, publisher.health, publisher.attempts, publisher.error ?? null])]
    },
  }
}

/** Leitura viva da sonda (o que antes justificava reler a rota a cada 2 s). */
export function probeSummary(app: App, channelId: string): unknown {
  const status = pgmProbeFor(app, channelId).getStatus()
  return { lastSampleAt: status.lastSampleAt ?? null, metrics: status.metrics }
}

/** Tópicos do servidor, sem canal: scanner, alertas (cabeçalho e pendências) e relógio. */
export function serverTopics(app: App, sqlite: Database.Database): Record<string, TopicSignature> {
  const pendingHealth = sqlite.prepare(HEALTH_CHANGE_SIGNATURE_SQL)
  return {
    // GET /api/library/scan (e, por tabela, a releitura do acervo).
    scan: () => [app.ingest.status(), readScanDiagnostics(sqlite).map(batch => [batch.id, batch.state])],
    // Contagens de pendências (cabeçalho) e notificações abertas: muda quando
    // entra incidente novo ou quando um pendente é reconhecido/resolvido.
    health: () => pendingHealth.get(),
    clock: () => { const status = app.clockMonitor.status(); return [status.state, status.reason, status.checkedAt] },
  }
}
