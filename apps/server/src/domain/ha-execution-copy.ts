import {mkdir,lstat,open,statfs} from 'node:fs/promises'
import {existsSync} from 'node:fs'
import {resolve,dirname,join} from 'node:path'
import {createHash} from 'node:crypto'
import {z} from 'zod'
import type {HaRecovery} from './ha-recovery.js'
import {writePrivateConfig,protectGeneratedHaDirectory} from './private-config-file.js'
import {installationVault} from './secret-vault.js'

type Candidate=Awaited<ReturnType<HaRecovery['activationCandidate']>>
export interface HaExecutionCopy {id:string;file:string;sourceHash:string;preparationId:string}
const originSchema=z.object({id:z.string().uuid(),file:z.string(),sourceHash:z.string().regex(/^[a-f0-9]{64}$/i),preparationId:z.string().uuid(),channelId:z.string(),state:z.literal('STAGED_NOT_ADMITTED'),automaticTake:z.literal(false),promotionReady:z.literal(false)}).strict()
async function ancestry(path:string){
  let current=resolve(path)
  while(true){const info=await lstat(current);if(!info.isDirectory()||info.isSymbolicLink())throw new Error('Cópia HA não pode atravessar links/junções.');const parent=dirname(current);if(parent===current)return;current=parent}
}
const same=(a:Awaited<ReturnType<typeof lstat>>,b:Awaited<ReturnType<typeof lstat>>)=>a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeMs===b.mtimeMs&&a.ctimeMs===b.ctimeMs&&b.nlink===1
/** Internal staging only. No unarchive, profile change, database migration,
 * execution grant or process spawn. A promotion UUID is a NEW directory;
 * repetition never overwrites/replays a copy. Partial evidence is retained. */
export async function stageHaExecutionCopy(candidate:Candidate,root:string,promotionId:string,assertCurrent:()=>Promise<void>,signal:AbortSignal):Promise<HaExecutionCopy>{
  const id=z.string().uuid().parse(promotionId),base=resolve(root)
  const current=async()=>{if(signal.aborted)throw new Error('Criação da execução HA cancelada.');await assertCurrent();await candidate.verifyCurrent();if(signal.aborted)throw new Error('Criação da execução HA cancelada.')}
  await current()
  const source=resolve(candidate.databaseFile)
  if(!/^[a-f0-9]{64}$/i.test(candidate.databaseHash))throw new Error('Preparação HA sem hash válido.')
  await mkdir(base,{recursive:true,mode:0o700});await ancestry(base);await ancestry(dirname(source))
  const initial=await lstat(source)
  if(!initial.isFile()||initial.isSymbolicLink()||initial.nlink!==1||initial.size<=0||initial.size>16*1024**3||existsSync(source+'-wal')||existsSync(source+'-shm'))throw new Error('Preparação HA deve ser banco fechado, regular e dentro do limite de cópia.')
  const available=await statfs(base,{bigint:true})
  if(available.bavail*available.bsize<BigInt(initial.size)+64n*1024n*1024n)throw new Error('Espaço insuficiente para criar execução HA sem afetar o banco atual.')
  const directory=join(base,'.ha-execution.private-'+id),file=join(directory,'operational.db')
  await mkdir(directory,{mode:0o700});await ancestry(directory);await current()
  await protectGeneratedHaDirectory(directory);await current()
  // Protect the EMPTY destination before copying any SQLite data. Never rename
  // over an existing execution; the newly created UUID directory is exclusive.
  await writePrivateConfig(file,'',()=>{if(signal.aborted)throw new Error('Cópia HA cancelada.')})
  const empty=await lstat(file)
  const input=await open(source,'r');let output:Awaited<ReturnType<typeof open>>|null=null
  try{
    const pinned=await input.stat()
    if(!same(initial,pinned)||!same(initial,await lstat(source)))throw new Error('Banco preparado mudou antes da cópia.')
    output=await open(file,'r+')
    const destination=await output.stat()
    if(!destination.isFile()||destination.size!==0||destination.nlink!==1||destination.dev!==empty.dev||destination.ino!==empty.ino||!same(empty,await lstat(file)))throw new Error('Destino HA mudou antes da gravação.')
    const hash=createHash('sha256'),buffer=Buffer.alloc(1024*1024);let offset=0
    while(offset<initial.size){
      if(signal.aborted)throw new Error('Cópia HA cancelada.')
      const read=await input.read(buffer,0,Math.min(buffer.length,initial.size-offset),offset)
      if(!read.bytesRead)throw new Error('Banco preparado foi truncado durante a cópia.')
      hash.update(buffer.subarray(0,read.bytesRead));let written=0
      while(written<read.bytesRead){const part=await output.write(buffer,written,read.bytesRead-written,offset+written);if(!part.bytesWritten)throw new Error('Cópia HA incompleta.');written+=part.bytesWritten}
      offset+=read.bytesRead
    }
    if(hash.digest('hex').toLowerCase()!==candidate.databaseHash.toLowerCase()||!same(initial,await input.stat())||!same(initial,await lstat(source))||existsSync(source+'-wal')||existsSync(source+'-shm'))throw new Error('Preparação HA mudou durante a cópia; nenhuma execução admitida.')
    await output.sync()
    const final=await output.stat(),named=await lstat(file)
    if(final.size!==initial.size||final.dev!==empty.dev||final.ino!==empty.ino||!same(final,named)||named.isSymbolicLink())throw new Error('Cópia HA mudou antes da conclusão.')
  }finally{try{await output?.close()}finally{await input.close()}}
  await current();await ancestry(directory)
  // Hash the actual destination, not merely the bytes offered to write().
  const {probeRuntimeHash}=await import('./ha-local-probe.js')
  if(await probeRuntimeHash(file)!==candidate.databaseHash)throw new Error('Cópia HA não corresponde byte a byte ao banco preparado.')
  const copy:HaExecutionCopy={id,file,sourceHash:candidate.databaseHash,preparationId:candidate.candidate.request.requestId}
  await writePrivateConfig(join(directory,'origin.json'),JSON.stringify({version:1,ciphertext:installationVault(false).encrypt(JSON.stringify({...copy,channelId:candidate.candidate.channel.id,state:'STAGED_NOT_ADMITTED',automaticTake:false,promotionReady:false}),'ha-execution-copy:v1:'+id)}))
  await current()
  return copy
}

