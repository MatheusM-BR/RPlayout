import type Database from 'better-sqlite3'
/** Persist the measured payload and expire history atomically. The cutoff is
 * based on commit time, not browser attendance or a historical query's window.
 * relatedWrites must only perform synchronous SQLite writes on this connection. */
export function persistMetricHistory(sqlite:Database.Database,sample:{generatedAt:string},now=Date.now(),relatedWrites?:()=>void):void{
  if(!Number.isFinite(now)||new Date(sample.generatedAt).toISOString()!==sample.generatedAt)throw new Error('Data de coleta inválida.')
  const cutoff=new Date(now-14*86400_000).toISOString()
  sqlite.transaction(()=>{
    sqlite.prepare('INSERT OR REPLACE INTO host_metric_samples VALUES (?,?)').run(sample.generatedAt,JSON.stringify(sample))
    sqlite.prepare('DELETE FROM host_metric_samples WHERE sampled_at<?').run(cutoff)
    relatedWrites?.()
  })()
}
