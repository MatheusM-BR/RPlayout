import { eq } from 'drizzle-orm'
import {
  framesSinceMidnight,
  secondsToFrames,
  suggestedBitrateKbps,
  type Channel,
  type GraphicTemplate,
  type ItemGraphic,
  type MediaAsset,
  type PreviewTarget,
} from '@rplayout/protocol'
import type Database from 'better-sqlite3'
import { openDatabase, type Db } from './db/client.js'
import { assetMap, getChannel, getRundown, listChannels, listItems } from './db/repo.js'
import { graphicTemplates, itemGraphics, rundownItems } from './db/schema.js'
import { buildView, type RundownView } from './domain/plan.js'
import { simulateMeter, SILENCE, type MeterReading } from './domain/meters.js'
import { SimulatedTransport, type Transport } from './domain/transport.js'
import { EngineTransport } from './domain/engine.js'
import { AsRun } from './domain/asrun.js'
import { ensureDefaultGraphics, Graphics } from './domain/graphics.js'
import { History } from './domain/history.js'
import {
  ENGINE_BINARY,
  ENGINE_BITRATE_KBPS_EXPLICITO,
  ENGINE_OUTPUTS,
  MEDIAMTX_BINARY,
  MEDIAMTX_BIND,
  DEVICES_BINARY,
  MEDIAMTX_LOGLEVEL,
  BACKUP_DIR,
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

export class ChannelRuntime {
  view: RundownView | null = null
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
  /** Qual item o disparo automático está acompanhando e o que já disparou. */
  private cuesFor: string | null = null
  /** Se a apresentação técnica está no ar por conta do canal vazio. */
  private slateUp = false

  private fired = new Set<string>()
  private phase = 0

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
  ) {
    // Sem engine configurado, a grade inteira continua operável no simulado:
    // é o que permite montar programação numa máquina sem GStreamer.
    this.transport = ENGINE_BINARY
      ? new EngineTransport(channel, () => this.view, (id) => this.assets.get(id) ?? null, {
          binary: ENGINE_BINARY,
          outputs: engineOutputs,
          preview: previewOutput,
          // O padrão sai do formato do canal, não de um número fixo: 4 Mbps
          // eram folgados num 480p30 e pobres num 1080p50, que tem oito vezes
          // mais pixel por segundo -- e imagem pobre com bloco em movimento de
          // câmera foi o que o operador viu. `RPLAYOUT_ENGINE_BITRATE` ainda
          // manda, para quem tem motivo para mandar; cada saída pode ter o seu.
          bitrateKbps:
            ENGINE_BITRATE_KBPS_EXPLICITO ??
            suggestedBitrateKbps(channel.width, channel.height, channel.rate),
        })
      : new SimulatedTransport(channel.id, () => this.view)

    this.graphics = new Graphics(channel, this.transport)
    this.asRun = new AsRun(db, channel)
  }

  async load(rundownId: string): Promise<RundownView | null> {
    const rundown = await getRundown(this.db, rundownId)
    if (!rundown) return null

    const [items, assets] = await Promise.all([
      listItems(this.db, rundownId),
      assetMap(this.db),
    ])
    this.assets = assets

    // Grafismo preso a item anda junto com a grade: recarregar a grade e
    // deixar as deixas velhas em memória é como um crédito antigo volta ao ar.
    const [templates, cues] = await Promise.all([
      this.db.select().from(graphicTemplates),
      this.db
        .select()
        .from(itemGraphics)
        .innerJoin(rundownItems, eq(itemGraphics.itemId, rundownItems.id))
        .where(eq(rundownItems.rundownId, rundownId)),
    ])
    this.templates = new Map(templates.map((row) => [row.id, row]))
    // O canal é relido do banco: campos de operação mudam com o canal no ar, e
    // a cópia em memória não pode ficar para trás.
    const fresh = await getChannel(this.db, this.channel.id)
    if (fresh) this.channel = fresh
    this.cues = new Map()
    for (const row of cues) {
      const cue = row.item_graphics
      const list = this.cues.get(cue.itemId) ?? []
      list.push({
        ...cue,
        templateName: this.templates.get(cue.templateId)?.name ?? 'arte removida',
      })
      this.cues.set(cue.itemId, list)
    }
    for (const list of this.cues.values()) list.sort((a, b) => a.atSeconds - b.atSeconds)

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
    if (templateId === null && this.slateUp) {
      this.graphics.hide()
      this.slateUp = false
    }
  }

  /**
   * Apresentação técnica: entra quando nada está no ar.
   *
   * Preto no ar é honesto e não diz nada a quem está assistindo. Com uma arte
   * escolhida, o canal mostra que está de pé e por que não há programa -- e ela
   * sai sozinha assim que um item entra.
   */
  followSlate(): void {
    const onAir = this.transport.state().onAir !== null
    const slateId = this.channel.slateTemplateId

    if (onAir || !slateId) {
      if (this.slateUp) {
        this.graphics.hide()
        this.slateUp = false
      }
      return
    }
    if (this.slateUp || this.graphics.onAir()) return

    const template = this.templates.get(slateId)
    if (!template) return
    // Slate não tem hora para sair: quem a tira é o item que entrar.
    this.graphics.show({ ...template, holdSeconds: null }, {})
    this.slateUp = true
  }

  /**
   * Anota no as-run o que está no ar.
   *
   * Roda a cada volta do laço e só escreve quando o item muda -- inclusive
   * quando ele muda para nada, porque preto no ar também é informação.
   */
  followAsRun(): void {
    void this.asRun.follow(this.transport.state().onAir?.itemId ?? null, this.view)
  }

  fireDueGraphics(): boolean {
    const onAir = this.transport.state().onAir
    if (!onAir) {
      this.cuesFor = null
      return false
    }
    if (this.cuesFor !== onAir.itemId) {
      this.cuesFor = onAir.itemId
      this.fired = new Set()
    }

    let changed = false
    for (const cue of this.cues.get(onAir.itemId) ?? []) {
      if (this.fired.has(cue.id)) continue
      if (onAir.elapsed < secondsToFrames(cue.atSeconds, this.channel.rate)) continue
      const template = this.templates.get(cue.templateId)
      this.fired.add(cue.id)
      if (!template) continue
      this.graphics.show(template, cue.values)
      changed = true
    }
    return changed
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

  /** A interface diz que alguém está com este monitor aberto. */
  watching(bus: 'pvw' | 'mon'): void {
    this.olhando.set(bus, Date.now())
    if (this.monitorLigado.get(bus) !== true) {
      this.monitorLigado.set(bus, true)
      console.info(`[monitor] ligando ${bus}: alguém abriu a janela`)
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
            publisher.health === 'retrying' ? 'caiu e está tentando voltar' : 'parou'
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
      const item = this.view?.items.find((entry) => entry.item.id === noAr.itemId)
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
        found.push({
          kind: 'ENGINE',
          message:
            `"${item.item.title}" tem trilha de áudio mas nada chega ao medidor — ` +
            'pode faltar o decodificador (AAC vem do gst-libav)',
        })
      }
    }

    // Máquina apertada é a explicação de "a imagem está engasgando", e até
    // agora ela só existia no stderr do engine.
    const aviso = this.transport.warning()
    if (aviso !== null) found.push({ kind: 'ENGINE', message: aviso })

    const health = this.transport.health()
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
      graphic: this.graphics.onAir(),
      alerts: this.alerts(),
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
  /** Handle do SQLite, para a cópia de segurança sem parar o servidor. */
  readonly sqlite: Database.Database
  readonly backupDir: string
  /** Fecha o que precisa de escrita antes de o processo sair. */
  flush(): Promise<void>
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
    sqlite,
    backupDir: BACKUP_DIR,
    /**
     * Fecha as linhas de as-run abertas antes de o processo sair.
     *
     * Precisa ser esperado: o `close` é síncrono e o processo terminaria antes
     * de a escrita chegar ao disco -- o item que estava no ar ficaria para
     * sempre sem hora de saída.
     */
    flush: async () => {
      for (const runtime of runtimes.values()) await runtime.asRun.finish('SHUTDOWN')
    },
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
