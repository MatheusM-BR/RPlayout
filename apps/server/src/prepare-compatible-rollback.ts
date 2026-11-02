import Database from 'better-sqlite3'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {existsSync} from 'node:fs'
import {readFile,mkdir} from 'node:fs/promises'
import {resolve,join,dirname,isAbsolute} from 'node:path'
import {randomUUID} from 'node:crypto'
import {z} from 'zod'
import {verifyLocalPackage,regularFileStamp,fileSha256,physicalDirectory} from './domain/local-package.js'
import {assertRollbackSchema,assertRollbackCheckpointData,rollbackContractSchema,qualifiedHistoricalRollbackContract} from './domain/rollback-contract.js'
import {assertLosslessRollbackHistory,assertExactRollbackAsRunCopy} from './domain/rollback-history.js'
import {assertSchemaCompatibility} from './db/schema-compatibility.js'
import {validateBackupRestore} from './domain/backup.js'
import {installationVault} from './domain/secret-vault.js'
import {writePrivateConfig} from './domain/private-config-file.js'
import {verifyRestorationManifest} from './domain/restoration-manifest.js'
import {isRecoveryRehearsal} from './domain/recovery-rehearsal.js'
import {sanitizeDiagnostic} from './domain/sanitize-diagnostic.js'
import {writeStandaloneBackup} from './domain/standalone-backup.js'

