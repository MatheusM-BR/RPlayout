import type { AsRunEntry } from '../types.js'
import { csvRows } from './csv.js'

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
export function asRunStatus(entry: AsRunEntry): string {
  if (!entry.endedAt) return 'EM EXECUÇÃO'
  const reason = entry.endedBy?.toUpperCase()
  if (reason === 'EOF' || reason === 'EOS') return 'FIM DO ARQUIVO'
  if (reason === 'NEXT' || reason === 'TAKE') return 'CORTE / TAKE'
  if (reason === 'LIVE_PRIORITY') return 'CORTE PARA AO VIVO'
  if (reason === 'STOP') return 'PARADA MANUAL'
  if (reason === 'RESTART') return 'ENCERRADO NO REINÍCIO'
  if (reason === 'CONTINGENCY_RETURN') return 'RETORNO DE CONTINGÊNCIA'
  if (reason === 'SKIP' || reason === 'DROPPED') return 'DESCARTADO'
  if (reason && /FAIL|ERROR|ABORT/.test(reason)) return 'FALHA'
  return 'ENCERRAMENTO NÃO CLASSIFICADO'
}
export function summarizeAsRun(entries: AsRunEntry[]) {
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
export function asRunCsv(entries: AsRunEntry[]) {
  const headers = ['ID', 'Título', 'Categoria', 'Início UTC (relógio local)', 'Fim UTC', 'Quadros registrados', 'Cadência num', 'Cadência den', 'Segundos registrados/estimados', 'Evidência da duração', 'Transporte', 'Motivo', 'Estado', 'Homologação regulatória']
  return csvRows([headers, ...entries.map(entry => {
    const duration = asRunDuration(entry)
    return [entry.id, entry.title, entry.type, entry.startedAt, entry.endedAt, duration.frames, duration.rate?.num, duration.rate?.den, duration.seconds, duration.evidence, entry.executionKind ?? 'UNKNOWN', entry.endedBy, asRunStatus(entry), 'NÃO HOMOLOGADA']
  })])
}
export function asRunXml(entries: AsRunEntry[], channel: { id: string; name: string }) {
  return '<?xml version="1.0" encoding="UTF-8"?>\n' + `<AsRun channelId="${xml(channel.id)}" channelName="${xml(channel.name)}" clock="LOCAL_HOST" regulatoryValidation="NOT_HOMOLOGATED">\n` + entries.map(entry => {
    const duration = asRunDuration(entry)
    return `  <Event id="${xml(entry.id)}" type="${xml(entry.type)}" transport="${xml(entry.executionKind ?? 'UNKNOWN')}" status="${xml(asRunStatus(entry))}"><Title>${xml(entry.title)}</Title><Start>${xml(entry.startedAt)}</Start>${entry.endedAt ? `<End>${xml(entry.endedAt)}</End>` : ''}<Duration frames="${duration.frames ?? ''}" rateNum="${duration.rate?.num ?? ''}" rateDen="${duration.rate?.den ?? ''}" seconds="${duration.seconds ?? ''}" evidence="${duration.evidence}"/><Reason>${xml(entry.endedBy)}</Reason></Event>`
  }).join('\n') + '\n</AsRun>'
}
export function asRunReport(entries: AsRunEntry[], channel: { id: string; name: string }, generatedAt: Date) {
  return `RPLAYOUT — RELATÓRIO OPERACIONAL AS-RUN\nCanal: ${channel.name} (${channel.id})\nGerado em: ${generatedAt.toISOString()}\nRelógio: host local; sincronização NTP não aferida.\nSem assinatura digital, certificação regulatória ou confirmação física de veiculação.\nSIMULATED representa simulação; UNKNOWN identifica registro sem proveniência.\n\n` + entries.map(entry => {
    const duration = asRunDuration(entry)
    return `${entry.startedAt} → ${entry.endedAt ?? 'em execução'} | ${entry.executionKind ?? 'UNKNOWN'} | ${asRunStatus(entry)} | duração ${duration.seconds === null ? 'N/D' : duration.seconds.toFixed(3) + 's'} (${duration.evidence}) | ${entry.id} | ${entry.title}`
  }).join('\n')
}
