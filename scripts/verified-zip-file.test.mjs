import {test,before} from 'node:test'
import assert from 'node:assert/strict'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdtemp,readFile,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'

// Actual packager function, inert own files only. Never evaluate extracted
// script text, change policy or create the product installer for a unit test.
const workspace=fileURLToPath(new URL('..',import.meta.url)),directory=await mkdtemp(join(workspace,'scratch','verified-zip-file-'))
const ps=join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),run=promisify(execFile)
const quote=value=>"'"+value.replaceAll("'","''")+"'",helper=join(workspace,'scripts/lib/verified-zip-file.ps1')
const invoke=command=>run(ps,['-NoProfile','-NonInteractive','-Command',`$ErrorActionPreference='Stop'; . ${quote(helper)}; ${command}`],{windowsHide:true,timeout:20000,maxBuffer:128*1024})
before(async()=>{
  try{await invoke('Get-Command Write-ZipVerifiedFile -ErrorAction Stop | Out-Null')}
  catch(error){
    const blocked=/AuthorizationManager|UnauthorizedAccess|SecurityException/.test(String(error))
    await writeFile(join(directory,'result.json'),JSON.stringify({result:blocked?'BLOCKED':'FAIL',stage:'SCRIPT_LOAD',blocker:blocked?'WINDOWS_SCRIPT_AUTHORIZATION':null,error:String(error),functionalTestsCompleted:0,productArchiveCreated:false},null,2))
    throw error
  }
})
async function copy(label,bytes,{hash=createHash('sha256').update(bytes).digest('hex'),size=bytes.length,writer=false}={}){
  const source=join(directory,label+'-ação.bin'),archive=join(directory,label+'.fixture-zip'),extracted=join(directory,label+'.decoded')
  await writeFile(source,bytes)
  const entry={file:'fixture.bin',bytes:size,sha256:hash}
  await invoke(`Add-Type -AssemblyName System.IO.Compression; $owner=$null; $archiveStream=$null; $zip=$null; try { ${writer?`$owner=[IO.File]::Open(${quote(source)},[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::ReadWrite);`:''} $archiveStream=[IO.File]::Open(${quote(archive)},[IO.FileMode]::CreateNew,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None); $zip=[IO.Compression.ZipArchive]::new($archiveStream,[IO.Compression.ZipArchiveMode]::Create,$true); $entry=${quote(JSON.stringify(entry))} | ConvertFrom-Json; Write-ZipVerifiedFile $zip $entry ${quote(source)} } finally {try{if($zip){$zip.Dispose()}}finally{try{if($archiveStream){$archiveStream.Dispose()}}finally{if($owner){$owner.Dispose()}}}}; $archiveStream=[IO.File]::OpenRead(${quote(archive)}); $zip=[IO.Compression.ZipArchive]::new($archiveStream,[IO.Compression.ZipArchiveMode]::Read); try { $reader=$zip.GetEntry('fixture.bin').Open(); $output=[IO.File]::Open(${quote(extracted)},[IO.FileMode]::CreateNew); try {$reader.CopyTo($output)}finally{$reader.Dispose();$output.Dispose()} } finally{$zip.Dispose();$archiveStream.Dispose()}`)
  return readFile(extracted)
}
test('same-byte hash and ZIP decode preserve binary multi-block data plus tail',async()=>{
  const bytes=Buffer.alloc(1024*1024+37);for(let index=0;index<bytes.length;index++)bytes[index]=(index*31)%256
  assert.deepEqual(await copy('multi-block',bytes),bytes)
})
test('empty source is a real valid empty ZIP entry, not a skipped verification',async()=>{
  assert.deepEqual(await copy('empty',Buffer.alloc(0)),Buffer.alloc(0))
})
test('changed digest or size rejects the fixture before any success/decode step',async()=>{
  const bytes=Buffer.from('Own inert file, no media or runtime')
  await assert.rejects(copy('wrong-hash',bytes,{hash:'0'.repeat(64)}),/Conteudo mudou durante copia/)
  await assert.rejects(copy('wrong-size',bytes,{size:bytes.length+1}),/Conteudo mudou durante copia/)
})
test('existing writer handle is not trusted as a stable source, without killing a process',async()=>{
  await assert.rejects(copy('own-open-writer',Buffer.from('Own inert fixture'),{writer:true}))
})
