import type Database from 'better-sqlite3'
import {z} from 'zod'
import {createHash} from 'node:crypto'
import {mkdir,lstat,open,statfs} from 'node:fs/promises'
import {existsSync} from 'node:fs'
import {dirname,join,resolve} from 'node:path'
import {haReturnCandidateRequest,type HaReturnCandidateStages} from './ha-return-candidate-staging.js'
import {installationVault} from './secret-vault.js'
import {protectGeneratedHaDirectory,writePrivateConfig} from './private-config-file.js'
import {runBoundReturnCandidate} from './ha-return-review-runner.js'
import type {HaBindings} from './ha-bindings.js'
import {verifyReturnLocalMediaBytes} from './ha-return-local-media.js'

export const HA_RETURN_APPLICATION_RESERVE=256*1024*1024
export const haReturnApplicationRequest=z.object({applicationId:z.string().uuid(),channelId:z.string().min(1).max(128),candidate:haReturnCandidateRequest,bindingPlanId:z.string().uuid()}).strict().refine(value=>value.channelId===value.candidate.channelId)
const hash=z.string().regex(/^[a-f0-9]{64}$/)
const resultSchema=z.object({sourceDatabaseHash:hash,databaseHash:hash,databaseBytes:z.number().int().positive().max(HA_RETURN_APPLICATION_RESERVE),vaultFingerprint:hash,bindingDigest:hash,selectedRevisions:z.number().int().positive().max(128),inputBindingsApplied:z.literal(true),outputsApplied:z.literal(false),mediaValidated:z.literal(false),nativePrepared:z.literal(false),authorityTransferred:z.literal(false),publicationAuthorized:z.literal(false)}).strict()
const recordSchema=z.object({version:z.literal(1),request:haReturnApplicationRequest,owner:z.string(),phase:z.enum(['ACCEPTED','APPLYING','STAGED','FAILED']),quotaBytes:z.literal(HA_RETURN_APPLICATION_RESERVE),updatedAt:z.string().datetime(),result:resultSchema.nullable()}).strict().refine(value=>value.phase!=='STAGED'||!!value.result)
async function ancestry(path:string){let cursor=resolve(path);for(;;){const info=await lstat(cursor);if(!info.isDirectory()||info.isSymbolicLink())throw new Error('Link/junção não permitido.');const parent=dirname(cursor);if(parent===cursor)return;cursor=parent}}
const same=(a:Awaited<ReturnType<typeof lstat>>,b:Awaited<ReturnType<typeof lstat>>)=>a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeMs===b.mtimeMs&&a.ctimeMs===b.ctimeMs&&b.nlink===1

