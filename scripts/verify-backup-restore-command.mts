import assert from 'node:assert/strict'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdtemp,readFile,writeFile,lstat,symlink,mkdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createHash,randomBytes} from 'node:crypto'
import {createRequire} from 'node:module'
const root=fileURLToPath(new URL('..',import.meta.url)),Database=createRequire(new URL('../apps/server/package.json',import.meta.url))('better-sqlite3')
const [backup,vault]=process.argv.slice(2);assert.ok(backup&&vault,'Pass the previous own verifier backup and vault; inputs are read-only')
process.env.RPLAYOUT_VAULT_FILE=vault;delete process.env.RPLAYOUT_VAULT_KEY
const {readRestorationRecords,assertCurrentRestorationReport}=await import('../apps/server/src/db/restoration-records.js'),{verifyRestorationManifest}=await import('../apps/server/src/domain/restoration-manifest.js')
const directory=await mkdtemp(join(tmpdir(),'RPlayout-restore-command-')),candidate=join(directory,'before-quarantine.db'),run=promisify(execFile)
const environment=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^RPLAYOUT_|^VITEST$/i.test(key)))
const env={...environment,RPLAYOUT_INSTALL_ROOT:root},tool=join(root,'apps/server/dist/restore-backup.cjs'),sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex')
const originalBackup=await readFile(backup),originalVault=await readFile(vault)
const source=new Database(backup,{readonly:true,fileMustExist:true});try{await source.backup(candidate)}finally{source.close()}
const original=new Database(candidate);try{original.exec('DROP TABLE IF EXISTS ha_recovery_origin')}finally{original.close()}
const candidateBytes=await readFile(candidate),destination=join(directory,'Cópia São José'),args=(target:string)=>[tool,'--backup',candidate,'--destination',target,'--vault-file',vault]
async function absent(path:string){await assert.rejects(lstat(path),(error:any)=>error.code==='ENOENT')}
async function refused(arguments_:string[],environment_:NodeJS.ProcessEnv=env){
  try{await run(process.execPath,arguments_,{env:environment_,windowsHide:true,timeout:90000});throw new Error('Unexpected restore acceptance')}
  catch(error:any){assert.equal(error.code,1,'Refusal must be a normal CLI failure, not timeout/import/native crash')}
}
let result:Record<string,unknown>={result:'FAIL',directory}
try{
  const report=JSON.parse((await run(process.execPath,args(destination),{env,windowsHide:true,timeout:90000})).stdout.trim())
  assert.equal(report.phase,'QUARANTINED');assert.equal(report.backupSha256,sha(candidateBytes));assert.equal(report.vaultMode,'ORIGINAL_FILE')
  const recovered=new Database(join(destination,'service.db'),{readonly:true,fileMustExist:true})
  try{
    assert.ok(recovered.prepare('SELECT 1 FROM ha_recovery_origin').get());assert.equal(recovered.pragma('integrity_check',{simple:true}),'ok')
    assert.deepEqual(assertCurrentRestorationReport(recovered,report),report)
    assert.deepEqual(await verifyRestorationManifest(recovered,join(destination,'restore-quarantine.json')),report)
  }finally{recovered.close()}
  assert.deepEqual(await readFile(join(destination,'vault.json')),originalVault)
  const dbBytes=await readFile(join(destination,'service.db')),manifest=await readFile(join(destination,'restore-quarantine.json'))
  const nestedDestination=join(directory,'Segunda recuperação'),nestedReport=JSON.parse((await run(process.execPath,[tool,'--backup',join(destination,'service.db'),'--destination',nestedDestination,'--vault-file',vault],{env,windowsHide:true,timeout:90000})).stdout.trim())
  const nested=new Database(join(nestedDestination,'service.db'),{readonly:true,fileMustExist:true})
  try{
    assert.deepEqual(readRestorationRecords(nested),[report,nestedReport])
    assert.deepEqual(await verifyRestorationManifest(nested,join(nestedDestination,'restore-quarantine.json')),nestedReport)
    assert.throws(()=>assertCurrentRestorationReport(nested,report),/atual/)
    await assert.rejects(verifyRestorationManifest(nested,join(destination,'restore-quarantine.json')),/atual/)
  }finally{nested.close()}
  assert.deepEqual(await readFile(join(destination,'service.db')),dbBytes)
  await refused(args(destination));assert.deepEqual(await readFile(join(destination,'service.db')),dbBytes);assert.deepEqual(await readFile(join(destination,'restore-quarantine.json')),manifest)
  const wrong=join(directory,'wrong-key')
  await refused([tool,'--backup',candidate,'--destination',wrong],{...env,RPLAYOUT_VAULT_KEY:randomBytes(32).toString('base64')});await absent(wrong)
  const missing=join(directory,'missing-vault');await refused([tool,'--backup',candidate,'--destination',missing,'--vault-file',join(directory,'absent.json')]);await absent(missing)
  const absentBackup=join(directory,'missing-backup');await refused([tool,'--backup',join(directory,'absent.db'),'--destination',absentBackup,'--vault-file',vault]);await absent(absentBackup)
  const foreign=join(directory,'foreign.db'),raw=new Database(foreign);try{raw.exec('CREATE TABLE unrelated(id INTEGER)')}finally{raw.close()}
  const foreignTarget=join(directory,'foreign-target');await refused([tool,'--backup',foreign,'--destination',foreignTarget,'--vault-file',vault]);await absent(foreignTarget)
  const parent=join(directory,'real-parent'),junction=join(directory,'junction');await mkdir(parent);await symlink(parent,junction,'junction')
  await refused(args(join(junction,'blocked')));await absent(join(parent,'blocked'))
  const partial=join(directory,'acl-failure');await refused(args(partial),{...env,RPLAYOUT_FILE_SECURITY:''})
  await absent(join(partial,'service.db'));await absent(join(partial,'vault.json'))
  const partialDb=new Database(join(partial,'service.restore-partial.db'),{readonly:true,fileMustExist:true});try{assert.ok(partialDb.prepare('SELECT 1 FROM ha_recovery_origin').get())}finally{partialDb.close()}
  assert.deepEqual(await readFile(candidate),candidateBytes);assert.deepEqual(await readFile(backup),originalBackup);assert.deepEqual(await readFile(vault),originalVault)
  result={result:'PASS',directory,restoreCliSha256:sha(await readFile(tool)),newQuarantineMarkerCreated:true,currentReportBoundToSignedDatabaseReceipt:true,nestedRestorationPreservesOriginalReceiptAndAppendsNewIdentity:true,olderProtectedManifestRefusedAgainstNewRestoration:true,existingDestinationRefusedWithoutOverwrite:true,wrongKeyRefusedBeforeDestinationCreation:true,missingVaultRefusedWithoutNewKey:true,missingBackupRefusedWithoutEmptyDb:true,nonRPlayoutBackupRefused:true,junctionParentRefused:true,aclHelperMissingRefusedWithOwnedQuarantinedPartialPreserved:true,originalBackupAndVaultBytesPreserved:true,serversStarted:false,physicalPgmValidated:false,sharedKeySuccessValidated:false}
}catch(error){result={...result,error:String(error)};throw error}
finally{await writeFile(join(directory,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result))}
