import { eq } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import {
  graphicTemplates,
  itemGraphics,
  rundownItems,
} from '../db/schema.js'
import {
  assetMap,
  getChannel,
  getRundown,
  listItems,
} from '../db/repo.js'
import {
  BROADCAST_CATEGORY_COLORS,
  formatTimecode,
  framesSinceMidnight,
  framesToMs,
  RATE_PADRAO,
  type BroadcastItemCategory,
  type Rate,
  type RundownItem,
  type TimelineAudioPoint,
  type TimelineMultiTrackData,
  type TimelineTrack,
  type TimelineTrackMarker,
  type TimelineViewportState,
  type TimelineZoomLevel,
} from '@rplayout/protocol'
import { buildView } from './plan.js'
import { globalConcurrencyManager } from './concurrency.js'

export const ZOOM_CONFIGS: Record<
  TimelineZoomLevel,
  { windowMs: number; pixelsPerMs: number }
> = {
  ZOOM_24H: { windowMs: 24 * 3600 * 1000, pixelsPerMs: 0.0000222 },
  ZOOM_1H: { windowMs: 3600 * 1000, pixelsPerMs: 0.000533 },
  ZOOM_5M: { windowMs: 300 * 1000, pixelsPerMs: 0.0064 },
  ZOOM_10S: { windowMs: 10 * 1000, pixelsPerMs: 0.192 },
}

export function classifyItemCategory(
  itemType: string,
  eventType?: string,
  title?: string,
): BroadcastItemCategory {
  const t = (title ?? '').toLowerCase()
  if (itemType === 'LIVE' || eventType === 'LIVE') return 'LIVE'
  if (itemType === 'COMMERCIAL' || t.includes('comercial') || t.includes('break') || t.includes('publicidade') || t.includes('propaganda') || t.includes('vt_campanha')) {
    return 'COMMERCIAL'
  }
  if (itemType === 'FILLER' || eventType === 'FILLER' || t.includes('filler')) {
    return 'FILLER'
  }
  if (t.includes('jornal') || t.includes('noticia') || t.includes('news') || t.includes('reportagem') || t.includes('politica')) {
    return 'NEWS'
  }
  if (t.includes('promo') || t.includes('chamada') || t.includes('institucional') || t.includes('vinheta')) {
    return 'PROMO'
  }
  if (t.includes('filme') || t.includes('serie') || t.includes('novela') || t.includes('drama')) {
    return 'DRAMA'
  }
  return 'NEWS'
}

export interface GenerateTimelineOptions {
  zoomLevel?: TimelineZoomLevel
  windowStartMs?: number
  currentPlayheadFrames?: number
  tenantId?: string
  channelId?: string
}

/**
 * Agregador e compilador das 4 pistas da Timeline Visual Multicamada 24H:
 * - Pista 1: Master Video / PGM (com blocos coloridos e detecção precisa de Gaps)
 * - Pista 2: Secondary Events / CG (Logos, Tarjas Lower-Third e Tickers sincronizados)
 * - Pista 3: SCTE-35 / DPI (Marcadores de Cue Out e Cue In para desinsersão comercial)
 * - Pista 4: Audio Loudness Envelope (Predição de conformidade EBU R128)
 */
