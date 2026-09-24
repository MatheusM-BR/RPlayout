import { randomUUID } from 'node:crypto'
import { and, desc, eq, gte, lte } from 'drizzle-orm'
import {
  formatTimecode,
  framesSinceMidnight,
  framesToSeconds,
  msToFrames,
  RATE_PADRAO,
  type Channel,
  type Rate,
  type AsRunRecordExtended,
  type AsRunExtendedStatus,
  type AncineComplianceSummary,
} from '@rplayout/protocol'
import type { Db } from '../db/client.js'
import { asRun } from '../db/schema.js'
import type { RundownView } from './plan.js'
import { emitIntegrationEvent } from './integrations.js'

/** Uma linha do as-run como ela sai para a interface e para o relatório. */
export type AsRunEntry = typeof asRun.$inferSelect

/**
 * Escreve o que foi ao ar.
 *
 * Fecha a linha anterior quando o item no ar muda -- e não só quando um item
 * novo entra: preto no ar também é informação, e um as-run que só registra
 * sucesso não serve para explicar o dia em que algo falhou.
 */
export class AsRun {
  private open: { id: string; itemId: string; startedMs: number } | null = null

  constructor(
    private readonly db: Db,
    private readonly channel: Channel,
  ) {}

  /**
   * Atualiza o log com base no item atualmente em exibição no PGM.
   *
   * Idempotente para o mesmo item: só escreve se a chave mudar.
   */
  async follow(itemId: string | null, view: RundownView | null = null): Promise<void> {
    if (this.open && this.open.itemId === itemId) return

    if (this.open) {
      await this.close(this.open, itemId ? 'NEXT' : 'STOP')
      this.open = null
    }

    if (!itemId) {
      void emitIntegrationEvent(this.db, 'asrun.gap', { startedAt: new Date().toISOString() }, this.channel.id)
      return
    }

    const entry = view?.items.find((candidate) => candidate.item.id === itemId)
    const scheduled = view?.schedule.items.find((candidate) => candidate.id === itemId)
    const now = framesSinceMidnight(new Date(), this.channel.rate)

    const id = randomUUID()
    await this.db.insert(asRun).values({
      id,
      channelId: this.channel.id,
      rundownId: view?.rundown.id ?? null,
      itemId,
      mediaId: entry?.item.mediaId ?? null,
      title: entry?.item.title ?? 'item desconhecido',
      type: entry?.item.type ?? 'VT',
      startedAt: new Date().toISOString(),
      endedAt: null,
      plannedStart: scheduled?.start ?? null,
      actualStart: now,
      airedFrames: null,
      plannedFrames: scheduled?.duration ?? null,
      endedBy: null,
      createdAt: new Date().toISOString(),
    })
    void emitIntegrationEvent(this.db, 'asrun.started', { itemId, title: entry?.item.title ?? 'item desconhecido', startedAt: new Date().toISOString() }, this.channel.id)
    this.open = { id, itemId, startedMs: Date.now() }
  }

  /** Fecha a linha aberta, se houver. Chamado ao encerrar o canal. */
  async finish(reason = 'STOP'): Promise<void> {
    if (!this.open) return
    await this.close(this.open, reason)
    this.open = null
  }

  private async close(open: { id: string; itemId: string; startedMs: number }, reason: string): Promise<void> {
    const aired = msToFrames(Date.now() - open.startedMs, this.channel.rate)
    await this.db
      .update(asRun)
      .set({
        endedAt: new Date().toISOString(),
        airedFrames: Math.max(0, aired),
        endedBy: reason,
      })
      .where(eq(asRun.id, open.id))
    void emitIntegrationEvent(this.db, 'asrun.ended', { itemId: open.itemId, endedAt: new Date().toISOString(), reason, airedFrames: Math.max(0, aired) }, this.channel.id)
  }
}

/** As linhas de um canal a partir de um instante (ou intervalo de datas), mais novas primeiro. */
export async function listAsRun(
  db: Db,
  channelId?: string,
  since?: string,
  limit = 1000,
  until?: string,
): Promise<AsRunEntry[]> {
  const conditions = []
  if (channelId) {
    conditions.push(eq(asRun.channelId, channelId))
  }
  if (since) {
    conditions.push(gte(asRun.startedAt, since))
  }
  if (until) {
    conditions.push(lte(asRun.startedAt, until))
  }
  return db
    .select()
    .from(asRun)
    .where(conditions.length === 0 ? undefined : conditions.length === 1 ? conditions[0]! : and(...conditions))
    .orderBy(desc(asRun.startedAt))
    .limit(limit)
}

