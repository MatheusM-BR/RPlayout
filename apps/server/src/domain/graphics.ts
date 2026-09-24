import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import {
  escapeXml,
  framesSinceMidnight,
  renderTemplate,
  secondsToFrames,
  type Channel,
  type GraphicLayerState,
  type GraphicOnAir,
  type GraphicTemplate,
  type GraphicsLayer,
  type SecondaryEvent,
} from '@rplayout/protocol'
import type { Db } from '../db/client.js'
import { graphicTemplates } from '../db/schema.js'
import type { Transport } from './transport.js'
import { globalScteDispatcher } from './scte.js'
import { globalStudioAutomationGateway } from './external-control.js'

export interface TriggerLayerOptions {
  templateId?: string
  template?: GraphicTemplate
  name?: string
  payload?: Record<string, unknown>
  values?: Record<string, string>
  fadeMs?: number
  durationFrames?: number
  opacity?: number
}

/**
 * Gerenciador de camadas de grafismo RGBA (Fase D).
 *
 * Suporta 4 camadas independentes:
 * - STATION_LOGO: Marca d'água / DVE bug em Action Safe (90%)
 * - ONAIR_CLOCK: Relógio NTP tabular sincronizado + clima
 * - CRAWL_TICKER: Ticker / crawl contínuo de notícias
 * - LOWER_THIRD: Tarja de apresentador / programa
 */
export class Graphics {
  private current: GraphicOnAir | null = null
  private readonly layers: Record<GraphicsLayer, GraphicLayerState> = {
    STATION_LOGO: { layer: 'STATION_LOGO', active: false },
    ONAIR_CLOCK: { layer: 'ONAIR_CLOCK', active: false },
    CRAWL_TICKER: { layer: 'CRAWL_TICKER', active: false },
    LOWER_THIRD: { layer: 'LOWER_THIRD', active: false },
  }

  readonly scheduler: SecondaryEventScheduler

  constructor(
    private readonly channel: Channel,
    private readonly transport: Transport,
  ) {
    this.scheduler = new SecondaryEventScheduler(async (event, mode) => {
      if (mode === 'FIRE') {
        if (event.type === 'SCTE_TRIGGER' || event.scteConfig) {
          const scteConfig = event.scteConfig ?? {
            spliceEventId: Number(event.payload.spliceEventId ?? 1001),
            ptsTime: Number(event.payload.ptsTime ?? 0),
            durationSeconds: Number(event.payload.durationSeconds ?? 30),
            autoReturn: Boolean(event.payload.autoReturn ?? true),
            prerollMs: Number(event.payload.prerollMs ?? 4000),
          }
          globalScteDispatcher.dispatchSpliceInsert(scteConfig)
          return
        }

        if (event.type === 'DEVICE_AUTOMATION' || event.deviceConfig) {
          const deviceConfig = event.deviceConfig ?? {
            targetDevice: 'ATEM_SWITCHER' as const,
            action: String(event.payload.action ?? 'TAKE'),
            params: (event.payload.params as Record<string, unknown>) ?? {},
          }
          await globalStudioAutomationGateway.execute(deviceConfig)
          return
        }

        // Gráficos de camada
        this.triggerLayer(event.targetLayer, 'SHOW', {
          templateId: event.templateId,
          payload: event.payload,
          durationFrames: event.durationFrames,
        })
      } else if (mode === 'DISMISS') {
        this.triggerLayer(event.targetLayer, 'HIDE')
      }
    })
  }

  /** Retorna o estado atual de todas as 4 camadas. */
  getLayers(): Record<GraphicsLayer, GraphicLayerState> {
    return { ...this.layers }
  }

  /** Retorna a camada principal no ar (compatibilidade legado). */
  onAir(): GraphicOnAir | null {
    return this.current
  }

