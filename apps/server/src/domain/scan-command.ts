import {randomUUID,createHash} from 'node:crypto'
import {resolve} from 'node:path'
import {z} from 'zod'
import {eq} from 'drizzle-orm'
import {scanETag,type ScanReview,type ScanCommandResult} from '@rplayout/protocol'
import type {Db} from '../db/client.js'
import {operatorDecisions} from '../db/schema.js'
import {rootAccess,readRootCatalog,rootAuthority} from './root-edit.js'
import {CollaborativeEditError} from './collaborative-edit.js'
import {readScanDiagnostics} from './scan-diagnostic.js'
import {AccessControl} from './access.js'
import {can} from './permissions.js'
type Authority=ReturnType<typeof rootAuthority>
const fail=(status:number,error:string):never=>{throw new CollaborativeEditError(status,{error})}
export function readScanReview(db:Db,a:Authority,available:boolean):ScanReview{return db.transaction(()=>{
  const catalog=readRootCatalog(db,a),row=db.$client.prepare('SELECT version FROM scan_revision WHERE singleton=1').get() as {version:number}|undefined
  if(!row||!Number.isSafeInteger(row.version)||row.version<1)fail(409,'Revisão da varredura indisponível.')
  const canRecover=catalog.canEdit&&can(new AccessControl(db.$client).role(a.request),'OUTPUT_CONTROL')
  const activeBatches=readScanDiagnostics(db.$client,canRecover)
  return {...catalog,batchRevision:row!.version,operationId:randomUUID(),available,canStart:catalog.canEdit&&available&&catalog.roots.length>0&&!activeBatches.length,activeBatches}
})}
export function queueScan(db:Db,body:unknown,header:unknown,a:Authority,available:boolean):ScanCommandResult{
  const parsed=z.object({requestId:z.string().uuid(),measure:z.boolean(),root:z.string().min(1).max(4096).optional()}).strict().safeParse(body)
  if(!parsed.success)fail(400,'Varredura exige identificador, modo de medição e somente uma pasta opcional cadastrada.')
  const input=parsed.data!
  return db.transaction(()=>{
    const actor=rootAccess(db,a,true),decisionId='scan-command:'+input.requestId
    const signature=createHash('sha256').update(JSON.stringify({ownerId:a.ownerId,header,measure:input.measure,root:input.root??null})).digest('hex')
    const previous=db.select().from(operatorDecisions).where(eq(operatorDecisions.id,decisionId)).get()
    if(previous){
      if(previous.payload.signature!==signature)fail(409,'Identificador já usado para outra varredura/conferência.')
      const id=String(previous.payload.batchId),row=db.$client.prepare('SELECT state FROM ingest_batches WHERE id=?').get(id) as {state:string}|undefined
      return {accepted:true,batchId:id,state:row?.state??'UNKNOWN',deduplicated:true,roots:previous.payload.roots as string[],measure:input.measure}
    }
    const review=readScanReview(db,a,available)
    if(header===undefined)fail(428,'Confira pastas e estado da varredura antes de confirmar; revisão original obrigatória.')
    if(typeof header!=='string'||!/^"scan:[1-9]\d*:[1-9]\d*"$/.test(header))fail(400,'Conferência de varredura inválida.')
    if(header!==scanETag(review))fail(409,'Pastas ou estado da varredura mudaram. Campos preservados; reabra a conferência.')
    if(!review.canStart)fail(409,available?'Existe lote ativo/pendente ou nenhuma pasta cadastrada. Nenhuma nova varredura criada.':'A sonda de mídia não está configurada.')
    const selected=input.root?review.roots.filter(root=>root.path===resolve(input.root!)):review.roots
    if(!selected.length)fail(400,'Escolha somente uma pasta cadastrada, não um caminho arbitrário do servidor.')
    const roots=selected.map(root=>root.path),batchId=randomUUID(),now=new Date().toISOString()
    db.$client.prepare('INSERT INTO ingest_batches(id,roots,measure,state,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(batchId,JSON.stringify(roots),input.measure?1:0,'PENDING',now,now)
    db.insert(operatorDecisions).values({id:decisionId,rundownId:'@library',kind:'MEDIA_SCAN_QUEUED',actorUsername:actor.identity?.username??null,createdAt:now,payload:{batchId,roots,measure:input.measure,signature,reviewedRootRevision:review.revision,reviewedBatchRevision:review.batchRevision,station:a.request.ip,automaticTake:false}}).run()
    return {accepted:true,batchId,state:'PENDING',deduplicated:false,roots,measure:input.measure}
  },{behavior:'immediate'})
}
