import Database from 'better-sqlite3'
import {createHash,randomUUID} from 'node:crypto'
import {createReadStream,existsSync} from 'node:fs'
import {lstat,mkdir} from 'node:fs/promises'
import {dirname,resolve,join,parse} from 'node:path'
import {assertSchemaCompatibility} from './db/schema-compatibility.js'
import {validateBackupRestore} from './domain/backup.js'
import {installationVault} from './domain/secret-vault.js'
import {writePrivateConfig} from './domain/private-config-file.js'
import {reviewRollbackAsRun} from './domain/rollback-asrun-review.js'
import {sanitizeDiagnostic} from './domain/sanitize-diagnostic.js'
async function stamp(file:string){const info=await lstat(file,{bigint:true});if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1n)throw new Error('Use snapshots regulares, não banco em uso ou links.');return [info.dev,info.ino,info.size,info.mtimeNs,info.ctimeNs].join(':')}
async function sha(file:string){const hash=createHash('sha256');for await(const value of createReadStream(file))hash.update(value);return hash.digest('hex')}
async function physicalParents(path:string){let current=path;while(true){const info=await lstat(current);if(!info.isDirectory()||info.isSymbolicLink())throw new Error('Pasta de revisão não pode atravessar links/junções.');const parent=dirname(current);if(parent===current)return;current=parent}}
async function main(){
  const args=process.argv.slice(2),values=new Map<string,string>()
  for(let i=0;i<args.length;i+=2){const key=args[i]!,value=args[i+1];if(!['--current-backup','--return-backup','--vault-file','--destination'].includes(key)||values.has(key)||!value||value.startsWith('--'))throw new Error('Informe os dois backups, cofre original e pasta nova da revisão.');values.set(key,value)}
  if(values.size!==4||process.env.RPLAYOUT_VAULT_KEY)throw new Error('Dois backups/cofre/pasta nova obrigatórios, sem chave externa conflitante.')
  process.env.RPLAYOUT_VAULT_FILE=resolve(values.get('--vault-file')!)
  await physicalParents(dirname(process.env.RPLAYOUT_VAULT_FILE))
  await stamp(process.env.RPLAYOUT_VAULT_FILE)
  const vault=installationVault(false)
  const currentFile=resolve(values.get('--current-backup')!),previousFile=resolve(values.get('--return-backup')!),destination=resolve(values.get('--destination')!)
  if(currentFile===previousFile||destination===parse(destination).root||destination===resolve(process.cwd()))throw new Error('Snapshots devem ser diferentes e destino deve ser pasta nova, não instalação/raiz.')
  await physicalParents(dirname(destination))
  for(const file of [currentFile,previousFile]){await physicalParents(dirname(file));if(existsSync(file+'-wal')||existsSync(file+'-shm'))throw new Error('Snapshot possui WAL/SHM: use cópia de backup fechada, não banco operacional.')}
  const beforeStamps=await Promise.all([stamp(previousFile),stamp(currentFile)]),hashes=await Promise.all([sha(previousFile),sha(currentFile)])
  await validateBackupRestore(previousFile);await validateBackupRestore(currentFile)
  let previous:Database.Database|null=null,current:Database.Database|null=null
  try{
    previous=new Database(previousFile,{readonly:true,fileMustExist:true});current=new Database(currentFile,{readonly:true,fileMustExist:true})
    const previousSchema=assertSchemaCompatibility(previous),currentSchema=assertSchemaCompatibility(current),history=reviewRollbackAsRun(previous,current)
    previous.close();previous=null;current.close();current=null
    if(await stamp(previousFile)!==beforeStamps[0]||await stamp(currentFile)!==beforeStamps[1]||await sha(previousFile)!==hashes[0]||await sha(currentFile)!==hashes[1])throw new Error('Snapshot mudou durante a revisão; nenhum retorno foi aprovado.')
    const report={version:1,requestId:randomUUID(),reviewedAt:new Date().toISOString(),previousBackupSha256:hashes[0],currentBackupSha256:hashes[1],previousSchema,currentSchema,history,targetBinaryCompatibility:'NOT_VERIFIED',originalDatabasesChanged:false,profileChanged:false,automaticTake:false,rollbackReady:false}
    const protectedReport=vault.encrypt(JSON.stringify(report),'rollback-review:v1:report')
    await mkdir(destination,{mode:0o700})
    await writePrivateConfig(join(destination,'rollback-review.json'),JSON.stringify({version:1,protectedReport},null,2))
    process.stdout.write(JSON.stringify({requestId:report.requestId,history:{newRecords:history.newRecords,changedRecords:history.changedRecords,missingRecords:history.missingRecords,totalDifferences:history.totalDifferences,currentOpen:history.currentOpen,historyReconciliationRequired:history.historyReconciliationRequired},targetBinaryCompatibility:'NOT_VERIFIED',automaticTake:false,rollbackReady:false})+'\n')
  }finally{previous?.close();current?.close()}
}
void main().catch(error=>{process.stderr.write(sanitizeDiagnostic(error instanceof Error?error.message:'Revisão de retorno recusada; snapshots preservados.')+'\n');process.exitCode=1})
