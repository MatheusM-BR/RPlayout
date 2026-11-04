import type Database from 'better-sqlite3'

/** Janela do histórico de métricas do host (uma linha a cada 10 s, ~2,8 kB).
 * Na produção (r88-35) eram 8 600 linhas e ~25 MB por dia, 14 dias inteiros
 * em resolução cheia: ~70 % do banco. Agora a resolução cheia vale só para as
 * últimas horas; depois fica uma amostra por `coarseSeconds`. */
export interface MetricRetention { readonly days: number; readonly fullResolutionHours: number; readonly coarseSeconds: number }
export const DEFAULT_METRIC_RETENTION: MetricRetention = { days: 14, fullResolutionHours: 24, coarseSeconds: 60 }

function validRetention(retention: MetricRetention): boolean {
  return Number.isFinite(retention.days) && retention.days > 0 && Number.isFinite(retention.fullResolutionHours) && retention.fullResolutionHours >= 0 && Number.isInteger(retention.coarseSeconds) && retention.coarseSeconds >= 10
}

/** Persist the measured payload and expire history atomically. The cutoff is
 * based on commit time, not browser attendance or a historical query's window.
 * relatedWrites must only perform synchronous SQLite writes on this connection. */
export function persistMetricHistory(sqlite:Database.Database,sample:{generatedAt:string},now=Date.now(),relatedWrites?:()=>void,retention:MetricRetention=DEFAULT_METRIC_RETENTION):void{
  if(!Number.isFinite(now)||new Date(sample.generatedAt).toISOString()!==sample.generatedAt)throw new Error('Data de coleta inválida.')
  const days=validRetention(retention)?retention.days:DEFAULT_METRIC_RETENTION.days
  const cutoff=new Date(now-days*86400_000).toISOString()
  sqlite.transaction(()=>{
    sqlite.prepare('INSERT OR REPLACE INTO host_metric_samples VALUES (?,?)').run(sample.generatedAt,JSON.stringify(sample))
    sqlite.prepare('DELETE FROM host_metric_samples WHERE sampled_at<?').run(cutoff)
    relatedWrites?.()
  })()
}

/** Reduz a resolução das amostras mais velhas que `fullResolutionHours`:
 * fica a PRIMEIRA amostra de cada intervalo de `coarseSeconds` (a página de
 * histórico segue com o mesmo formato, só mais espaçada). Em lotes, para não
 * segurar o armazenamento num banco grande; devolve quantas linhas saíram. */
export function compactMetricHistory(sqlite:Database.Database,now=Date.now(),retention:MetricRetention=DEFAULT_METRIC_RETENTION,batch=20_000):number{
  if(!Number.isFinite(now)||!validRetention(retention))return 0
  const before=new Date(now-retention.fullResolutionHours*3600_000).toISOString()
  return sqlite.prepare(`DELETE FROM host_metric_samples WHERE sampled_at IN (
    SELECT sampled_at FROM (
      SELECT sampled_at,row_number() OVER (PARTITION BY CAST(strftime('%s',sampled_at) AS INTEGER)/CAST(? AS INTEGER) ORDER BY sampled_at) AS rn
      FROM host_metric_samples WHERE sampled_at<?
    ) WHERE rn>1 LIMIT ?)`).run(retention.coarseSeconds,before,batch).changes
}