  /**
   * Aciona uma camada específica de grafismo (SHOW, HIDE, UPDATE).
   */
  triggerLayer(
    layer: GraphicsLayer,
    action: 'SHOW' | 'HIDE' | 'UPDATE',
    options: TriggerLayerOptions = {},
  ): GraphicLayerState {
    const fadeMs = options.fadeMs ?? 300

    if (action === 'HIDE') {
      this.layers[layer] = {
        layer,
        active: false,
        updatedAt: new Date().toISOString(),
      }
      if (this.current && this.current.templateId === options.templateId) {
        this.current = null
      }
      this.renderComposite(fadeMs)
      return this.layers[layer]
    }

    // Ação SHOW ou UPDATE
    const durationFrames = options.durationFrames
    const nowFrames = framesSinceMidnight(new Date(), this.channel.rate)
    const expiresAtFrames =
      durationFrames && durationFrames > 0 ? nowFrames + durationFrames : null

    const svg = options.template
      ? renderTemplate(options.template, options.values ?? {})
      : this.buildDefaultLayerSvg(layer, options)

    const state: GraphicLayerState = {
      layer,
      active: true,
      templateId: options.templateId ?? options.template?.id,
      name: options.name ?? options.template?.name ?? layer,
      payload: options.payload,
      svg,
      opacity: options.opacity ?? (layer === 'STATION_LOGO' ? 0.9 : 1.0),
      updatedAt: new Date().toISOString(),
      expiresAtFrames,
    }

    this.layers[layer] = state
    this.current = {
      templateId: state.templateId ?? layer,
      name: state.name ?? layer,
      values: options.values ?? {},
      endsAt: expiresAtFrames,
    }

    this.renderComposite(fadeMs)
    return state
  }

  /** Desativa todas as camadas no ar. */
  dismissAllLayers(fadeMs = 300): void {
    for (const key of Object.keys(this.layers) as GraphicsLayer[]) {
      this.layers[key] = { layer: key, active: false, updatedAt: new Date().toISOString() }
    }
    this.current = null
    this.transport.graphic(null, fadeMs)
  }

  /** API Legada: Exibe template e ativa camada correspondente. */
  show(template: GraphicTemplate, values: Record<string, string>): GraphicOnAir {
    const endsAt =
      template.holdSeconds === null
        ? null
        : framesSinceMidnight(new Date(), this.channel.rate) +
          secondsToFrames(template.holdSeconds, this.channel.rate)

    const layer = this.deduceLayer(template.name)
    this.triggerLayer(layer, 'SHOW', {
      templateId: template.id,
      template,
      values,
      fadeMs: template.fadeMs,
      durationFrames: template.holdSeconds
        ? secondsToFrames(template.holdSeconds, this.channel.rate)
        : undefined,
    })

    this.current = { templateId: template.id, name: template.name, values, endsAt }
    return this.current
  }

  /** API Legada: Oculta o grafismo ativo. */
  hide(fadeMs = 300): void {
    this.dismissAllLayers(fadeMs)
  }

  /**
   * Avalia saídas automáticas por tempo decorrido.
   * Devolve true se houve alteração no estado das camadas.
   */
  tick(): boolean {
    const now = framesSinceMidnight(new Date(), this.channel.rate)
    let changed = false

    for (const key of Object.keys(this.layers) as GraphicsLayer[]) {
      const layerState = this.layers[key]
      if (layerState.active && layerState.expiresAtFrames && now >= layerState.expiresAtFrames) {
        this.triggerLayer(key, 'HIDE')
        changed = true
      }
    }

    if (this.current?.endsAt !== null && this.current !== null && now >= this.current.endsAt) {
      this.current = null
      changed = true
    }

    return changed
  }

