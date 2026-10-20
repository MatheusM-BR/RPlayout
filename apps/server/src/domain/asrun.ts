import { randomUUID } from 'node:crypto'
import { and, desc, eq, gte, isNull, lte } from 'drizzle-orm'
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
import type {ExecutionLease} from './execution-ownership.js'
import {readExecutionOwner,executionAsRunSignature} from '../db/execution-ownership.js'

/** Uma linha do as-run como ela sai para a interface e para o relatório. */
type Provenance = 'revisionId' | 'mediaHash' | 'startPositionFrames' | 'endPositionFrames' | 'rateNum' | 'rateDen' | 'executionKind' | 'durationEvidence'
export type AsRunEntry = Omit<typeof asRun.$inferSelect, Provenance> & Partial<Pick<typeof asRun.$inferSelect, Provenance>>

/**
 * Escreve o que foi ao ar.
 *
 * Fecha a linha anterior quando o item no ar muda -- e não só quando um item
 * novo entra: preto no ar também é informação, e um as-run que só registra
 * sucesso não serve para explicar o dia em que algo falhou.
 */
export class AsRun {
  private open: { id: string; itemId: string; startedMs: number; startPositionFrames: number; rate: Rate } | null = null
  /**
   * O as-run em memória é recriado junto com o servidor. Sem esta
   * reconciliação, uma queda/reinício deixa a linha anterior com `endedAt`
   * nulo e a tela Aired passa a mostrar dois (ou mais) itens como NO AR.
   */
  private reconciledAfterStartup = false
  private serial: Promise<void> = Promise.resolve()
  private exitReasons = new Map<string, { reason: string; frames: number }>()
  private deferredEvents:Array<()=>void>|null=null

  noteExit(itemId: string, reason: string, frames: number): void {
    this.exitReasons.set(itemId, { reason, frames: Math.max(0, Math.floor(frames)) })
  }

  constructor(
    private readonly db: Db,
    private readonly channel: Channel,
    private readonly executionKind: 'NATIVE' | 'SIMULATED' | 'UNKNOWN' = 'UNKNOWN',
    private readonly lease:ExecutionLease|null=null,
  ) {if(executionKind==='NATIVE'&&!lease)throw new Error('Registro nativo de as-run exige dono durável de execução.')}

  /**
   * Atualiza o log com base no item atualmente em exibição no PGM.
   *
   * Idempotente para o mesmo item: só escreve se a chave mudar.
   */
  follow(itemId: string | null, view: RundownView | null = null, revisionId: string | null = null, positionFrames = 0, newTake = false): Promise<void> {
    return this.enqueue(() => this.followSerial(itemId, view, revisionId, positionFrames, newTake))
  }

  /** Serialized synchronous SQL transaction; no awaited native/HTTP work here. */
  followHeldWithCommit(itemId:string,view:RundownView|null,revisionId:string|null,positionFrames:number,commit:()=>void):Promise<void>{
    return this.enqueue(()=>{
      if(this.executionKind!=='NATIVE'||!this.lease)throw new Error('Commit pausado exige as-run nativo e posse.')
      const open=this.open,reconciled=this.reconciledAfterStartup,reasons=new Map(this.exitReasons),events:Array<()=>void>=[]
      this.deferredEvents=events
      try{
        this.db.transaction(()=>{
          this.followSerial(itemId,view,revisionId,positionFrames,false)
          const result:unknown=commit()
          if(result&&typeof result==='object'&&'then' in result)throw new Error('Commit pausado deve ser síncrono dentro da transação.')
        },{behavior:'immediate'})
      }catch(error){this.open=open;this.reconciledAfterStartup=reconciled;this.exitReasons=reasons;throw error}
      finally{this.deferredEvents=null}
      for(const event of events)event()
    })
  }

  private integration(event:string,payload:Record<string,unknown>):void{
    const send=()=>{void emitIntegrationEvent(this.db,event,payload,this.channel.id)}
    if(this.deferredEvents)this.deferredEvents.push(send);else send()
  }

  private enqueue(action: () => void|Promise<void>): Promise<void> {
    const operation = this.serial.then(action)
    this.serial = operation.catch(() => {})
    return operation
  }

