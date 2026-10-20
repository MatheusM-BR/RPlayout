import {test,before} from 'node:test'
import assert from 'node:assert/strict'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdtemp,mkdir,writeFile,readFile,symlink} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'

const workspace=fileURLToPath(new URL('..',import.meta.url)),root=await mkdtemp(join(workspace,'scratch','build-source-roots-'))
const ps=join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),run=promisify(execFile)
const quote=value=>"'"+value.replaceAll("'","''")+"'"
const required=['server.cjs','schedule-planner.cjs','ha-witness.cjs','restore-backup.cjs','review-restored.cjs','recover-restored-reservation.cjs','storage-service.cjs','storage-bridge.cjs','migrate-restored.cjs','reconcile-upgrade-profile.cjs','review-rollback.cjs','ha-return-review-worker.cjs','rollback-contract.cjs','prepare-compatible-rollback.cjs']
async function server(name,missing){const directory=join(root,name);await mkdir(directory,{recursive:true});for(const file of required)if(file!==missing)await writeFile(join(directory,file),'// inert build-selection fixture');return directory}
async function web(name,html='<script type="module" src="/assets/novo.js"></script><link rel="stylesheet" href="/assets/novo.css">',inventory='{}'){
  const directory=join(root,name);await mkdir(join(directory,'assets'),{recursive:true});await mkdir(join(directory,'third-party'))
  for(const [file,value]of Object.entries({'index.html':html,'build.json':'{}','third-party/inventory.json':inventory,'assets/novo.js':'// inert fixture','assets/novo.css':'/* inert fixture */'}))await writeFile(join(directory,file),value)
  return directory
}
async function select(folder,override='',use=true,base=root){
  const command=`$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); . ${quote(join(workspace,'scripts/lib/build-source-roots.ps1'))}; ConvertTo-Json -Depth 4 -InputObject @(Get-RPlayoutBuildFiles -WorkspaceRoot ${quote(base)} -Folder ${quote(folder)} -OverrideDirectory ${quote(override)} -UseCurrentBuilds:$${use?'true':'false'}) -Compress`
  const output=await run(ps,['-NoProfile','-NonInteractive','-Command',command],{windowsHide:true,timeout:15000,maxBuffer:256*1024})
  return JSON.parse(output.stdout)
}
async function selectNative(name,override='',use=true,base=root){
  const command=`$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); . ${quote(join(workspace,'scripts/lib/build-source-roots.ps1'))}; Get-RPlayoutNativeBuildFile -WorkspaceRoot ${quote(base)} -Name ${quote(name)} -OverrideFile ${quote(override)} -UseCurrentBuilds:$${use?'true':'false'} | ConvertTo-Json -Compress`
  return JSON.parse((await run(ps,['-NoProfile','-NonInteractive','-Command',command],{windowsHide:true,timeout:15000,maxBuffer:256*1024})).stdout)
}
function inertPe(marker=1){
  // Header fixture only. Never execute; no code, imports or runtime proof.
  const bytes=Buffer.alloc(432);bytes.writeUInt16LE(0x5a4d);bytes.writeUInt32LE(0x80,0x3c)
  bytes.writeUInt32LE(0x4550,0x80);bytes.writeUInt16LE(0x8664,0x84);bytes.writeUInt16LE(1,0x86)
  bytes.writeUInt16LE(240,0x94);bytes.writeUInt16LE(2,0x96);bytes.writeUInt16LE(0x20b,0x98);bytes[431]=marker
  return bytes
}
before(async()=>{
  // One read-only preflight, not eight misleading business assertion failures
  // if Windows refuses to load our script. Never change execution policy here.
  try{await select('apps/web/dist',join(workspace,'scratch/host-history-r88-web-native-diagnostic-20261018'))}
  catch(error){
    const blocked=/AuthorizationManager|UnauthorizedAccess|SecurityException/.test(String(error))
    await writeFile(join(root,'result.json'),JSON.stringify({result:blocked?'BLOCKED':'FAIL',stage:'READ_ONLY_PREFLIGHT',blocker:blocked?'WINDOWS_SCRIPT_AUTHORIZATION':null,error:String(error),functionalTestsCompleted:0,zipCreated:false,dWrites:false},null,2))
    throw error
  }
})
test('default source mapping retains packaged destinations',async()=>{
  await server('apps/server/dist');await web('apps/web/dist')
  for(const folder of ['apps/server/dist','apps/web/dist']){const files=await select(folder);assert.ok(files.length);assert.ok(files.every(entry=>entry.file.startsWith(folder+'/')&&entry.source.startsWith(join(root,folder))))}
})
test('explicit Unicode web root never mixes in conventional old assets',async()=>{
  const directory=await web('isolado São José Çãó'),files=await select('apps/web/dist',directory)
  assert.ok(files.some(entry=>entry.file==='apps/web/dist/assets/novo.js'));assert.ok(files.every(entry=>entry.source.startsWith(directory+'\\')))
  assert.ok(files.every(entry=>!entry.source.startsWith(join(root,'apps/web/dist')+'\\')))
})
test('external sources require observed-build switch and absolute path',async()=>{
  const directory=await web('switch')
  await assert.rejects(select('apps/web/dist',directory,false),/Build externo/)
  await assert.rejects(select('apps/web/dist','relative-web'),/Build externo/)
})
test('incomplete server source is refused rather than merged from old dist',async()=>{
  const directory=await server('incomplete','storage-service.cjs')
  await assert.rejects(select('apps/server/dist',directory),/Build incompleto/)
})
test('HTML pointing to an asset from another build is refused',async()=>{
  const directory=await web('stale','<script src="/assets/antigo.js"></script><link href="/assets/novo.css">')
  await assert.rejects(select('apps/web/dist',directory),/Asset referenciado/)
})
test('malformed metadata, missing script/style and path traversal are refused',async()=>{
  await assert.rejects(select('apps/web/dist',await web('bad-json',undefined,'{')),/ConvertFrom-Json|Invalid|invalido|inválido|invalida|inválida|objeto|Objeto/)
  await assert.rejects(select('apps/web/dist',await web('no-entry','<html></html>')),/HTML sem entradas/)
  await assert.rejects(select('apps/web/dist',await web('traversal','<script src="/assets/%2e%2e/%2e%2e/outside.js"></script>')),/Referencia web fora/)
})
test('junctions are refused before traversing a referenced directory',async()=>{
  const directory=await web('linked'),outside=await web('outside-own-fixture')
  await symlink(outside,join(directory,'external'),'junction')
  await assert.rejects(select('apps/web/dist',directory),/junction\/symlink/)
})
test('observed real isolated builds select the new server and exact HTML assets',async()=>{
  // Web remains the prior verified root: the new diagnostic UI build is NOT
  // qualified. This selector fixture is not integrated package approval.
  const roots={server:join(workspace,'scratch/host-history-r88-manual-failover-20261019'),web:join(workspace,'scratch/host-history-r88-web-native-diagnostic-20261018')}
  const files=[...await select('apps/server/dist',roots.server),...await select('apps/web/dist',roots.web)]
  const wanted={'apps/server/dist/server.cjs':'4e3ff51c73b0647d7ac4418b453873b5bb9543e417aa79ce5a3707297e12d85d','apps/web/dist/assets/index-DED2jcbR.js':'efdc03ff397c91dfdd60d6e3836dd91e3df1f690510874bfb374a05e752bdfa1'}
  for(const [file,hash]of Object.entries(wanted)){const item=files.find(entry=>entry.file===file);assert.ok(item);assert.equal(createHash('sha256').update(await readFile(item.source)).digest('hex'),hash)}
  const source=await readFile(join(workspace,'scripts/build-streamed-partial-installer.ps1'),'utf8')
  assert.ok(source.includes("[string]$WebBuildDirectory=''")&&source.includes("Get-RPlayoutBuildFiles -WorkspaceRoot"))
})
test('native core defaults and explicit Unicode guard use exact selected bytes, never silently fall back',async()=>{
  const core=join(root,'apps/engine/target/release');await mkdir(core,{recursive:true})
  for(const name of ['rplayout-engine.exe','rplayout-host-guard.exe']){
    const bytes=inertPe();await writeFile(join(core,name),bytes)
    assert.deepEqual(await selectNative(name),{file:'apps/engine/target/release/'+name,source:join(core,name),sha256:createHash('sha256').update(bytes).digest('hex').toUpperCase()})
  }
  const file=join(root,'Guarda ação Çãó.exe'),bytes=inertPe(2);await writeFile(file,bytes)
  assert.deepEqual(await selectNative('rplayout-host-guard.exe',file),{file:'apps/engine/target/release/rplayout-host-guard.exe',source:file,sha256:createHash('sha256').update(bytes).digest('hex').toUpperCase()})
  await assert.rejects(selectNative('rplayout-host-guard.exe',join(root,'missing.exe')))
  await assert.rejects(selectNative('rplayout-host-guard.exe',file,false),/compilacao observada/)
  await assert.rejects(selectNative('rplayout-host-guard.exe','relative.exe'),/arquivo absoluto/)
})
test('native selection refuses truncated, non-PE, x86, DLL and absent section headers before packaging',async()=>{
  const variants=[Buffer.alloc(10),Buffer.alloc(432)]
  const x86=inertPe();x86.writeUInt16LE(0x14c,0x84);variants.push(x86)
  const dll=inertPe();dll.writeUInt16LE(0x2002,0x96);variants.push(dll)
  const section=inertPe();section.writeUInt16LE(10,0x86);variants.push(section)
  const offset=inertPe();offset.writeUInt32LE(0xffffffff,0x3c);variants.push(offset)
  for(const [index,bytes] of variants.entries()){
    const file=join(root,`not-executed-bad-native-${index}.exe`);await writeFile(file,bytes)
    await assert.rejects(selectNative('rplayout-host-guard.exe',file))
  }
})
test('native binary cannot traverse a real junction, even when a valid file exists behind it',async()=>{
  const outside=join(root,'native-outside'),alias=join(root,'native-link');await mkdir(outside)
  const bytes=inertPe();await writeFile(join(outside,'guard.exe'),bytes)
  await symlink(outside,alias,'junction')
  await assert.rejects(selectNative('rplayout-host-guard.exe',join(alias,'guard.exe')),/junction\/symlink/)
})

process.once('beforeExit',async()=>{await writeFile(join(root,'scope.json'),JSON.stringify({scope:'Read-only build-root selection and inert C: fixtures; no ZIP, install, runtime or D: writes',testDirectory:root},null,2))})
