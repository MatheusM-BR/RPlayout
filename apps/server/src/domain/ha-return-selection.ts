import type Database from 'better-sqlite3'
import {z} from 'zod'
import {installationVault} from './secret-vault.js'
const id=z.string().min(1).max(256),mac=z.string().regex(/^[A-Za-z0-9_-]{43}$/)
export const haReturnSelectionRequest=z.object({planId:z.string().uuid(),reviewId:z.string().uuid(),rekeyId:z.string().uuid(),transferId:z.string().uuid(),channelId:z.string().min(1).max(128),editionInventoryMac:mac,checkpointMac:mac.nullable(),revisionIds:z.array(id).min(1).max(128),executionRevisionId:id,cursorPolicy:z.enum(['STOPPED','RECEIVED_LAST_CONFIRMED']),reason:z.string().trim().min(5).max(2000)}).strict().refine(v=>new Set(v.revisionIds).size===v.revisionIds.length&&v.revisionIds.includes(v.executionRevisionId),'Seleção de edições inválida')
const recordSchema=z.object({version:z.literal(1),request:haReturnSelectionRequest,owner:z.string(),actor:z.string().min(1),recordedAt:z.string().datetime(),reviewDatabaseHash:z.string().regex(/^[a-f0-9]{64}$/),phase:z.literal('SELECTION_RECORDED'),source:z.literal('RETURNED_REKEYED_COPY'),historyReconciled:z.literal(false),mediaValidated:z.literal(false),nativePrepared:z.literal(false),authorityTransferred:z.literal(false),publicationAuthorized:z.literal(false)}).strict()
export class HaReturnSelections{
  constructor(private readonly db:Database.Database,private readonly context:string,private readonly owner:string){
    db.exec('CREATE TABLE IF NOT EXISTS ha_return_selection_plans(plan_id TEXT PRIMARY KEY,review_id TEXT NOT NULL,channel_id TEXT NOT NULL,payload TEXT NOT NULL)')
    db.exec("CREATE TRIGGER IF NOT EXISTS ha_return_selection_no_update BEFORE UPDATE ON ha_return_selection_plans BEGIN SELECT RAISE(ABORT,'Return selection is immutable'); END; CREATE TRIGGER IF NOT EXISTS ha_return_selection_no_delete BEFORE DELETE ON ha_return_selection_plans BEGIN SELECT RAISE(ABORT,'Return selection history cannot be deleted'); END; CREATE TRIGGER IF NOT EXISTS ha_return_selection_no_replace BEFORE INSERT ON ha_return_selection_plans WHEN EXISTS(SELECT 1 FROM ha_return_selection_plans WHERE plan_id=NEW.plan_id) BEGIN SELECT RAISE(ABORT,'Return selection cannot be replaced'); END;")
  }
  private key(planId:string){return 'ha-return-selection:v1:'+this.context+':'+planId}
  private read(planId:string,channelId:string){
    const row=this.db.prepare('SELECT * FROM ha_return_selection_plans WHERE plan_id=?').get(z.string().uuid().parse(planId)) as {plan_id:string;review_id:string;channel_id:string;payload:string}|undefined
    if(!row)return null
    const value=recordSchema.parse(JSON.parse(installationVault(false).decrypt(row.payload,this.key(planId))))
    if(value.request.planId!==row.plan_id||value.request.reviewId!==row.review_id||value.request.channelId!==row.channel_id||channelId!==row.channel_id)throw new Error('Seleção pertence a outro canal ou diário inválido.')
    return value
  }
  query(planId:string,channelId:string){
    const value=this.read(planId,channelId)
    if(!value)throw new Error('Seleção ainda não registrada neste canal.')
    const {owner:_,...publicValue}=value
    return {...publicValue,ownedHere:value.owner===this.owner,confirmationIsHistorical:true as const,operationalReady:false as const}
  }
  existing(raw:unknown){const request=haReturnSelectionRequest.parse(raw),value=this.read(request.planId,request.channelId);if(!value)return null;if(JSON.stringify(value.request)!==JSON.stringify(request))throw new Error('UUID pertence a outra seleção; não substituir plano.');return this.query(request.planId,request.channelId)}
  save(raw:unknown,reviewDatabaseHash:string,actor:string,authorize:()=>void){
    const request=haReturnSelectionRequest.parse(raw)
    return this.db.transaction(()=>{
      authorize();const prior=this.existing(request);if(prior)return prior
      if((this.db.prepare('SELECT count(*) AS n FROM ha_return_selection_plans').get() as {n:number}).n>=1024)throw new Error('Limite de seleções atingido; histórico preservado.')
      const value=recordSchema.parse({version:1,request,owner:this.owner,actor,recordedAt:new Date().toISOString(),reviewDatabaseHash,phase:'SELECTION_RECORDED',source:'RETURNED_REKEYED_COPY',historyReconciled:false,mediaValidated:false,nativePrepared:false,authorityTransferred:false,publicationAuthorized:false})
      this.db.prepare('INSERT INTO ha_return_selection_plans VALUES(?,?,?,?)').run(request.planId,request.reviewId,request.channelId,installationVault(false).encrypt(JSON.stringify(value),this.key(request.planId)))
      authorize();return this.query(request.planId,request.channelId)
    }).immediate()
  }
}