/** Pre-admission check only. Once an admitted execution intentionally modifies
 * its distinct DB, its own storage lease/journal takes over. Never use this
 * initial SHA to claim an already-running copy is still an immutable stage. */
export async function verifyStagedHaExecutionCopy(copy:HaExecutionCopy,candidate:Candidate,root:string,assertCurrent:()=>Promise<void>,signal:AbortSignal):Promise<void>{
  z.string().uuid().parse(copy.id)
  const directory=resolve(root,'.ha-execution.private-'+copy.id),file=join(directory,'operational.db')
  if(resolve(copy.file)!==file||copy.sourceHash!==candidate.databaseHash||copy.preparationId!==candidate.candidate.request.requestId)throw new Error('Cópia de execução pertence a outro pedido/origem.')
  if(signal.aborted)throw new Error('Admissão da cópia HA cancelada.')
  await assertCurrent();await candidate.verifyCurrent();await ancestry(directory)
  const manifest=join(directory,'origin.json'),initial=await lstat(manifest)
  if(!initial.isFile()||initial.isSymbolicLink()||initial.nlink!==1||initial.size<1||initial.size>65536)throw new Error('Origem da cópia HA ausente/alterada.')
  const input=await open(manifest,'r')
  try{
    if(!same(initial,await input.stat()))throw new Error('Origem HA mudou antes da leitura.')
    const buffer=Buffer.alloc(initial.size+1);let bytes=0
    while(bytes<buffer.length){const part=await input.read(buffer,bytes,buffer.length-bytes,bytes);if(!part.bytesRead)break;bytes+=part.bytesRead}
    if(bytes!==initial.size||!same(initial,await input.stat())||!same(initial,await lstat(manifest)))throw new Error('Origem HA mudou durante a leitura.')
    const envelope=z.object({version:z.literal(1),ciphertext:z.string().min(1).max(65536)}).strict().parse(JSON.parse(buffer.subarray(0,bytes).toString('utf8')))
    const origin=originSchema.parse(JSON.parse(installationVault(false).decrypt(envelope.ciphertext,'ha-execution-copy:v1:'+copy.id)))
    if(origin.id!==copy.id||origin.file!==file||origin.sourceHash!==copy.sourceHash||origin.preparationId!==copy.preparationId||origin.channelId!==candidate.candidate.channel.id)throw new Error('Origem cifrada não corresponde à cópia/canal/promoção.')
  }finally{await input.close()}
  const info=await lstat(file)
  if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||existsSync(file+'-wal')||existsSync(file+'-shm'))throw new Error('Cópia staged já foi aberta/alterada; admissão recusada.')
  const {probeRuntimeHash}=await import('./ha-local-probe.js')
  if(await probeRuntimeHash(file)!==copy.sourceHash||!same(info,await lstat(file)))throw new Error('Banco da cópia diverge da preparação autenticada.')
  await ancestry(directory);await assertCurrent();await candidate.verifyCurrent()
  if(signal.aborted)throw new Error('Admissão da cópia HA cancelada.')
}
