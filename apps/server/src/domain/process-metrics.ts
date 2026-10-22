import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
const run = promisify(execFile)
export interface ProcessCounter { cpuTimeMs:number|null; memoryBytes:number|null }
export function parseProcessCounters(text:string):Map<number,ProcessCounter> {
  const value:unknown=JSON.parse(text.trim() || '[]'), rows=Array.isArray(value)?value:[value]
  const samples=new Map<number,ProcessCounter>()
  for(const entry of rows) {
    if (!entry || typeof entry!=='object') continue
    const row=entry as {Id?:unknown;CPU?:unknown;WorkingSet64?:unknown}
    if(typeof row.Id!=='number' || !Number.isSafeInteger(row.Id) || row.Id<=0) continue
    samples.set(row.Id,{cpuTimeMs:typeof row.CPU==='number' && Number.isFinite(row.CPU) && row.CPU>=0 ? Math.round(row.CPU*1000):null,
      memoryBytes:typeof row.WorkingSet64==='number' && Number.isSafeInteger(row.WorkingSet64) && row.WorkingSet64>=0 ? row.WorkingSet64:null})
  }
  return samples
}
const collect = async(pids:readonly number[]) => {
  if(process.platform!=='win32') return new Map<number,ProcessCounter>()
  const {stdout}=await run('powershell.exe',['-NoProfile','-NonInteractive','-Command',
    `Get-Process -Id @(${pids.join(',')}) -ErrorAction SilentlyContinue | Select-Object Id,CPU,WorkingSet64 | ConvertTo-Json -Compress`],
    {timeout:1500,windowsHide:true,maxBuffer:1024*1024})
  return parseProcessCounters(stdout)
}
/** One bounded OS request shared by browser polls. A timeout omits counters;
 * it never delays the process/engine state behind two unbounded shell calls. */
export class ProcessMetrics {
  private cached:{key:string;at:number;samples:Map<number,ProcessCounter>;error:string|null}|null=null
  private pending=new Map<string,Promise<{samples:Map<number,ProcessCounter>;error:string|null}>>()
  constructor(private readonly query=collect,private readonly ttlMs=2000) {}
  latest(input:readonly number[]) {
    const pids=[...new Set(input.filter(pid=>Number.isSafeInteger(pid)&&pid>0))].sort((a,b)=>a-b),key=pids.join(',')
    if(!pids.length) return Promise.resolve({samples:new Map<number,ProcessCounter>(),error:null})
    if(this.cached?.key===key && Date.now()-this.cached.at<this.ttlMs) return Promise.resolve(this.cached)
    const pending=this.pending.get(key)
    if(pending) return pending
    const work=this.query(pids).then(samples=>({samples:new Map([...samples].filter(([pid])=>pids.includes(pid))),error:null as string|null}))
      .catch(()=>({samples:new Map<number,ProcessCounter>(),error:'Contadores de processo indisponíveis; estado do engine continua disponível.'}))
      .then(result=>{this.cached={...result,key,at:Date.now()};return result})
      .finally(()=>this.pending.delete(key))
    this.pending.set(key,work)
    return work
  }
}
