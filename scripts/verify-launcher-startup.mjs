import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {mkdtemp,mkdir,cp,copyFile,writeFile,readFile,readdir,stat} from 'node:fs/promises'
import {createServer} from 'node:net'
import {join,resolve} from 'node:path'
import {createHash} from 'node:crypto'

const workspace=resolve('.'),installed=resolve(process.argv[2]??'')
assert.equal(process.argv.length,3);assert.ok(installed.startsWith(join(workspace,'scratch')+'\\'))
assert.equal(resolve(process.execPath).toLowerCase(),join(installed,'runtime/node/node.exe').toLowerCase())
const directory=await mkdtemp(join(workspace,'scratch','launcher-startup-')),root=join(directory,'portable-fixture')
await mkdir(root)
// Small, explicit portable test fixture: actual bundled Node/modules + current
// compiled server/web/launcher. NOT an installed/full release qualification.
for(const folder of ['runtime/node','apps/server/node_modules'])await cp(join(installed,folder),join(root,folder),{recursive:true})
for(const folder of ['apps/server/dist','apps/web/dist'])await cp(join(workspace,folder),join(root,folder),{recursive:true})
for(const name of await readdir(installed))if(name.toLowerCase().endsWith('.dll'))await copyFile(join(installed,name),join(root,name))
await copyFile(join(installed,'package.json'),join(root,'package.json'))
await mkdir(join(root,'apps/engine/target/release'),{recursive:true})
await copyFile(join(installed,'apps/engine/target/release/rplayout-file-security.exe'),join(root,'apps/engine/target/release/rplayout-file-security.exe'))
await copyFile(join(workspace,'apps/engine/target/release/rplayout.exe'),join(root,'RPlayout-Server.exe'))
await writeFile(join(root,'package-manifest.json'),JSON.stringify({version:1,fixture:true,functionalVerification:'OWNED_LAUNCHER_FIXTURE_NOT_AN_INSTALLATION',files:[]}))
await mkdir(join(root,'data'));await mkdir(join(root,'media'))
const profileFile=join(root,'installation-profile.json'),profile={version:1,dataRoot:join(root,'data'),mediaRoot:join(root,'media'),vaultFile:join(root,'data/vault.json')}
await writeFile(profileFile,JSON.stringify(profile))
const sha=bytes=>createHash('sha256').update(bytes).digest('hex')
const hashes={launcher:sha(await readFile(join(root,'RPlayout-Server.exe'))),server:sha(await readFile(join(root,'apps/server/dist/server.cjs')))}
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^RPLAYOUT_|^NODE_|^HOST$|^PORT$|^GST_|^GSTREAMER_/i.test(key)))
Object.assign(env,{PATH:join(root,'runtime/node')+';'+join(process.env.SystemRoot,'System32'),HOST:'127.0.0.1',PORT:'17',NODE_OPTIONS:'--rplayout-invalid-global-option',NODE_PATH:join(directory,'foreign-global-modules'),RPLAYOUT_ENGINE:'',RPLAYOUT_MEDIAMTX:'',RPLAYOUT_DEVICES:'',RPLAYOUT_RELAY:'',RPLAYOUT_PROBE:'',RPLAYOUT_PROXY:'',RPLAYOUT_AUDIO_ANALYSIS:'',RPLAYOUT_BACKUP_HOURS:'0',LOG_LEVEL:'warn'})
const children=[],cases=[]
let owner,ownerPid,foreign,report={result:'FAIL',directory,root,hashes}
function launch(args=[],overrides={}){
  const child=spawn(join(root,'RPlayout-Server.exe'),['--server-only',...args],{cwd:root,windowsHide:true,env:{...env,...overrides},stdio:['ignore','pipe','pipe']})
  const item={child,log:'',closed:false};children.push(item)
  for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>item.log=(item.log+String(chunk)).slice(-24000))
  child.on('close',()=>{item.closed=true});return item
}
async function wait(label,check,ms=15000){const deadline=performance.now()+ms;while(performance.now()<deadline){if(await check())return;await new Promise(done=>setTimeout(done,50))}throw new Error(label)}
async function ended(item){await wait('Owned launcher must exit',()=>item.closed);return item.child.exitCode}
async function freePort(){const server=createServer();await new Promise(done=>server.listen(0,'127.0.0.1',done));const port=server.address().port;await new Promise(done=>server.close(done));return port}
const alive=pid=>{try{process.kill(pid,0);return true}catch(error){if(error.code==='ESRCH')return false;throw error}}
try{
  foreign=createServer(socket=>{socket.on('error',()=>{});socket.end('HTTP/1.1 200 OK\r\nContent-Length: 11\r\nConnection: close\r\n\r\n{"ok":true}')})
  await new Promise(done=>foreign.listen(0,'127.0.0.1',done));const occupiedPort=foreign.address().port
  const collision=launch(['--port='+occupiedPort]);assert.notEqual(await ended(collision),0);assert.match(collision.log,/porta ocupada sem identificação válida/)
  assert.equal(foreign.listening,true);assert.equal(await stat(join(root,'data/rplayout.db')).then(()=>true,()=>false),false)
  cases.push('Foreign service preserved; refused without spawning own server')
  const invalid=launch([],{PORT:'0'});assert.notEqual(await ended(invalid),0);assert.match(invalid.log,/porta deve estar entre 1 e 65535/)
  cases.push('Invalid port refused before startup')
  const port=await freePort(),base='http://127.0.0.1:'+port,identityFile=join(root,`.rplayout-launcher-${port}.json`)
  owner=launch(['--port='+port]);const started=performance.now()
  const getIdentity=async()=>{const response=await fetch(base+'/_rplayout/launcher',{signal:AbortSignal.timeout(1500)});assert.equal(response.status,200);return response.json()}
  await wait('Configured port and private identity ready',async()=>{assert.ok(!owner.closed,owner.log);try{return(await getIdentity()).application==='RPlayout'}catch{return false}})
  const identity=await getIdentity(),descriptorBytes=await readFile(identityFile),descriptor=JSON.parse(descriptorBytes)
  ownerPid=descriptor.pid;assert.equal(identity.pid,ownerPid);assert.equal(identity.port,port);assert.equal(identity.instanceId,descriptor.instanceId)
  assert.equal(descriptor.database,join(root,'data/rplayout.db'));assert.equal(descriptor.root,root)
  await wait('Launcher confirms own child, not merely TCP',()=>owner.log.includes(`RPlayout disponível em ${base}`))
  const startupElapsedMs=performance.now()-started
  assert.equal((await fetch(base+'/api/health')).status,200)
  cases.push('Actual launcher configured port; bundled Node/SQLite with hostile global Node options excluded')
  const second=launch(['--port='+port]);assert.equal(await ended(second),0);assert.match(second.log,/reutilizando a instância confirmada/)
  assert.equal((await getIdentity()).pid,ownerPid);assert.equal(owner.closed,false)
  cases.push('Second opening reuses only the same confirmed server and leaves it running')
  const otherData=join(root,'other-data');await mkdir(otherData)
  await writeFile(profileFile,JSON.stringify({...profile,dataRoot:otherData,vaultFile:join(otherData,'vault.json')}))
  try{const changed=launch(['--port='+port]);assert.notEqual(await ended(changed),0);assert.match(changed.log,/porta ocupada sem identificação válida/)}finally{await writeFile(profileFile,JSON.stringify(profile))}
  assert.equal((await getIdentity()).pid,ownerPid);cases.push('Different database profile refused without stopping original server')
  await writeFile(identityFile,JSON.stringify({...descriptor,instanceId:'00000000-0000-0000-0000-000000000000'}))
  try{const stale=launch(['--port='+port]);assert.notEqual(await ended(stale),0);assert.match(stale.log,/porta ocupada sem identificação válida/)}finally{await writeFile(identityFile,descriptorBytes)}
  assert.equal((await getIdentity()).pid,ownerPid);cases.push('Stale instance descriptor refused without exposing its identity to the service')
  for(const headers of [{origin:base},{'sec-fetch-site':'none'},{'x-forwarded-for':'192.0.2.50'}])assert.equal((await fetch(base+'/_rplayout/launcher',{headers})).status,403)
  cases.push('Browser and forwarded-origin identity reads refused')
  owner.child.kill();await ended(owner)
  await wait('Owned Windows job must stop its Node child',()=>!alive(ownerPid),10000)
  cases.push('Closing only owned launcher stops owned Node by Windows job handle; no PID-based kill')
  report={...report,result:'PASS',cases,startupElapsedMs,port,configuredPortOverride:true,serverPid:ownerPid,ownNodeStopped:true,foreignServicePreserved:foreign.listening,noEngineOrPhysicalOutput:true,fullInstallerValidated:false,cleanWindowsValidated:false}
}catch(error){report={...report,error:String(error),cases};throw error}
finally{
  for(const item of children)if(!item.closed){item.child.kill();await ended(item)}
  if(ownerPid)await wait('Owned child cleanup',()=>!alive(ownerPid),10000)
  if(foreign?.listening)await new Promise(done=>foreign.close(done))
  for(const [index,item]of children.entries())await writeFile(join(directory,`launcher-${index}.log`),item.log)
  await writeFile(join(directory,'result.json'),JSON.stringify({...report,allOwnedLaunchersClosed:children.every(item=>item.closed)},null,2))
  console.log(JSON.stringify(report))
}