export class HaReturnApplications{
  closeInterrupted(id:string,channelId:string,expectedPhase:string,expectedUpdatedAt:string,stopped:(owner:string)=>void){
    const value=this.read(id,channelId)
    if(!['ACCEPTED','APPLYING'].includes(value.phase)||value.phase!==expectedPhase||value.updatedAt!==expectedUpdatedAt||value.result)throw new Error('Aplicação de vínculos mudou ou contém confirmação; não encerrar.')
    stopped(value.owner);this.write({...value,phase:'FAILED',updatedAt:new Date().toISOString()})
  }
  constructor(private readonly db:Database.Database,private readonly context:string,private readonly owner:string){db.exec('CREATE TABLE IF NOT EXISTS ha_return_applications(application_id TEXT PRIMARY KEY,candidate_id TEXT NOT NULL,binding_plan_id TEXT NOT NULL,channel_id TEXT NOT NULL,payload TEXT NOT NULL,UNIQUE(candidate_id,binding_plan_id))')}
  private key(id:string){return 'ha-return-application:v1:'+this.context+':'+id}
  private read(applicationId:string,channelId:string){
    const row=this.db.prepare('SELECT * FROM ha_return_applications WHERE application_id=?').get(z.string().uuid().parse(applicationId)) as {application_id:string;candidate_id:string;binding_plan_id:string;channel_id:string;payload:string}|undefined
    if(!row)throw new Error('Aplicação não registrada.')
    const value=recordSchema.parse(JSON.parse(installationVault(false).decrypt(row.payload,this.key(applicationId))))
    if(value.request.applicationId!==row.application_id||value.request.candidate.candidateId!==row.candidate_id||value.request.bindingPlanId!==row.binding_plan_id||value.request.channelId!==row.channel_id||row.channel_id!==channelId)throw new Error('Diário de aplicação diverge da intenção/canal.')
    return value
  }
  query(applicationId:string,channelId:string){const {owner,...record}=this.read(applicationId,channelId);return {...record,ownedHere:owner===this.owner,confirmationIsHistorical:true as const,operationalReady:false as const}}
  async verify(root:string,applicationId:string,channelId:string,current:()=>void,signal:AbortSignal){
    const record=this.read(applicationId,channelId),result=record.result
    if(record.owner!==this.owner||record.phase!=='STAGED'||!result||resolve(root).startsWith('\\\\')||installationVault(false).fingerprint!==result.vaultFingerprint)throw new Error('Revisão exige aplicação própria confirmada e cofre correspondente.')
    const file=join(resolve(root),'.ha-execution.private-'+record.request.applicationId,'bound.db')
    current();const info=await lstat(file)
    if(info.size!==result.databaseBytes||['-wal','-shm','-journal'].some(suffix=>existsSync(file+suffix)))throw new Error('Aplicação não permaneceu consolidada.')
    const stamp=await verifyReturnLocalMediaBytes(file,result.databaseHash,signal,current)
    if(['-wal','-shm','-journal'].some(suffix=>existsSync(file+suffix))||JSON.stringify(this.read(applicationId,channelId))!==JSON.stringify(record))throw new Error('Aplicação mudou durante conferência.')
    current();return stamp
  }
  existing(raw:unknown){const request=haReturnApplicationRequest.parse(raw);if(!this.db.prepare('SELECT 1 FROM ha_return_applications WHERE application_id=?').get(request.applicationId))return null;const value=this.query(request.applicationId,request.channelId);if(JSON.stringify(value.request)!==JSON.stringify(request))throw new Error('UUID pertence a outra intenção.');return value}
  reservedBytes(){return (this.db.prepare('SELECT count(*) n FROM ha_return_applications').get() as {n:number}).n*HA_RETURN_APPLICATION_RESERVE}
  accept(raw:unknown){const request=haReturnApplicationRequest.parse(raw),prior=this.existing(request);if(prior)return prior;const value=recordSchema.parse({version:1,request,owner:this.owner,phase:'ACCEPTED',quotaBytes:HA_RETURN_APPLICATION_RESERVE,updatedAt:new Date().toISOString(),result:null});this.db.prepare('INSERT INTO ha_return_applications VALUES(?,?,?,?,?)').run(request.applicationId,request.candidate.candidateId,request.bindingPlanId,request.channelId,installationVault(false).encrypt(JSON.stringify(value),this.key(request.applicationId)));return this.query(request.applicationId,request.channelId)}
  fail(raw:unknown){const request=haReturnApplicationRequest.parse(raw),value=this.read(request.applicationId,request.channelId);if(value.owner!==this.owner||value.phase==='STAGED')throw new Error('Não alterar aplicação confirmada ou estrangeira.');this.write({...value,phase:'FAILED',result:null,updatedAt:new Date().toISOString()})}
  private write(raw:unknown){const value=recordSchema.parse(raw);if(this.db.prepare('UPDATE ha_return_applications SET payload=? WHERE application_id=?').run(installationVault(false).encrypt(JSON.stringify(value),this.key(value.request.applicationId)),value.request.applicationId).changes!==1)throw new Error('Aplicação perdeu diário.')}
  async create(raw:unknown,root:string,candidate:ReturnType<HaReturnCandidateStages['query']>,plan:ReturnType<HaBindings['executionBindings']>,current:()=>void,signal:AbortSignal,alive:()=>void=current){
    const request=haReturnApplicationRequest.parse(raw),initial=this.read(request.applicationId,request.channelId),proof=candidate.result
    if(initial.owner!==this.owner||initial.phase!=='ACCEPTED'||!candidate.ownedHere||candidate.phase!=='STAGED'||!proof||JSON.stringify(candidate.request)!==JSON.stringify(request.candidate)||plan.planId!==request.bindingPlanId)throw new Error('Aplicação exige candidato/plano próprios confirmados.')
    const check=()=>{signal.throwIfAborted();alive()},confirm=()=>{check();current()}
    const hashFile=async(file:string,expected?:Awaited<ReturnType<typeof lstat>>)=>{
      check();await ancestry(dirname(file));const info=await lstat(file)
      if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||info.size<=0||info.size>HA_RETURN_APPLICATION_RESERVE||expected&&!same(expected,info)||['-wal','-shm','-journal'].some(suffix=>existsSync(file+suffix)))throw new Error('Banco não consolidado ou alterado.')
      const handle=await open(file,'r')
      try{if(!same(info,await handle.stat()))throw new Error('Identidade mudou antes de SHA.');const digest=createHash('sha256'),buffer=Buffer.alloc(256*1024);let offset=0;while(offset<info.size){check();const count=await handle.read(buffer,0,Math.min(buffer.length,info.size-offset),offset);if(!count.bytesRead)throw new Error('Banco truncado.');digest.update(buffer.subarray(0,count.bytesRead));offset+=count.bytesRead}if(!same(info,await handle.stat())||!same(info,await lstat(file))||['-wal','-shm','-journal'].some(suffix=>existsSync(file+suffix)))throw new Error('Banco mudou durante SHA.');return {info,hash:digest.digest('hex')}}finally{await handle.close()}
    }
    try{
      confirm();if(resolve(root).startsWith('\\\\'))throw new Error('Raiz deve ser local.')
      const source=join(resolve(root),'.ha-execution.private-'+request.candidate.candidateId,'candidate.db'),before=await hashFile(source)
      if(before.hash!==proof.databaseHash||before.info.size!==proof.databaseBytes||installationVault(false).fingerprint!==proof.vaultFingerprint)throw new Error('Candidato diverge do recibo/cofre.')
      confirm()
      const free=await statfs(root,{bigint:true});if(free.bavail*free.bsize<BigInt(HA_RETURN_APPLICATION_RESERVE))throw new Error('Espaço insuficiente para derivada.')
      const directory=join(resolve(root),'.ha-execution.private-'+request.applicationId),file=join(directory,'bound.db')
      await ancestry(root);await mkdir(directory,{mode:0o700});await protectGeneratedHaDirectory(directory);check();await writePrivateConfig(file,'',check)
      const empty=await lstat(file);if(!empty.isFile()||empty.isSymbolicLink()||empty.nlink!==1||empty.size!==0)throw new Error('Destino não permaneceu novo/vazio.')
      this.write({...initial,phase:'APPLYING',updatedAt:new Date().toISOString()})
      confirm()
      const converted=await runBoundReturnCandidate(source,file,{applicationId:request.applicationId,candidate:request.candidate,sourceDatabaseHash:proof.databaseHash,sourceDatabaseBytes:proof.databaseBytes,vaultFingerprint:proof.vaultFingerprint,recordedAt:initial.updatedAt,plan},signal)
      confirm();const final=await hashFile(file),after=await hashFile(source,before.info)
      if(after.hash!==proof.databaseHash||final.info.dev!==empty.dev||final.info.ino!==empty.ino||converted.version!==1||converted.applicationId!==request.applicationId||JSON.stringify(converted.candidate)!==JSON.stringify(request.candidate)||converted.bindingPlanId!==plan.planId||converted.bindingDigest!==plan.bindingDigest||converted.vaultFingerprint!==proof.vaultFingerprint||installationVault(false).fingerprint!==proof.vaultFingerprint||converted.selectedRevisions!==proof.selectedRevisions)throw new Error('Derivada não confirmou intenção/plano/fonte/cofre.')
      const result=resultSchema.parse({sourceDatabaseHash:proof.databaseHash,databaseHash:final.hash,databaseBytes:final.info.size,vaultFingerprint:converted.vaultFingerprint,bindingDigest:converted.bindingDigest,selectedRevisions:converted.selectedRevisions,inputBindingsApplied:converted.inputBindingsApplied,outputsApplied:converted.outputsApplied,mediaValidated:converted.mediaValidated,nativePrepared:converted.nativePrepared,authorityTransferred:converted.authorityTransferred,publicationAuthorized:converted.publicationAuthorized})
      confirm();this.write({...initial,phase:'STAGED',result,updatedAt:new Date().toISOString()})
    }catch{this.fail(request)}
    return this.query(request.applicationId,request.channelId)
  }
}
