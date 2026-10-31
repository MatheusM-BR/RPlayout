import type Database from 'better-sqlite3'
import {createHash} from 'node:crypto'
import {z} from 'zod'
import {installationVault} from './secret-vault.js'
import {assertSchemaCompatibility} from '../db/schema-compatibility.js'

export const haHistoryImportRequest=z.object({importId:z.string().uuid(),reviewId:z.string().uuid(),transferId:z.string().uuid(),channelId:z.string().min(1).max(128),records:z.array(z.object({id:z.string().min(1).max(128),receivedHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict()).min(1).max(1000)}).strict().superRefine((v,ctx)=>{if(new Set(v.records.map(row=>row.id)).size!==v.records.length)ctx.addIssue({code:z.ZodIssueCode.custom,message:'IDs repetidos.'})})
export type HaHistoryImportRequest=z.infer<typeof haHistoryImportRequest>
export type HaHistoryCommit=(request:HaHistoryImportRequest,rows:Array<Record<string,unknown>>,authorize:()=>void,actor:string)=>{version:1;request:HaHistoryImportRequest;imported:number;historyFullyReconciled:false;primaryApproved:false;publicationAuthorized:false;authorityTransferred:false;committedAt:string}
export interface HaHistoryAdapter {commit:HaHistoryCommit;query:(importId:string,channelId:string)=>ReturnType<HaHistoryCommit>|null}
export const asRunRowHash=(row:Record<string,unknown>,columns:readonly string[])=>createHash('sha256').update(JSON.stringify([...columns].sort().map(key=>[key,row[key]??null]))).digest('hex')
export const haHistoryAppendEligible=(row:Record<string,unknown>)=>row.execution_kind==='NATIVE'&&row.duration_evidence==='ENGINE_POSITION'&&typeof row.started_at==='string'&&typeof row.ended_at==='string'&&Number.isFinite(Date.parse(row.started_at))&&Number.isFinite(Date.parse(row.ended_at))&&Date.parse(row.ended_at)>=Date.parse(row.started_at)&&Number.isSafeInteger(row.aired_frames)&&Number(row.aired_frames)>=0&&Number.isSafeInteger(row.start_position_frames)&&Number(row.start_position_frames)>=0&&Number.isSafeInteger(row.end_position_frames)&&Number(row.end_position_frames)>=Number(row.start_position_frames)&&Number.isSafeInteger(row.rate_num)&&Number.isSafeInteger(row.rate_den)&&Number(row.rate_num)>0&&Number(row.rate_den)>0
export function queryHaHistoryImport(db:Database.Database,importId:string,channelId:string){
  const row=db.prepare('SELECT kind,payload FROM operator_decisions WHERE id=?').get(z.string().uuid().parse(importId)) as {kind:string;payload:string}|undefined
  if(!row)return null
  if(row.kind!=='HA_HISTORY_IMPORT')throw new Error('UUID pertence a outra operação.')
  const report=JSON.parse(installationVault(false).decrypt(row.payload,'operator_decisions.payload')) as ReturnType<HaHistoryCommit>
  const request=haHistoryImportRequest.parse(report.request)
  if(request.importId!==importId||request.channelId!==channelId||report.version!==1||report.imported!==request.records.length||report.historyFullyReconciled!==false||report.primaryApproved!==false||report.publicationAuthorized!==false||report.authorityTransferred!==false)throw new Error('Diário de importação não corresponde ao canal/intenção.')
  return {...report,request}
}
/** INSERT-only and audit in ONE operational transaction. Never updates/closes
 * an existing as-run, creates missing editions, selects a cursor or enables PGM. */
export function appendHaHistory(db:Database.Database,request:HaHistoryImportRequest,rows:Array<Record<string,unknown>>,authorize:()=>void,actor:string):ReturnType<HaHistoryCommit>{
  request=haHistoryImportRequest.parse(request);authorize()
  return db.transaction(()=>{
    authorize();assertSchemaCompatibility(db,true)
    const old=queryHaHistoryImport(db,request.importId,request.channelId)
    if(old){if(JSON.stringify(old.request)!==JSON.stringify(request))throw new Error('UUID pertence a outra intenção.');return old}
    if(!db.prepare('SELECT 1 FROM channels WHERE id=?').get(request.channelId))throw new Error('Canal do principal ausente.')
    const columns=(db.pragma('table_info(as_run)') as Array<{name:string}>).map(row=>row.name).sort(),received=new Map(rows.map(row=>[row.id,row]))
    if(received.size!==rows.length||received.size!==request.records.length)throw new Error('Extração não corresponde aos IDs revisados.')
    const insert=db.prepare('INSERT INTO as_run ('+columns.map(key=>'"'+key.replaceAll('"','""')+'"').join(',')+') VALUES ('+columns.map(()=>'?').join(',')+')')
    for(const selected of request.records){
      const row=received.get(selected.id)
      if(!row||Object.keys(row).sort().join('\0')!==columns.join('\0')||row.channel_id!==request.channelId||asRunRowHash(row,columns)!==selected.receivedHash||db.prepare('SELECT 1 FROM as_run WHERE id=?').get(selected.id))throw new Error('Registro mudou/já existe/de outro canal; nenhuma substituição permitida.')
      if(!haHistoryAppendEligible(row))throw new Error('Importação exige registro encerrado com evidência nativa; não inferir duração/fechar histórico.')
      authorize();if(insert.run(...columns.map(key=>row[key])).changes!==1)throw new Error('Histórico não foi inserido integralmente.')
    }
    const report:ReturnType<HaHistoryCommit>={version:1,request,imported:request.records.length,historyFullyReconciled:false,primaryApproved:false,publicationAuthorized:false,authorityTransferred:false,committedAt:new Date().toISOString()}
    authorize();db.prepare('INSERT INTO operator_decisions(id,rundown_id,item_id,kind,payload,actor_username,created_at) VALUES(?,?,NULL,?,?,?,?)').run(request.importId,'@ha:'+request.channelId,'HA_HISTORY_IMPORT',installationVault(false).encrypt(JSON.stringify(report),'operator_decisions.payload'),actor,report.committedAt)
    return report
  }).immediate()
}
