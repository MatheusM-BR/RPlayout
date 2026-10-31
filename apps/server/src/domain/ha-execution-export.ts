import {mkdir,lstat,open,statfs} from 'node:fs/promises'
import {existsSync} from 'node:fs'
import {dirname,join,resolve} from 'node:path'
import {createHash} from 'node:crypto'
import {z} from 'zod'
import {protectGeneratedHaDirectory,writePrivateConfig} from './private-config-file.js'
import {installationVault} from './secret-vault.js'
import type {HaExecutionCopy} from './ha-execution-copy.js'
import {haProtectedBridgeProof} from './ha-protected-bridge.js'
export type HaExportBridge=(file:string,exportId:string,signal:AbortSignal)=>Promise<ReturnType<typeof haProtectedBridgeProof.parse>>

export const haExportRequest=z.object({requestId:z.string().uuid(),channelId:z.string().min(1).max(128),promotionId:z.string().uuid(),stopRequestId:z.string().uuid()}).strict()
export const haExportSeal=z.object({version:z.literal(1),exportId:z.string().uuid(),channelId:z.string().min(1).max(128),promotionId:z.string().uuid(),stopRequestId:z.string().uuid(),sourcePreparationId:z.string().uuid(),sourceSnapshotHash:z.string().regex(/^[a-f0-9]{64}$/i),sourceDatabaseHash:z.string().regex(/^[a-f0-9]{64}$/i).optional(),protectedBridge:haProtectedBridgeProof.optional(),databaseHash:z.string().regex(/^[a-f0-9]{64}$/i),databaseBytes:z.number().int().positive().max(16*1024**3),sealedAt:z.string().datetime(),contents:z.literal('CLOSED_OPERATIONAL_DATABASE'),reverseSyncConfirmed:z.literal(false),primaryApproved:z.literal(false),publicationAuthorized:z.literal(false)}).strict()
async function ancestry(path:string){let current=resolve(path);for(;;){const stat=await lstat(current);if(!stat.isDirectory()||stat.isSymbolicLink())throw new Error('Exportação não pode atravessar link/junção.');const parent=dirname(current);if(parent===current)return;current=parent}}
const same=(a:Awaited<ReturnType<typeof lstat>>,b:Awaited<ReturnType<typeof lstat>>)=>a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeMs===b.mtimeMs&&a.ctimeMs===b.ctimeMs&&b.nlink===1
/** New private UUID directory, full executed SQLite contents (no merge/import).
 * Caller must prove owned handles/app/storage stopped; file existence is not it. */
