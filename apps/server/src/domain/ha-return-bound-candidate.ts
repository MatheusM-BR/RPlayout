import Database from 'better-sqlite3'
import {drizzle} from 'drizzle-orm/better-sqlite3'
import {eq} from 'drizzle-orm'
import {z} from 'zod'
import {createHash} from 'node:crypto'
import {lstatSync,openSync,closeSync,readSync,writeSync,fstatSync,fsyncSync,existsSync} from 'node:fs'
import {basename,dirname,resolve} from 'node:path'
import * as schema from '../db/schema.js'
import {readReturnCandidateOrigin,haReturnCandidateOriginRequest} from './ha-return-candidate-origin.js'
import {haSourceBindingKey} from './ha-bindings.js'
import {installationVault} from './secret-vault.js'
import {Checkpoints} from './checkpoints.js'
import type {OperationalPayload} from './operational-playlist.js'

const hash=z.string().regex(/^[a-f0-9]{64}$/),text=z.string().min(1).max(2048)
const localInput=z.object({key:text,label:text,family:text,reference:text}).strict()
export const haReturnBoundCandidateJob=z.object({applicationId:z.string().uuid(),candidate:haReturnCandidateOriginRequest,sourceDatabaseHash:hash,sourceDatabaseBytes:z.number().int().positive().max(256*1024*1024),vaultFingerprint:hash,recordedAt:z.string().datetime(),plan:z.object({planId:z.string().uuid(),bindingDigest:hash,inputs:z.array(z.object({sourceKey:hash,local:localInput}).strict()).max(1000),outputs:z.array(z.object({outputId:z.string().min(1).max(128),kind:text,target:text.nullable(),reason:z.string().max(500).nullable()}).strict()).max(256)}).strict()}).strict()
const family=(value:string)=>{const prefix=value.split(':',1)[0]!.toUpperCase();return prefix==='RTMPS'?'RTMP':prefix==='RTSPS'?'RTSP':prefix}
/** Applies only live input references. Media remains BLOCKED and graphics /
 * secondary automation remain in provenance until independently validated. */
export function bindReturnInputs(payload:OperationalPayload,plan:z.infer<typeof haReturnBoundCandidateJob>['plan']){
  const required=new Set<string>()
  if(new Set(plan.inputs.map(row=>row.sourceKey)).size!==plan.inputs.length)throw new Error('Plano possui entradas duplicadas.')
  const items=payload.items.map(item=>{
    const reference=item.sourceRef??item.liveEndpoint??item.liveConfig?.sourceEndpoint
    if(!reference){if(item.type==='LIVE')throw new Error('Live sem referência explícita.');return {...item,configuredSourceId:null}}
    const key=haSourceBindingKey(reference),local=plan.inputs.find(row=>row.sourceKey===key)?.local;required.add(key)
    if(!local||family(reference)!==family(local.reference)||family(local.family+':')!==family(reference))throw new Error('Entrada local ausente/de outro protocolo.')
    if([item.sourceRef,item.liveEndpoint,item.liveConfig?.sourceEndpoint].some(value=>value&&value!==reference))throw new Error('Referências da live conflitantes.')
    return {...item,configuredSourceId:local.key.startsWith('configured:')?local.key.slice('configured:'.length):null,sourceRef:local.reference,liveEndpoint:item.liveEndpoint?local.reference:null,liveConfig:item.liveConfig?{...item.liveConfig,sourceEndpoint:local.reference}:item.liveConfig}
  })
  return {payload:{...payload,items,assets:(payload.assets??[]).map(asset=>({...asset,path:'',ignored:true,qcStatus:'BLOCKED' as const})),graphics:{templates:[],cues:[]},secondaryEvents:[]},required}
}

/** Private worker primitive; copies a sealed candidate into a NEW empty file.
 * Never modifies the source or opens this derivative through server bootstrap. */
