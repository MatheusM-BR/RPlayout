import {createHash,randomUUID} from 'node:crypto'
import {readFileSync} from 'node:fs'
import {execFileSync} from 'node:child_process'
import {join} from 'node:path'
let cached:string|undefined
/** Opaque OS machine identity, not a hostname which two PCs may share. If
 * unavailable, trust only this Node process lifetime; never infer remote
 * death from a local PID probe. No network lookup, new runtime or shell. */
export function executionHostIdentity():string{
  if(cached)return cached
  try{
    let identity:string|undefined
    if(process.platform==='win32'){
      const text=execFileSync(join(process.env.SystemRoot??'C:\\Windows','System32','reg.exe'),['query','HKLM\\SOFTWARE\\Microsoft\\Cryptography','/v','MachineGuid','/reg:64'],{windowsHide:true,timeout:1500,encoding:'utf8',stdio:['ignore','pipe','pipe']})
      identity=/MachineGuid\s+REG_SZ\s+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?=\s|$)/i.exec(text)?.[1]?.toLowerCase()
    }else if(process.platform==='linux'){
      const text=readFileSync('/etc/machine-id','utf8').trim();if(/^[a-f0-9]{32}$/i.test(text))identity=text.toLowerCase()
    }
    if(identity){cached=createHash('sha256').update('rplayout-execution-host:v1:'+process.platform+':'+identity).digest('hex');return cached}
  }catch{/* No guessed hostname fallback or permissive death proof. */}
  cached='unknown-process:'+randomUUID();return cached
}