export async function sealHaExecution(copy:HaExecutionCopy,root:string,value:z.infer<typeof haExportRequest>,authorize:()=>Promise<void>,signal:AbortSignal,bridge:HaExportBridge|null=null){
  const request=haExportRequest.parse(value),base=resolve(root),source=resolve(copy.file)
  if(copy.id!==request.promotionId||source!==join(base,'.ha-execution.private-'+copy.id,'operational.db')||base.startsWith('\\\\'))throw new Error('Exportação exige cópia local exata, não caminho fornecido pelo cliente.')
  const current=async()=>{signal.throwIfAborted();await authorize();signal.throwIfAborted()}
  await current();await ancestry(base);await ancestry(dirname(source))
  const initial=await lstat(source)
  if(!initial.isFile()||initial.isSymbolicLink()||initial.nlink!==1||initial.size<=0||initial.size>16*1024**3||existsSync(source+'-wal')||existsSync(source+'-shm'))throw new Error('Execução deve estar fechada/consolidada antes de selar.')
  const available=await statfs(base,{bigint:true})
  if(available.bavail*available.bsize<BigInt(initial.size)+64n*1024n*1024n)throw new Error('Sem espaço para exportação privada; execução original preservada.')
  const directory=join(base,'.ha-execution.private-'+request.requestId),databaseFile=join(directory,'returned.db'),manifestFile=join(directory,'return-seal.json')
  await mkdir(directory,{mode:0o700});await protectGeneratedHaDirectory(directory);await current()
  await writePrivateConfig(databaseFile,'',()=>signal.throwIfAborted())
  const empty=await lstat(databaseFile),input=await open(source,'r');let output:Awaited<ReturnType<typeof open>>|null=null
  const digest=createHash('sha256')
  try{
    if(!same(initial,await input.stat())||!same(initial,await lstat(source)))throw new Error('Execução mudou antes da exportação.')
    output=await open(databaseFile,'r+')
    if(!same(empty,await output.stat())||empty.size!==0)throw new Error('Destino privado deixou de estar vazio.')
    const buffer=Buffer.alloc(1024*1024);let offset=0
    while(offset<initial.size){
      await current();const read=await input.read(buffer,0,Math.min(buffer.length,initial.size-offset),offset)
      if(!read.bytesRead)throw new Error('Execução truncada durante exportação.')
      digest.update(buffer.subarray(0,read.bytesRead));let written=0
      while(written<read.bytesRead){const part=await output.write(buffer,written,read.bytesRead-written,offset+written);if(!part.bytesWritten)throw new Error('Exportação incompleta.');written+=part.bytesWritten}
      offset+=read.bytesRead
    }
    await output.sync();await current()
    if(!same(initial,await input.stat())||!same(initial,await lstat(source))||existsSync(source+'-wal')||existsSync(source+'-shm'))throw new Error('Execução recebeu escrita durante a exportação; não selar.')
    const rawCopy=await output.stat()
    if(rawCopy.size!==initial.size||rawCopy.nlink!==1||rawCopy.dev!==empty.dev||rawCopy.ino!==empty.ino)throw new Error('Exportação mudou de identidade/tamanho.')
    if(bridge){const rawHash=createHash('sha256');let cursor=0;while(cursor<rawCopy.size){await current();const read=await output.read(buffer,0,Math.min(buffer.length,rawCopy.size-cursor),cursor);if(!read.bytesRead)throw new Error('Cópia bruta truncada.');rawHash.update(buffer.subarray(0,read.bytesRead));cursor+=read.bytesRead}if(rawHash.digest('hex')!==digest.copy().digest('hex')||!same(rawCopy,await output.stat())||!same(rawCopy,await lstat(databaseFile)))throw new Error('Cópia bruta diverge da origem antes da ponte.')}
    let protectedBridge:ReturnType<typeof haProtectedBridgeProof.parse>|undefined
    if(bridge){await current();const free=await statfs(base,{bigint:true});if(free.bavail*free.bsize<256n*1024n*1024n)throw new Error('Sem espaço para ponte privada; origem preservada.');protectedBridge=haProtectedBridgeProof.parse(await bridge(databaseFile,request.requestId,signal));await current()}
    const copied=await output.stat()
    if((!bridge&&copied.size!==initial.size)||copied.size<=0||copied.size>16*1024**3||copied.nlink!==1||copied.dev!==empty.dev||copied.ino!==empty.ino||existsSync(databaseFile+'-wal')||existsSync(databaseFile+'-shm')||existsSync(databaseFile+'-journal'))throw new Error('Exportação mudou de identidade/tamanho ou não consolidou ponte.')
    const actual=createHash('sha256');offset=0
    while(offset<copied.size){await current();const read=await output.read(buffer,0,Math.min(buffer.length,copied.size-offset),offset);if(!read.bytesRead)throw new Error('Exportação truncada.');actual.update(buffer.subarray(0,read.bytesRead));offset+=read.bytesRead}
    const sourceDatabaseHash=digest.digest('hex'),databaseHash=actual.digest('hex')
    if((!bridge&&databaseHash!==sourceDatabaseHash)||!same(copied,await output.stat())||!same(copied,await lstat(databaseFile)))throw new Error('SHA do arquivo efetivamente exportado diverge.')
    const seal=haExportSeal.parse({version:1,exportId:request.requestId,channelId:request.channelId,promotionId:request.promotionId,stopRequestId:request.stopRequestId,sourcePreparationId:copy.preparationId,sourceSnapshotHash:copy.sourceHash,databaseHash,databaseBytes:copied.size,sealedAt:new Date().toISOString(),contents:'CLOSED_OPERATIONAL_DATABASE',reverseSyncConfirmed:false,primaryApproved:false,publicationAuthorized:false})
    const portableSeal=haExportSeal.parse({...seal,sourceDatabaseHash,...(protectedBridge?{protectedBridge}:{})})
    const serialized=JSON.stringify(portableSeal),manifestHash=createHash('sha256').update(serialized).digest('hex')
    await current();await writePrivateConfig(manifestFile,JSON.stringify({version:1,ciphertext:installationVault(false).encrypt(serialized,'ha-export-seal:v1:'+request.requestId),signature:installationVault(false).reviewIdentity(serialized,'ha-export-seal-signature:v1')}),()=>signal.throwIfAborted())
    await current()
    if(!same(initial,await input.stat())||!same(initial,await lstat(source))||existsSync(source+'-wal')||existsSync(source+'-shm'))throw new Error('Execução mudou antes da confirmação final do selo.')
    await ancestry(directory);await ancestry(dirname(source))
    if(!same(copied,await output.stat())||!same(copied,await lstat(databaseFile)))throw new Error('Destino mudou antes da confirmação final do selo.')
    return {seal:portableSeal,manifestHash,databaseFile,manifestFile}
  }finally{await output?.close();await input.close()}
}
