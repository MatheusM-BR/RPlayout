import type Database from 'better-sqlite3'
import {z} from 'zod'
import {installationVault} from './secret-vault.js'
import {asRunRowHash} from './ha-history-import.js'
import {assertSchemaCompatibility} from '../db/schema-compatibility.js'

const hash=z.string().regex(/^[a-f0-9]{64}$/)
export const haHistoryVariantRequest=z.object({decisionId:z.string().uuid(),reviewId:z.string().uuid(),transferId:z.string().uuid(),channelId:z.string().min(1).max(128),records:z.array(z.object({id:z.string().min(1).max(128),primaryHash:hash,receivedHash:hash.nullable(),policy:z.literal('KEEP_PRIMARY_WITH_VARIANT'),reason:z.string().trim().min(5).max(2000)}).strict()).min(1).max(100)}).strict().superRefine((v,ctx)=>{if(new Set(v.records.map(row=>row.id)).size!==v.records.length)ctx.addIssue({code:z.ZodIssueCode.custom,message:'IDs repetidos.'})})
export type HaHistoryVariantRequest=z.infer<typeof haHistoryVariantRequest>
export interface HaHistoryVariantReceipt {version:1;request:HaHistoryVariantRequest;preserved:number;asRunModified:false;nativeUncertaintyResolved:false;historyFullyReconciled:false;publicationAuthorized:false;authorityTransferred:false;committedAt:string}
const receiptSchema=z.object({version:z.literal(1),request:haHistoryVariantRequest,preserved:z.number().int().positive().max(100),asRunModified:z.literal(false),nativeUncertaintyResolved:z.literal(false),historyFullyReconciled:z.literal(false),publicationAuthorized:z.literal(false),authorityTransferred:z.literal(false),committedAt:z.string().datetime()}).strict()
export interface HaHistoryVariantAdapter {commit:(request:HaHistoryVariantRequest,received:Array<Record<string,unknown>|null>,authorize:()=>void,actor:string)=>HaHistoryVariantReceipt;query:(decisionId:string,channelId:string)=>HaHistoryVariantReceipt|null}
export function queryHaHistoryVariant(db:Database.Database,decisionId:string,channelId:string){
  z.string().uuid().parse(decisionId);z.string().min(1).max(128).parse(channelId)
  const row=db.prepare('SELECT kind,payload FROM operator_decisions WHERE id=?').get(decisionId) as {kind:string;payload:string}|undefined
  if(!row)return null
  if(row.kind!=='HA_HISTORY_VARIANT_REVIEW')throw new Error('UUID pertence a outra ação.')
  const raw=JSON.parse(installationVault(false).decrypt(row.payload,'operator_decisions.payload')) as {receipt:unknown}
  const receipt=receiptSchema.parse(raw.receipt)
  if(receipt.request.decisionId!==decisionId||receipt.request.channelId!==channelId||receipt.preserved!==receipt.request.records.length)throw new Error('Recibo pertence a outra decisão/canal.')
  return receipt // No private variants or source titles sent to the browser.
}
/** Archive both versions and the explicit operator policy. Never overwrite,
 * close, duplicate billing rows or declare a lost native command confirmed. */
export function preserveHaHistoryVariants(db:Database.Database,raw:HaHistoryVariantRequest,received:Array<Record<string,unknown>|null>,authorize:()=>void,actor:string):HaHistoryVariantReceipt{
  const request=haHistoryVariantRequest.parse(raw);authorize()
  return db.transaction(()=>{
    authorize();assertSchemaCompatibility(db,true)
    const prior=queryHaHistoryVariant(db,request.decisionId,request.channelId)
    if(prior){if(JSON.stringify(prior.request)!==JSON.stringify(request))throw new Error('UUID pertence a outra intenção.');return prior}
    if(received.length!==request.records.length)throw new Error('Extração de variantes incompleta.')
    const columns=(db.pragma('table_info(as_run)') as Array<{name:string}>).map(row=>row.name).sort()
    const variants=request.records.map((selected,index)=>{
      const primary=db.prepare('SELECT * FROM as_run WHERE id=? AND channel_id=?').get(selected.id,request.channelId) as Record<string,unknown>|undefined,remote=received[index]
      if(!primary||asRunRowHash(primary,columns)!==selected.primaryHash)throw new Error('Histórico do principal mudou desde a revisão.')
      if(selected.receivedHash===null?remote!==null:!remote||remote.id!==selected.id||remote.channel_id!==request.channelId||Object.keys(remote).sort().join('\0')!==columns.join('\0')||asRunRowHash(remote,columns)!==selected.receivedHash)throw new Error('Variante recebida não corresponde à revisão.')
      if(Buffer.byteLength(JSON.stringify({primary,remote}))>128*1024)throw new Error('Variante excede limite; não truncar como preservada.')
      return {id:selected.id,primary,received:remote,primaryHash:selected.primaryHash,receivedHash:selected.receivedHash,policy:selected.policy,reason:selected.reason}
    })
    const receipt:HaHistoryVariantReceipt={version:1,request,preserved:variants.length,asRunModified:false,nativeUncertaintyResolved:false,historyFullyReconciled:false,publicationAuthorized:false,authorityTransferred:false,committedAt:new Date().toISOString()}
    const serialized=JSON.stringify({receipt,variants});if(Buffer.byteLength(serialized)>1024*1024)throw new Error('Lote de variantes excede limite durável; selecione menos registros.')
    authorize();db.prepare('INSERT INTO operator_decisions(id,rundown_id,item_id,kind,payload,actor_username,created_at) VALUES(?,?,NULL,?,?,?,?)').run(request.decisionId,'@ha:'+request.channelId,'HA_HISTORY_VARIANT_REVIEW',installationVault(false).encrypt(serialized,'operator_decisions.payload'),actor,receipt.committedAt)
    return receipt
  }).immediate()
}
