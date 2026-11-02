import {z} from 'zod'
import {mkdir,lstat,open,statfs} from 'node:fs/promises'
import {existsSync} from 'node:fs'
import {dirname,join,resolve} from 'node:path'
import {createHash} from 'node:crypto'
import {haExportSeal} from './ha-execution-export.js'
import {runImportProtectedBridge} from './ha-return-review-runner.js'
import {protectGeneratedHaDirectory,writePrivateConfig} from './private-config-file.js'
import {installationVault} from './secret-vault.js'
import {haOwnershipEvidence} from './ha-return-ownership-evidence.js'

export const haReturnRekeyRequest=z.object({rekeyId:z.string().uuid(),transferId:z.string().uuid(),channelId:z.string().min(1).max(128)}).strict()
export const haRekeyResult=z.object({sourceDatabaseHash:z.string().regex(/^[a-f0-9]{64}$/),databaseHash:z.string().regex(/^[a-f0-9]{64}$/),databaseBytes:z.number().int().positive().max(16*1024**3),entries:z.number().int().nonnegative().max(100000),vaultFingerprint:z.string().regex(/^[a-f0-9]{64}$/),ownershipEvidence:haOwnershipEvidence.optional(),installationKeyCopied:z.literal(false),operationalApproved:z.literal(false),publicationAuthorized:z.literal(false)}).strict()
const same=(a:Awaited<ReturnType<typeof lstat>>,b:Awaited<ReturnType<typeof lstat>>)=>a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeMs===b.mtimeMs&&a.ctimeMs===b.ctimeMs&&b.nlink===1
async function ancestry(path:string){let cursor=resolve(path);for(;;){const info=await lstat(cursor);if(!info.isDirectory()||info.isSymbolicLink())throw new Error('Derivada não pode atravessar link/junção.');const parent=dirname(cursor);if(parent===cursor)return;cursor=parent}}
/** Internal descriptor supplied by receiver ownership, never browser paths.
 * Keeps received bytes unchanged. Failed/new copies are retained, not retried. */
export async function prepareRekeyedCopy(source:{file:string;root:string;seal:z.infer<typeof haExportSeal>},request:z.infer<typeof haReturnRekeyRequest>,pairingKey:string,current:()=>void,signal:AbortSignal){
  if(!source.seal.protectedBridge||source.seal.channelId!==request.channelId||resolve(source.file)!==join(resolve(source.root),'.ha-execution.private-'+request.transferId,'returned.db'))throw new Error('Recebimento não tem ponte correspondente.')
  const check=()=>{signal.throwIfAborted();current()}
  check();await ancestry(dirname(source.file));await ancestry(source.root)
  const initial=await lstat(source.file)
  if(!initial.isFile()||initial.isSymbolicLink()||initial.nlink!==1||initial.size!==source.seal.databaseBytes||existsSync(source.file+'-wal')||existsSync(source.file+'-shm'))throw new Error('Recebimento mudou/não está consolidado.')
  const free=await statfs(source.root,{bigint:true});if(free.bavail*free.bsize<BigInt(initial.size)+256n*1024n*1024n)throw new Error('Sem espaço para reproteção isolada.')
  const directory=join(source.root,'.ha-execution.private-'+request.rekeyId),file=join(directory,'rekeyed.db')
  await mkdir(directory,{mode:0o700});await protectGeneratedHaDirectory(directory);check();await writePrivateConfig(file,'',check)
  const empty=await lstat(file),input=await open(source.file,'r');let output:Awaited<ReturnType<typeof open>>|null=null
  try{
    if(!same(initial,await input.stat())||!empty.isFile()||empty.isSymbolicLink()||empty.nlink!==1||empty.size!==0)throw new Error('Origem/destino mudaram.')
    output=await open(file,'r+');if(!same(empty,await output.stat()))throw new Error('Destino mudou durante abertura.')
    const buffer=Buffer.alloc(256*1024),original=createHash('sha256');let offset=0
    while(offset<initial.size){check();const read=await input.read(buffer,0,Math.min(buffer.length,initial.size-offset),offset);if(!read.bytesRead)throw new Error('Origem truncada.');original.update(buffer.subarray(0,read.bytesRead));let written=0;while(written<read.bytesRead){check();const part=await output.write(buffer,written,read.bytesRead-written,offset+written);if(!part.bytesWritten)throw new Error('Derivada incompleta.');written+=part.bytesWritten}offset+=read.bytesRead}
    await output.sync();if(original.digest('hex')!==source.seal.databaseHash)throw new Error('SHA atual do recebimento diverge.')
    const verifySource=async()=>{check();await ancestry(dirname(source.file));if(!same(initial,await input.stat())||!same(initial,await lstat(source.file))||existsSync(source.file+'-wal')||existsSync(source.file+'-shm'))throw new Error('Recebimento mudou durante reproteção.')}
    const hashTarget=async()=>{check();const info=await output!.stat();if(info.dev!==empty.dev||info.ino!==empty.ino||info.nlink!==1||info.size<=0||info.size>16*1024**3)throw new Error('Derivada mudou de identidade/tamanho.');const digest=createHash('sha256');let cursor=0;while(cursor<info.size){check();const read=await output!.read(buffer,0,Math.min(buffer.length,info.size-cursor),cursor);if(!read.bytesRead)throw new Error('Derivada truncada.');digest.update(buffer.subarray(0,read.bytesRead));cursor+=read.bytesRead}await ancestry(directory);if(!same(info,await output!.stat())||!same(info,await lstat(file)))throw new Error('Derivada mudou durante SHA.');return {info,hash:digest.digest('hex')}}
    await verifySource();const raw=await hashTarget();if(raw.hash!==source.seal.databaseHash||raw.info.size!==initial.size)throw new Error('Derivada bruta diverge antes da transformação.')
    const fingerprint=installationVault(false).fingerprint,converted=await runImportProtectedBridge(file,source.seal.exportId,pairingKey,source.seal.protectedBridge,signal) as {version?:unknown;entries?:unknown;vaultFingerprint?:unknown;ownershipEvidence?:unknown;installationKeyCopied?:unknown;operationalApproved?:unknown;publicationAuthorized?:unknown}
    check();await verifySource()
    if(converted.version!==1||converted.entries!==source.seal.protectedBridge.entries||converted.vaultFingerprint!==fingerprint||converted.installationKeyCopied!==false||converted.operationalApproved!==false||converted.publicationAuthorized!==false||installationVault(false).fingerprint!==fingerprint||existsSync(file+'-wal')||existsSync(file+'-shm')||existsSync(file+'-journal'))throw new Error('Reproteção sem confirmação/consolidação correspondente.')
    if(JSON.stringify(converted.ownershipEvidence)!==JSON.stringify(source.seal.protectedBridge.ownershipEvidence))throw new Error('Evidência de posse sem confirmação correspondente.')
    const final=await hashTarget();await verifySource();check()
    return {file,result:haRekeyResult.parse({sourceDatabaseHash:source.seal.databaseHash,databaseHash:final.hash,databaseBytes:final.info.size,entries:converted.entries,vaultFingerprint:fingerprint,ownershipEvidence:converted.ownershipEvidence,installationKeyCopied:false,operationalApproved:false,publicationAuthorized:false})}
  }finally{await output?.close();await input.close()}
}
