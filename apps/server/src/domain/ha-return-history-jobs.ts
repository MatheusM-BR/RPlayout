import type Database from 'better-sqlite3'
import {z} from 'zod'
import {installationVault} from './secret-vault.js'
import {haHistoryImportRequest} from './ha-history-import.js'
import {haHistoryVariantRequest} from './ha-history-variant.js'

const intent=z.discriminatedUnion('kind',[z.object({kind:z.literal('IMPORT'),request:haHistoryImportRequest}).strict(),z.object({kind:z.literal('VARIANT'),request:haHistoryVariantRequest}).strict()])
const record=z.object({version:z.literal(1),intent,owner:z.string(),actor:z.string().min(1).max(256),phase:z.enum(['ACCEPTED','EXTRACTING','COMMITTING','CONFIRMED','FAILED']),updatedAt:z.string().datetime()}).strict()
type Intent=z.infer<typeof intent>
const identity=(value:Intent)=>value.kind==='IMPORT'?value.request.importId:value.request.decisionId
export const HA_RETURN_HISTORY_JOB_RESERVE=256*1024
/** Durable intent before extraction. The operational receipt, not this phase,
 * proves commit; uncertain commit is never replayed or declared failed. */
export class HaReturnHistoryJobs{
  constructor(private readonly db:Database.Database,private readonly context:string,private readonly owner:string){db.exec('CREATE TABLE IF NOT EXISTS ha_return_history_jobs(job_id TEXT PRIMARY KEY,job_kind TEXT NOT NULL,channel_id TEXT NOT NULL,payload TEXT NOT NULL)')}
  private key(id:string){return 'ha-return-history-job:v1:'+this.context+':'+id}
  private read(id:string,channelId:string){
    const row=this.db.prepare('SELECT * FROM ha_return_history_jobs WHERE job_id=?').get(z.string().uuid().parse(id)) as {job_id:string;job_kind:string;channel_id:string;payload:string}|undefined
    if(!row)return null
    const value=record.parse(JSON.parse(installationVault(false).decrypt(row.payload,this.key(id))))
    if(identity(value.intent)!==row.job_id||value.intent.kind!==row.job_kind||value.intent.request.channelId!==row.channel_id||row.channel_id!==channelId)throw new Error('Trabalho de histórico diverge do pedido/canal.')
    return value
  }
  query(id:string,channelId:string){const value=this.read(id,channelId);if(!value)return null;const {owner,...publicValue}=value;return {...publicValue,ownedHere:owner===this.owner}}
  existing(raw:unknown){const value=intent.parse(raw),prior=this.query(identity(value),value.request.channelId);if(prior&&JSON.stringify(prior.intent)!==JSON.stringify(value))throw new Error('UUID de histórico pertence a outra intenção.');return prior}
  reservedBytes(){return (this.db.prepare('SELECT count(*) n FROM ha_return_history_jobs').get() as {n:number}).n*HA_RETURN_HISTORY_JOB_RESERVE}
  accept(raw:unknown,actor:string){
    const value=intent.parse(raw),prior=this.existing(value);if(prior)return prior
    if((this.db.prepare('SELECT count(*) n FROM ha_return_history_jobs').get() as {n:number}).n>=1024)throw new Error('Limite de histórico atingido; preservar tentativas.')
    const initial=record.parse({version:1,intent:value,owner:this.owner,actor,phase:'ACCEPTED',updatedAt:new Date().toISOString()}),encoded=JSON.stringify(initial)
    if(Buffer.byteLength(encoded)>HA_RETURN_HISTORY_JOB_RESERVE)throw new Error('Intenção excede reserva do diário.')
    this.db.prepare('INSERT INTO ha_return_history_jobs VALUES(?,?,?,?)').run(identity(value),value.kind,value.request.channelId,installationVault(false).encrypt(encoded,this.key(identity(value))))
    return this.query(identity(value),value.request.channelId)!
  }
  transition(raw:unknown,phase:'EXTRACTING'|'COMMITTING'|'CONFIRMED'){
    const value=intent.parse(raw),id=identity(value),prior=this.read(id,value.request.channelId)
    if(!prior||prior.owner!==this.owner||JSON.stringify(prior.intent)!==JSON.stringify(value)||prior.phase!==({EXTRACTING:'ACCEPTED',COMMITTING:'EXTRACTING',CONFIRMED:'COMMITTING'} as const)[phase])throw new Error('Transição de histórico fora de ordem/owner/intenção.')
    this.write({...prior,phase,updatedAt:new Date().toISOString()})
  }
  failBeforeCommit(raw:unknown){
    const value=intent.parse(raw),prior=this.read(identity(value),value.request.channelId)
    if(!prior||prior.owner!==this.owner||JSON.stringify(prior.intent)!==JSON.stringify(value))throw new Error('Tentativa de histórico não pertence à execução atual.')
    if(['ACCEPTED','EXTRACTING'].includes(prior.phase))this.write({...prior,phase:'FAILED',updatedAt:new Date().toISOString()})
    // COMMITTING stays uncertain even if the adapter threw or a response vanished.
  }
  closeInterrupted(id:string,channelId:string,kind:'IMPORT'|'VARIANT',phase:string,updatedAt:string,stopped:(owner:string)=>void,receiptAbsent:(value:Intent)=>void){
    const prior=this.read(id,channelId)
    if(!prior||prior.intent.kind!==kind||!['ACCEPTED','EXTRACTING'].includes(prior.phase)||prior.phase!==phase||prior.updatedAt!==updatedAt)throw new Error('Trabalho mudou ou pode ter iniciado commit; encerramento recusado.')
    stopped(prior.owner);receiptAbsent(prior.intent)
    this.write({...prior,phase:'FAILED',updatedAt:new Date().toISOString()})
    receiptAbsent(prior.intent)
  }
  private write(raw:unknown){const value=record.parse(raw),id=identity(value.intent);if(this.db.prepare('UPDATE ha_return_history_jobs SET payload=? WHERE job_id=? AND job_kind=? AND channel_id=?').run(installationVault(false).encrypt(JSON.stringify(value),this.key(id)),id,value.intent.kind,value.intent.request.channelId).changes!==1)throw new Error('Trabalho de histórico perdeu diário.')}
}
