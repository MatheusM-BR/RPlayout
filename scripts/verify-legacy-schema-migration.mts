import assert from 'node:assert/strict'
import {spawn,execFile,type ChildProcess} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {createHash} from 'node:crypto'
import {createRequire} from 'node:module'
import {createServer} from 'node:net'

const legacy=resolve('release/runtime-base-r30'),current=resolve('D:/RPlayout-builds/qa/r83-installed-20261016'),qa=resolve('D:/RPlayout-builds/qa')
assert.equal(resolve(process.execPath).toLowerCase(),join(current,'runtime/node/node.exe').toLowerCase())
const directory=await mkdtemp(join(qa,'legacy-schema-')),sourceDir=join(directory,'source'),media=join(directory,'media'),restored=join(directory,'restored')
for(const path of [sourceDir,media,join(directory,'temp')])await mkdir(path)
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex'),run=promisify(execFile)
const legacyManifest=JSON.parse(await readFile(join(legacy,'package-manifest.json'),'utf8'))
for(const file of ['apps/server/dist/server.cjs','runtime/node/node.exe'])assert.equal(hash(await readFile(join(legacy,file))).toUpperCase(),legacyManifest.files.find((entry:any)=>entry.file===file).sha256)
const legacyHash=hash(await readFile(join(legacy,'apps/server/dist/server.cjs')))
const env:NodeJS.ProcessEnv=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^RPLAYOUT_|^NODE_|^PORT$|^HOST$/i.test(key)))
const source=join(sourceDir,'service.db'),sourceVault=join(sourceDir,'vault.json'),backup=join(directory,'legacy-backup.db')
// Historical r30 resolves the Windows DPAPI PowerShell helper through PATH.
// Supply its actual OS dependency; do not patch the old executable or pretend
// this source run qualifies the current edition's minimal-PATH contract.
Object.assign(env,{PATH:[join(legacy,'runtime/node'),join(process.env.SystemRoot!,'System32'),join(process.env.SystemRoot!,'System32/WindowsPowerShell/v1.0')].join(';'),TEMP:join(directory,'temp'),TMP:join(directory,'temp'),HOST:'127.0.0.1',LOG_LEVEL:'warn',RPLAYOUT_INSTALL_ROOT:legacy,RPLAYOUT_DB:source,RPLAYOUT_VAULT_FILE:sourceVault,RPLAYOUT_MEDIA:media,RPLAYOUT_THUMBS:join(sourceDir,'thumbs'),RPLAYOUT_CACHE:join(sourceDir,'cache'),RPLAYOUT_CACHE_DIR:join(sourceDir,'cache'),RPLAYOUT_MEDIA_VERSIONS:join(sourceDir,'versions'),RPLAYOUT_BACKUPS:join(sourceDir,'backups'),RPLAYOUT_BACKUP_HOURS:'0',RPLAYOUT_ENGINE:'',RPLAYOUT_MEDIAMTX:'',RPLAYOUT_DEVICES:'',RPLAYOUT_RELAY:'',RPLAYOUT_PROBE:'',RPLAYOUT_PROXY:'',RPLAYOUT_AUDIO_ANALYSIS:''})
const ps=join(process.env.SystemRoot!,'System32/WindowsPowerShell/v1.0/powershell.exe')
const SQLite=createRequire(join(current,'apps/server/dist/server.cjs'))('better-sqlite3')
const inspect=<T>(file:string,work:(db:any)=>T):T=>{const db=new SQLite(file,{readonly:true,fileMustExist:true});try{return work(db)}finally{db.close()}}
let child:ChildProcess|null=null,logs='',result:Record<string,any>={result:'FAIL',directory,legacy,legacyHash,current,scope:'Actual historical binary creates old schema; fixture business rows, isolated offline migration only'},failure:unknown=null
async function end(){if(!child||child.exitCode!==null||child.signalCode!==null)return;await new Promise<void>((done,reject)=>{const timer=setTimeout(()=>reject(new Error('Legacy QA job did not exit')),15000);child!.once('exit',()=>{clearTimeout(timer);done()});child!.kill('SIGKILL')})}
async function command(label:string,args:string[],expected=0){
  try{const value=await run(join(current,'runtime/node/node.exe'),args,{env:{...env,RPLAYOUT_INSTALL_ROOT:current,RPLAYOUT_VAULT_FILE:join(restored,'vault.json')},cwd:directory,windowsHide:true,timeout:60000,maxBuffer:65536});await writeFile(join(directory,label+'.log'),value.stdout+'\n'+value.stderr);assert.equal(expected,0);return JSON.parse(value.stdout)}
  catch(error){const e=error as any;await writeFile(join(directory,label+'.log'),String(e.stdout??'')+'\n'+String(e.stderr??''));if(expected!==0&&e.code===expected)return {refused:true,message:e.stderr};throw error}
}
try{
  const allocator=createServer();await new Promise<void>(done=>allocator.listen(0,'127.0.0.1',done));const port=(allocator.address() as {port:number}).port;await new Promise<void>(done=>allocator.close(()=>done()))
  child=spawn(ps,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',resolve('scripts/qa-owned-legacy-server.ps1'),'-LegacyRoot',legacy,'-QaDirectory',directory],{env:{...env,PORT:String(port)},cwd:directory,windowsHide:true,stdio:['ignore','pipe','pipe']})
  for(const stream of [child.stdout,child.stderr])stream?.on('data',chunk=>logs=(logs+String(chunk)).slice(-32000))
  let ready=false;const deadline=performance.now()+45000
  while(performance.now()<deadline){assert.equal(child.exitCode,null,logs);try{const response=await fetch('http://127.0.0.1:'+port+'/api/health',{signal:AbortSignal.timeout(1000)});if(response.ok&&(await response.json() as any).ok){ready=true;break}}catch{}await new Promise(done=>setTimeout(done,100))}
  assert.ok(ready,logs);await end()
  const before=inspect(source,db=>db.prepare('SELECT version,name FROM schema_migrations ORDER BY version').all())
  result.legacyMigrations=before;assert.equal(before.at(-1).version,45,'Historical source must actually be older, not a current DB with deleted markers')
  // Public business fixtures only, after the historical process stopped. No
  // schema, migration marker, signed ownership or restoration receipt is forged.
  const fixture=new SQLite(source,{fileMustExist:true})
  try{
    fixture.prepare("INSERT INTO channels(id,name,rate_num,rate_den,width,height,target_lufs,ceiling_dbtp,limiter_lookahead_ms,created_at) VALUES('legacy','Programação São José Çãó',25,1,320,180,-23,-1,5,?)").run(new Date().toISOString())
    fixture.prepare("INSERT INTO rundowns(id,channel_id,name,planned_start,loop,date,created_at,updated_at) VALUES('legacy-rd','legacy','Grade Óscar',0,0,'2026-10-16',?,?)").run(new Date().toISOString(),new Date().toISOString())
    await fixture.backup(backup)
  }finally{fixture.close()}
  const backupHash=hash(await readFile(backup)),business=inspect(backup,db=>({channels:db.prepare('SELECT * FROM channels').all(),rundowns:db.prepare('SELECT * FROM rundowns').all()}))
  result.backupHash=backupHash
  result.restore=await command('restore',[join(current,'apps/server/dist/restore-backup.cjs'),'--backup',backup,'--destination',restored,'--vault-file',sourceVault])
  assert.equal(result.restore.phase,'QUARANTINED')
  const database=join(restored,'service.db'),manifest=join(restored,'restore-quarantine.json'),vault=join(restored,'vault.json')
  const review=await command('review-before-migration',[join(current,'apps/server/dist/review-restored.cjs'),'--database',database,'--manifest',manifest,'--vault-file',vault],1)
  assert.equal(review.refused,true)
  result.migration=await command('migrate',[join(current,'apps/server/dist/migrate-restored.cjs'),'--database',database,'--manifest',manifest,'--vault-file',vault])
  assert.equal(result.migration.stage,'MIGRATED_NOT_ACTIVATED');assert.equal(result.migration.schema.current,true)
  result.after=inspect(database,db=>({migrations:db.prepare('SELECT version,name FROM schema_migrations ORDER BY version').all(),business:{channels:db.prepare('SELECT * FROM channels').all(),rundowns:db.prepare('SELECT * FROM rundowns').all()},integrity:db.pragma('integrity_check',{simple:true}),fk:db.pragma('foreign_key_check'),origin:db.prepare("SELECT 1 FROM sqlite_master WHERE name='ha_recovery_origin'").get()}))
  assert.equal(result.after.integrity,'ok');assert.deepEqual(result.after.fk,[]);assert.ok(result.after.origin);assert.deepEqual(result.after.business,business)
  assert.equal(hash(await readFile(backup)),backupHash)
  result.currentNoop=await command('migrate-current',[join(current,'apps/server/dist/migrate-restored.cjs'),'--database',database,'--manifest',manifest,'--vault-file',vault])
  assert.equal(result.currentNoop.stage,'CURRENT_NOT_ACTIVATED')
  result.result='PASS'
}catch(error){failure=error;result.error=String(error);throw error}
finally{await end();result.legacyJobStopped=Boolean(child&&(child.exitCode!==null||child.signalCode!==null));await writeFile(join(directory,'legacy.log'),logs);await writeFile(join(directory,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({result:result.result,directory,error:result.error}));if(!result.legacyJobStopped&&!failure)throw new Error('Legacy job not stopped')}
