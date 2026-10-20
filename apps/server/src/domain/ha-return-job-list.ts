import type Database from 'better-sqlite3'
import {z} from 'zod'
import {returnRecoverableJobKind,returnJobActivePhase} from './ha-return-job-recovery.js'
export const haReturnJobListQuery=z.object({channelId:z.string().min(1).max(128),kind:returnRecoverableJobKind,afterId:z.string().uuid().optional()}).strict()
type JobKind=z.infer<typeof returnRecoverableJobKind>
type HistoricalJob={version:1;phase:string;updatedAt:string;ownedHere:boolean;ownerRecorded?:boolean;confirmationIsHistorical:true;operationalReady:false;result:unknown;request:{channelId:string;mediaReviewId?:string;mediaApplicationId?:string;postGainReviewId?:string;busReviewId?:string;candidateId?:string;applicationId?:string;reviewId?:string;rekeyId?:string;importId?:string;decisionId?:string}}
/** Page the journal, not just matches. Empty pages may still have a cursor.
 * SQL names come only from this fixed map; decrypted private evidence is never
 * included in the response. No claim of a cross-page stable snapshot. */
export function listReturnPendingJobs(db:Database.Database,raw:unknown,read:(kind:JobKind,id:string,channelId:string)=>HistoricalJob){
  const request=haReturnJobListQuery.parse(raw),definition={HISTORY_IMPORT:{table:'ha_return_history_jobs',column:'job_id',field:'importId',filter:" AND job_kind='IMPORT'"},HISTORY_VARIANT:{table:'ha_return_history_jobs',column:'job_id',field:'decisionId',filter:" AND job_kind='VARIANT'"},DATABASE_REVIEW:{table:'ha_return_reviews',column:'review_id',field:'reviewId'},REKEY:{table:'ha_return_rekeys',column:'rekey_id',field:'rekeyId'},CANDIDATE:{table:'ha_return_candidate_stages',column:'candidate_id',field:'candidateId'},BINDING_APPLICATION:{table:'ha_return_applications',column:'application_id',field:'applicationId'},MEDIA_REVIEW:{table:'ha_return_media_reviews',column:'media_review_id',field:'mediaReviewId'},MEDIA_APPLICATION:{table:'ha_return_media_applications',column:'media_application_id',field:'mediaApplicationId'},POSTGAIN_REVIEW:{table:'ha_return_postgain_reviews',column:'postgain_review_id',field:'postGainReviewId'},BUS_REVIEW:{table:'ha_return_bus_reviews',column:'bus_review_id',field:'busReviewId'}}[request.kind],{table,column}=definition
  const ids=db.prepare('SELECT '+column+' id FROM '+table+' WHERE channel_id=? AND '+column+'>?'+('filter' in definition?definition.filter:'')+' ORDER BY '+column+' COLLATE BINARY LIMIT 26').all(request.channelId,request.afterId??'') as Array<{id:string}>
  const page=ids.slice(0,25),rows=[]
  for(const row of page){
    const value=read(request.kind,row.id,request.channelId),id=value.request[definition.field as keyof HistoricalJob['request']]
    if(value.version!==1||id!==row.id||value.request.channelId!==request.channelId||value.confirmationIsHistorical!==true||value.operationalReady!==false)throw new Error('Listagem diverge do diário/canal.')
    if(['ACCEPTED',returnJobActivePhase(request.kind),...(['HISTORY_IMPORT','HISTORY_VARIANT'].includes(request.kind)?['COMMITTING']:[])].includes(value.phase)){
      if(value.result!==null)throw new Error('Pedido pendente contém resultado confirmado.')
      rows.push({id:row.id,kind:request.kind,channelId:request.channelId,phase:value.phase as 'ACCEPTED'|'EXTRACTING'|'COMMITTING'|'REVIEWING'|'REKEYING'|'MATERIALIZING'|'CHECKING'|'APPLYING'|'MEASURING',updatedAt:value.updatedAt,ownedHere:value.ownedHere,ownerRecorded:value.ownerRecorded??true})
    }
  }
  return {version:1 as const,channelId:request.channelId,kind:request.kind,afterId:request.afterId??null,rows,scanned:page.length,nextCursor:ids.length>25?page.at(-1)!.id:null,snapshot:false as const,processStoppedProven:false as const,operationalReady:false as const,publicationAuthorized:false as const}
}
