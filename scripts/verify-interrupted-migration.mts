import assert from 'node:assert/strict'
import {spawn,execFile,type ChildProcess} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {createRequire} from 'node:module'
import {createHash} from 'node:crypto'
import {inspectWal} from './lib/wal-evidence.js'

assert.ok(process.argv.length===4||process.argv.length===5)
const duringTransaction=process.argv[4]==='--during-transaction'
assert.ok(process.argv.length===4||duringTransaction)
const install=resolve(process.argv[2]!),legacyEvidence=resolve(process.argv[3]!),qa=resolve('D:/RPlayout-builds/qa')
for(const path of [install,legacyEvidence])assert.ok(path.toLowerCase().startsWith(qa.toLowerCase()+'\\'))
assert.equal(resolve(process.execPath).toLowerCase(),join(install,'runtime/node/node.exe').toLowerCase())
const old=JSON.parse(await readFile(join(legacyEvidence,'result.json'),'utf8'))
assert.equal(old.result,'PASS');assert.equal(old.legacyJobStopped,true)
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex'),run=promisify(execFile)
assert.equal(hash(await readFile(join(legacyEvidence,'legacy-backup.db'))),old.backupHash)
assert.equal(hash(await readFile(join(install,'apps/server/dist/server.cjs'))),'3f52de22cd416a920a273de2489a3d3ff6a490b8bfbf2790e647b0101c7f030d')
const directory=await mkdtemp(join(qa,'interrupted-migration-')),fixture=join(directory,'legacy-fixture.db'),backup=join(directory,'fixture-backup.db'),prepared=join(directory,'interrupted'),fresh=join(directory,'recovered')
await mkdir(join(directory,'temp'))
const SQLite=createRequire(join(install,'apps/server/dist/server.cjs'))('better-sqlite3')
const read=<T>(file:string,work:(db:any)=>T):T=>{const db=new SQLite(file,{readonly:true,fileMustExist:true});try{return work(db)}finally{db.close()}}
const ps=join(process.env.SystemRoot!,'System32/WindowsPowerShell/v1.0/powershell.exe')
const env:NodeJS.ProcessEnv=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^RPLAYOUT_|^NODE_|^GST_|^GSTREAMER_|^MTX_|^RTSP_/i.test(key)))
Object.assign(env,{RPLAYOUT_INSTALL_ROOT:install,TEMP:join(directory,'temp'),TMP:join(directory,'temp')})
let child:ChildProcess|null=null,logs='',failure:unknown=null,result:Record<string,any>={result:'FAIL',directory,install,legacyEvidence,fixture,backup,prepared,fresh,duringTransaction,scope:'Interrupted migration of a real r30 schema45 backup plus explicitly synthetic INFO health rows; no legacy native PGM/jobs or physical power-loss qualification'}
async function end(){if(!child||child.exitCode!==null||child.signalCode!==null)return;await new Promise<void>((done,reject)=>{const timer=setTimeout(()=>reject(new Error('Own migration QA job did not stop')),15000);child!.once('exit',()=>{clearTimeout(timer);done()});child!.kill('SIGKILL')})}
async function command(label:string,args:string[],expected=0){
  try{const value=await run(process.execPath,args,{cwd:install,env,windowsHide:true,timeout:120000,maxBuffer:65536});await writeFile(join(directory,label+'.log'),value.stdout+'\n'+value.stderr);assert.equal(expected,0);return JSON.parse(value.stdout)}
  catch(error){const e=error as any;await writeFile(join(directory,label+'.log'),String(e.stdout??'')+'\n'+String(e.stderr??''));if(expected&&e.code===expected)return {refused:true,message:String(e.stderr)};throw error}
}
const paths=(root:string)=>['--database',join(root,'service.db'),'--manifest',join(root,'restore-quarantine.json'),'--vault-file',join(root,'vault.json')]
try{
  const original=new SQLite(join(legacyEvidence,'legacy-backup.db'),{readonly:true,fileMustExist:true})
  try{assert.equal(original.prepare('SELECT MAX(version) AS n FROM schema_migrations').get().n,45);await original.backup(fixture)}finally{original.close()}
  // New QA copy only: bounded public diagnostic fixtures, never native
  // incidents, migration markers, owners, receipts or journal phases.
  const seeded=new SQLite(fixture,{fileMustExist:true})
  try{
    const insert=seeded.prepare('INSERT INTO health_events(id,channel_id,component,state,severity,message,occurred_at,acknowledged_at) VALUES(?,NULL,?,?,?,NULL,?,NULL)')
    seeded.transaction(()=>{for(let i=0;i<(duringTransaction?200000:20000);i++)insert.run('qa-migration-fixture:'+i,'QA_MIGRATION_FIXTURE','fixture','INFO','2026-10-17T00:00:00.000Z')})()
    await seeded.backup(backup)
  }finally{seeded.close()}
  result.backupHash=hash(await readFile(backup));result.syntheticInfoRows=duringTransaction?200000:20000
  result.restoration=await command('restore-interrupted',[join(install,'apps/server/dist/restore-backup.cjs'),'--backup',backup,'--destination',prepared,'--vault-file',join(legacyEvidence,'source/vault.json')])
  assert.equal(result.restoration.phase,'QUARANTINED')
  process.env.RPLAYOUT_VAULT_FILE=join(prepared,'vault.json');delete process.env.RPLAYOUT_VAULT_KEY
  const {installationVault}=await import('../apps/server/src/domain/secret-vault.js')
  const {verifyRestorationManifest}=await import('../apps/server/src/domain/restoration-manifest.js')
  const {assertNoInterruptedRestoredMigration}=await import('../apps/server/src/domain/migrate-restored-copy.js')
  const {readStorageAdmission}=await import('../apps/server/src/db/storage-admission.js')
  const inspection=new SQLite(join(prepared,'service.db'),{readonly:true,fileMustExist:true})
  try{await verifyRestorationManifest(inspection,join(prepared,'restore-quarantine.json'))}finally{inspection.close()}
  const vault=installationVault(false)
  child=spawn(ps,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',resolve('scripts/qa-owned-migration.ps1'),'-InstallRoot',install,'-Database',join(prepared,'service.db'),'-Manifest',join(prepared,'restore-quarantine.json'),'-VaultFile',join(prepared,'vault.json')],{cwd:install,env,windowsHide:true,stdio:['ignore','pipe','pipe']})
  for(const stream of [child.stdout,child.stderr])stream?.on('data',chunk=>logs=(logs+String(chunk)).slice(-64000))
  const observer=new SQLite(join(prepared,'service.db'),{readonly:true,fileMustExist:true})
  try{
    const intent=observer.prepare("SELECT payload FROM operator_decisions WHERE kind='RESTORED_SCHEMA_MIGRATION_STARTED' ORDER BY rowid DESC LIMIT 1")
    let observed=false;const deadline=performance.now()+60000
    while(performance.now()<deadline){
      assert.equal(child.exitCode,null,logs)
      const row=intent.get()
      if(row){
        result.interruptedIntent=JSON.parse(vault.decrypt(row.payload,'operator_decisions.payload'))
        if(duringTransaction){
          const committedPages=Number(observer.pragma('page_count',{simple:true}));result.pagesAtIntent=committedPages
          const transactionDeadline=performance.now()+15000
          let captured:Buffer|null=null
          while(performance.now()<transactionDeadline){
            assert.equal(child.exitCode,null,logs)
            const bytes=await readFile(join(prepared,'service.db-wal')).catch((error:any)=>{if(error.code==='ENOENT')return null;throw error})
            const candidate=bytes&&inspectWal(bytes,false)
            if(candidate&&candidate.frames.some(frame=>frame.index>candidate.lastCommit&&frame.page>committedPages)){
              captured=bytes;await end();break
            }
            await new Promise(done=>setTimeout(done,1))
          }
          assert.ok(captured,'No uncommitted new-page WAL frames captured; do not claim an in-transaction stop')
          const checked=inspectWal(captured)!
          assert.ok(checked?.checksumValidated)
          const newUncommitted=checked.frames.filter(frame=>frame.index>checked.lastCommit&&frame.page>committedPages)
          assert.ok(newUncommitted.length,'Captured frames must have valid salts/checksums, not a concurrent partial write')
          await writeFile(join(directory,'pre-interruption.wal'),captured)
          result.walEvidence={sha256:hash(captured),bytes:captured.length,pageSize:checked.pageSize,lastCommit:checked.lastCommit,validFrames:checked.frames.length,newUncommittedPages:[...new Set(newUncommitted.map(frame=>frame.page))],checksumValidated:true}
        }else await end()
        observed=true;break
      }
      await new Promise(done=>setTimeout(done,2))
    }
    assert.ok(observed,'No durable STARTED observed; no interruption claim')
  }finally{observer.close()}
  const journal=()=>read(join(prepared,'service.db'),db=>db.prepare("SELECT kind,payload FROM operator_decisions WHERE kind LIKE 'RESTORED_SCHEMA_MIGRATION_%' ORDER BY rowid").all().map((row:any)=>({kind:row.kind,value:JSON.parse(vault.decrypt(row.payload,'operator_decisions.payload'))})))
  assert.deepEqual(journal().map(row=>row.kind),['RESTORED_SCHEMA_MIGRATION_STARTED'])
  const beforeRetry=read(join(prepared,'service.db'),db=>({migrations:db.prepare('SELECT * FROM schema_migrations ORDER BY version').all(),channels:db.prepare('SELECT * FROM channels ORDER BY id').all(),rundowns:db.prepare('SELECT * FROM rundowns ORDER BY id').all()}))
  result.afterInterruption=beforeRetry
  if(duringTransaction)assert.equal(beforeRetry.migrations.at(-1).version,45,'Atomic initialize must roll back, not expose partially committed migration markers')
  assert.throws(()=>read(join(prepared,'service.db'),db=>assertNoInterruptedRestoredMigration(db)),/interrompida/)
  assert.equal(read(join(prepared,'service.db'),db=>readStorageAdmission(db))?.phase,'MAINTENANCE')
  result.retry=await command('retry-refused',[join(install,'apps/server/dist/migrate-restored.cjs'),...paths(prepared)],1)
  assert.equal(result.retry.refused,true);assert.match(result.retry.message,/interrompida/)
  assert.deepEqual(journal().map(row=>row.kind),['RESTORED_SCHEMA_MIGRATION_STARTED'])
  assert.deepEqual(read(join(prepared,'service.db'),db=>db.prepare('SELECT * FROM schema_migrations ORDER BY version').all()),beforeRetry.migrations)
  // Recovery is a NEW restoration of the unchanged original fixture backup.
  // The interrupted database and its pending intent remain preserved.
  result.newRestoration=await command('restore-fresh',[join(install,'apps/server/dist/restore-backup.cjs'),'--backup',backup,'--destination',fresh,'--vault-file',join(legacyEvidence,'source/vault.json')])
  result.newMigration=await command('migrate-fresh',[join(install,'apps/server/dist/migrate-restored.cjs'),...paths(fresh)])
  assert.equal(result.newMigration.stage,'MIGRATED_NOT_ACTIVATED');assert.equal(result.newMigration.schema.current,true)
  assert.equal(read(join(fresh,'service.db'),db=>db.pragma('integrity_check',{simple:true})),'ok')
  for(const table of ['channels','rundowns'])assert.deepEqual(read(join(fresh,'service.db'),db=>db.prepare(`SELECT * FROM ${table} ORDER BY id`).all()),read(backup,db=>db.prepare(`SELECT * FROM ${table} ORDER BY id`).all()))
  assert.equal(read(join(fresh,'service.db'),db=>db.prepare("SELECT COUNT(*) AS n FROM health_events WHERE component='QA_MIGRATION_FIXTURE'").get().n),result.syntheticInfoRows)
  assert.equal(hash(await readFile(backup)),result.backupHash);assert.equal(hash(await readFile(join(legacyEvidence,'legacy-backup.db'))),old.backupHash)
  result.result='PASS'
}catch(error){failure=error;result.error=String(error);throw error}
finally{
  await end();result.ownedJobStopped=Boolean(child&&(child.exitCode!==null||child.signalCode!==null))
  result.engineStarted=false;result.physicalInputsValidated=false;result.powerLossValidated=false
  await writeFile(join(directory,'migration.log'),logs);await writeFile(join(directory,'result.json'),JSON.stringify(result,null,2))
  console.log(JSON.stringify({result:result.result,directory,error:result.error,ownedJobStopped:result.ownedJobStopped}))
  if(!result.ownedJobStopped&&!failure)throw new Error('Own migration job not stopped')
}