const run=promisify(execFile),absolute=z.string().min(1).refine(isAbsolute),digest=z.string().regex(/^[a-f0-9]{64}$/)
const preparationSchema=z.object({version:z.literal(1),purpose:z.literal('COMPATIBLE_ROLLBACK_LATEST_SNAPSHOT'),requestId:z.string().uuid(),createdAt:z.string().datetime(),target:absolute,targetManifestSha256:digest,contract:rollbackContractSchema,contractSource:z.enum(['DECLARED_EXECUTABLE','QUALIFIED_R83_MANIFEST']),current:z.object({file:absolute,sha256:digest}).strict(),baseline:z.object({file:absolute,sha256:digest}).strict(),profileSha256:digest,restorationManifestSha256:digest,historyPolicy:z.literal('LATEST_COMPLETE_SNAPSHOT_NO_MERGE'),history:z.object({newRecords:z.number().int().nonnegative(),changedRecords:z.number().int().nonnegative(),missingRecords:z.literal(0),inventorySha256:digest}).strict(),automaticTake:z.literal(false),rollbackReady:z.literal(false)}).strict()
const required=['runtime/node/node.exe','apps/server/dist/server.cjs','apps/server/dist/restore-backup.cjs','apps/server/dist/review-restored.cjs','apps/engine/target/release/rplayout-engine.exe','apps/engine/target/release/rplayout-host-guard.exe','apps/engine/target/release/rplayout-file-security.exe','RPlayout-Server.exe','review-rplayout-upgrade.ps1','start-rplayout-upgrade.ps1']
function targetEnvironment(target:string){return {...Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^RPLAYOUT_|^NODE_OPTIONS$|^NODE_PATH$|^MTX_|^RTSP_/i.test(key))),RPLAYOUT_INSTALL_ROOT:target}}
async function closedSnapshot(file:string){await physicalDirectory(dirname(file));const stamp=await regularFileStamp(file);if(existsSync(file+'-wal')||existsSync(file+'-shm'))throw new Error('Use backup fechado sem WAL/SHM, não o banco operacional.');return {stamp,sha256:await fileSha256(file)}}
async function contractFor(target:Awaited<ReturnType<typeof verifyLocalPackage>>){
  const executable=target.files.get('apps/server/dist/rollback-contract.cjs')
  if(!executable)return {contract:qualifiedHistoricalRollbackContract(target.manifestSha256),source:'QUALIFIED_R83_MANIFEST' as const}
  const result=await run(target.files.get('runtime/node/node.exe')!,[executable,'--describe'],{cwd:target.root,env:targetEnvironment(target.root),windowsHide:true,timeout:15000,maxBuffer:65536})
  return {contract:rollbackContractSchema.parse(JSON.parse(result.stdout)),source:'DECLARED_EXECUTABLE' as const}
}
async function immutableSnapshot(file:string,before:{stamp:string;sha256:string}){if(await regularFileStamp(file)!==before.stamp||await fileSha256(file)!==before.sha256)throw new Error('Backup mudou durante a preparação; preserve a cópia e não ative.')}
async function review(workspace:string){
  await physicalDirectory(workspace)
  for(const name of ['rollback-preparation.json','vault.json','installation-profile.candidate.json','restore-quarantine.json','service.db'])await regularFileStamp(join(workspace,name))
  process.env.RPLAYOUT_VAULT_FILE=join(workspace,'vault.json')
  const vault=installationVault(false)
  const envelope=JSON.parse(await readFile(join(workspace,'rollback-preparation.json'),'utf8'))
  const report=preparationSchema.parse(JSON.parse(vault.decrypt(envelope.protectedReport,'compatible-rollback:v1:report')))
  const target=await verifyLocalPackage(report.target,required),actualContract=await contractFor(target)
  if(target.manifestSha256!==report.targetManifestSha256||JSON.stringify(actualContract.contract)!==JSON.stringify(report.contract))throw new Error('Edição/contrato mudou desde a preparação.')
  for(const snapshot of [report.current,report.baseline])if((await closedSnapshot(snapshot.file)).sha256!==snapshot.sha256)throw new Error('Snapshot original mudou; retorno recusado.')
  if(await fileSha256(join(workspace,'installation-profile.candidate.json'))!==report.profileSha256||await fileSha256(join(workspace,'restore-quarantine.json'))!==report.restorationManifestSha256)throw new Error('Perfil/manifesto da cópia mudou; retorno recusado.')
  const sql=new Database(join(workspace,'service.db'),{readonly:true,fileMustExist:true})
  try{
    const receipt=await verifyRestorationManifest(sql,join(workspace,'restore-quarantine.json'))
    if(receipt.requestId!==report.requestId||receipt.backupSha256!==report.current.sha256||!isRecoveryRehearsal(sql))throw new Error('Cópia não é a quarentena deste snapshot atual; não repetir ativação.')
    assertSchemaCompatibility(sql,true)
    assertRollbackSchema(sql.prepare('SELECT version,name FROM schema_migrations ORDER BY version').all() as {version:number;name:string}[],report.contract)
    assertRollbackCheckpointData(sql,report.contract)
    const original=new Database(report.current.file,{readonly:true,fileMustExist:true})
    try{
      assertExactRollbackAsRunCopy(original,sql)
    }finally{original.close()}
  }finally{sql.close()}
  // This private receipt is NOT an activation capability. The target's
  // unchanged review/launcher/backend retain their fresh host/storage/PGM gates.
  return {version:1,purpose:report.purpose,requestId:report.requestId,target:target.root,targetManifestSha256:target.manifestSha256,history:report.history,historyPolicy:report.historyPolicy,reviewed:true,automaticTake:false,rollbackReady:false}
}
async function prepare(values:Map<string,string>){
  let currentFile=resolve(values.get('--current-backup')!),baselineFile=resolve(values.get('--baseline-backup')!)
  const targetRoot=resolve(values.get('--target')!),destination=resolve(values.get('--destination')!),media=resolve(values.get('--media-root')!)
  process.env.RPLAYOUT_VAULT_FILE=resolve(values.get('--vault-file')!)
  await physicalDirectory(dirname(process.env.RPLAYOUT_VAULT_FILE));await regularFileStamp(process.env.RPLAYOUT_VAULT_FILE)
  const vault=installationVault(false)
  if(currentFile.toLowerCase()===baselineFile.toLowerCase())throw new Error('Escolha snapshots distintos: baseline anterior e estado atual fechado.')
  await physicalDirectory(dirname(destination));await physicalDirectory(media)
  if(existsSync(destination))throw new Error('Destino existente; nada será substituído.')
  if(values.has('--export-snapshots')){
    // Explicit read-only SQLite export supports historical WAL-mode archives
    // without deleting/changing their sidecars or weakening the closed-input
    // gate. It can also capture a consistent committed live source, but never
    // releases its owner; target activation still needs fresh native exclusion.
    const exports=join(dirname(destination),'.rollback-snapshots-'+randomUUID())
    await mkdir(exports,{mode:0o700})
    for(const [name,file]of [['current.db',currentFile],['baseline.db',baselineFile]] as const){
      await physicalDirectory(dirname(file));await regularFileStamp(file)
      const source=new Database(file,{readonly:true,fileMustExist:true})
      try{await writeStandaloneBackup(source,join(exports,name))}finally{source.close()}
    }
    currentFile=join(exports,'current.db');baselineFile=join(exports,'baseline.db')
  }
  const currentStamp=await closedSnapshot(currentFile),baselineStamp=await closedSnapshot(baselineFile)
  const target=await verifyLocalPackage(targetRoot,required),compatibility=await contractFor(target)
  await validateBackupRestore(currentFile);await validateBackupRestore(baselineFile)
  const current=new Database(currentFile,{readonly:true,fileMustExist:true}),baseline=new Database(baselineFile,{readonly:true,fileMustExist:true})
  let history:ReturnType<typeof assertLosslessRollbackHistory>
  try{
    assertSchemaCompatibility(current,true)
    assertRollbackSchema(current.prepare('SELECT version,name FROM schema_migrations ORDER BY version').all() as {version:number;name:string}[],compatibility.contract)
    assertRollbackCheckpointData(current,compatibility.contract)
    history=assertLosslessRollbackHistory(baseline,current)
  }finally{baseline.close();current.close()}
  await immutableSnapshot(currentFile,currentStamp);await immutableSnapshot(baselineFile,baselineStamp)
  // The target's OWN restore implementation must validate the exact snapshot.
  // No old backup replaces newer history; no table/column is dropped or merged.
  const restored=await run(target.files.get('runtime/node/node.exe')!,[target.files.get('apps/server/dist/restore-backup.cjs')!,'--backup',currentFile,'--destination',destination,'--vault-file',process.env.RPLAYOUT_VAULT_FILE],{cwd:target.root,env:targetEnvironment(target.root),windowsHide:true,timeout:120000,maxBuffer:1024*1024})
  const receipt=JSON.parse(restored.stdout)
  if(receipt.phase!=='QUARANTINED'||receipt.promotionReady!==false||receipt.automaticTake!==false||receipt.backupSha256!==currentStamp.sha256)throw new Error('Ferramenta de destino não confirmou a quarentena do snapshot atual; preserve a pasta parcial.')
  const profile={version:1,dataRoot:destination,databaseFile:join(destination,'service.db'),mediaRoot:media,vaultFile:join(destination,'vault.json')}
  const profileText=JSON.stringify(profile,null,2)
  const targetPreparation={version:1,requestId:receipt.requestId,preparedAt:new Date().toISOString(),phase:'QUARANTINED',candidateProfile:'installation-profile.candidate.json',installRoot:target.root,packageManifestSha256:target.manifestSha256,backupSha256:currentStamp.sha256,vaultFingerprint:receipt.vaultFingerprint,activeProfileChanged:false,previousInstallationModified:false,automaticTake:false,promotionReady:false,mediaCopied:false,schemaCompatibility:'EXACT_TARGET_CONTRACT',rollbackCompatibility:'REVIEW_REQUIRED',purpose:'COMPATIBLE_ROLLBACK_LATEST_SNAPSHOT'}
  for(const [name,value]of [['installation-profile.candidate.json',profileText],['upgrade-preparation.json',JSON.stringify(targetPreparation,null,2)]] as const){if(existsSync(join(destination,name)))throw new Error('Artefato de preparação já existe; não substituir.');await writePrivateConfig(join(destination,name),value)}
  const candidate=new Database(join(destination,'service.db'),{readonly:true,fileMustExist:true})
  try{
    // Exact full rows, not only row counts or a "same schema" declaration.
    const original=new Database(currentFile,{readonly:true,fileMustExist:true})
    try{
      assertExactRollbackAsRunCopy(original,candidate)
    }finally{original.close()}
  }finally{candidate.close()}
  const report=preparationSchema.parse({version:1,purpose:'COMPATIBLE_ROLLBACK_LATEST_SNAPSHOT',requestId:receipt.requestId,createdAt:new Date().toISOString(),target:target.root,targetManifestSha256:target.manifestSha256,contract:compatibility.contract,contractSource:compatibility.source,current:{file:currentFile,sha256:currentStamp.sha256},baseline:{file:baselineFile,sha256:baselineStamp.sha256},profileSha256:await fileSha256(join(destination,'installation-profile.candidate.json')),restorationManifestSha256:await fileSha256(join(destination,'restore-quarantine.json')),historyPolicy:history.historyPolicy,history:{newRecords:history.newRecords,changedRecords:history.changedRecords,missingRecords:0,inventorySha256:history.differenceInventoryHash},automaticTake:false,rollbackReady:false})
  await immutableSnapshot(currentFile,currentStamp);await immutableSnapshot(baselineFile,baselineStamp)
  await writePrivateConfig(join(destination,'rollback-preparation.json'),JSON.stringify({version:1,protectedReport:vault.encrypt(JSON.stringify(report),'compatible-rollback:v1:report')},null,2))
  return {version:1,stage:'ROLLBACK_PREPARED_NOT_ACTIVATED',target:target.root,requestId:receipt.requestId,history:report.history,historyPolicy:report.historyPolicy,targetSchemaCompatible:true,sourceSnapshotsExported:values.has('--export-snapshots'),automaticTake:false,rollbackReady:false}
}
async function main(){
  const args=process.argv.slice(2),values=new Map<string,string>()
  for(let index=0;index<args.length;index+=2){const key=args[index]!,value=args[index+1];if(!['--current-backup','--baseline-backup','--vault-file','--target','--destination','--media-root','--workspace','--export-snapshots'].includes(key)||values.has(key)||!value||value.startsWith('--'))throw new Error('Opções inválidas/repetidas para preparar ou conferir retorno.');values.set(key,value)}
  if(process.env.RPLAYOUT_VAULT_KEY)throw new Error('Use cofre original em arquivo, sem chave externa conflitante.')
  if(values.has('--export-snapshots')&&values.get('--export-snapshots')!=='EXPORTAR')throw new Error('Exportação exige confirmação explícita EXPORTAR.')
  const result=values.has('--workspace')&&values.size===1?await review(resolve(values.get('--workspace')!)):!values.has('--workspace')&&values.size===(values.has('--export-snapshots')?7:6)?await prepare(values):null
  if(!result)throw new Error('Informe os seis caminhos de preparação ou somente --workspace para revisão.')
  process.stdout.write(JSON.stringify(result)+'\n')
}
void main().catch(error=>{process.stderr.write(sanitizeDiagnostic(error instanceof Error?error.message:'Retorno compatível recusado; originais preservados.')+'\n');process.exitCode=1})
