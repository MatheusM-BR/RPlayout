import { createHash } from 'node:crypto'
import { framesToSeconds, type Rate } from '@rplayout/protocol'
import { calculateAncineCompliance, toAsRunRecordExtended, type AsRunEntry } from './asrun.js'

export interface CommercialComplianceReport {
  readonly generatedAt: string
  readonly period: { readonly since: string | null; readonly until: string | null }
  readonly commercialSpots: readonly ReturnType<typeof toAsRunRecordExtended>[]
  readonly totalCommercialSeconds: number
  readonly hourlyCompliance: readonly { readonly hour: string; readonly percent: number; readonly compliant: boolean }[]
  readonly reportId: string
}

const isCommercial = (entry: AsRunEntry) => ['COMMERCIAL', 'SPOT', 'PUB'].includes(entry.type.toUpperCase())

/** Constrói o comprovante a partir do as-run, a fonte de verdade de veiculação. */
export function buildCommercialComplianceReport(
  entries: readonly AsRunEntry[],
  rate: Rate,
  period: CommercialComplianceReport['period'],
  generatedAt = new Date().toISOString(),
): CommercialComplianceReport {
  const commercialSpots = entries.filter(isCommercial).map((entry) => toAsRunRecordExtended(entry, rate))
  const buckets = new Map<string, AsRunEntry[]>()
  for (const entry of entries) {
    const hour = entry.startedAt.slice(0, 13) + ':00:00Z'
    buckets.set(hour, [...(buckets.get(hour) ?? []), entry])
  }
  const hourlyCompliance = [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([hour, rows]) => {
    const summary = calculateAncineCompliance(rows, rate)
    return { hour, percent: summary.hourlyCommercialPercent, compliant: summary.compliant }
  })
  const totalCommercialSeconds = Math.round(commercialSpots.reduce((sum, item) => sum + framesToSeconds(item.durationFrames, rate), 0) * 1000) / 1000
  const fingerprint = JSON.stringify({ entries: entries.map((entry) => entry.id), period, generatedAt })
  return {
    generatedAt,
    period,
    commercialSpots,
    totalCommercialSeconds,
    hourlyCompliance,
    reportId: createHash('sha256').update(fingerprint).digest('hex').slice(0, 16).toUpperCase(),
  }
}

function pdfText(value: unknown): string {
  // PDF base-14 usa WinAnsi; trocar caracteres fora de ASCII mantém o arquivo
  // legível e evita que conteúdo operacional seja interpretado como sintaxe PDF.
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\\()]/g, '\\$&').replace(/[^\x20-\x7e]/g, '?')
}

/** Gera um PDF real e autocontido, sem depender de um renderer externo. */
export function renderCommercialCompliancePdf(channelName: string, report: CommercialComplianceReport): Buffer {
  const lines = [
    'RPLAYOUT - COMPROVANTE DE VEICULACAO COMERCIAL E COMPLIANCE',
    `Canal: ${channelName}`,
    `Periodo: ${report.period.since ?? 'inicio'} ate ${report.period.until ?? 'agora'}`,
    `Emitido em: ${report.generatedAt}   Documento: ${report.reportId}`,
    `Spots comerciais veiculados: ${report.commercialSpots.length}   Duracao total: ${report.totalCommercialSeconds}s`,
    'Limite regulatorio por hora: 25.0% de publicidade.',
    '',
    'VEICULACOES COMERCIAIS',
    ...report.commercialSpots.map((spot) => `${spot.actualStart} | ${spot.title} | ${spot.durationFrames} frames | ${spot.status}`),
    '',
    'COMPLIANCE POR HORA',
    ...report.hourlyCompliance.map((hour) => `${hour.hour} | publicidade ${hour.percent.toFixed(1)}% | ${hour.compliant ? 'CONFORME' : 'NAO CONFORME'}`),
    '',
    'Este comprovante e derivado do log as-run registrado pelo RPlayout.',
  ]
  // Nunca silenciosamente cortar uma lista grande de inserções comerciais.
  // Cada página reserva uma linha para cabeçalho/rodapé e guarda até 48 eventos.
  const pages = Array.from({ length: Math.max(1, Math.ceil(lines.length / 48)) }, (_, page) => lines.slice(page * 48, page * 48 + 48))
  const streams = pages.map((pageLines, page) => [
    'BT', '/F1 10 Tf', '50 790 Td', '14 TL',
    ...pageLines.flatMap((line, index) => [index === 0 ? `(${pdfText(line)}) Tj` : `T* (${pdfText(line)}) Tj`]),
    `T* (Pagina ${page + 1}/${pages.length}) Tj`, 'ET',
  ].join('\n'))
  // 1=catalogo, 2=arvore de paginas, 3=fonte; cada pagina e seu stream
  // recebem dois objetos consecutivos.
  const pageObjectIds = pages.map((_, index) => 4 + index * 2)
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ...streams.flatMap((stream, index) => {
      const pageId = pageObjectIds[index]!
      const streamId = pageId + 1
      return [
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${streamId} 0 R >>`,
        `<< /Length ${Buffer.byteLength(stream, 'ascii')} >>\nstream\n${stream}\nendstream`,
      ]
    }),
  ]
  let pdf = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'
  const offsets = [0]
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf, 'binary'))
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
  }
  const xref = Buffer.byteLength(pdf, 'binary')
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n `).join('\n')}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(pdf, 'binary')
}