export function materializeBoundReturnCandidate(source:Database.Database,sourceFile:string,targetFile:string,raw:unknown){
  const job=haReturnBoundCandidateJob.parse(raw),vault=installationVault(false),inputFile=resolve(sourceFile),file=resolve(targetFile)
  const before=lstatSync(inputFile),empty=lstatSync(file)
  if(vault.fingerprint!==job.vaultFingerprint||inputFile===file||inputFile.startsWith('\\\\')||file.startsWith('\\\\')||basename(inputFile)!=='candidate.db'||basename(dirname(inputFile))!=='.ha-execution.private-'+job.candidate.candidateId||basename(file)!=='bound.db'||basename(dirname(file))!=='.ha-execution.private-'+job.applicationId||!before.isFile()||before.isSymbolicLink()||before.nlink!==1||before.size!==job.sourceDatabaseBytes||!empty.isFile()||empty.isSymbolicLink()||empty.nlink!==1||empty.size!==0)throw new Error('Aplicação exige fonte selada e destino novo privado.')
  for(const target of [inputFile,file]){
    if(['-wal','-shm','-journal'].some(suffix=>existsSync(target+suffix)))throw new Error('Banco não consolidado.')
    let cursor=dirname(target)
    for(;;){const info=lstatSync(cursor);if(!info.isDirectory()||info.isSymbolicLink())throw new Error('Link/junção não permitido.');const parent=dirname(cursor);if(parent===cursor)break;cursor=parent}
  }
  if(resolve(source.name)!==inputFile)throw new Error('Conexão SQLite não corresponde à fonte privada.')
  if(new Set(job.plan.outputs.map(row=>row.outputId)).size!==job.plan.outputs.length)throw new Error('Plano possui saídas duplicadas.')
  const same=(a:typeof before,b:typeof before)=>a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeMs===b.mtimeMs&&a.ctimeMs===b.ctimeMs&&b.nlink===1
  const input=openSync(inputFile,'r'),output=openSync(file,'r+'),digest=createHash('sha256'),buffer=Buffer.alloc(256*1024)
  try{
    if(!same(before,fstatSync(input))||!same(empty,fstatSync(output)))throw new Error('Identidade mudou antes da cópia.')
    let offset=0
    while(offset<before.size){const count=readSync(input,buffer,0,Math.min(buffer.length,before.size-offset),offset);if(!count)throw new Error('Fonte truncada.');digest.update(buffer.subarray(0,count));let written=0;while(written<count){const size=writeSync(output,buffer,written,count-written,offset+written);if(!size)throw new Error('Cópia incompleta.');written+=size}offset+=count}
    fsyncSync(output)
    if(digest.digest('hex')!==job.sourceDatabaseHash||!same(before,fstatSync(input))||!same(before,lstatSync(inputFile)))throw new Error('Fonte mudou/diverge do SHA durante cópia.')
  }finally{closeSync(input);closeSync(output)}
  const copied=lstatSync(file)
  if(copied.dev!==empty.dev||copied.ino!==empty.ino||copied.nlink!==1||copied.size!==before.size)throw new Error('Destino perdeu identidade durante cópia.')
  const target=new Database(file,{fileMustExist:true}),db=drizzle(target,{schema}),mapping=new Map<string,string>()
  try{
    // Read provenance from the bytes whose SHA was just confirmed, not from
    // a separate SQLite handle that might precede an external path replacement.
    const origin=readReturnCandidateOrigin(target,job.candidate),variants=origin.entries.map(entry=>({entry,...bindReturnInputs(entry.payload,job.plan)}))
    const required=new Set(variants.flatMap(variant=>[...variant.required]))
    if(required.size!==job.plan.inputs.length||job.plan.inputs.some(row=>!required.has(row.sourceKey)))throw new Error('Plano possui entradas fora da seleção.')
    target.pragma('query_only = OFF') // Only this new private derivative.
    target.pragma('trusted_schema = OFF');target.pragma('foreign_keys = ON');target.pragma('synchronous = FULL')
    db.transaction(tx=>{
      for(const {entry,payload} of variants){
        const originalLocal=origin.revisionIds.find(([id])=>id===entry.revision.id)?.[1]
        const current=originalLocal?tx.select().from(schema.operationalPlaylistRevisions).where(eq(schema.operationalPlaylistRevisions.id,originalLocal)).get():null
        if(!current||current.rundownId!==entry.revision.rundownId)throw new Error('Edição do candidato não corresponde à origem.')
        const id='ha-return-bound:'+createHash('sha256').update(JSON.stringify([job.applicationId,job.candidate,entry.revision.id,job.plan.planId,job.plan.bindingDigest])).digest('hex');mapping.set(entry.revision.id,id)
        const bound={...payload,haReturnOrigin:{version:1,candidateId:job.candidate.candidateId,planId:job.candidate.planId,applicationId:job.applicationId,bindingPlanId:job.plan.planId,sourceRevisionId:entry.revision.id,inputBindingsApplied:true,mediaValidated:false,nativePrepared:false}}
        if(tx.update(schema.operationalPlaylistRevisions).set({id,payload:bound as unknown as Record<string,unknown>}).where(eq(schema.operationalPlaylistRevisions.id,originalLocal!)).run().changes!==1)throw new Error('Edição não aplicada.')
      }
      const execution=origin.entries.find(entry=>entry.revision.id===origin.job.request.executionRevisionId)!
      new Checkpoints(target).write({version:1,channelId:job.candidate.channelId,rundownId:execution.revision.rundownId,revisionId:mapping.get(execution.revision.id)!,itemId:null,elapsed:0,playing:false,realEngine:false})
      target.exec('CREATE TABLE ha_return_bound_origin(id INTEGER PRIMARY KEY CHECK(id=1),payload TEXT NOT NULL)')
      target.prepare('INSERT INTO ha_return_bound_origin VALUES(1,?)').run(vault.encrypt(JSON.stringify({version:1,job,revisionIds:[...mapping],inputBindingsApplied:true,mediaValidated:false,outputsApplied:false,nativePrepared:false,authorityTransferred:false}),'ha-return-bound-origin:v1:'+job.applicationId))
    })
    if(target.pragma('integrity_check',{simple:true})!=='ok'||(target.pragma('foreign_key_check') as unknown[]).length)throw new Error('Derivada não passou na integridade.')
    for(const name of ['output_profiles','live_sources','execution_owner_runs','distribution_owner_runs','as_run'])if((target.prepare('SELECT count(*) n FROM '+name).get() as {n:number}).n)throw new Error('Derivada contém execução/saída indevida.')
    target.pragma('wal_checkpoint(TRUNCATE)');target.pragma('journal_mode = DELETE')
    const final=lstatSync(file)
    if(final.dev!==empty.dev||final.ino!==empty.ino||final.nlink!==1||final.size>256*1024*1024||!same(before,lstatSync(inputFile)))throw new Error('Fonte/destino mudaram ou excederam limite.')
    return {version:1 as const,applicationId:job.applicationId,candidate:job.candidate,bindingPlanId:job.plan.planId,bindingDigest:job.plan.bindingDigest,selectedRevisions:variants.length,inputBindingsApplied:true as const,outputsApplied:false as const,mediaValidated:false as const,nativePrepared:false as const,authorityTransferred:false as const,publicationAuthorized:false as const,vaultFingerprint:vault.fingerprint}
  }finally{target.close()}
}