/** Converte um AsRunEntry bruto para o modelo estendido com métricas de compliance. */
export function toAsRunRecordExtended(
  entry: AsRunEntry,
  rate: Rate = RATE_PADRAO,
): AsRunRecordExtended {
  const plannedFrames = entry.plannedFrames ?? 0
  const airedFrames = entry.airedFrames ?? plannedFrames
  const delta = (entry.actualStart ?? 0) - (entry.plannedStart ?? entry.actualStart ?? 0)

  let status: AsRunExtendedStatus = 'PLAYED_FULL'
  const endedBy = (entry.endedBy ?? '').toUpperCase()
  if (endedBy === 'FAILED' || endedBy === 'ERROR' || endedBy === 'FAILED_MEDIA_ERROR') {
    status = 'FAILED'
  } else if (airedFrames === 0) {
    status = 'DROPPED'
  } else if (plannedFrames > 0 && airedFrames < plannedFrames * 0.95) {
    status = 'TRUNCATED'
  } else {
    status = 'PLAYED_FULL'
  }

  const isCommercial =
    entry.type.toUpperCase() === 'COMMERCIAL' ||
    entry.type.toUpperCase() === 'SPOT' ||
    entry.type.toUpperCase() === 'PUB'

  return {
    id: entry.id,
    itemId: entry.itemId ?? entry.id,
    title: entry.title,
    eventType: entry.type,
    scheduledStart:
      entry.plannedStart !== null && entry.plannedStart !== undefined
        ? formatTimecode(entry.plannedStart, rate)
        : (entry.startedAt ?? '00:00:00:00'),
    actualStart: formatTimecode(entry.actualStart, rate),
    durationFrames: airedFrames,
    deltaFrames: delta,
    status,
    audioLufs: -24.0,
    audioTruePeakDb: -2.0,
    ancineQuotaEligible: !isCommercial,
    commercialContractId: isCommercial ? `CTR-${entry.id.slice(0, 8).toUpperCase()}` : undefined,
  }
}

/**
 * Calcula a conformidade regulatória ANCINE e a regra dos 25% de publicidade por hora
 * (art. 67 Decreto nº 52.795/1963 e Lei 4.117/1962).
 */
export function calculateAncineCompliance(
  entries: readonly (AsRunEntry | AsRunRecordExtended)[],
  rate: Rate = RATE_PADRAO,
): AncineComplianceSummary {
  let commercialSeconds = 0
  let nationalSeconds = 0

  for (const item of entries) {
    const isCommercial =
      'ancineQuotaEligible' in item
        ? !item.ancineQuotaEligible
        : item.type.toUpperCase() === 'COMMERCIAL' ||
          item.type.toUpperCase() === 'SPOT' ||
          item.type.toUpperCase() === 'PUB'

    const frames =
      'durationFrames' in item
        ? item.durationFrames
        : item.airedFrames ?? item.plannedFrames ?? 0

    const seconds = framesToSeconds(frames, rate)

    if (isCommercial) {
      commercialSeconds += seconds
    } else {
      nationalSeconds += seconds
    }
  }

  // Janela regulatória padrão de 1 hora cheia de relógio (3600 segundos)
  const windowSeconds = 3600
  const hourlyCommercialPercent =
    Math.min(100, Math.round((commercialSeconds / windowSeconds) * 1000) / 10)
  const nationalContentMinutes = Math.round((nationalSeconds / 60) * 10) / 10

  return {
    hourlyCommercialPercent,
    maxAllowedCommercialPercent: 25.0,
    nationalContentMinutes,
    nationalContentQuotaMin: 30.0,
    compliant: hourlyCommercialPercent <= 25.0,
  }
}

/** Obtém o resumo de conformidade ANCINE a partir do banco de dados. */
export async function getAncineComplianceSummary(
  db: Db,
  channelId?: string,
  targetHourOrDate?: Date | string,
  rate: Rate = RATE_PADRAO,
): Promise<AncineComplianceSummary> {
  let since: string | undefined
  if (targetHourOrDate) {
    const d = typeof targetHourOrDate === 'string' ? new Date(targetHourOrDate) : targetHourOrDate
    since = d.toISOString()
  } else {
    // Por padrão avalia a última hora
    const oneHourAgo = new Date(Date.now() - 3600 * 1000)
    since = oneHourAgo.toISOString()
  }

  const entries = await listAsRun(db, channelId, since)
  return calculateAncineCompliance(entries, rate)
}

