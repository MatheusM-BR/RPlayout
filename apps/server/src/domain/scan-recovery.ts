import {createHash} from 'node:crypto'
import {eq} from 'drizzle-orm'
import {z} from 'zod'
import {scanETag,type ScanCommandResult} from '@rplayout/protocol'
import type {Db} from '../db/client.js'
import {operatorDecisions} from '../db/schema.js'
import {rootAccess,rootAuthority} from './root-edit.js'
import {readScanReview} from './scan-command.js'
import {diagnoseScan,type ScanOwnerRow} from './scan-diagnostic.js'
import {AccessControl} from './access.js'
import {can} from './permissions.js'
import {CollaborativeEditError} from './collaborative-edit.js'
const fail=(status:number,error:string):never=>{throw new CollaborativeEditError(status,{error})}
export function recoverScan(db:Db,body:unknown,header:unknown,a:ReturnType<typeof rootAuthority>,available:boolean):ScanCommandResult{
  const parsed=z.object({requestId:z.string().uuid(),batchId:z.string().min(1).max(128)}).strict().safeParse(body)
  if(!parsed.success)fail(400,'Retomada exige lote e identificador, sem dono/PID ou campos extras.')
  return db.transaction(()=>{
    const actor=rootAccess(db,a,true)
    if(!can(new AccessControl(db.$client).role(a.request),'OUTPUT_CONTROL'))fail(403,'Seu papel não pode solicitar reparo de posse do scanner.')
    const input=parsed.data!,decisionId='scan-recovery:'+input.requestId,signature=createHash('sha256').update(JSON.stringify({batchId:input.batchId,ownerId:a.ownerId,header})).digest('hex')
    const previous=db.select().from(operatorDecisions).where(eq(operatorDecisions.id,decisionId)).get()
    if(previous){if(previous.payload.signature!==signature)fail(409,'Identificador usado para outra retomada/conferência.');const row=db.$client.prepare('SELECT state FROM ingest_batches WHERE id=?').get(input.batchId) as {state:string}|undefined;return {accepted:true,batchId:input.batchId,state:row?.state??'UNKNOWN',deduplicated:true,roots:previous.payload.roots as string[],measure:Boolean(previous.payload.measure)}}
    const review=readScanReview(db,a,available)
    if(header===undefined)fail(428,'Confira posse e fila antes da retomada; revisão original obrigatória.')
    if(typeof header!=='string'||!/^"scan:[1-9]\d*:[1-9]\d*"$/.test(header))fail(400,'Conferência de retomada inválida.')
    if(header!==scanETag(review))fail(409,'Fila, raízes ou posse mudaram; reabra a conferência.')
    const row=db.$client.prepare('SELECT id,state,roots,measure,owner_host,owner_pid,owner_boot FROM ingest_batches WHERE id=?').get(input.batchId) as ScanOwnerRow|undefined
    if(!row)fail(404,'Lote não encontrado; nenhuma retomada presumida.')
    const diagnostic=diagnoseScan(row!,true)
    if(!diagnostic.canRecover)fail(409,'Encerramento local não comprovado ou lote inválido. Dono/raízes preservados; nenhum processo será morto.')
    const now=new Date().toISOString(),roots=JSON.parse(row!.roots) as string[]
    const changed=db.$client.prepare("UPDATE ingest_batches SET state='PENDING',owner_host=NULL,owner_pid=NULL,owner_boot=NULL,error='Retomada conferida após encerramento local comprovado.',updated_at=? WHERE id=? AND state='RUNNING' AND owner_host=? AND owner_pid=? AND owner_boot=?").run(now,row!.id,row!.owner_host,row!.owner_pid,row!.owner_boot)
    if(changed.changes!==1)fail(409,'Posse mudou; lote não retomado.')
    db.insert(operatorDecisions).values({id:decisionId,rundownId:'@library',kind:'MEDIA_SCAN_RECOVERY_REQUESTED',actorUsername:actor.identity?.username??null,createdAt:now,payload:{batchId:row!.id,roots,measure:Boolean(row!.measure),signature,reviewedRootRevision:review.revision,reviewedBatchRevision:review.batchRevision,proof:'LOCAL_PROCESS_ABSENT',station:a.request.ip,automaticTake:false,processKilled:false}}).run()
    return {accepted:true,batchId:row!.id,state:'PENDING',deduplicated:false,roots,measure:Boolean(row!.measure)}
  },{behavior:'immediate'})
}
