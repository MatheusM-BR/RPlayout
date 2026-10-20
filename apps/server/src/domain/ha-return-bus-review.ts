import type Database from 'better-sqlite3'
import {createHash} from 'node:crypto'
import {z} from 'zod'
import {installationVault} from './secret-vault.js'
import {returnPostGainProfile as returnBusProfile} from './ha-return-postgain-plan.js'
import type {planReturnBusAudio} from './ha-return-bus-plan.js'
import {bindReturnBusEvidence,returnBusEvidenceSchema,returnBusSummarySchema,summarizeReturnBus} from './ha-return-bus-evidence.js'
import {assessReturnBusAudio,returnBusPolicySchema,returnBusAssessmentSummarySchema,summarizeReturnBusAssessment} from './ha-return-bus-policy.js'

const hash=z.string().regex(/^[a-f0-9]{64}$/),mac=z.string().regex(/^[A-Za-z0-9_-]{43}$/)
export const HA_RETURN_BUS_REVIEW_RESERVE=64*1024*1024
/** HTTP intent has no gain, profile, paths or client-provided measurements. */
export const haReturnBusReviewRequest=z.object({busReviewId:z.string().uuid(),mediaApplicationId:z.string().uuid(),channelId:z.string().min(1).max(128)}).strict()
export const returnBusCapture=z.object({mediaReviewId:z.string().uuid(),mediaDatabaseHash:hash,evidenceMac:mac,profile:returnBusProfile,profileFingerprint:hash,autoDecisionId:z.string().uuid().nullable(),policy:returnBusPolicySchema.nullable().optional()}).strict().refine(value=>createHash('sha256').update(JSON.stringify(value.profile)).digest('hex')===value.profileFingerprint&&(!value.policy||value.policy.channelId===value.profile.channelId&&value.policy.audioChannels===value.profile.audioChannels))
const result=z.object({runtimeHash:hash,checkedAt:z.string().datetime(),evidenceMac:mac,summary:returnBusSummarySchema,assessment:returnBusAssessmentSummarySchema.nullable().optional()}).strict()
const record=z.object({version:z.literal(1),request:haReturnBusReviewRequest,capture:returnBusCapture,owner:z.string().min(1),actor:z.string().min(1).max(256),phase:z.enum(['ACCEPTED','MEASURING','REVIEWED','FAILED']),quotaBytes:z.literal(HA_RETURN_BUS_REVIEW_RESERVE),updatedAt:z.string().datetime(),result:result.nullable(),privateEvidence:z.string().max(16*1024*1024).nullable()}).strict().refine(value=>value.capture.profile.channelId===value.request.channelId&&(value.phase==='REVIEWED'?!!value.result&&!!value.privateEvidence:value.result===null&&value.privateEvidence===null))
type Capture=z.infer<typeof returnBusCapture>
type Plan=ReturnType<typeof planReturnBusAudio>
function assertPlan(capture:Capture,plan:Plan){
  if(JSON.stringify(capture.profile)!==JSON.stringify(returnBusProfile.parse(plan.profile))||capture.profileFingerprint!==plan.profileFingerprint||plan.jobs.some(job=>job.evidenceMac!==capture.evidenceMac||job.autoDecisionId!==capture.autoDecisionId))throw new Error('Plano bus completo diverge do perfil/evidência/decisão capturados.')
}
/** Journal only. Store must gate quota/authorization, verify the STAGED copy
 * and registered AUTO decision, and reconfirm bytes/profile before/after run.
 * This class neither authorizes PGM nor opens media/native resources itself. */