  /**
   * Renderiza a composição das 4 camadas RGBA ativas em um único stream SVG
   * enviado ao transporte / GStreamer compositor.
   */
  private renderComposite(fadeMs: number): void {
    const activeLayers = (Object.keys(this.layers) as GraphicsLayer[])
      .map((k) => this.layers[k])
      .filter((l) => l.active && l.svg)

    if (activeLayers.length === 0) {
      this.transport.graphic(null, fadeMs)
      return
    }

    const compositeSvg = `<g id="rplayout-cg-composite">\n${activeLayers
      .map((l) => `<g id="layer-${l.layer.toLowerCase()}" opacity="${l.opacity ?? 1.0}">${l.svg}</g>`)
      .join('\n')}\n</g>`

    this.transport.graphic(compositeSvg, fadeMs)
  }

  private deduceLayer(templateName: string): GraphicsLayer {
    const upper = templateName.toUpperCase()
    if (upper.includes('SELO') || upper.includes('LOGO')) return 'STATION_LOGO'
    if (upper.includes('RELÓGIO') || upper.includes('CLOCK') || upper.includes('HORA')) return 'ONAIR_CLOCK'
    if (upper.includes('URGENTE') || upper.includes('TICKER') || upper.includes('PLANTÃO')) return 'CRAWL_TICKER'
    return 'LOWER_THIRD'
  }

  /**
   * Gera SVG canônico respeitando safe areas (EBU R95 / SMPTE RP 2046-1).
   */
  private buildDefaultLayerSvg(layer: GraphicsLayer, options: TriggerLayerOptions): string {
    const payload = options.payload ?? {}

    switch (layer) {
      case 'STATION_LOGO': {
        const title = escapeXml(String(payload.title ?? options.name ?? 'RPLAYOUT HD'))
        // 90% Action Safe: 96px da borda lateral, 54px da borda superior em 1080p
        return `<g>
  <rect x="1640" y="54" width="200" height="60" rx="4" fill="#0b1220" fill-opacity="0.8"/>
  <rect x="1640" y="54" width="6" height="60" fill="#2f6ee0"/>
  <text x="1743" y="93" text-anchor="middle" font-family="Inter, Helvetica, sans-serif" font-size="24" font-weight="bold" fill="#ffffff" letter-spacing="2">${title}</text>
</g>`
      }

      case 'ONAIR_CLOCK': {
        const date = new Date()
        const hh = String(date.getHours()).padStart(2, '0')
        const mm = String(date.getMinutes()).padStart(2, '0')
        const ss = String(date.getSeconds()).padStart(2, '0')
        const weather = payload.weather ? ` • ${escapeXml(String(payload.weather))}` : ''
        return `<g>
  <rect x="1640" y="122" width="200" height="38" rx="3" fill="#0b1220" fill-opacity="0.75"/>
  <text x="1740" y="148" text-anchor="middle" font-family="monospace, Inter, sans-serif" font-variant-numeric="tabular-nums" font-size="20" fill="#f2f5fb">${hh}:${mm}:${ss}${weather}</text>
</g>`
      }

      case 'CRAWL_TICKER': {
        const text = escapeXml(String(payload.text ?? payload.headline ?? 'PLANTÃO DA NOTÍCIA'))
        const badge = escapeXml(String(payload.badge ?? 'URGENTE'))
        const isAlert = Boolean(payload.isBreaking ?? true)
        // 80% Title Safe: canto inferior (y=990 a 1040 em 1080p)
        return `<g>
  <rect x="0" y="990" width="1920" height="54" fill="${isAlert ? '#8f1d1d' : '#0b1220'}" fill-opacity="0.95"/>
  <rect x="0" y="990" width="200" height="54" fill="${isAlert ? '#b91c1c' : '#2f6ee0'}"/>
  <text x="100" y="1025" text-anchor="middle" font-family="Inter, Helvetica, sans-serif" font-size="22" font-weight="bold" fill="#ffffff" letter-spacing="1">${badge}</text>
  <text x="230" y="1025" font-family="Inter, Helvetica, sans-serif" font-size="22" fill="#ffffff">${text}</text>
</g>`
      }

      case 'LOWER_THIRD':
      default: {
        const title = escapeXml(String(payload.title ?? payload.headline ?? options.name ?? 'Crédito'))
        const subtitle = escapeXml(String(payload.subtitle ?? payload.subheadline ?? ''))
        const badge = payload.badge ? escapeXml(String(payload.badge)) : null
        const themeColor = escapeXml(String(payload.themeColor ?? '#2f6ee0'))
        // 80% Title Safe: x=160 (192px margem segura), y=840 (108px da margem inferior)
        return `<g>
  <rect x="160" y="840" width="960" height="124" rx="3" fill="#0b1220" fill-opacity="0.92"/>
  <rect x="160" y="840" width="8" height="124" fill="${themeColor}"/>
  ${badge ? `<rect x="180" y="852" width="120" height="24" rx="2" fill="${themeColor}"/><text x="240" y="869" text-anchor="middle" font-family="Inter, sans-serif" font-size="14" font-weight="bold" fill="#ffffff">${badge}</text>` : ''}
  <text x="${badge ? 320 : 190}" y="${badge ? 872 : 890}" font-family="Inter, Helvetica, sans-serif" font-size="42" font-weight="bold" fill="#f2f5fb">${title}</text>
  <text x="190" y="934" font-family="Inter, Helvetica, sans-serif" font-size="24" fill="#9dbbf0">${subtitle}</text>
</g>`
      }
    }
  }
}