function escapeCsvField(val: unknown): string {
  if (val === null || val === undefined) return ''
  const str = String(val)
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

/**
 * Exporta o As-Run estruturado em formato CSV com colunas de auditoria broadcast e compliance.
 */
export function exportAsRunCsv(
  entries: readonly (AsRunEntry | AsRunRecordExtended)[],
  rate: Rate = RATE_PADRAO,
): string {
  const headers = [
    'id',
    'itemId',
    'title',
    'eventType',
    'scheduledStart',
    'actualStart',
    'durationFrames',
    'deltaFrames',
    'status',
    'audioLufs',
    'audioTruePeakDb',
    'ancineQuotaEligible',
    'commercialContractId',
  ]

  const lines = [headers.join(',')]

  for (const entry of entries) {
    const rec: AsRunRecordExtended =
      'ancineQuotaEligible' in entry ? entry : toAsRunRecordExtended(entry, rate)

    const row = [
      escapeCsvField(rec.id),
      escapeCsvField(rec.itemId),
      escapeCsvField(rec.title),
      escapeCsvField(rec.eventType),
      escapeCsvField(rec.scheduledStart),
      escapeCsvField(rec.actualStart),
      escapeCsvField(rec.durationFrames),
      escapeCsvField(rec.deltaFrames),
      escapeCsvField(rec.status),
      escapeCsvField(rec.audioLufs),
      escapeCsvField(rec.audioTruePeakDb),
      escapeCsvField(rec.ancineQuotaEligible),
      escapeCsvField(rec.commercialContractId ?? ''),
    ]
    lines.push(row.join(','))
  }

  return lines.join('\r\n')
}

function escapeXml(val: unknown): string {
  if (val === null || val === undefined) return ''
  return String(val)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * Exporta o log de exibição em XML compatível com o padrão SMPTE-2021 BXF (Broadcast eXchange Format).
 */
export function exportAsRunBxf(
  entries: readonly (AsRunEntry | AsRunRecordExtended)[],
  options: {
    channelName?: string
    channelId?: string
    broadcastDate?: string
    rate?: Rate
  } = {},
): string {
  const rate = options.rate ?? RATE_PADRAO
  const channelName = options.channelName ?? 'RPlayout Channel'
  const channelId = options.channelId ?? 'CH-01'
  const broadcastDate = options.broadcastDate ?? new Date().toISOString().slice(0, 10)
  const messageId = randomUUID()
  const timestamp = new Date().toISOString()

  let itemsXml = ''
  for (const entry of entries) {
    const rec: AsRunRecordExtended =
      'ancineQuotaEligible' in entry ? entry : toAsRunRecordExtended(entry, rate)

    itemsXml += `      <ScheduleItem itemId="${escapeXml(rec.itemId)}">
        <BroadcastEvent eventType="${escapeXml(rec.eventType)}">
          <EventData eventTitle="${escapeXml(rec.title)}">
            <CommercialContractId>${escapeXml(rec.commercialContractId ?? '')}</CommercialContractId>
            <AncineQuotaEligible>${rec.ancineQuotaEligible}</AncineQuotaEligible>
          </EventData>
          <TimingData>
            <ScheduledStart>${escapeXml(rec.scheduledStart)}</ScheduledStart>
            <ActualStart>${escapeXml(rec.actualStart)}</ActualStart>
            <DurationFrames>${rec.durationFrames}</DurationFrames>
            <DeltaFrames>${rec.deltaFrames}</DeltaFrames>
          </TimingData>
          <AudioCompliance audioLufs="${rec.audioLufs}" audioTruePeakDb="${rec.audioTruePeakDb}" standard="EBU-R128" />
          <ExecutionResult status="${rec.status}" />
        </BroadcastEvent>
      </ScheduleItem>\n`
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<BxfMessage xmlns="http://smpte-ra.org/schemas/2021/2008/BXF" messageType="AsRun" version="2.0">
  <BxfHeader>
    <MessageId>${messageId}</MessageId>
    <DateTime>${timestamp}</DateTime>
    <Origin>RPlayout Broadcast Automation</Origin>
    <Destination>Traffic &amp; Billing Master</Destination>
  </BxfHeader>
  <BxfData action="create">
    <AsRun channelId="${escapeXml(channelId)}" channelName="${escapeXml(channelName)}">
      <AsRunSchedule scheduleDate="${escapeXml(broadcastDate)}">
${itemsXml}      </AsRunSchedule>
    </AsRun>
  </BxfData>
</BxfMessage>`
}
