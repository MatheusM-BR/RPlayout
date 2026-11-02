import type Database from 'better-sqlite3'
import {z} from 'zod'
import {mkdir,lstat,open,statfs} from 'node:fs/promises'
import {existsSync} from 'node:fs'
import {dirname,join,resolve} from 'node:path'
import {createHash} from 'node:crypto'
import {installationVault} from './secret-vault.js'
import {protectGeneratedHaDirectory,writePrivateConfig} from './private-config-file.js'
import {runReturnCandidate,runReturnCandidateOrigin} from './ha-return-review-runner.js'
import type {HaReturnSelections} from './ha-return-selection.js'
export const HA_RETURN_CANDIDATE_RESERVE=256*1024*1024
export const haReturnCandidateRequest=z.object({candidateId:z.string().uuid(),planId:z.string().uuid(),channelId:z.string().min(1).max(128)}).strict()
const resultSchema=z.object({sourceDatabaseHash:z.string().regex(/^[a-f0-9]{64}$/),databaseHash:z.string().regex(/^[a-f0-9]{64}$/),databaseBytes:z.number().int().positive().max(HA_RETURN_CANDIDATE_RESERVE),vaultFingerprint:z.string().regex(/^[a-f0-9]{64}$/),selectedRevisions:z.number().int().positive().max(128),channelArchived:z.literal(true),cursorStopped:z.literal(true),bindingsResolved:z.literal(false),nativePrepared:z.literal(false),publicationAuthorized:z.literal(false),authorityTransferred:z.literal(false)}).strict()
const recordSchema=z.object({version:z.literal(1),request:haReturnCandidateRequest,owner:z.string(),phase:z.enum(['ACCEPTED','MATERIALIZING','STAGED','FAILED']),quotaBytes:z.literal(HA_RETURN_CANDIDATE_RESERVE),updatedAt:z.string().datetime(),result:resultSchema.nullable()}).strict().refine(v=>v.phase!=='STAGED'||!!v.result)
const same=(a:Awaited<ReturnType<typeof lstat>>,b:Awaited<ReturnType<typeof lstat>>)=>a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeMs===b.mtimeMs&&a.ctimeMs===b.ctimeMs&&b.nlink===1
async function ancestry(path:string){let cursor=resolve(path);for(;;){const info=await lstat(cursor);if(!info.isDirectory()||info.isSymbolicLink())throw new Error('Candidato não pode atravessar link/junção.');const parent=dirname(cursor);if(parent===cursor)return;cursor=parent}}
export class HaReturnCandidateStages{
  closeInterrupted(id:string,channelId:string,expectedPhase:string,expectedUpdatedAt:string,stopped:(owner:string)=>void){
    const value=this.read(id,channelId)
    if(!['ACCEPTED','MATERIALIZING'].includes(value.phase)||value.phase!==expectedPhase||value.updatedAt!==expectedUpdatedAt||value.result)throw new Error('Candidato mudou ou contém confirmação; não encerrar.')
    stopped(value.owner)
    const failed=recordSchema.parse({...value,phase:'FAILED',updatedAt:new Date().toISOString()})
    if(this.db.prepare('UPDATE ha_return_candidate_stages SET payload=? WHERE candidate_id=?').run(installationVault(false).encrypt(JSON.stringify(failed),this.key(id)),id).changes!==1)throw new Error('Candidato perdeu diário durante encerramento.')
  }
  constructor(private readonly db:Database.Database,private readonly context:string,private readonly owner:string){db.exec('CREATE TABLE IF NOT EXISTS ha_return_candidate_stages(candidate_id TEXT PRIMARY KEY,plan_id TEXT NOT NULL UNIQUE,channel_id TEXT NOT NULL,payload TEXT NOT NULL)')}
  private key(id:string){return 'ha-return-candidate-stage:v1:'+this.context+':'+id}
  private read(candidateId:string,channelId:string){
    const row=this.db.prepare('SELECT * FROM ha_return_candidate_stages WHERE candidate_id=?').get(z.string().uuid().parse(candidateId)) as {candidate_id:string;plan_id:string;channel_id:string;payload:string}|undefined
    if(!row)throw new Error('Candidato não registrado.')
    const value=recordSchema.parse(JSON.parse(installationVault(false).decrypt(row.payload,this.key(candidateId))))
    if(value.request.candidateId!==row.candidate_id||value.request.planId!==row.plan_id||value.request.channelId!==row.channel_id||row.channel_id!==channelId)throw new Error('Diário do candidato diverge do canal/seleção.')
    return value
  }
  query(candidateId:string,channelId:string){const {owner,...value}=this.read(candidateId,channelId);return {...value,ownedHere:owner===this.owner,confirmationIsHistorical:true as const,operationalReady:false as const}}
  /** Server-internal, never an HTTP response. Recheck sealed candidate around
   * readonly worker and retain the generic active-DB admission blocker. */
  async privateOrigin(root:string,raw:unknown,current:()=>void,signal:AbortSignal){
    const request=haReturnCandidateRequest.parse(raw),initial=this.read(request.candidateId,request.channelId)
    if(initial.owner!==this.owner||initial.phase!=='STAGED'||!initial.result||initial.request.planId!==request.planId||resolve(root).startsWith('\\\\'))throw new Error('Origem exige candidato confirmado deste backend/seleção.')
    const result=initial.result,file=join(resolve(root),'.ha-execution.private-'+request.candidateId,'candidate.db')
    const check=()=>{signal.throwIfAborted();current();const now=this.read(request.candidateId,request.channelId);if(JSON.stringify(now)!==JSON.stringify(initial)||installationVault(false).fingerprint!==result.vaultFingerprint)throw new Error('Diário/cofre mudou durante leitura privada.')}
    const hash=async(expected?:Awaited<ReturnType<typeof lstat>>)=>{
      check();await ancestry(dirname(file));const info=await lstat(file)
      if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||info.size!==result.databaseBytes||expected&&!same(expected,info)||['-wal','-shm','-journal'].some(suffix=>existsSync(file+suffix)))throw new Error('Candidato não permaneceu consolidado/imutável.')
      const handle=await open(file,'r')
      try{
        if(!same(info,await handle.stat()))throw new Error('Identidade mudou antes da leitura.')
        const digest=createHash('sha256'),buffer=Buffer.alloc(256*1024);let offset=0
        while(offset<info.size){check();const read=await handle.read(buffer,0,Math.min(buffer.length,info.size-offset),offset);if(!read.bytesRead)throw new Error('Candidato truncado.');digest.update(buffer.subarray(0,read.bytesRead));offset+=read.bytesRead}
        if(digest.digest('hex')!==result.databaseHash||!same(info,await handle.stat())||!same(info,await lstat(file))||['-wal','-shm','-journal'].some(suffix=>existsSync(file+suffix)))throw new Error('SHA/identidade mudou durante leitura.')
        return info
      }finally{await handle.close()}
    }
    const before=await hash(),origin=await runReturnCandidateOrigin(file,request,signal)
    await hash(before);check()
    if(origin.job.sourceDatabaseHash!==result.sourceDatabaseHash||origin.entries.length!==result.selectedRevisions||origin.operationalReady!==false||origin.publicationAuthorized!==false)throw new Error('Origem não corresponde ao recibo confirmado.')
    return origin
  }
  existing(raw:unknown){const request=haReturnCandidateRequest.parse(raw);if(!this.db.prepare('SELECT 1 FROM ha_return_candidate_stages WHERE candidate_id=?').get(request.candidateId))return null;const value=this.query(request.candidateId,request.channelId);if(JSON.stringify(value.request)!==JSON.stringify(request))throw new Error('UUID de candidato pertence a outra intenção.');return value}
  reservedBytes(){return (this.db.prepare('SELECT count(*) AS n FROM ha_return_candidate_stages').get() as {n:number}).n*HA_RETURN_CANDIDATE_RESERVE}
  fail(raw:unknown){const request=haReturnCandidateRequest.parse(raw),value=this.read(request.candidateId,request.channelId);if(value.owner!==this.owner||value.phase==='STAGED')throw new Error('Não substituir candidato confirmado ou de outra instância.');const failed=recordSchema.parse({...value,phase:'FAILED',result:null,updatedAt:new Date().toISOString()});if(this.db.prepare('UPDATE ha_return_candidate_stages SET payload=? WHERE candidate_id=?').run(installationVault(false).encrypt(JSON.stringify(failed),this.key(request.candidateId)),request.candidateId).changes!==1)throw new Error('Diário do candidato perdeu intenção.')}
  accept(raw:unknown){const request=haReturnCandidateRequest.parse(raw),prior=this.existing(request);if(prior)return prior;const value=recordSchema.parse({version:1,request,owner:this.owner,phase:'ACCEPTED',quotaBytes:HA_RETURN_CANDIDATE_RESERVE,updatedAt:new Date().toISOString(),result:null});this.db.prepare('INSERT INTO ha_return_candidate_stages VALUES(?,?,?,?)').run(request.candidateId,request.planId,request.channelId,installationVault(false).encrypt(JSON.stringify(value),this.key(request.candidateId)));return this.query(request.candidateId,request.channelId)}
  async create(raw:unknown,selection:ReturnType<HaReturnSelections['query']>,source:{root:string;inspection:string;hash:string;bytes:number;vaultFingerprint:string},current:()=>void,signal:AbortSignal){
    const request=haReturnCandidateRequest.parse(raw),initial=this.read(request.candidateId,request.channelId)
    if(initial.owner!==this.owner||initial.phase!=='ACCEPTED'||selection.request.planId!==request.planId||selection.request.channelId!==request.channelId||!selection.ownedHere)throw new Error('Candidato não pertence à seleção/backend atual.')
    const store=(phase:z.infer<typeof recordSchema>['phase'],result:z.infer<typeof resultSchema>|null=null)=>{const record=recordSchema.parse({...initial,phase,result,updatedAt:new Date().toISOString()});if(this.db.prepare('UPDATE ha_return_candidate_stages SET payload=? WHERE candidate_id=?').run(installationVault(false).encrypt(JSON.stringify(record),this.key(request.candidateId)),request.candidateId).changes!==1)throw new Error('Diário do candidato perdeu intenção.')}
    const check=()=>{signal.throwIfAborted();current()}
    const hashFile=async(file:string,expected?:Awaited<ReturnType<typeof lstat>>)=>{check();await ancestry(dirname(file));const info=await lstat(file);if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||info.size>16*1024**3||file.endsWith('candidate.db')&&info.size>HA_RETURN_CANDIDATE_RESERVE||expected&&!same(expected,info)||existsSync(file+'-wal')||existsSync(file+'-shm')||existsSync(file+'-journal'))throw new Error('Arquivo não consolidado/mudou/excede limite.');const input=await open(file,'r');try{const digest=createHash('sha256'),buffer=Buffer.alloc(256*1024);let offset=0;while(offset<info.size){check();const read=await input.read(buffer,0,Math.min(buffer.length,info.size-offset),offset);if(!read.bytesRead)throw new Error('Arquivo truncado.');digest.update(buffer.subarray(0,read.bytesRead));offset+=read.bytesRead}if(!same(info,await input.stat())||!same(info,await lstat(file)))throw new Error('Arquivo mudou durante SHA.');return {info,hash:digest.digest('hex')}}finally{await input.close()}}
    try{
      check();if(resolve(source.root).startsWith('\\\\')||resolve(source.inspection)!==join(resolve(source.root),'.ha-execution.private-'+selection.request.reviewId,'inspection.db'))throw new Error('Fonte não é derivada interna da revisão.')
      const original=await hashFile(source.inspection)
      if(original.hash!==source.hash||original.info.size!==source.bytes||selection.reviewDatabaseHash!==source.hash)throw new Error('Fonte diverge da revisão/seleção.')
      const free=await statfs(source.root,{bigint:true});if(free.bavail*free.bsize<BigInt(HA_RETURN_CANDIDATE_RESERVE))throw new Error('Sem espaço para candidato isolado.')
      const directory=join(source.root,'.ha-execution.private-'+request.candidateId),file=join(directory,'candidate.db')
      await ancestry(source.root);await mkdir(directory,{mode:0o700});await protectGeneratedHaDirectory(directory);check();await writePrivateConfig(file,'',check)
      const empty=await lstat(file);if(!empty.isFile()||empty.isSymbolicLink()||empty.nlink!==1||empty.size!==0)throw new Error('Destino não permaneceu novo/vazio.')
      store('MATERIALIZING')
      const converted=await runReturnCandidate(source.inspection,file,{candidateId:request.candidateId,request:selection.request,sourceDatabaseHash:source.hash,vaultFingerprint:source.vaultFingerprint,recordedAt:selection.recordedAt},signal)
      check();const final=await hashFile(file),after=await hashFile(source.inspection,original.info)
      if(after.hash!==source.hash||final.info.dev!==empty.dev||final.info.ino!==empty.ino||converted.version!==1||converted.candidateId!==request.candidateId||converted.planId!==request.planId||converted.channelId!==request.channelId||converted.selectedRevisions!==selection.request.revisionIds.length||converted.vaultFingerprint!==source.vaultFingerprint||installationVault(false).fingerprint!==source.vaultFingerprint||converted.foreignOwnershipImported!==false)throw new Error('Candidato não confirmou origem/identidade/seleção/cofre.')
      const result=resultSchema.parse({sourceDatabaseHash:source.hash,databaseHash:final.hash,databaseBytes:final.info.size,vaultFingerprint:converted.vaultFingerprint,selectedRevisions:converted.selectedRevisions,channelArchived:converted.channelArchived,cursorStopped:converted.cursorStopped,bindingsResolved:converted.bindingsResolved,nativePrepared:converted.nativePrepared,publicationAuthorized:converted.publicationAuthorized,authorityTransferred:converted.authorityTransferred})
      check();store('STAGED',result)
    }catch{store('FAILED')}
    return this.query(request.candidateId,request.channelId)
  }
}