/**
 * Agendador determinístico de eventos secundários acoplados aos itens da grade.
 * Resolve offsets relativos (OFFSET_FROM_START e OFFSET_BEFORE_END).
 */
export class SecondaryEventScheduler {
  private events: SecondaryEvent[] = []
  private activeItemState: {
    itemId: string
    firedEventIds: Set<string>
    dismissedEventIds: Set<string>
  } | null = null

  constructor(
    private readonly onTrigger: (
      event: SecondaryEvent,
      mode: 'FIRE' | 'DISMISS',
    ) => void | Promise<void>,
  ) {}

  registerEvent(event: SecondaryEvent): void {
    this.events.push(event)
  }

  setEvents(events: SecondaryEvent[]): void {
    this.events = [...events]
  }

  getEvents(rundownItemId?: string): SecondaryEvent[] {
    if (rundownItemId) {
      return this.events.filter((e) => !e.rundownItemId || e.rundownItemId === rundownItemId)
    }
    return this.events
  }

  clearEvents(): void {
    this.events = []
    this.activeItemState = null
  }

  resetItem(itemId: string | null): void {
    if (!itemId) {
      this.activeItemState = null
      return
    }
    this.activeItemState = {
      itemId,
      firedEventIds: new Set(),
      dismissedEventIds: new Set(),
    }
  }

  /**
   * Avalia eventos secundários a cada ciclo (tick) de reprodução do item.
   *
   * @param itemId ID do item atualmente no ar
   * @param elapsedFrames Quadros já reproduzidos desde o início do item
   * @param totalDurationFrames Duração total prevista do item em quadros
   */
  async tick(
    itemId: string,
    elapsedFrames: number,
    totalDurationFrames: number,
  ): Promise<{ fired: string[]; dismissed: string[] }> {
    if (!this.activeItemState || this.activeItemState.itemId !== itemId) {
      this.resetItem(itemId)
    }

    const fired: string[] = []
    const dismissed: string[] = []
    const matchingEvents = this.events.filter(
      (e) => e.enabled && (!e.rundownItemId || e.rundownItemId === itemId),
    )

    for (const evt of matchingEvents) {
      let triggerFrame = -1

      if (evt.triggerMode === 'OFFSET_FROM_START') {
        triggerFrame = evt.offsetFrames
      } else if (evt.triggerMode === 'OFFSET_BEFORE_END') {
        triggerFrame = Math.max(0, totalDurationFrames - evt.offsetFrames)
      } else {
        // MANUAL só dispara por chamada explícita
        continue
      }

      // Disparo do evento (FIRE)
      if (
        elapsedFrames >= triggerFrame &&
        !this.activeItemState!.firedEventIds.has(evt.id)
      ) {
        this.activeItemState!.firedEventIds.add(evt.id)
        fired.push(evt.id)
        await this.onTrigger(evt, 'FIRE')
      }

      // Auto-descarte (DISMISS) se houver durationFrames configurado
      if (
        evt.durationFrames &&
        evt.durationFrames > 0 &&
        this.activeItemState!.firedEventIds.has(evt.id) &&
        !this.activeItemState!.dismissedEventIds.has(evt.id)
      ) {
        const dismissFrame = triggerFrame + evt.durationFrames
        if (elapsedFrames >= dismissFrame) {
          this.activeItemState!.dismissedEventIds.add(evt.id)
          dismissed.push(evt.id)
          await this.onTrigger(evt, 'DISMISS')
        }
      }
    }

    return { fired, dismissed }
  }

