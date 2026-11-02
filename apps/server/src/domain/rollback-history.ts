import type Database from 'better-sqlite3'
import {reviewRollbackAsRun} from './rollback-asrun-review.js'

/** Keep the ENTIRE latest snapshot. Never merge IDs, infer end frames or
 * overwrite the latest execution with the pre-upgrade database. */
export function assertLosslessRollbackHistory(baseline:Database.Database,current:Database.Database){
  const history=reviewRollbackAsRun(baseline,current)
  if(history.missingRecords)throw new Error('Histórico atual perdeu IDs presentes no backup anterior. Retorno exige conciliação explícita; nenhum registro será descartado ou mesclado automaticamente.')
  const fields=['channel_id','rundown_id','item_id','media_id','revision_id','media_hash','started_at','rate_num','rate_den','execution_kind']
  const available=(db:Database.Database)=>(db.pragma('table_info(as_run)') as {name:string}[]).map(row=>row.name)
  const common=fields.filter(field=>available(baseline).includes(field)&&available(current).includes(field))
  const currentById=current.prepare('SELECT * FROM as_run WHERE id=?')
  for(const row of baseline.prepare('SELECT * FROM as_run ORDER BY id').iterate() as Iterable<Record<string,unknown>>){
    const latest=currentById.get(row.id) as Record<string,unknown>
    if(common.some(field=>(row[field]??null)!==(latest[field]??null)))throw new Error('Identidade histórica mudou entre backups. Retorno recusado sem reescrever evidência.')
  }
  return {...history,historyPolicy:'LATEST_COMPLETE_SNAPSHOT_NO_MERGE' as const,allBaselineIdsPreserved:true as const}
}

export function assertExactRollbackAsRunCopy(source:Database.Database,candidate:Database.Database){
  const columns=(db:Database.Database)=>(db.pragma('table_info(as_run)') as Array<{name:string;type:string;notnull:number;pk:number}>).map(({name,type,notnull,pk})=>({name,type,notnull,pk}))
  if(JSON.stringify(columns(source))!==JSON.stringify(columns(candidate)))throw new Error('Schema do histórico da cópia diverge do snapshot atual.')
  const count=(db:Database.Database)=>(db.prepare('SELECT COUNT(*) AS n FROM as_run').get() as {n:number}).n
  const rows=count(source)
  if(rows>500000||count(candidate)!==rows)throw new Error('Histórico extra/ausente ou acima do limite na cópia de retorno.')
  const byId=candidate.prepare('SELECT * FROM as_run WHERE id=?')
  for(const row of source.prepare('SELECT * FROM as_run ORDER BY id').iterate() as Iterable<{id:string}>){if(JSON.stringify(row)!==JSON.stringify(byId.get(row.id)))throw new Error('Histórico da cópia diverge do snapshot atual.')}
  return {rows}
}
