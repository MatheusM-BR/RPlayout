import type { AsRunEntry } from '../types.js'
import { csvRows } from './csv.js'
import { OUTAGE_ACTION_LABELS, outageDurationText, outageReasonText } from '@rplayout/protocol'

/** Opções da exportação do AIRED. `includeOutages` (padrão: sim) põe as paradas do ao vivo. */
export interface AsRunExportOptions { includeOutages?: boolean }
const closedText = (closedBy: string | null, endedAt: string | null) => closedBy === 'ITEM_ENDED' ? 'fechada no fim do item' : endedAt ? 'sinal voltou' : 'em andamento'

/** Historical cadence belongs to the occurrence, not today's preset. Never
 * substitute planned duration for executed duration on an open/legacy row. */
export function asRunDuration(entry: AsRunEntry) {
  const frames = entry.endedAt && entry.airedFrames !== null && Number.isSafeInteger(entry.airedFrames) && entry.airedFrames >= 0 ? entry.airedFrames : null
  const rate = Number.isSafeInteger(entry.rateNum) && Number.isSafeInteger(entry.rateDen) && entry.rateNum! > 0 && entry.rateDen! > 0 ? { num: entry.rateNum!, den: entry.rateDen! } : null
  if (frames !== null && rate) return { frames, rate, seconds: frames * rate.den / rate.num, evidence: entry.durationEvidence ?? 'UNKNOWN' }
  const elapsed = entry.endedAt ? Date.parse(entry.endedAt) - Date.parse(entry.startedAt) : NaN
  const seconds = Number.isFinite(elapsed) && elapsed >= 0 ? elapsed / 1000 : null
  return { frames, rate, seconds, evidence: seconds === null ? 'UNKNOWN' as const : 'CLOCK_ESTIMATE' as const }
}
/** Tempo de relógio entre entrada e saída do PGM e quanto dele não aparece na
 * posição do engine: o quadro congelado enquanto um TAKE espera sinal (ao vivo
 * sem sinal segura o item anterior por ~10 s) some da duração nominal. */