export async function generateTimelineMultiTrack(
  db: Db,
  rundownId: string,
  options?: GenerateTimelineOptions,
): Promise<TimelineMultiTrackData & { viewport: TimelineViewportState }> {
  const rundown = await getRundown(db, rundownId)
  if (!rundown) {
    throw new Error(`Rundown não encontrado: ${rundownId}`)
  }

  const channel = (await getChannel(db, rundown.channelId)) ?? {
    id: rundown.channelId,
    name: 'Canal Padrão',
    rate: RATE_PADRAO,
    targetLufs: -23,
    ceilingDbtp: -1,
  }
  const rate: Rate = channel.rate ?? RATE_PADRAO

  const [items, assets, templates, cues] = await Promise.all([
    listItems(db, rundownId),
    assetMap(db),
    db.select().from(graphicTemplates),
    db
      .select()
      .from(itemGraphics)
      .innerJoin(rundownItems, eq(itemGraphics.itemId, rundownItems.id))
      .where(eq(rundownItems.rundownId, rundownId)),
  ])

  const templateMap = new Map<string, typeof graphicTemplates.$inferSelect>(
    templates.map((tpl) => [tpl.id, tpl]),
  )

  const nowFrames =
    options?.currentPlayheadFrames ?? framesSinceMidnight(new Date(), rate)
  const playheadMs = Math.round(framesToMs(nowFrames, rate))

  const scheduleNow =
    options?.currentPlayheadFrames !== undefined ? options.currentPlayheadFrames : null
  const view = buildView(rundown, channel as any, items, assets, scheduleNow, null)
  const resolvedSchedule = view.schedule.items

  // ==========================================
  // PISTA 1: MASTER VIDEO / PGM COM GAPS
  // ==========================================
  const track1Items: TimelineTrackMarker[] = []
  let gapCount = 0

  for (let i = 0; i < resolvedSchedule.length; i++) {
    const entry = resolvedSchedule[i]!
    const origItem = items.find((it: RundownItem) => it.id === entry.id)
    const category = classifyItemCategory(
      origItem?.type ?? 'VT',
      origItem?.eventType,
      origItem?.title,
    )

    const startMs = Math.round(framesToMs(entry.start, rate))
    const durationMs = Math.round(framesToMs(entry.duration, rate))
    const endMs = startMs + durationMs

    track1Items.push({
      id: entry.id,
      trackIndex: 1,
      type: 'PRIMARY_VIDEO',
      startMs,
      durationMs,
      endMs,
      label: origItem?.title ?? `Item ${entry.order}`,
      category,
      colorHex: BROADCAST_CATEGORY_COLORS[category],
      isGap: false,
      metadata: {
        order: entry.order,
        itemType: origItem?.type,
        mediaId: origItem?.mediaId,
        trimmable: origItem?.trimmable,
        optional: origItem?.optional,
        protected: origItem?.protected,
      },
    })

    // Detecção de Gap entre itens consecutivos
    if (i < resolvedSchedule.length - 1) {
      const nextEntry = resolvedSchedule[i + 1]!
      if (nextEntry.start > entry.end) {
        gapCount++
        const gapFrames = nextEntry.start - entry.end
        const gapStartMs = endMs
        const gapDurationMs = Math.round(framesToMs(gapFrames, rate))
        const gapEndMs = gapStartMs + gapDurationMs

        track1Items.push({
          id: `gap-${entry.id}-${nextEntry.id}`,
          trackIndex: 1,
          type: 'PRIMARY_VIDEO',
          startMs: gapStartMs,
          durationMs: gapDurationMs,
          endMs: gapEndMs,
          label: `GAP: +${formatTimecode(gapFrames, rate)}`,
          category: 'GAP',
          colorHex: BROADCAST_CATEGORY_COLORS.GAP,
          isGap: true,
          metadata: {
            gapFrames,
            previousItemId: entry.id,
            nextItemId: nextEntry.id,
          },
        })
      }
    }
  }

  // ==========================================
  // PISTA 2: SECONDARY EVENTS / CG
  // ==========================================
  const track2Items: TimelineTrackMarker[] = []

  for (const row of cues) {
    const cue = row.item_graphics
    const parentScheduled = resolvedSchedule.find((s) => s.id === cue.itemId)
    if (!parentScheduled) continue

    const tpl = templateMap.get(cue.templateId)
    const tplName = tpl?.name ?? 'Grafismo'
    const itemStartMs = Math.round(framesToMs(parentScheduled.start, rate))
    const itemDurationMs = Math.round(framesToMs(parentScheduled.duration, rate))

    const eventStartMs = itemStartMs + cue.atSeconds * 1000
    const holdMs = (tpl?.holdSeconds ?? 5) * 1000
    const eventDurationMs = Math.min(holdMs, Math.max(1000, itemDurationMs - cue.atSeconds * 1000))
    const eventEndMs = eventStartMs + eventDurationMs

    let category: BroadcastItemCategory = 'NEWS'
    let colorHex = '#06B6D4' // Lower-third (Turquesa)

    const lowerName = tplName.toLowerCase()
    if (lowerName.includes('logo') || lowerName.includes('selo')) {
      category = 'PROMO'
      colorHex = '#94A3B8'
    } else if (lowerName.includes('ticker') || lowerName.includes('crawl')) {
      category = 'NEWS'
      colorHex = '#84CC16'
    }

    const firstVal = Object.values(cue.values)[0] ?? ''
    const label = firstVal ? `${tplName}: ${firstVal}` : tplName

    track2Items.push({
      id: cue.id,
      trackIndex: 2,
      type: 'CG_EVENT',
      startMs: eventStartMs,
      durationMs: eventDurationMs,
      endMs: eventEndMs,
      label,
      category,
      colorHex,
      metadata: {
        templateId: cue.templateId,
        templateName: tplName,
        values: cue.values,
        parentItemId: cue.itemId,
      },
    })
  }

  // ==========================================
  // PISTA 3: SCTE-35 / DPI CUE MARKERS
  // ==========================================
  const track3Items: TimelineTrackMarker[] = []

  for (const entry of resolvedSchedule) {
    const origItem = items.find((it: RundownItem) => it.id === entry.id)
    const isCommercial =
      origItem?.type === 'COMMERCIAL' ||
      classifyItemCategory(origItem?.type ?? '', origItem?.eventType, origItem?.title) ===
        'COMMERCIAL'

    if (isCommercial) {
      const startMs = Math.round(framesToMs(entry.start, rate))
      const durationMs = Math.round(framesToMs(entry.duration, rate))
      const endMs = startMs + durationMs
      const durSec = Math.round(durationMs / 1000)

      // Marcador de Cue Out (abertura de janela de desinsersão)
      track3Items.push({
        id: `scte-cue-out-${entry.id}`,
        trackIndex: 3,
        type: 'SCTE35_CUE',
        startMs,
        durationMs,
        endMs,
        label: `DPI CUE OUT (${durSec}s)`,
        category: 'COMMERCIAL',
        colorHex: '#D946EF',
        metadata: {
          commandType: 'SPLICE_INSERT',
          outOfNetwork: true,
          prerollMs: 4000,
          durationSeconds: durSec,
          parentItemId: entry.id,
        },
      })

      // Marcador de Cue In (fechamento de janela de desinsersão)
      track3Items.push({
        id: `scte-cue-in-${entry.id}`,
        trackIndex: 3,
        type: 'SCTE35_CUE',
        startMs: Math.max(startMs, endMs - 1000),
        durationMs: 1000,
        endMs,
        label: 'DPI CUE IN',
        category: 'COMMERCIAL',
        colorHex: '#A21CAF',
        metadata: {
          commandType: 'SPLICE_INSERT',
          outOfNetwork: false,
          parentItemId: entry.id,
        },
      })
    }
  }

  // ==========================================
  // PISTA 4: AUDIO LOUDNESS ENVELOPE (EBU R128)
  // ==========================================
  const track4Items: TimelineTrackMarker[] = []
  const loudnessPoints: TimelineAudioPoint[] = []

  for (const entry of resolvedSchedule) {
    const origItem = items.find((it: RundownItem) => it.id === entry.id)
    const asset = origItem?.mediaId ? assets.get(origItem.mediaId) : null
    const lufs = asset?.loudnessFile?.integratedLufs ?? -23.0
    const truePeak = asset?.loudnessFile?.truePeakDbtp ?? -2.0

    const startMs = Math.round(framesToMs(entry.start, rate))
    const durationMs = Math.round(framesToMs(entry.duration, rate))
    const endMs = startMs + durationMs

    let colorHex = '#10B981' // Verde: conforme
    if (Math.abs(lufs - -23.0) > 1.5 || truePeak > -1.0) {
      colorHex = '#EF4444' // Vermelho: fora de conformidade / estouro
    } else if (Math.abs(lufs - -23.0) > 0.5) {
      colorHex = '#F59E0B' // Amarelo: tolerância
    }

    track4Items.push({
      id: `audio-env-${entry.id}`,
      trackIndex: 4,
      type: 'AUDIO_ENVELOPE',
      startMs,
      durationMs,
      endMs,
      label: `${lufs.toFixed(1)} LUFS | ${truePeak.toFixed(1)} dBTP`,
      category: 'PROMO',
      colorHex,
      metadata: {
        integratedLufs: lufs,
        truePeakDbtp: truePeak,
        targetLufs: channel.targetLufs,
      },
    })

    loudnessPoints.push({ timeMs: startMs, lufsIntegrated: lufs, truePeakDbtp: truePeak })
    loudnessPoints.push({
      timeMs: Math.round(startMs + durationMs / 2),
      lufsIntegrated: lufs,
      truePeakDbtp: truePeak,
    })
    loudnessPoints.push({ timeMs: endMs, lufsIntegrated: lufs, truePeakDbtp: truePeak })
  }

  const tracks: TimelineTrack[] = [
    {
      type: 'MASTER_VIDEO',
      index: 1,
      name: 'Master Video / PGM',
      items: track1Items,
    },
    {
      type: 'SECONDARY_EVENTS',
      index: 2,
      name: 'Secondary Events / CG',
      items: track2Items,
    },
    {
      type: 'SCTE35_DPI',
      index: 3,
      name: 'SCTE-35 / DPI',
      items: track3Items,
    },
    {
      type: 'AUDIO_LOUDNESS',
      index: 4,
      name: 'Audio Loudness Envelope',
      items: track4Items,
      loudnessPoints,
    },
  ]

  const zoomLevel: TimelineZoomLevel = options?.zoomLevel ?? 'ZOOM_1H'
  const zoomConfig = ZOOM_CONFIGS[zoomLevel]
  const viewportStartMs =
    options?.windowStartMs ?? Math.max(0, Math.round(playheadMs - zoomConfig.windowMs * 0.25))
  const viewportEndMs = viewportStartMs + zoomConfig.windowMs

  const viewport: TimelineViewportState = {
    zoomLevel,
    pixelsPerMillisecond: zoomConfig.pixelsPerMs,
    viewportStartMs,
    viewportEndMs,
    playheadMs,
    followPlayhead: true,
  }

  const lastEntry = resolvedSchedule[resolvedSchedule.length - 1]
  const totalDurationFrames = lastEntry ? lastEntry.end : 0
  const totalDurationMs = Math.round(framesToMs(totalDurationFrames, rate))

  const rundownVersion = globalConcurrencyManager.getRundownVersion(rundownId)
  const eTag = globalConcurrencyManager.generateETag(rundownId)

  return {
    rundownId,
    date: rundown.date,
    currentPlayheadFrames: nowFrames,
    currentPlayheadMs: playheadMs,
    totalDurationFrames,
    totalDurationMs,
    gapCount,
    zoomLevel,
    tenantId: options?.tenantId,
    channelId: rundown.channelId,
    rundownVersion,
    eTag,
    tracks,
    viewport,
  }
}
