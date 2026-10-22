import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {mkdtemp,readFile,writeFile,mkdir,stat,realpath} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {createServer} from 'node:net'
import {createHash} from 'node:crypto'
import {fileURLToPath} from 'node:url'
import {createRequire} from 'node:module'

const root=resolve(process.argv[2]??'');assert.ok(process.argv[2],'Provide isolated extracted payload')
assert.equal(resolve(process.execPath).toLowerCase(),join(root,'runtime/node/node.exe').toLowerCase(),'Use bundled Node')
const directory=await mkdtemp(join(process.argv.includes('--workspace-artifacts')?join(fileURLToPath(new URL('..',import.meta.url)),'scratch'):tmpdir(),'RPlayout-portable-server-'))
await mkdir(join(directory,'media'))
const listener=createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r))
const port=listener.address().port;await new Promise(r=>listener.close(r))
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^RPLAYOUT_|^NODE_PATH$|^NODE_OPTIONS$|^GST_|^GSTREAMER_/i.test(key)))
const minimalPath=process.argv.includes('--minimal-path')
const serverArgument=process.argv.find(value=>value.startsWith('--server-binary='))
const serverBinary=serverArgument?resolve(serverArgument.slice('--server-binary='.length)):join(root,'apps/server/dist/server.cjs')
if(serverArgument)env.NODE_PATH=join(root,'apps/server/node_modules')
const sqliteModule=await realpath(createRequire(serverBinary).resolve('better-sqlite3'))
const packagePrefix=(await realpath(root)).toLowerCase()+'\\'
const sqliteResolvedWithinPackage=sqliteModule.toLowerCase().startsWith(packagePrefix)
if(!serverArgument)assert.ok(sqliteResolvedWithinPackage,'Native SQLite must resolve inside the chosen package, not the source/global modules')
if(process.argv.includes('--trace-startup'))env.RPLAYOUT_STARTUP_TRACE='1'
const budgetArgument=process.argv.find(value=>value.startsWith('--startup-budget='))
const startupBudget=budgetArgument?Number(budgetArgument.slice('--startup-budget='.length)):30000
assert.ok(Number.isInteger(startupBudget)&&startupBudget>=30000&&startupBudget<=120000,'bounded diagnostic startup budget')
Object.assign(env,{PATH:join(root,'runtime/node')+';'+join(root,'runtime/gstreamer/bin')+';'+join(process.env.SystemRoot,'System32')+(minimalPath?'':';'+join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0')),
 RPLAYOUT_INSTALL_ROOT:root,RPLAYOUT_DB:join(directory,'service.db'),RPLAYOUT_VAULT_FILE:join(directory,'vault.json'),
 RPLAYOUT_MEDIA:join(directory,'media'),RPLAYOUT_THUMBS:join(directory,'thumbs'),RPLAYOUT_MEDIA_VERSIONS:join(directory,'versions'),
 RPLAYOUT_CACHE_DIR:join(directory,'cache'),RPLAYOUT_BACKUPS:join(directory,'backups'),RPLAYOUT_BACKUP_HOURS:'0',
 RPLAYOUT_ENGINE:'',RPLAYOUT_MEDIAMTX:'',RPLAYOUT_DEVICES:'',RPLAYOUT_RELAY:'',RPLAYOUT_AUDIO_ANALYSIS:'',
 RPLAYOUT_PROBE:'',RPLAYOUT_PROXY:'',HOST:'127.0.0.1',PORT:String(port),LOG_LEVEL:'warn'})
const child=spawn(process.execPath,[serverBinary],{cwd:directory,env,windowsHide:true,stdio:['ignore','pipe','pipe']})
const startupStarted=performance.now()
await writeFile(join(directory,'launch.json'),JSON.stringify({pid:child.pid,port,startupBudget,package:root},null,2))
let logs='',result={result:'FAIL',directory,package:root,serverBinary,compiledServerOverride:Boolean(serverArgument),pgmDisabled:true}
const startupObservations=[]
for(const stream of [child.stdout,child.stderr])stream.on('data',b=>logs=(logs+b).slice(-16000))
try{
 const deadline=performance.now()+startupBudget;let healthy=false
 while(performance.now()<deadline){
  assert.equal(child.exitCode,null,logs)
  try{const response=await fetch(`http://127.0.0.1:${port}/api/health`,{signal:AbortSignal.timeout(1500)});const body=await response.json();healthy=response.ok&&body.ok;startupObservations.push({elapsedMs:Math.round(performance.now()-startupStarted),status:response.status,bodyKeys:Object.keys(body),ok:body.ok})}catch(error){startupObservations.push({elapsedMs:Math.round(performance.now()-startupStarted),error:String(error),causeCode:error.cause?.code,aggregateCodes:error.cause?.errors?.map(value=>value.code)})}
  if(startupObservations.length>8)startupObservations.shift()
  if(healthy)break
  await new Promise(r=>setTimeout(r,100))
 }
 assert.ok(healthy,'Packaged server readiness: '+logs)
 const page=await fetch(`http://127.0.0.1:${port}/`);assert.equal(page.status,200)
 const html=await page.text();assert.match(html,/RPlayout/i)
 const script=html.match(/src="(\/assets\/[^" ]+\.js)"/);assert.ok(script,'Built interface script')
 const response=await fetch(`http://127.0.0.1:${port}${script[1]}`);assert.equal(response.status,200)
 const bytes=new Uint8Array(await response.arrayBuffer()),expected=await readFile(join(root,'apps/web/dist',script[1]))
 const sha=b=>createHash('sha256').update(b).digest('hex')
 assert.equal(sha(bytes),sha(expected));assert.ok((await stat(join(directory,'service.db'))).size>0)
 const startupElapsedMs=performance.now()-startupStarted
 result={...result,result:startupElapsedMs<=30000?'PASS':'LATE_STARTUP',startupElapsedMs,standardStartupDeadlineMet:startupElapsedMs<=30000,bundledNode:process.version,interfaceAsset:script[1],interfaceSha256:sha(bytes),databaseCreated:true,
  minimalPathWithoutPowerShell:minimalPath,sqliteResolvedWithinPackage,childNodeOptionsRemoved:!Object.hasOwn(env,'NODE_OPTIONS'),childNodePathRemoved:!Object.hasOwn(env,'NODE_PATH'),serverSha256:sha(await readFile(serverBinary)),cleanWindowsValidated:false,installerShortcutsValidated:false,physicalSignalValidated:false}
}catch(error){result={...result,error:String(error)};throw error}
finally{
 if(child.exitCode===null&&child.signalCode===null){const ended=new Promise(r=>child.once('exit',r));child.kill();await ended}
 result={...result,serverExitObserved:true,startupObservations}
 await writeFile(join(directory,'result.json'),JSON.stringify(result,null,2));await writeFile(join(directory,'server.log'),logs)
 console.log(JSON.stringify(result))
}
