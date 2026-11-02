import {randomUUID,createHash} from 'node:crypto'
import {eq,and,or,isNull,isNotNull,desc} from 'drizzle-orm'
import {z} from 'zod'
import {integrationETag,integrationCatalogETag,integrationDeliveryETag,type IntegrationReview,type IntegrationCatalogReview,type IntegrationDeliveryReview,type IntegrationDeliverySummary} from '@rplayout/protocol'
import type {Db} from '../db/client.js'
import {integrations,integrationDeliveries,operatorDecisions} from '../db/schema.js'
import {AccessControl,type AccessRequest} from './access.js'
import {can} from './permissions.js'
import {CollaborativeEditError} from './collaborative-edit.js'
import {diagnoseIntegrationOwner,uncertainDelivery} from './integration-diagnostic.js'
import {sanitizeDiagnostic} from './sanitize-diagnostic.js'
export {uncertainDelivery} from './integration-diagnostic.js'
export function readIntegrationDeliveries(db:Db,channelId:string|null,a:Authority):{deliveries:IntegrationDeliverySummary[];limit:number;deliverySemantics:string}{return db.transaction(()=>{
  const actor=authorize(db,a,channelId,false)
  if(channelId===null&&!actor.canEdit)fail(403,'Escolha um canal autorizado para consultar entregas.')
  const restricted=actor.identity?.channelIds!==undefined&&actor.identity.channelIds!==null
  const rows=db.select({id:integrationDeliveries.id,integrationId:integrationDeliveries.integrationId,channelId:integrationDeliveries.channelId,event:integrationDeliveries.event,state:integrationDeliveries.state,attempts:integrationDeliveries.attempts,nextAttemptAt:integrationDeliveries.nextAttemptAt,lastError:integrationDeliveries.lastError,createdAt:integrationDeliveries.createdAt,deliveredAt:integrationDeliveries.deliveredAt,ownerHost:integrationDeliveries.ownerHost,ownerPid:integrationDeliveries.ownerPid,ownerBoot:integrationDeliveries.ownerBoot})
    .from(integrationDeliveries).leftJoin(integrations,eq(integrations.id,integrationDeliveries.integrationId))
    .where(channelId===null?undefined:and(eq(integrationDeliveries.channelId,channelId),or(isNull(integrations.channelId),eq(integrations.channelId,channelId)),restricted?isNotNull(integrations.id):undefined))
    .orderBy(desc(integrationDeliveries.createdAt),desc(integrationDeliveries.id)).limit(100).all()
  // Explicit public projection: owner coordinates and private target/payload
  // are never spread into responses, even if internal queries grow later.
  return {deliveries:rows.map(row=>({id:row.id,integrationId:row.integrationId,channelId:row.channelId,event:row.event,state:row.state,attempts:row.attempts,nextAttemptAt:row.nextAttemptAt,lastError:row.lastError===null?null:sanitizeDiagnostic(row.lastError),createdAt:row.createdAt,deliveredAt:row.deliveredAt,diagnostic:diagnoseIntegrationOwner(row)})),limit:100,deliverySemantics:'AT_LEAST_ONCE'}
})}
const fail=(status:number,error:string):never=>{throw new CollaborativeEditError(status,{error})}
const url=z.string().url().max(4096).refine(value=>{const u=new URL(value);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password},'Use HTTP(S) sem usuário/senha na URL.')
const events=z.array(z.string().trim().min(1).max(128)).min(1).max(100)
export const integrationCreate=z.object({channelId:z.string().min(1).nullable().optional(),name:z.string().trim().min(1).max(256),url,events}).strict()
const patch=z.object({name:z.string().trim().min(1).max(256).optional(),url:url.optional(),events:events.optional(),enabled:z.boolean().optional()}).strict().refine(value=>Object.keys(value).length>0)
interface Authority {request:AccessRequest;ownerId:string|null}
export const integrationAuthority=(db:Db,request:AccessRequest):Authority=>({request,ownerId:new AccessControl(db.$client).identity(request)?.id??null})
function authorize(db:Db,a:Authority,channel:string|null,write=true){
  const access=new AccessControl(db.$client),identity=access.identity(a.request)
  if((identity?.id??null)!==a.ownerId||access.required()&&!identity||!can(access.role(a.request),'OUTPUT_CONTROL'))fail(403,'Sessão ou permissão de integrações mudou; nada foi alterado ou enviado.')
  const canEdit=channel===null?identity?.channelIds===undefined||identity.channelIds===null:access.channelAllowed(a.request,channel)
  if(channel!==null&&!db.$client.prepare('SELECT 1 FROM channels WHERE id=?').get(channel))fail(404,'Canal da integração não existe.')
  if(channel!==null&&!canEdit)fail(403,'Sua conta não pode consultar este canal.')
  if(write&&!canEdit)fail(403,'Sua conta não pode alterar/disparar integrações deste escopo.')
  return {identity,canEdit}
}
function revision(db:Db){const row=db.$client.prepare('SELECT version FROM integration_revision WHERE singleton=1').get() as {version:number}|undefined;if(!row||!Number.isSafeInteger(row.version)||row.version<1)fail(409,'Revisão de integrações indisponível.');return row!.version}
function proof(header:unknown,expected:string){if(header===undefined)fail(428,'Confira a integração antes de confirmar; revisão original obrigatória.');if(typeof header!=='string'||!/^"integration(?:-catalog|-delivery)?:[^"\s]+:[1-9]\d*(?::[1-9]\d*)?"$/.test(header))fail(400,'Conferência de integração inválida.');if(header!==expected)fail(409,'Configuração ou entrega mudou. Campos preservados; reabra a conferência.')}
export function publicIntegration(row:typeof integrations.$inferSelect){
  let safeUrl='Destino inválido; solicite reparo explícito.'
  try{const u=new URL(row.url);safeUrl=u.origin+(u.pathname!=='/'||u.search?'/REDACTED':'/')}catch{}
  return {...row,url:safeUrl}
}
function get(db:Db,id:string){const row=db.select().from(integrations).where(eq(integrations.id,id)).get();if(!row)fail(404,'Integração não encontrada.');return row!}
export function readIntegrationCatalog(db:Db,channelId:string|null,a:Authority):IntegrationCatalogReview{return db.transaction(()=>({channelId,revision:revision(db),canEdit:authorize(db,a,channelId,false).canEdit}))}
export function readIntegration(db:Db,id:string,a:Authority):IntegrationReview{return db.transaction(()=>{const row=get(db,id);return {...publicIntegration(row),revision:revision(db),canEdit:authorize(db,a,row.channelId,false).canEdit}})}
function audit(db:Db,kind:string,actor:string|null,payload:Record<string,unknown>){db.insert(operatorDecisions).values({id:randomUUID(),rundownId:'@integrations',kind,actorUsername:actor,createdAt:new Date().toISOString(),payload}).run()}
export function createIntegration(db:Db,body:unknown,header:unknown,a:Authority){
  const parsed=integrationCreate.safeParse(body);if(!parsed.success)fail(400,'Nome, URL HTTP(S) sem credenciais e eventos válidos; campos extras recusados.')
  const input=parsed.data!
  return db.transaction(()=>{const channelId=input.channelId??null,actor=authorize(db,a,channelId),before={channelId,revision:revision(db),canEdit:true};proof(header,integrationCatalogETag(before))
    const row={...input,channelId,id:randomUUID(),enabled:false,createdAt:new Date().toISOString()};db.insert(integrations).values(row).run()
    audit(db,'INTEGRATION_CREATED',actor.identity?.username??null,{integrationId:row.id,channelId,name:row.name,events:row.events,enabled:false,reviewedRevision:before.revision,revision:revision(db),station:a.request.ip})
    return {integration:publicIntegration(row),applied:true as const}
  },{behavior:'immediate'})
}
export function updateIntegration(db:Db,id:string,body:unknown,header:unknown,a:Authority){
  const parsed=patch.safeParse(body);if(!parsed.success)fail(400,'Alteração de integração inválida ou com campos extras.')
  return db.transaction(()=>{const row=get(db,id),actor=authorize(db,a,row.channelId);proof(header,integrationETag({id,revision:revision(db)}));const reviewedRevision=revision(db)
    db.update(integrations).set(parsed.data!).where(eq(integrations.id,id)).run()
    audit(db,'INTEGRATION_CHANGED',actor.identity?.username??null,{integrationId:id,channelId:row.channelId,fields:Object.keys(parsed.data!),reviewedRevision,revision:revision(db),station:a.request.ip})
    return {...readIntegration(db,id,a),applied:true as const}
  },{behavior:'immediate'})
}
export function queueIntegrationTest(db:Db,id:string,body:unknown,header:unknown,a:Authority){
  const parsed=z.object({requestId:z.string().uuid()}).strict().safeParse(body);if(!parsed.success)fail(400,'Teste exige identificador da operação; destino/campos extras recusados.')
  return db.transaction(()=>{const row=get(db,id),actor=authorize(db,a,row.channelId),decisionId='integration-test:'+parsed.data!.requestId
    const signature=createHash('sha256').update(JSON.stringify({id,ownerId:a.ownerId,header})).digest('hex')
    const previous=db.select().from(operatorDecisions).where(eq(operatorDecisions.id,decisionId)).get()
    if(previous){if(previous.payload.signature!==signature)fail(409,'Identificador já usado para outro teste/conferência.');const delivery=db.select().from(integrationDeliveries).where(eq(integrationDeliveries.id,String(previous.payload.deliveryId))).get();return {queued:true as const,deliveryId:String(previous.payload.deliveryId),state:delivery?.state??'UNKNOWN',applied:true as const,deduplicated:true}}
    proof(header,integrationETag({id,revision:revision(db)}));if(!url.safeParse(row.url).success)fail(409,'Destino salvo inválido; teste não agendado.')
    const deliveryId=randomUUID(),now=new Date().toISOString()
    db.insert(integrationDeliveries).values({id:deliveryId,integrationId:id,channelId:row.channelId,event:'rplayout.test',target:row.url,payload:{id:deliveryId,type:'rplayout.test',sentAt:now},manualTest:true,state:'QUEUED',attempts:0,nextAttemptAt:now,createdAt:now}).run()
    db.insert(operatorDecisions).values({id:decisionId,rundownId:'@integrations',kind:'INTEGRATION_TEST_QUEUED',actorUsername:actor.identity?.username??null,createdAt:now,payload:{integrationId:id,deliveryId,channelId:row.channelId,reviewedRevision:revision(db),signature,station:a.request.ip}}).run()
    return {queued:true as const,deliveryId,state:'QUEUED' as const,applied:true as const,deduplicated:false}
  },{behavior:'immediate'})
}
export function readIntegrationDelivery(db:Db,id:string,a:Authority):IntegrationDeliveryReview{return db.transaction(()=>{
  const row=db.select().from(integrationDeliveries).where(eq(integrationDeliveries.id,id)).get();if(!row)fail(404,'Entrega não encontrada.')
  const integration=get(db,row!.integrationId),actor=authorize(db,a,integration.channelId,false);if(row!.channelId!==null)authorize(db,a,row!.channelId,false)
  const version=db.$client.prepare('SELECT version FROM integration_delivery_versions WHERE id=?').get(id) as {version:number}|undefined
  if(!version||!Number.isSafeInteger(version.version)||version.version<1)fail(409,'Revisão de entrega indisponível.')
  return {id,integrationId:row!.integrationId,channelId:row!.channelId,state:row!.state,attempts:row!.attempts,revision:version!.version,configurationRevision:revision(db),canRetry:actor.canEdit&&!uncertainDelivery(row!.lastError)&&['FAILED','CANCELLED'].includes(row!.state)&&integration.url===row!.target&&(row!.manualTest||integration.enabled&&integration.events.includes(row!.event)),requiresOwnerConfirmation:uncertainDelivery(row!.lastError),diagnostic:diagnoseIntegrationOwner(row!)}
})}
export function retryIntegrationDelivery(db:Db,id:string,body:unknown,header:unknown,a:Authority){
  const parsed=z.object({confirmedPreviousStopped:z.boolean().optional()}).strict().safeParse(body??{});if(!parsed.success)fail(400,'Confirmação de reenvio inválida.')
  return db.transaction(()=>{const review=readIntegrationDelivery(db,id,a),integration=get(db,review.integrationId),actor=authorize(db,a,integration.channelId);if(review.channelId!==null)authorize(db,a,review.channelId)
    proof(header,integrationDeliveryETag(review));if(review.requiresOwnerConfirmation)fail(409,'Posse inconclusiva: confirmação manual não comprova encerramento. Pedido preservado; reenvio bloqueado.')
    if(!review.canRetry)fail(409,'Entrega ativa/confirmada ou destino alterado; reenvio não autorizado.')
    if(review.requiresOwnerConfirmation&&!parsed.data!.confirmedPreviousStopped)fail(409,'Confirme o encerramento da instância anterior; nenhum processo será presumido parado.')
    db.update(integrationDeliveries).set({state:'QUEUED',attempts:0,nextAttemptAt:new Date().toISOString(),lastError:null,ownerHost:null,ownerPid:null,ownerBoot:null}).where(eq(integrationDeliveries.id,id)).run()
    audit(db,'INTEGRATION_RETRY',actor.identity?.username??null,{deliveryId:id,integrationId:integration.id,channelId:review.channelId,reviewedRevision:review.revision,ownerConfirmed:review.requiresOwnerConfirmation,station:a.request.ip})
    return {applied:true as const,queued:true as const}
  },{behavior:'immediate'})
}