  private followSerial(itemId: string | null, view: RundownView | null, revisionId: string | null, positionFrames: number, newTake: boolean): void {
    this.reconcileAfterStartup()
    if (this.open && this.open.itemId === itemId && !newTake) return

    if (this.open) {
      const exit = this.exitReasons.get(this.open.itemId)
      this.close(this.open, exit?.reason ?? (itemId ? 'NEXT' : 'STOP'), exit?.frames)
      this.exitReasons.delete(this.open.itemId)
      this.open = null
    }

    if (!itemId) {
      this.integration('asrun.gap', { startedAt: new Date().toISOString() })
      return
    }

    const entry = view?.items.find((candidate) => candidate.item.id === itemId)
    const scheduled = view?.schedule.items.find((candidate) => candidate.id === itemId)
    const now = framesSinceMidnight(new Date(), this.channel.rate)

    const id = randomUUID()
    this.db.transaction(tx=>{
    if(this.lease)this.lease.assertOwned()
    else if(readExecutionOwner(this.db.$client,this.channel.id))throw new Error('As-run protegido por posse nativa; outro runtime não pode gravar execução presumida.')
    tx.insert(asRun).values({
      id,
      channelId: this.channel.id,
      rundownId: view?.rundown.id ?? null,
      itemId,
      mediaId: entry?.item.mediaId ?? null,
      revisionId,
      mediaHash: entry?.asset?.contentHash ?? null,
      startPositionFrames: Math.max(0, Math.floor(positionFrames)),
      title: entry?.item.title ?? 'item desconhecido',
      type: entry?.item.type ?? 'VT',
      startedAt: new Date().toISOString(),
      endedAt: null,
      plannedStart: scheduled?.start ?? null,
      actualStart: now,
      airedFrames: null,
      rateNum: this.channel.rate.num,
      rateDen: this.channel.rate.den,
      executionKind: this.executionKind,
      durationEvidence: 'UNKNOWN',
      plannedFrames: scheduled?.duration ?? null,
      endedBy: null,
      createdAt: new Date().toISOString(),
    }).run()
    this.lease?.bindAsRun(id)
    },{behavior:'immediate'})
    this.integration('asrun.started', { itemId, title: entry?.item.title ?? 'item desconhecido', startedAt: new Date().toISOString() })
    this.open = { id, itemId, startedMs: Date.now(), startPositionFrames: Math.max(0, Math.floor(positionFrames)), rate: { ...this.channel.rate } }
  }

  /** Only the predecessor whose process/engines were proved dead may close.
   * Untagged legacy and foreign live writers are not inferred orphaned. */
  private reconcileAfterStartup(): void {
    if (this.reconciledAfterStartup) return
    this.db.transaction(()=>{
      if(this.lease){
        const owner=this.lease.assertOwned()
        if(owner.channelId!==this.channel.id)throw new Error('As-run de outro canal.')
        for(const runId of this.lease.recoverablePredecessorRunIds()){
          for(const row of this.db.$client.prepare('SELECT asrun_id,signature FROM execution_owner_asrun WHERE run_id=?').all(runId) as {asrun_id:string;signature:string}[])if(row.signature!==executionAsRunSignature(row.asrun_id,runId))throw new Error('Vínculo de predecessor do as-run adulterado; reconciliação recusada.')
          this.db.$client.prepare("UPDATE as_run SET ended_at=?,ended_by='RESTART' WHERE channel_id=? AND ended_at IS NULL AND id IN (SELECT asrun_id FROM execution_owner_asrun WHERE run_id=?)").run(new Date().toISOString(),this.channel.id,runId)
        }
      }else if(readExecutionOwner(this.db.$client,this.channel.id))throw new Error('As-run possui dono nativo. Reconciliação estrangeira recusada; histórico preservado.')
    },{behavior:'immediate'})
    this.reconciledAfterStartup = true
  }

  /** Fecha a linha aberta, se houver. Chamado ao encerrar o canal. */
  finish(reason = 'STOP', endPositionFrames?: number): Promise<void> {
    return this.enqueue(async () => {
      if (!this.open) return
      await this.close(this.open, reason, endPositionFrames)
      this.exitReasons.delete(this.open.itemId)
      this.open = null
    })
  }

