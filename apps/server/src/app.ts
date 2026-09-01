import { eq } from 'drizzle-orm'
import { framesSinceMidnight, type Channel, type MediaAsset, type PreviewTarget } from '@rplayout/protocol'
import { openDatabase, type Db } from './db/client.js'
import { assetMap, getChannel, getRundown, listChannels, listItems } from './db/repo.js'
import { rundownItems } from './db/schema.js'
import { buildView, type RundownView } from './domain/plan.js'
import { simulateMeter, SILENCE, type MeterReading } from './domain/meters.js'
import { SimulatedTransport, type Transport } from './domain/transport.js'
import { EngineTransport } from './domain/engine.js'
import { History } from './domain/history.js'
import {
  ENGINE_BINARY,
  ENGINE_BITRATE_KBPS,
  ENGINE_OUTPUTS,
  MEDIAMTX_BINARY,
  MEDIAMTX_BIND,
  DEVICES_BINARY,
  MEDIAMTX_LOGLEVEL,
  MEDIA_ROOT,
  PROBE_BINARY,
  RELAY_BINARY,
  THUMBNAIL_DIR,
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
import { resolve as resolvePath } from 'node:path'

/**
 * Runtime de um canal. Guarda a grade já resolvida em cache porque o
 * transporte precisa dela de forma síncrona, a cada tick, e recalcular do
 * banco vinte vezes por segundo seria desperdício.
 */
export class ChannelRuntime {
  view: RundownView | null = null
  readonly transport: Transport
  /** Acervo em memória: o medidor do preview precisa dele a cada tick. */
  private assets: Map<string, MediaAsset> = new Map()
  private phase = 0

  constructor(
    readonly channel: Channel,
    private readonly db: Db,
    /** Para onde este canal sai. Vem do servidor local quando ele existe. */
    engineOutputs: readonly string[],
    /** Para onde o preview sai. Nulo deixa o canal sem barramento de preview. */
    previewOutput: string | null = null,
  ) {
    // Sem engine configurado, a grade inteira continua operável no simulado:
    // é o que permite montar programação numa máquina sem GStreamer.
    this.transport = ENGINE_BINARY
      ? new EngineTransport(channel, () => this.view, (id) => this.assets.get(id) ?? null, {
          binary: ENGINE_BINARY,
          outputs: engineOutputs,
          preview: previewOutput,
          bitrateKbps: ENGINE_BITRATE_KBPS,
        })
      : new SimulatedTransport(channel.id, () => this.view)
  }

  async load(rundownId: string): Promise<RundownView | null> {
    const rundown = await getRundown(this.db, rundownId)
    if (!rundown) return null

    const [items, assets] = await Promise.all([
      listItems(this.db, rundownId),
      assetMap(this.db),
    ])
    this.assets = assets

    this.view = buildView(
      rundown,
      this.channel,
      items,
      assets,
      framesSinceMidnight(new Date(), this.channel.rate),
      this.transport.state().onAir,
    )
    return this.view
  }

  /** Recalcula a grade corrente. Chamado depois de toda alteração. */
  async refresh(): Promise<RundownView | null> {
    const id = this.view?.rundown.id
    return id ? this.load(id) : null
  }

  private meterForItem(itemId: string | null): MeterReading {
    if (!itemId || !this.view) return SILENCE
    const item = this.view.items.find((v) => v.item.id === itemId)
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
    return target.kind === 'ITEM' ? this.meterForItem(target.id) : this.meterForAsset(target.id)
  }

  /** Estado que vai para a interface a cada frame de atualização. */
  live() {
    this.phase += 0.12
    const state = this.transport.state()
    return {
      transport: state,
      now: framesSinceMidnight(new Date(), this.channel.rate),
      meters: {
        // Havendo engine, os dois medidores são medição de verdade, pela
        // BS.1770-4 sobre as amostras de cada barramento.
        program: this.transport.programMeter() ?? this.meterForItem(state.onAir?.itemId ?? null),
        preview: this.transport.previewMeter() ?? this.meterForPreview(state.preview),
      },
    }
  }
}

export interface App {
  readonly db: Db
  readonly runtimes: Map<string, ChannelRuntime>
  readonly history: History
  /** Servidor de mídia local. Nulo quando não há binário configurado. */
  readonly mediamtx: MediaMtx | null
  readonly relays: RelaySupervisor
  readonly ingest: Ingest
  readonly sources: Sources
  readonly mediaRoot: string
  readonly thumbnailDir: string
  /** Caminho de cada canal no servidor local. */
  paths: ChannelPaths[]
  close(): void
}

export async function createApp(file: string): Promise<App> {
  const { db, sqlite } = openDatabase(file)
  const runtimes = new Map<string, ChannelRuntime>()
  const mediamtx = MEDIAMTX_BINARY
    ? new MediaMtx({
        binary: MEDIAMTX_BINARY,
        configPath: resolvePath(process.cwd(), 'mediamtx.yml'),
        bind: MEDIAMTX_BIND,
        logLevel: MEDIAMTX_LOGLEVEL,
      })
    : null

  const app: App = {
    db,
    runtimes,
    history: new History(),
    mediamtx,
    relays: new RelaySupervisor(RELAY_BINARY),
    ingest: new Ingest(db, PROBE_BINARY, THUMBNAIL_DIR),
    sources: new Sources(db, DEVICES_BINARY),
    mediaRoot: MEDIA_ROOT,
    thumbnailDir: THUMBNAIL_DIR,
    paths: [],
    close: () => {
      app.relays.closeAll()
      mediamtx?.stop()
      sqlite.close()
    },
  }
  return app
}

export async function runtimeFor(app: App, channelId: string): Promise<ChannelRuntime | null> {
  const existing = app.runtimes.get(channelId)
  if (existing) return existing

  const channel = await getChannel(app.db, channelId)
  if (!channel) return null

  const path = app.paths.find((entry) => entry.channelId === channelId)
  if (app.mediamtx) await ensureManagedOutputs(app.db, channel, path)

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
    .filter((entry) => entry.role === 'EXTRA')
    .map((entry) => toEngineProfile(entry, path))
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    .map(encodeProfile)

  const outputs = program ? [program, ...extras] : [...ENGINE_OUTPUTS, ...extras]

  const runtime = new ChannelRuntime(channel, app.db, outputs, forRole('PREVIEW'))
  app.runtimes.set(channelId, runtime)
  return runtime
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
  if (runtime.view?.rundown.id !== rundownId) await runtime.load(rundownId)
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
  const channels = await listChannels(app.db)
  app.paths = channelPaths(channels)

  if (!app.mediamtx) return

  const guests = await app.db.select().from(guestKeys)
  await app.mediamtx.apply(
    app.paths,
    guests
      .filter((guest) => guest.enabled)
      .map((guest) => ({ label: guest.label, streamKey: guest.streamKey })),
  )
  app.mediamtx.start()
  if (!(await app.mediamtx.waitUntilReady())) {
    console.error('[rplayout] o servidor de mídia local não respondeu; as saídas ficarão mudas.')
  }

  const targets = await app.db.select().from(destinations)
  const first = app.paths[0]
  if (first) {
    app.relays.sync(
      targets
        .filter((target) => target.enabled)
        .map((target) => ({ id: target.id, name: target.name, url: target.url })),
      MediaMtx.internalRead(first.program),
    )
  }
}
