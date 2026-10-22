import type Database from 'better-sqlite3'
import {createHash} from 'node:crypto'
import type {HaSnapshot} from './ha-replication.js'
import {assertSchemaCompatibility} from '../db/schema-compatibility.js'
import {haHistoryAppendEligible} from './ha-history-import.js'
import {inspectRekeyedFields,type haRekeyReviewContext} from './ha-rekeyed-fields-review.js'
import type {z} from 'zod'
import {inspectReturnContent} from './ha-return-content-review.js'

const sha=(raw:string)=>createHash('sha256').update(raw).digest('hex')
const camel=(key:string)=>key.replace(/_([a-z])/g,(_,letter:string)=>letter.toUpperCase())
/** Read-only diagnostic. Never migrates/rekeys/merges data or approves PGM. */
export function inspectReturnedDatabase(db:Database.Database,channelId:string,baseline:HaSnapshot,rekeyed?:z.infer<typeof haRekeyReviewContext>){
  db.pragma('query_only = ON');db.pragma('trusted_schema = OFF')
  for(const name of ['schema_migrations','channels','rundowns','operational_playlist_revisions','as_run','channel_checkpoints'])if(!(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name)))throw new Error('Tabela operacional obrigatória ausente.')
  const schema=assertSchemaCompatibility(db),integrity=db.pragma('integrity_check',{simple:true})
  if(integrity!=='ok'||(db.pragma('foreign_key_check') as unknown[]).length)throw new Error('Integridade/referências inválidas no retorno.')
  const encodingFields=rekeyed?inspectRekeyedFields(db,rekeyed):null
  const contentComparison=rekeyed?inspectReturnContent(db,channelId,baseline):null
  const protectedFields=encodingFields?{...encodingFields,contentComparison}:null
  if(!db.prepare('SELECT 1 FROM channels WHERE id=?').get(channelId))throw new Error('Canal recebido não corresponde ao recibo.')
  const primary=baseline.channels.find(row=>row.channelId===channelId)
  if(!primary)throw new Error('Canal ausente na visão atual do principal.')
  const columns=(db.pragma('table_info(as_run)') as Array<{name:string}>).map(row=>row.name).sort()
  if(!columns.includes('id')||!columns.includes('channel_id')||!columns.includes('ended_at'))throw new Error('As-run incompatível.')
  const canonical=(row:Record<string,unknown>)=>JSON.stringify(columns.map(key=>[key,Object.hasOwn(row,key)?row[key]:row[camel(key)]??null]))
  const before=new Map<string,Record<string,unknown>>()
  for(const row of baseline.asRun){if((row.channelId??row.channel_id)!==channelId)continue;if(typeof row.id!=='string'||!row.id||before.has(row.id)||before.size>=500000)throw new Error('Identidade/limite de histórico do principal inválido.');before.set(row.id,row)}
  const principalCount=before.size,seen=new Set<string>(),inventory=createHash('sha256'),details:Array<{id:string;kind:'RECEIVED_ONLY'|'CHANGED'|'PRIMARY_ONLY';primaryHash:string|null;receivedHash:string|null;appendEligible:boolean;label:string;changedFields:string[]}>=[]
  let receivedOnly=0,changed=0,unchanged=0,receivedOpen=0,receivedCount=0
  const detail=(id:string,kind:'RECEIVED_ONLY'|'CHANGED'|'PRIMARY_ONLY',primaryHash:string|null,receivedHash:string|null,appendEligible=false,label='',changedFields:string[]=[])=>{const value={id,kind,primaryHash,receivedHash,appendEligible,label:label.slice(0,256),changedFields};inventory.update(JSON.stringify(value)+'\n');if(details.length<1000)details.push(value)}
  for(const row of db.prepare('SELECT * FROM as_run WHERE channel_id=? ORDER BY id').iterate(channelId) as Iterable<Record<string,unknown>>){
    if(typeof row.id!=='string'||!row.id||seen.has(row.id)||seen.size>=500000)throw new Error('Identidade/limite do histórico recebido inválido.')
    seen.add(row.id);receivedCount++;if(row.ended_at==null)receivedOpen++
    const old=before.get(row.id),receivedHash=sha(canonical(row))
    const label=typeof row.title==='string'?row.title:''
    if(!old){receivedOnly++;detail(row.id,'RECEIVED_ONLY',null,receivedHash,haHistoryAppendEligible(row),label)}else{const primaryHash=sha(canonical(old));if(primaryHash===receivedHash)unchanged++;else{changed++;detail(row.id,'CHANGED',primaryHash,receivedHash,false,label,columns.filter(key=>JSON.stringify(row[key]??null)!==JSON.stringify(Object.hasOwn(old,key)?old[key]:old[camel(key)]??null)))}}
    before.delete(row.id)
  }
  for(const [id,row] of [...before].sort(([a],[b])=>a<b?-1:a>b?1:0))detail(id,'PRIMARY_ONLY',sha(canonical(row)),null,false,typeof row.title==='string'?row.title:'')
  const revisions=db.prepare('SELECT p.id,p.revision,p.active,p.state FROM operational_playlist_revisions p JOIN rundowns r ON r.id=p.rundown_id WHERE r.channel_id=? ORDER BY p.id').all(channelId) as Array<{id:string;revision:number;active:number;state:string}>
  const primaryRevisionIds=primary.revisions.map(row=>{
    if(typeof row.id!=='string'||!row.id)throw new Error('Identidade da edição do principal inválida.')
    return row.id
  })
  const revisionIds=new Set(primaryRevisionIds),receivedRevisionIds=new Set(revisions.map(row=>row.id))
  const checkpoint=db.prepare('SELECT payload,saved_at FROM channel_checkpoints WHERE channel_id=?').get(channelId) as {payload:string;saved_at:string}|undefined
  const primaryCheckpointHash=primary.checkpoint?sha(JSON.stringify(primary.checkpoint)):null
  const blockers=['PROTECTED_FIELDS_RECONCILIATION_REQUIRED','MEDIA_BINDINGS_RECONCILIATION_REQUIRED','EXECUTION_CURSOR_RECONCILIATION_REQUIRED','UNRESOLVED_COMMANDS_REVIEW_REQUIRED','RETURN_AUTHORITY_NOT_GRANTED']
  if(!schema.current)blockers.push('ISOLATED_SCHEMA_MIGRATION_REQUIRED')
  if(receivedOnly||changed||before.size||receivedOpen)blockers.push('ASRUN_RECONCILIATION_REQUIRED')
  if(revisions.some(row=>!revisionIds.has(row.id))||primaryRevisionIds.some(id=>!receivedRevisionIds.has(id)))blockers.push('PUBLISHED_EDITION_RECONCILIATION_REQUIRED')
  if(contentComparison?.editions.changed&&!blockers.includes('PUBLISHED_EDITION_RECONCILIATION_REQUIRED'))blockers.push('PUBLISHED_EDITION_RECONCILIATION_REQUIRED')
  if(contentComparison&&(!contentComparison.checkpoint.referencedEditionPresent||!contentComparison.checkpoint.referencedItemPresent))blockers.push('CHECKPOINT_REFERENCE_INVALID')
  return {version:1 as const,channelId,integrity:'ok' as const,foreignKeys:'ok' as const,schema,protectedFields,history:{primaryCount:principalCount,receivedCount,receivedOnly,changed,primaryOnly:before.size,unchanged,receivedOpen,differenceInventoryHash:inventory.digest('hex'),details,detailsTruncated:receivedOnly+changed+before.size>details.length,merged:false as const},editions:{receivedCount:revisions.length,primaryCount:primary.revisions.length,receivedOnly:revisions.filter(row=>!revisionIds.has(row.id)).map(row=>row.id).slice(0,1000),primaryOnly:primaryRevisionIds.filter(id=>!receivedRevisionIds.has(id)).slice(0,1000),payloadsApproved:false as const},checkpoint:{receivedPresent:!!checkpoint,receivedPayloadHash:checkpoint?sha(checkpoint.payload):null,primarySnapshotHash:primaryCheckpointHash,comparable:false as const,cursorSelected:false as const},blockers,primaryApproved:false as const,publicationAuthorized:false as const,historyMerged:false as const,authorityTransferred:false as const,checkedAt:new Date().toISOString()}
}
export function extractReturnedHistory(db:Database.Database,channelId:string,records:Array<{id:string;receivedHash:string|null}>){
  db.pragma('query_only = ON');db.pragma('trusted_schema = OFF');assertSchemaCompatibility(db,true)
  const columns=(db.pragma('table_info(as_run)') as Array<{name:string}>).map(row=>row.name).sort()
  return records.map(selected=>{const row=db.prepare('SELECT * FROM as_run WHERE id=? AND channel_id=?').get(selected.id,channelId) as Record<string,unknown>|undefined
    if(selected.receivedHash===null){if(row)throw new Error('Registro deveria estar ausente no recebido.');return null}
    if(!row||sha(JSON.stringify(columns.map(key=>[key,row[key]??null])))!==selected.receivedHash||Buffer.byteLength(JSON.stringify(row))>64*1024)throw new Error('Registro recebido diverge da revisão/limite.')
    return row
  })
}
