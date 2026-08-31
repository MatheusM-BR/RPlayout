import { eq } from 'drizzle-orm'
import { framesSinceMidnight, type Channel, type MediaAsset, type PreviewTarget } from '@rplayout/protocol'
import { openDatabase, type Db } from './db/client.js'
import { assetMap, getChannel, getRundown, listItems } from './db/repo.js'
import { rundownItems } from './db/schema.js'
import { buildView, type RundownView } from './domain/plan.js'
import { simulateMeter, SILENCE, type MeterReading } from './domain/meters.js'
import { SimulatedTransport } from './domain/transport.js'

/**
 * Runtime de um canal. Guarda a grade já resolvida em cache porque o
 * transporte precisa dela de forma síncrona, a cada tick, e recalcular do
 * banco vinte vezes por segundo seria desperdício.
 */
export class ChannelRuntime {
  view: RundownView | null = null
  readonly transport: SimulatedTransport
  /** Acervo em memória: o medidor do preview precisa dele a cada tick. */
  private assets: Map<string, MediaAsset> = new Map()
  private phase = 0

  constructor(
    readonly channel: Channel,
    private readonly db: Db,
  ) {
    this.transport = new SimulatedTransport(channel.id, () => this.view)
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
        program: this.meterForItem(state.onAir?.itemId ?? null),
        preview: this.meterForPreview(state.preview),
      },
    }
  }
}

export interface App {
  readonly db: Db
  readonly runtimes: Map<string, ChannelRuntime>
  close(): void
}

export async function createApp(file: string): Promise<App> {
  const { db, sqlite } = openDatabase(file)
  const runtimes = new Map<string, ChannelRuntime>()
  return { db, runtimes, close: () => sqlite.close() }
}

export async function runtimeFor(app: App, channelId: string): Promise<ChannelRuntime | null> {
  const existing = app.runtimes.get(channelId)
  if (existing) return existing

  const channel = await getChannel(app.db, channelId)
  if (!channel) return null

  const runtime = new ChannelRuntime(channel, app.db)
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