  async triggerManual(eventId: string): Promise<boolean> {
    const evt = this.events.find((e) => e.id === eventId)
    if (!evt) return false
    await this.onTrigger(evt, 'FIRE')
    return true
  }
}

/**
 * Templates padrão incluídos de fábrica com o RPlayout.
 */
const DEFAULTS: {
  name: string
  svg: string
  fields: { key: string; label: string; defaultValue: string }[]
  fadeMs: number
  holdSeconds: number | null
}[] = [
  {
    name: 'Crédito',
    fadeMs: 300,
    holdSeconds: 8,
    fields: [
      { key: 'nome', label: 'Nome', defaultValue: 'Nome do entrevistado' },
      { key: 'cargo', label: 'Cargo ou lugar', defaultValue: '' },
    ],
    svg: `<g>
  <rect x="120" y="820" width="960" height="124" rx="3" fill="#0b1220" fill-opacity="0.92"/>
  <rect x="120" y="820" width="8" height="124" fill="#2f6ee0"/>
  <text x="160" y="874" font-family="Inter, Helvetica, sans-serif" font-size="46" fill="#f2f5fb">{{nome}}</text>
  <text x="160" y="918" font-family="Inter, Helvetica, sans-serif" font-size="26" fill="#9dbbf0">{{cargo}}</text>
</g>`,
  },
  {
    name: 'Selo do canal',
    fadeMs: 500,
    holdSeconds: null,
    fields: [{ key: 'texto', label: 'Texto do selo', defaultValue: 'CANAL 1' }],
    svg: `<g opacity="0.9">
  <rect x="1620" y="60" width="220" height="64" rx="3" fill="#0b1220" fill-opacity="0.75"/>
  <text x="1730" y="103" text-anchor="middle" font-family="Inter, Helvetica, sans-serif" font-size="30" fill="#f2f5fb" letter-spacing="4">{{texto}}</text>
</g>`,
  },
  {
    name: 'Tarja urgente',
    fadeMs: 200,
    holdSeconds: 20,
    fields: [{ key: 'texto', label: 'Chamada', defaultValue: 'PLANTÃO' }],
    svg: `<g>
  <rect x="0" y="960" width="1920" height="72" fill="#8f1d1d"/>
  <text x="60" y="1010" font-family="Inter, Helvetica, sans-serif" font-size="38" fill="#ffffff" letter-spacing="2">{{texto}}</text>
</g>`,
  },
]

export async function ensureDefaultGraphics(db: Db): Promise<void> {
  for (const template of DEFAULTS) {
    const [existing] = await db
      .select()
      .from(graphicTemplates)
      .where(eq(graphicTemplates.name, template.name))
    if (existing) continue

    await db.insert(graphicTemplates).values({
      id: randomUUID(),
      channelId: null,
      ...template,
      createdAt: new Date().toISOString(),
    })
  }
}
