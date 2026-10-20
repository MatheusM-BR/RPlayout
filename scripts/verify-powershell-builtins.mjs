import assert from 'node:assert/strict'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {readFile,mkdtemp,mkdir,writeFile} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {createHash} from 'node:crypto'

// Test only each shipped entry point's bootstrap, not its destructive actions.
const directory=await mkdtemp(join(resolve('D:/RPlayout-builds/qa'),'powershell-builtins-'))
const known=['install-rplayout-partial.ps1','prepare-rplayout-upgrade.ps1','review-rplayout-upgrade.ps1','start-rplayout-upgrade.ps1','reconcile-rplayout-upgrade-profile.ps1','review-rplayout-rollback.ps1','restore-rplayout-backup.ps1','prepare-rplayout-rollback.ps1','start-rplayout-rollback.ps1']
const scripts=process.argv.length>2?process.argv.slice(2):known
for(const script of scripts)assert.ok(known.includes(script),'Choose only a known product entry point')
const bootstraps=[]
for(const script of scripts){
  const content=await readFile(join('scripts',script),'utf8')
  const lines=content.split(/\r?\n/).filter(line=>line.startsWith('Import-Module '))
  assert.equal(lines.length,2,script)
  for(const name of ['Utility','Management'])assert.ok(lines.some(line=>line.includes(`$PSHOME,'Modules','Microsoft.PowerShell.${name}','Microsoft.PowerShell.${name}.psd1'`)&&line.endsWith('-Force -ErrorAction Stop')),script)
  assert.ok(content.indexOf(lines[0])<content.search(/\btry\s*\{/)||script==='restore-rplayout-backup.ps1',script)
  bootstraps.push({script,source:lines.join('\n')})
}
const file=resolve('package.json'),expected=createHash('sha256').update(await readFile(file)).digest('hex').toUpperCase()
const fake=join(directory,'foreign','Microsoft.PowerShell.Utility');await mkdir(fake,{recursive:true})
await writeFile(join(fake,'Microsoft.PowerShell.Utility.psm1'),"throw 'FOREIGN_MODULE_MUST_NOT_RUN'")
const quoted=value=>"'"+value.replaceAll("'","''")+"'"
const run=promisify(execFile),results=[]
for(const scenario of ['inherited-version-path','foreign-first']){
  const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>key.toUpperCase()!=='PSMODULEPATH'))
  env.PSModulePath=(scenario==='foreign-first'?join(directory,'foreign')+';':'')+(process.env.PSModulePath??process.env.PSMODULEPATH??'')
  for(const {script,source}of bootstraps){
    const command=source+`; if((Get-FileHash -LiteralPath ${quoted(file)} -Algorithm SHA256).Hash -ne '${expected}'){throw 'HASH_MISMATCH'}; @{ok=$true;host=$PSHOME;utility=(Get-Module Microsoft.PowerShell.Utility).Path}|ConvertTo-Json -Compress`
    const value=await run(join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-NonInteractive','-Command',command],{env,windowsHide:true,timeout:30000,maxBuffer:4096})
    const report=JSON.parse(value.stdout);assert.equal(report.ok,true);assert.ok(report.utility.toLowerCase().startsWith(report.host.toLowerCase()+'\\'))
    results.push({script,scenario,...report})
  }
}
const result={result:'PASS',directory,cases:results.length,scope:'Seven product bootstraps under Windows PowerShell5 with inherited/foreign module paths, no installer/restore/upgrade execution',results}
await writeFile(join(directory,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({result:'PASS',directory,cases:results.length}))
