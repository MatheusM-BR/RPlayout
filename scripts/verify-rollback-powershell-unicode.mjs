import assert from 'node:assert/strict'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdtemp,mkdir,copyFile,writeFile,readFile,stat} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {createHash} from 'node:crypto'
const directory=await mkdtemp(join(resolve('D:/RPlayout-builds/qa'),'rollback-unicode-'))
for(const path of ['runtime/node','apps/server/dist','snow ☃'])await mkdir(join(directory,path),{recursive:true})
await copyFile(resolve('scratch/r78-installed-qa-20261016/runtime/node/node.exe'),join(directory,'runtime/node/node.exe'))
const scripts=['prepare-rplayout-rollback.ps1','start-rplayout-rollback.ps1']
for(const script of scripts)await copyFile(join('scripts',script),join(directory,script))
// A deliberately inert test tool stops BEFORE snapshots, host fencing or any
// channel operation. Marker proves the actual PS5 self-integrity loop accepted
// the Unicode manifest path and reached the declared portable Node tool.
await writeFile(join(directory,'apps/server/dist/prepare-compatible-rollback.cjs'),"process.stderr.write('QA_REACHED_TOOL_☃\\n');process.exit(7)")
await writeFile(join(directory,'snow ☃/index.html'),'unicode fixture')
const files=[]
for(const file of [...scripts,'runtime/node/node.exe','apps/server/dist/prepare-compatible-rollback.cjs','snow ☃/index.html']){const bytes=await readFile(join(directory,file));files.push({file,bytes:(await stat(join(directory,file))).size,sha256:createHash('sha256').update(bytes).digest('hex')})}
await writeFile(join(directory,'package-manifest.json'),JSON.stringify({version:1,files}))
const run=promisify(execFile),results=[]
for(const script of scripts){
 const args=script.startsWith('prepare-')?['-CurrentBackup',join(directory,'current.db'),'-BaselineBackup',join(directory,'baseline.db'),'-VaultFile',join(directory,'vault.json'),'-TargetInstallation',directory,'-Destination',join(directory,'unused'),'-MediaRoot',directory]:['-Workspace',join(directory,'unused')]
 try{await run(join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',join(directory,script),...args],{windowsHide:true,timeout:30000,maxBuffer:8192});assert.fail('Inert fixture must stop before any action')}
 catch(error){assert.equal(error.code,1);assert.match(error.stderr,/QA_REACHED_TOOL_☃/);assert.doesNotMatch(error.stdout,/Integridade da edicao atual nao confirmada/);results.push({script,unicodeManifestVerified:true,inertPortableToolReached:true})}
}
await writeFile(join(directory,'result.json'),JSON.stringify({result:'PASS',scope:'PS5 Unicode self-integrity and UTF8 native diagnostics, inert tool only; not rollback execution',results},null,2));console.log(JSON.stringify({result:'PASS',directory,cases:results.length}))