export function asRunHold(entry: AsRunEntry): { wallSeconds: number | null; heldSeconds: number | null } {
  const elapsed = entry.endedAt ? Date.parse(entry.endedAt) - Date.parse(entry.startedAt) : NaN
  const wallSeconds = Number.isFinite(elapsed) && elapsed >= 0 ? elapsed / 1000 : null
  const recorded = asRunDuration(entry)
  if (wallSeconds === null || recorded.frames === null || recorded.seconds === null) return { wallSeconds, heldSeconds: null }
  const held = wallSeconds - recorded.seconds
  return { wallSeconds, heldSeconds: held >= 1 ? Math.round(held * 10) / 10 : null }
}
export function asRunStatus(entry: AsRunEntry): string {
  if (!entry.endedAt) return entry.type === 'SINAL' ? 'SEM SINAL AGORA' : 'EM EXECUÇÃO'
  const reason = entry.endedBy?.toUpperCase()
  if (reason === 'EOF' || reason === 'EOS') return 'FIM DO ARQUIVO'
  if (reason === 'NEXT' || reason === 'TAKE') return 'CORTE / TAKE'
  if (reason === 'LIVE_PRIORITY') return 'CORTE NA HORA FIXA'
  if (reason === 'STOP') return 'PARADA MANUAL'
  if (reason === 'RESTART') return 'ENCERRADO NO REINÍCIO'
  if (reason === 'CONTINGENCY_RETURN') return 'RETORNO DE CONTINGÊNCIA'
  if (reason === 'SKIP' || reason === 'DROPPED') return 'DESCARTADO'
  if (reason === 'SIGNAL_RESTORED') return 'SINAL VOLTOU'
  if (reason === 'ITEM_ENDED') return 'SEM SINAL ATÉ A SAÍDA'
  if (reason && /FAIL|ERROR|ABORT/.test(reason)) return 'FALHA'
  return 'ENCERRAMENTO NÃO CLASSIFICADO'
}
export function summarizeAsRun(all: AsRunEntry[]) {
  // Linha de perda de sinal sobrepõe o item ao vivo; não soma tempo no ar.
  const entries = all.filter(entry => entry.type !== 'SINAL')
  const durations = entries.map(asRunDuration)
  const commercial = entries.map((entry, index) => ({ entry, seconds: durations[index]!.seconds })).filter(row => ['COMERCIAL', 'COMMERCIAL', 'SPOT', 'PUB'].includes(row.entry.type.toUpperCase()))
  return {
    seconds: durations.reduce((sum, duration) => sum + (duration.seconds ?? 0), 0),
    frames: durations.reduce((sum, duration) => sum + (duration.frames ?? 0), 0),
    missingDurations: durations.filter(duration => duration.seconds === null).length,
    estimates: durations.filter(duration => duration.seconds !== null && duration.evidence !== 'ENGINE_POSITION').length,
    commercialSeconds: commercial.reduce((sum, row) => sum + (row.seconds ?? 0), 0),
    eof: entries.filter(entry => entry.endedAt && ['EOF', 'EOS'].includes(entry.endedBy?.toUpperCase() ?? '')).length,
    takes: entries.filter(entry => entry.endedAt && ['NEXT', 'TAKE', 'LIVE_PRIORITY'].includes(entry.endedBy?.toUpperCase() ?? '')).length,
    stops: entries.filter(entry => entry.endedAt && entry.endedBy === 'STOP').length,
    simulated: entries.filter(entry => entry.executionKind === 'SIMULATED').length,
    legacy: entries.filter(entry => !entry.executionKind || entry.executionKind === 'UNKNOWN').length,
  }
}
const xml = (value: unknown) => String(value ?? '').replace(/[<>&'\"]/g, character => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[character]!)
export function asRunCsv(entries: AsRunEntry[], options: AsRunExportOptions = {}) {
  const include = options.includeOutages !== false
  const headers = ['ID', 'Título', 'Categoria', 'Início (UTC)', 'Fim (UTC)', 'Quadros registrados', 'Cadência num', 'Cadência den', 'Segundos registrados/estimados', 'Evidência da duração', 'Tempo real no PGM (s)', 'Parado/congelado além da duração (s)', 'Transporte', 'Motivo', 'Estado', 'Homologação regulatória', ...(include ? ['Parado total (s)'] : [])]
  return csvRows([headers, ...entries.flatMap(entry => {
    const duration = asRunDuration(entry), hold = asRunHold(entry)
    const outages = include ? entry.outages ?? [] : []
    const main = [entry.id, entry.title, entry.type, entry.startedAt, entry.endedAt, duration.frames, duration.rate?.num, duration.rate?.den, duration.seconds, duration.evidence, hold.wallSeconds, hold.heldSeconds, entry.executionKind ?? 'UNKNOWN', entry.endedBy, asRunStatus(entry), 'NÃO HOMOLOGADA', ...(include ? [outages.length ? ((entry.outageTotalMs ?? 0) / 1000).toFixed(1) : ''] : [])]
    // Sub-linhas do mesmo item: início, fim, duração, motivo e ação de cada parada.
    const stops = outages.map(outage => [outage.id, `↳ parada: ${outageReasonText(outage)}`, 'PARADA', outage.startedAt, outage.endedAt, '', '', '', outage.durationMs === null ? '' : (outage.durationMs / 1000).toFixed(1), 'RELÓGIO DO SERVIDOR', '', '', '', OUTAGE_ACTION_LABELS[outage.action], closedText(outage.closedBy, outage.endedAt), '', ''])
    return [main, ...stops]
  })])
}
export function asRunXml(entries: AsRunEntry[], channel: { id: string; name: string }, options: AsRunExportOptions = {}) {
  return '<?xml version="1.0" encoding="UTF-8"?>\n' + `<AsRun channelId="${xml(channel.id)}" channelName="${xml(channel.name)}" clock="LOCAL_HOST" regulatoryValidation="NOT_HOMOLOGATED">\n` + entries.map(entry => {
    const duration = asRunDuration(entry)
    return `  <Event id="${xml(entry.id)}" type="${xml(entry.type)}" transport="${xml(entry.executionKind ?? 'UNKNOWN')}" status="${xml(asRunStatus(entry))}"><Title>${xml(entry.title)}</Title><Start>${xml(entry.startedAt)}</Start>${entry.endedAt ? `<End>${xml(entry.endedAt)}</End>` : ''}<Duration frames="${duration.frames ?? ''}" rateNum="${duration.rate?.num ?? ''}" rateDen="${duration.rate?.den ?? ''}" seconds="${duration.seconds ?? ''}" evidence="${duration.evidence}"/><Reason>${xml(entry.endedBy)}</Reason>${options.includeOutages !== false && entry.outages?.length ? `<LiveOutages totalSeconds="${((entry.outageTotalMs ?? 0) / 1000).toFixed(1)}">${entry.outages.map(outage => `<Outage start="${xml(outage.startedAt)}"${outage.endedAt ? ` end="${xml(outage.endedAt)}"` : ''} seconds="${outage.durationMs === null ? '' : (outage.durationMs / 1000).toFixed(1)}" reason="${xml(outage.reasons.join(','))}" action="${xml(outage.action)}" closedBy="${xml(outage.closedBy ?? '')}">${xml(outageReasonText(outage))} · ${xml(OUTAGE_ACTION_LABELS[outage.action])}</Outage>`).join('')}</LiveOutages>` : ''}</Event>`
  }).join('\n') + '\n</AsRun>'
}
export function asRunReport(entries: AsRunEntry[], channel: { id: string; name: string }, generatedAt: Date, options: AsRunExportOptions = {}) {
  return `RPLAYOUT — RELATÓRIO OPERACIONAL AS-RUN\nCanal: ${channel.name} (${channel.id})\nGerado em: ${generatedAt.toISOString()}\nRelógio: host local; sincronização NTP não aferida.\nSem assinatura digital, certificação regulatória ou confirmação física de veiculação.\nSIMULATED representa simulação; UNKNOWN identifica registro sem proveniência.\n\n` + entries.map(entry => {
    const duration = asRunDuration(entry), hold = asRunHold(entry)
    const line = `${entry.startedAt} → ${entry.endedAt ?? 'em execução'} | ${entry.executionKind ?? 'UNKNOWN'} | ${asRunStatus(entry)} | duração ${duration.seconds === null ? 'N/D' : duration.seconds.toFixed(3) + 's'} (${duration.evidence})${hold.heldSeconds !== null ? ` | PGM parado/congelado +${hold.heldSeconds.toFixed(1)}s (tempo real ${hold.wallSeconds!.toFixed(1)}s)` : ''} | ${entry.id} | ${entry.title}`
    const outages = options.includeOutages !== false ? entry.outages ?? [] : []
    if (!outages.length) return line
    return [line, `    parado no item: ${outageDurationText(entry.outageTotalMs ?? 0)} em ${outages.length} parada(s)`, ...outages.map(outage =>
      `    ↳ ${outage.startedAt} → ${outage.endedAt ?? 'em andamento'} (${outageDurationText(outage.durationMs)}) · ${outageReasonText(outage)} · ${OUTAGE_ACTION_LABELS[outage.action]}${outage.closedBy === 'ITEM_ENDED' ? ' · fechada no fim do item' : ''}`)].join('\n')
  }).join('\n')
}
