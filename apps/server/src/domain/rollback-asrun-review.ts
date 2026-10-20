import type Database from 'better-sqlite3'
import {createHash} from 'node:crypto'
type Row=Record<string,unknown>&{id:string;channel_id:string}
export interface RollbackAsRunDifference {id:string;channelId:string;title:string;kind:'AFTER_UPGRADE'|'CHANGED'|'ABSENT_FROM_CURRENT';beforeHash:string|null;currentHash:string|null}
const canonical=(row:Record<string,unknown>,columns:readonly string[])=>JSON.stringify(columns.map(key=>[key,row[key]??null]))
const hash=(value:string)=>createHash('sha256').update(value).digest('hex')
/** Review only, never merging historical evidence into a different schema,
 * closing an as-run row or selecting a recovery cursor for an old engine. */
export function reviewRollbackAsRun(previous:Database.Database,current:Database.Database){
  const columns=(sql:Database.Database)=>(sql.pragma('table_info(as_run)') as Array<{name:string}>).map(row=>row.name)
  const beforeColumns=columns(previous),currentColumns=columns(current)
  for(const fields of [beforeColumns,currentColumns])if(!fields.includes('id')||!fields.includes('channel_id'))throw new Error('As-run ausente/incompatível; retorno não pode ignorar histórico.')
  const allColumns=[...new Set([...beforeColumns,...currentColumns])].sort(),before=new Map<string,Row>()
  let priorOpen=0,currentOpen=0,newRecords=0,changedRecords=0,missingRecords=0,unchangedRecords=0,currentCount=0
  const differences:RollbackAsRunDifference[]=[],inventory=createHash('sha256')
  const inspect=(row:Row)=>{if(typeof row.id!=='string'||!row.id||typeof row.channel_id!=='string'||!row.channel_id)throw new Error('Identidade de as-run inválida.')}
  const detail=(old:Row|undefined,row:Row|undefined,kind:RollbackAsRunDifference['kind'])=>{
    const chosen=row??old!,entry={id:chosen.id,channelId:chosen.channel_id,title:typeof chosen.title==='string'?chosen.title:'',kind,beforeHash:old?hash(canonical(old,allColumns)):null,currentHash:row?hash(canonical(row,allColumns)):null}
    inventory.update(JSON.stringify(entry)+'\n');if(differences.length<1000)differences.push(entry)
  }
  previous.transaction(()=>{
    for(const row of previous.prepare('SELECT * FROM as_run ORDER BY id').iterate() as Iterable<Row>){inspect(row);if(before.has(row.id)||before.size>=500000)throw new Error('Histórico duplicado/excede limite de conferência; não será truncado como pronto.');before.set(row.id,row);if(row.ended_at==null)priorOpen++}
  }).deferred()
  const priorCount=before.size,seen=new Set<string>()
  current.transaction(()=>{
    for(const row of current.prepare('SELECT * FROM as_run ORDER BY id').iterate() as Iterable<Row>){
      inspect(row);if(seen.has(row.id)||seen.size>=500000)throw new Error('Histórico atual duplicado/excede limite; conferência recusada.');seen.add(row.id);currentCount++;if(row.ended_at==null)currentOpen++
      const old=before.get(row.id)
      if(!old){newRecords++;detail(undefined,row,'AFTER_UPGRADE')}
      else if(canonical(old,allColumns)!==canonical(row,allColumns)){changedRecords++;detail(old,row,'CHANGED')}
      else unchangedRecords++
      before.delete(row.id)
    }
  }).deferred()
  for(const old of before.values()){missingRecords++;detail(old,undefined,'ABSENT_FROM_CURRENT')}
  const totalDifferences=newRecords+changedRecords+missingRecords
  const columnsAdded=currentColumns.filter(name=>!beforeColumns.includes(name)),columnsMissing=beforeColumns.filter(name=>!currentColumns.includes(name))
  return {version:1 as const,priorCount,currentCount,newRecords,changedRecords,missingRecords,unchangedRecords,priorOpen,currentOpen,totalDifferences,differenceInventoryHash:inventory.digest('hex'),differences,detailsTruncated:totalDifferences>differences.length,columnsAdded,columnsMissing,historyReconciliationRequired:totalDifferences>0||currentOpen>0||priorOpen>0||columnsAdded.length>0||columnsMissing.length>0,historyMerged:false,automaticTake:false,rollbackReady:false}
}