export class HaReturnBusReviews{
  constructor(private readonly db:Database.Database,private readonly context:string,private readonly owner:string){
    db.exec('CREATE TABLE IF NOT EXISTS ha_return_bus_reviews(bus_review_id TEXT PRIMARY KEY,media_application_id TEXT NOT NULL,channel_id TEXT NOT NULL,payload TEXT NOT NULL)')
    db.exec("CREATE TRIGGER IF NOT EXISTS ha_return_bus_no_delete BEFORE DELETE ON ha_return_bus_reviews BEGIN SELECT RAISE(ABORT,'Postgain history cannot be deleted'); END; CREATE TRIGGER IF NOT EXISTS ha_return_bus_no_replace BEFORE INSERT ON ha_return_bus_reviews WHEN EXISTS(SELECT 1 FROM ha_return_bus_reviews WHERE bus_review_id=NEW.bus_review_id) BEGIN SELECT RAISE(ABORT,'Postgain intent cannot be replaced'); END;")
  }
  private key(id:string){return 'ha-return-bus-review:v1:'+this.context+':'+id}
  private proofKey(id:string){return 'ha-return-bus-evidence:v1:'+this.context+':'+id}
  private read(id:string,channelId:string){
    const row=this.db.prepare('SELECT * FROM ha_return_bus_reviews WHERE bus_review_id=?').get(z.string().uuid().parse(id)) as {bus_review_id:string;media_application_id:string;channel_id:string;payload:string}|undefined
    if(!row)throw new Error('Revisão bus completo não registrada.')
    const value=record.parse(JSON.parse(installationVault(false).decrypt(row.payload,this.key(id))))
    if(value.request.busReviewId!==row.bus_review_id||value.request.mediaApplicationId!==row.media_application_id||value.request.channelId!==row.channel_id||row.channel_id!==channelId)throw new Error('Revisão bus completo diverge do diário/canal.')
    return value
  }
  query(id:string,channelId:string){const {owner,privateEvidence,...value}=this.read(id,channelId);return {...value,ownedHere:owner===this.owner,confirmationIsHistorical:true as const,operationalReady:false as const,publicationAuthorized:false as const}}
  existing(raw:unknown){const request=haReturnBusReviewRequest.parse(raw);if(!this.db.prepare('SELECT 1 FROM ha_return_bus_reviews WHERE bus_review_id=?').get(request.busReviewId))return null;const prior=this.query(request.busReviewId,request.channelId);if(JSON.stringify(prior.request)!==JSON.stringify(request))throw new Error('UUID bus completo pertence a outra intenção.');return prior}
  reservedBytes(){return (this.db.prepare('SELECT count(*) n FROM ha_return_bus_reviews').get() as {n:number}).n*HA_RETURN_BUS_REVIEW_RESERVE}
  accept(raw:unknown,captureRaw:unknown,actor:string,current:()=>void){
    return this.db.transaction(()=>{
      current();const request=haReturnBusReviewRequest.parse(raw),capture=returnBusCapture.parse(captureRaw),prior=this.existing(request)
      if(prior)return prior // Consultation only; caller must not enqueue again.
      if((this.db.prepare('SELECT count(*) n FROM ha_return_bus_reviews').get() as {n:number}).n>=1024)throw new Error('Histórico bus completo excede limite; preservar registros.')
      const value=record.parse({version:1,request,capture,actor,owner:this.owner,phase:'ACCEPTED',quotaBytes:HA_RETURN_BUS_REVIEW_RESERVE,updatedAt:new Date().toISOString(),result:null,privateEvidence:null})
      this.db.prepare('INSERT INTO ha_return_bus_reviews VALUES(?,?,?,?)').run(request.busReviewId,request.mediaApplicationId,request.channelId,installationVault(false).encrypt(JSON.stringify(value),this.key(request.busReviewId)))
      current();return this.query(request.busReviewId,request.channelId)
    }).immediate()
  }
  private transition(initial:z.infer<typeof record>,next:z.infer<typeof record>,current:()=>void){
    this.db.transaction(()=>{
      current();const observed=this.read(initial.request.busReviewId,initial.request.channelId)
      if(JSON.stringify(observed)!==JSON.stringify(initial)||['REVIEWED','FAILED'].includes(observed.phase))throw new Error('Revisão bus completo mudou ou já é terminal.')
      const value=record.parse(next),encoded=installationVault(false).encrypt(JSON.stringify(value),this.key(value.request.busReviewId))
      if(Buffer.byteLength(encoded)>HA_RETURN_BUS_REVIEW_RESERVE)throw new Error('Evidência excede reserva; não truncar como completa.')
      if(this.db.prepare('UPDATE ha_return_bus_reviews SET payload=? WHERE bus_review_id=?').run(encoded,value.request.busReviewId).changes!==1)throw new Error('Revisão perdeu diário.')
      current()
    }).immediate()
  }
  async run(raw:unknown,plan:Plan,measure:()=>Promise<{evidence:unknown;summary:unknown}>,verifyCurrent:()=>Promise<void>,current:()=>void){
    const request=haReturnBusReviewRequest.parse(raw),initial=this.read(request.busReviewId,request.channelId)
    if(initial.owner!==this.owner||initial.phase!=='ACCEPTED')throw new Error('Revisão bus completo não pertence à execução atual ou já foi iniciada.')
    assertPlan(initial.capture,plan);await verifyCurrent();current()
    const measuring={...initial,phase:'MEASURING' as const,updatedAt:new Date().toISOString()};this.transition(initial,measuring,current)
    try{
      const measured=await measure(),bound=bindReturnBusEvidence(plan,measured.evidence)
      if(JSON.stringify(returnBusSummarySchema.parse(measured.summary))!==JSON.stringify(bound.summary))throw new Error('Resumo bus completo diverge do recibo.')
      const privateEvidence=JSON.stringify(bound.evidence)
      if(Buffer.byteLength(privateEvidence)>16*1024*1024)throw new Error('Recibos bus completo excedem limite; não truncar.')
      await verifyCurrent();current();assertPlan(initial.capture,plan)
      const assessment=initial.capture.policy?summarizeReturnBusAssessment(assessReturnBusAudio(plan,bound.evidence,initial.capture.policy)):null
      this.transition(measuring,{...measuring,phase:'REVIEWED',updatedAt:new Date().toISOString(),privateEvidence,result:result.parse({runtimeHash:bound.evidence.runtimeHash,checkedAt:new Date().toISOString(),evidenceMac:installationVault(false).reviewIdentity(privateEvidence,this.proofKey(request.busReviewId)),summary:bound.summary,assessment})},current)
    }catch(error){
      // Lost ownership/cancellation must not manufacture a successful closure.
      current();this.transition(measuring,{...measuring,phase:'FAILED',updatedAt:new Date().toISOString()},current);throw error
    }
    return this.query(request.busReviewId,request.channelId)
  }
  privateEvidence(id:string,channelId:string,plan:Plan){
    const value=this.read(id,channelId)
    if(value.owner!==this.owner||value.phase!=='REVIEWED'||!value.result||!value.privateEvidence)throw new Error('Recibo próprio bus completo confirmado ausente.')
    assertPlan(value.capture,plan)
    const evidence=returnBusEvidenceSchema.parse(JSON.parse(value.privateEvidence)),bound=bindReturnBusEvidence(plan,evidence)
    if(installationVault(false).reviewIdentity(value.privateEvidence,this.proofKey(id))!==value.result.evidenceMac||evidence.runtimeHash!==value.result.runtimeHash||JSON.stringify(summarizeReturnBus(evidence))!==JSON.stringify(value.result.summary))throw new Error('Recibo bus completo diverge do resumo/MAC.')
    const assessment=value.capture.policy?summarizeReturnBusAssessment(assessReturnBusAudio(plan,evidence,value.capture.policy)):null
    if(JSON.stringify(value.result.assessment??null)!==JSON.stringify(assessment))throw new Error('Avaliação bus diverge da política capturada.')
    return {...bound,capture:value.capture,confirmationIsHistorical:true as const,publicationAuthorized:false as const}
  }
  closeInterrupted(id:string,channelId:string,phase:string,updatedAt:string,stopped:(owner:string)=>void,current:()=>void){
    const initial=this.read(id,channelId)
    if(!['ACCEPTED','MEASURING'].includes(initial.phase)||initial.phase!==phase||initial.updatedAt!==updatedAt||initial.result||initial.privateEvidence)throw new Error('Revisão bus completo mudou ou tem confirmação.')
    stopped(initial.owner);this.transition(initial,{...initial,phase:'FAILED',updatedAt:new Date().toISOString()},()=>{current();stopped(initial.owner)})
  }
}