  private close(open: NonNullable<AsRun['open']>, reason: string, endPositionFrames?: number): void {
    const positionConfirmed = this.executionKind === 'NATIVE' && Number.isSafeInteger(endPositionFrames) && endPositionFrames! >= open.startPositionFrames
    const aired = positionConfirmed ? endPositionFrames! - open.startPositionFrames : msToFrames(Math.max(0, Date.now() - open.startedMs), open.rate)
    this.db.transaction(tx=>{
    if(this.lease&&!this.lease.ownsAsRun(open.id))throw new Error('As-run não pertence à execução atual.')
    if(!this.lease&&readExecutionOwner(this.db.$client,this.channel.id))throw new Error('As-run de runtime não nativo não pode encerrar execução protegida.')
    tx.update(asRun)
      .set({
        endedAt: new Date().toISOString(),
        airedFrames: Math.max(0, aired),
        durationEvidence: positionConfirmed ? 'ENGINE_POSITION' : 'CLOCK_ESTIMATE',
        endedBy: reason,
        endPositionFrames: endPositionFrames ?? null,
      })
      .where(eq(asRun.id, open.id)).run()
    },{behavior:'immediate'})
    this.integration('asrun.ended', { itemId: open.itemId, endedAt: new Date().toISOString(), reason, airedFrames: Math.max(0, aired) })
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

/** Cadência histórica nunca é inferida do preset atual. Relógio fechado é
 * somente estimativa; linha aberta não possui duração final. */
export function asRunDurationData(entry: AsRunEntry) {
  const rate = Number.isSafeInteger(entry.rateNum) && Number.isSafeInteger(entry.rateDen) && entry.rateNum! > 0 && entry.rateDen! > 0
    ? { num: entry.rateNum!, den: entry.rateDen! } : null
  const frames = entry.endedAt && Number.isSafeInteger(entry.airedFrames) && entry.airedFrames! >= 0 ? entry.airedFrames : null
  if (frames !== null && rate) return { frames, rate, seconds: framesToSeconds(frames, rate), evidence: entry.durationEvidence ?? 'UNKNOWN' }
  const elapsed = entry.endedAt ? Date.parse(entry.endedAt) - Date.parse(entry.startedAt) : NaN
  const seconds = Number.isFinite(elapsed) && elapsed >= 0 ? elapsed / 1000 : null
  return { frames, rate, seconds, evidence: seconds === null ? 'UNKNOWN' as const : 'CLOCK_ESTIMATE' as const }
}

/** Converte o registro sem fabricar homologação, cadência ou fim de arquivo. */
export function toAsRunRecordExtended(
  entry: AsRunEntry,
  _rate: Rate = RATE_PADRAO,
): AsRunRecordExtended {
  const duration = asRunDurationData(entry)
  const airedFrames = duration.frames
  const historicalRate = duration.rate
  const delta = (entry.actualStart ?? 0) - (entry.plannedStart ?? entry.actualStart ?? 0)

  let status: AsRunExtendedStatus = 'UNKNOWN'
  const endedBy = (entry.endedBy ?? '').toUpperCase()
  if (!entry.endedAt) status = 'RUNNING'
  else if (/FAIL|ERROR|ABORT/.test(endedBy)) {
    status = 'FAILED'
  } else if (endedBy === 'SKIP' || endedBy === 'DROPPED') {
    status = 'DROPPED'
  } else if (['NEXT', 'TAKE', 'STOP', 'LIVE_PRIORITY', 'RESTART', 'CONTINGENCY_RETURN'].includes(endedBy)) {
    status = 'INTERRUPTED'
  } else if (['EOS', 'EOF'].includes(endedBy)) {
    status = 'PLAYED_FULL'
  }

  const isCommercial =
    entry.type.toUpperCase() === 'COMMERCIAL' || entry.type.toUpperCase() === 'COMERCIAL' ||
    entry.type.toUpperCase() === 'SPOT' ||
    entry.type.toUpperCase() === 'PUB'

  return {
    id: entry.id,
    itemId: entry.itemId ?? entry.id,
    title: entry.title,
    eventType: entry.type,
    scheduledStart:
      entry.plannedStart !== null && entry.plannedStart !== undefined
        ? historicalRate ? formatTimecode(entry.plannedStart, historicalRate) : 'N/D'
        : entry.startedAt,
    actualStart: historicalRate ? formatTimecode(entry.actualStart, historicalRate) : entry.startedAt,
    durationFrames: airedFrames,
    durationSeconds: duration.seconds,
    endedBy: entry.endedBy,
    rate: historicalRate,
    executionKind: entry.executionKind ?? 'UNKNOWN',
    durationEvidence: duration.evidence,
    deltaFrames: delta,
    status,
    // As-run has no persisted PGM loudness measurement or contract metadata.
    // Do not manufacture compliant values, national eligibility or contracts.
    audioLufs: null,
    audioTruePeakDb: null,
    ancineQuotaEligible: isCommercial ? false : null,
    commercialContractId: undefined,
  }
}

/**
 * Soma duração classificada. Não verifica janela legal, origem, direitos ou
 * sinal físico e, portanto, não certifica conformidade regulatória.
 */
export function calculateAncineCompliance(
  entries: readonly (AsRunEntry | AsRunRecordExtended)[],
  _rate: Rate = RATE_PADRAO,
): AncineComplianceSummary {
  let commercialSeconds = 0
  let nationalSeconds = 0
  let nationalMetadataComplete = true
  let missingDurationCount = 0

  for (const item of entries) {
    const kind = ('eventType' in item ? item.eventType : item.type).toUpperCase()
    const isCommercial = ['COMERCIAL', 'COMMERCIAL', 'SPOT', 'PUB'].includes(kind)

    const recordedSeconds = 'durationFrames' in item
      ? item.durationSeconds !== undefined ? item.durationSeconds : item.durationFrames !== null && item.rate ? framesToSeconds(item.durationFrames, item.rate) : null
      : asRunDurationData(item).seconds
    const seconds = recordedSeconds !== null && Number.isFinite(recordedSeconds) && recordedSeconds >= 0 ? recordedSeconds : null
    if (seconds === null) missingDurationCount++

    if (isCommercial) {
      commercialSeconds += seconds ?? 0
    } else if ('ancineQuotaEligible' in item && item.ancineQuotaEligible === true) {
      nationalSeconds += seconds ?? 0
    } else if (!('ancineQuotaEligible' in item) || item.ancineQuotaEligible === null) nationalMetadataComplete = false
  }

  // Janela regulatória padrão de 1 hora cheia de relógio (3600 segundos)
  const windowSeconds = 3600
  const hourlyCommercialPercent =
    Math.min(100, Math.round((commercialSeconds / windowSeconds) * 1000) / 10)
  const nationalContentMinutes = Math.round((nationalSeconds / 60) * 10) / 10

  return {
    hourlyCommercialPercent,
    maxAllowedCommercialPercent: 25.0,
    nationalContentMinutes: nationalMetadataComplete ? nationalContentMinutes : null,
    nationalContentQuotaMin: null,
    nationalMetadataComplete,
    durationMetadataComplete: missingDurationCount === 0,
    missingDurationCount,
    evidence: 'AS_RUN_EVENT_CLASSIFICATION_ONLY',
    compliant: null,
    regulatoryValidated: false,
    commercialThresholdExceeded: hourlyCommercialPercent > 25.0,
    aggregationBasis: 'CLASSIFIED_DURATION_PER_3600_SECONDS_NOT_LEGAL_WINDOW',
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
  const raw = String(val)
  const str = /^[=+@\-\t\r]/.test(raw) ? "'" + raw : raw
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
    'executionKind',
    'durationEvidence',
    'rateNum',
    'rateDen',
    'regulatoryValidation',
    'durationSeconds',
    'endedBy',
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
      escapeCsvField(rec.executionKind ?? 'UNKNOWN'),
      escapeCsvField(rec.durationEvidence ?? 'UNKNOWN'),
      escapeCsvField(rec.rate?.num),
      escapeCsvField(rec.rate?.den),
      'NOT_HOMOLOGATED',
      escapeCsvField(rec.durationSeconds),
      escapeCsvField(rec.endedBy),
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
 * Exportação XML legada, não validada por XSD BXF. Mantém os elementos para
 * consumidores existentes, mas não anuncia interoperabilidade SMPTE.
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
            <AncineQuotaEligible>${rec.ancineQuotaEligible ?? ''}</AncineQuotaEligible>
          </EventData>
          <TimingData>
            <ScheduledStart>${escapeXml(rec.scheduledStart)}</ScheduledStart>
            <ActualStart>${escapeXml(rec.actualStart)}</ActualStart>
            <DurationFrames>${rec.durationFrames ?? ''}</DurationFrames>
            <DurationSeconds>${rec.durationSeconds ?? ''}</DurationSeconds>
            <Rate num="${rec.rate?.num ?? ''}" den="${rec.rate?.den ?? ''}" />
            <DeltaFrames>${rec.deltaFrames}</DeltaFrames>
          </TimingData>
          ${rec.audioLufs !== null && rec.audioTruePeakDb !== null ? `<AudioCompliance audioLufs="${rec.audioLufs}" audioTruePeakDb="${rec.audioTruePeakDb}" standard="EBU-R128" />` : '<AudioCompliance measured="false" />'}
          <ExecutionResult status="${rec.status}" endedBy="${escapeXml(rec.endedBy)}" />
          <Evidence transport="${escapeXml(rec.executionKind ?? 'UNKNOWN')}" duration="${escapeXml(rec.durationEvidence ?? 'UNKNOWN')}" regulatoryValidated="false" />
        </BroadcastEvent>
      </ScheduleItem>\n`
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- Legacy RPlayout XML draft: NOT XSD-VALIDATED OR SMPTE-HOMOLOGATED. -->
<BxfMessage xmlns="http://smpte-ra.org/schemas/2021/2008/BXF" messageType="AsRun" version="2.0" schemaValidated="false">
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
