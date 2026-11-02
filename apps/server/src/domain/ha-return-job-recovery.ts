import type Database from 'better-sqlite3'
import {hostname} from 'node:os'
import {z} from 'zod'
import {installationVault} from './secret-vault.js'

export const returnRecoverableJobKind=z.enum(['HISTORY_IMPORT','HISTORY_VARIANT','DATABASE_REVIEW','REKEY','CANDIDATE','BINDING_APPLICATION','MEDIA_REVIEW','MEDIA_APPLICATION','POSTGAIN_REVIEW','BUS_REVIEW'])
export function returnJobActivePhase(kind:z.infer<typeof returnRecoverableJobKind>){return ({HISTORY_IMPORT:'EXTRACTING',HISTORY_VARIANT:'EXTRACTING',DATABASE_REVIEW:'REVIEWING',REKEY:'REKEYING',CANDIDATE:'MATERIALIZING',BINDING_APPLICATION:'APPLYING',MEDIA_REVIEW:'CHECKING',MEDIA_APPLICATION:'APPLYING',POSTGAIN_REVIEW:'MEASURING',BUS_REVIEW:'MEASURING'} as const)[kind]}
export const haReturnJobRecoveryRequest=z.object({recoveryId:z.string().uuid(),kind:returnRecoverableJobKind,targetId:z.string().uuid(),channelId:z.string().min(1).max(128),expectedUpdatedAt:z.string().datetime(),expectedPhase:z.enum(['ACCEPTED','EXTRACTING','REVIEWING','REKEYING','MATERIALIZING','CHECKING','APPLYING','MEASURING']),reason:z.string().trim().min(5).max(2000)}).strict().refine(v=>v.expectedPhase==='ACCEPTED'||v.expectedPhase===returnJobActivePhase(v.kind))
const ownerSchema=z.object({host:z.string().min(1),pid:z.number().int().positive(),boot:z.string().uuid()}).strict()
/** Missing process must be proven on the same host. A journal/timeout alone
 * is not proof. EPERM, another host, PID reuse or malformed owner refuse. */
export function assertReturnJobStopped(owner:string,currentOwner:string,idle:boolean,probe:(pid:number)=>void=pid=>process.kill(pid,0)){
  if(owner===currentOwner){if(!idle)throw new Error('Há trabalho corrente; não encerrar pedido ativo.');return}
  const previous=ownerSchema.parse(JSON.parse(owner)),current=ownerSchema.parse(JSON.parse(currentOwner))
  if(previous.host!==hostname()||current.host!==hostname())throw new Error('Processo remoto exige conferência no host de origem.')
  try{probe(previous.pid)}catch(error){if((error as NodeJS.ErrnoException)?.code==='ESRCH')return;throw new Error('Não foi possível comprovar encerramento do processo anterior.')}
  throw new Error('PID anterior ainda existe; não encerrar pedido por tempo decorrido.')
}
const record=z.object({version:z.literal(1),request:haReturnJobRecoveryRequest,owner:z.string(),actor:z.string().min(1).max(256),recordedAt:z.string().datetime(),phase:z.literal('INTERRUPTED_JOB_CLOSED'),previousResultPreserved:z.literal(true),partialFilesPreserved:z.literal(true),quotaRetained:z.literal(true),operationReplayed:z.literal(false),publicationAuthorized:z.literal(false)}).strict()
export const HA_RETURN_JOB_RECOVERY_RESERVE=64*1024
export class HaReturnJobRecoveries{
  constructor(private readonly db:Database.Database,private readonly context:string,private readonly owner:string){
    db.exec('CREATE TABLE IF NOT EXISTS ha_return_job_recoveries(recovery_id TEXT PRIMARY KEY,target_kind TEXT NOT NULL,target_id TEXT NOT NULL UNIQUE,channel_id TEXT NOT NULL,payload TEXT NOT NULL)')
    db.exec("CREATE TRIGGER IF NOT EXISTS ha_return_job_recovery_no_update BEFORE UPDATE ON ha_return_job_recoveries BEGIN SELECT RAISE(ABORT,'Recovery is immutable'); END; CREATE TRIGGER IF NOT EXISTS ha_return_job_recovery_no_delete BEFORE DELETE ON ha_return_job_recoveries BEGIN SELECT RAISE(ABORT,'Recovery history is immutable'); END; CREATE TRIGGER IF NOT EXISTS ha_return_job_recovery_no_replace BEFORE INSERT ON ha_return_job_recoveries WHEN EXISTS(SELECT 1 FROM ha_return_job_recoveries WHERE recovery_id=NEW.recovery_id OR target_id=NEW.target_id) BEGIN SELECT RAISE(ABORT,'Recovery cannot be replaced'); END;")
  }
  private key(id:string){return 'ha-return-job-recovery:v1:'+this.context+':'+id}
  reservedBytes(){return (this.db.prepare('SELECT count(*) n FROM ha_return_job_recoveries').get() as {n:number}).n*HA_RETURN_JOB_RECOVERY_RESERVE}
  query(id:string,channelId:string){
    const row=this.db.prepare('SELECT * FROM ha_return_job_recoveries WHERE recovery_id=?').get(z.string().uuid().parse(id)) as {recovery_id:string;target_kind:string;target_id:string;channel_id:string;payload:string}|undefined
    if(!row)throw new Error('Encerramento não registrado.')
    const value=record.parse(JSON.parse(installationVault(false).decrypt(row.payload,this.key(id))))
    if(value.request.recoveryId!==row.recovery_id||value.request.kind!==row.target_kind||value.request.targetId!==row.target_id||value.request.channelId!==row.channel_id||row.channel_id!==channelId)throw new Error('Diário de recuperação diverge do pedido/canal.')
    const {owner,...publicValue}=value
    return {...publicValue,ownedHere:owner===this.owner,confirmationIsHistorical:true as const,operationalReady:false as const}
  }
  existing(raw:unknown){const request=haReturnJobRecoveryRequest.parse(raw);if(!this.db.prepare('SELECT 1 FROM ha_return_job_recoveries WHERE recovery_id=?').get(request.recoveryId))return null;const value=this.query(request.recoveryId,request.channelId);if(JSON.stringify(value.request)!==JSON.stringify(request))throw new Error('UUID de recuperação pertence a outra intenção.');return value}
  close(raw:unknown,actor:string,apply:()=>void,current:()=>void){
    const request=haReturnJobRecoveryRequest.parse(raw)
    return this.db.transaction(()=>{
      current();const prior=this.existing(request);if(prior)return prior
      if((this.db.prepare('SELECT count(*) n FROM ha_return_job_recoveries').get() as {n:number}).n>=1024)throw new Error('Limite de recuperação atingido; preservar histórico.')
      const value=record.parse({version:1,request,owner:this.owner,actor,recordedAt:new Date().toISOString(),phase:'INTERRUPTED_JOB_CLOSED',previousResultPreserved:true,partialFilesPreserved:true,quotaRetained:true,operationReplayed:false,publicationAuthorized:false})
      apply();current()
      this.db.prepare('INSERT INTO ha_return_job_recoveries VALUES(?,?,?,?,?)').run(request.recoveryId,request.kind,request.targetId,request.channelId,installationVault(false).encrypt(JSON.stringify(value),this.key(request.recoveryId)))
      current();return this.query(request.recoveryId,request.channelId)
    }).immediate()
  }
}
