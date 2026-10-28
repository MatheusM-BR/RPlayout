import type { AsRunEntry } from '../../types.js'
import { summarizeAsRun } from '../../domain/asrun-evidence.js'

interface Props { entries: AsRunEntry[]; className?: string }
export function AncineComplianceCard({ entries, className = '' }: Props) {
  const summary = summarizeAsRun(entries)
  const percent = summary.seconds > 0 ? 100 * summary.commercialSeconds / summary.seconds : null
  return <section className={`bg-surface-card rounded-xl border border-border-subtle p-3.5 flex flex-col gap-3 ${className}`}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="font-headline-md text-[13px] font-bold text-on-surface">Classificação dos registros · conferência regulatória</h3>
      <span className="text-[11px] text-armed-amber">NÃO HOMOLOGADA</span>
    </div>
    <p className="text-[11px] text-outline">O registro do engine não comprova transmissão física, origem nacional ou validade de certificado CPB/CRT. Não há aprovação regulatória automática.</p>
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[11px]">
      <div className="rounded border border-border-subtle p-3">
        <strong>Itens classificados como comerciais no período</strong>
        <p>{percent === null ? 'N/D · sem duração disponível' : `${percent.toFixed(1)}% · ${(summary.commercialSeconds / 60).toFixed(2)} min registrados/estimados`}</p>
        <p className="text-outline">Não é apuração por hora nem avaliação de limite legal. A categoria precisa estar cadastrada corretamente.</p>
      </div>
      <div className="rounded border border-border-subtle p-3">
        <strong>Origem nacional e certificados</strong><p>N/D · metadados regulatórios não persistidos neste registro.</p>
        <p className="text-outline">{summary.simulated} ocorrências simuladas · {summary.legacy} sem proveniência · {summary.missingDurations} durações indisponíveis · {summary.estimates} estimadas/não confirmadas pelo cursor nativo.</p>
      </div>
    </div>
  </section>
}
