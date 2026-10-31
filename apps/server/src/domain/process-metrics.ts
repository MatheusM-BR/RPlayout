import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile } from 'node:fs/promises'
const run = promisify(execFile)
export interface ProcessCounter { cpuTimeMs:number|null; memoryBytes:number|null
  /** CPU do processo entre duas leituras (100% = um núcleo inteiro). Ausente na primeira leitura. */
  cpuPercent?:number|null }
/** Linux: /proc/<pid>/stat (utime+stime em ticks; CLK_TCK=100 em todas as
 * arquiteturas suportadas pelo kernel atual) e VmRSS de /proc/<pid>/status. */
export function parseProcStat(stat:string,status:string,clockTicks=100):ProcessCounter {
  const rest=stat.slice(stat.lastIndexOf(')')+2).trim().split(/\s+/)
  const utime=Number(rest[11]),stime=Number(rest[12])
  const rss=/^VmRSS:\s+(\d+)\s*kB/m.exec(status)
  return {cpuTimeMs:Number.isFinite(utime)&&Number.isFinite(stime)&&utime>=0&&stime>=0?Math.round((utime+stime)*1000/clockTicks):null,
    memoryBytes:rss?Number(rss[1])*1024:null}
}
const collectLinux=async(pids:readonly number[])=>{
  const samples=new Map<number,ProcessCounter>()
  await Promise.all(pids.map(async pid=>{
    try{samples.set(pid,parseProcStat(await readFile(`/proc/${pid}/stat`,'utf8'),await readFile(`/proc/${pid}/status`,'utf8')))}catch{/* processo encerrou entre a lista e a leitura */}
  }))
  return samples
}
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
  if(process.platform==='linux') return collectLinux(pids)
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
  /** Última leitura de CPU acumulada por PID, para derivar o percentual. */
  private previousCpu=new Map<number,{cpuTimeMs:number;at:number}>()
  constructor(private readonly query=collect,private readonly ttlMs=2000) {}
  latest(input:readonly number[]) {
    const pids=[...new Set(input.filter(pid=>Number.isSafeInteger(pid)&&pid>0))].sort((a,b)=>a-b),key=pids.join(',')
    if(!pids.length) return Promise.resolve({samples:new Map<number,ProcessCounter>(),error:null})
    if(this.cached?.key===key && Date.now()-this.cached.at<this.ttlMs) return Promise.resolve(this.cached)
    const pending=this.pending.get(key)
    if(pending) return pending
    const work=this.query(pids).then(samples=>({samples:new Map([...samples].filter(([pid])=>pids.includes(pid))),error:null as string|null}))
      .catch(()=>({samples:new Map<number,ProcessCounter>(),error:'Contadores de processo indisponíveis; estado do engine continua disponível.'}))
      .then(result=>{
        const now=Date.now()
        for(const [pid,sample] of result.samples){
          const previous=this.previousCpu.get(pid)
          if(sample.cpuTimeMs!==null){
            if(previous&&now>previous.at&&sample.cpuTimeMs>=previous.cpuTimeMs)sample.cpuPercent=Math.round((sample.cpuTimeMs-previous.cpuTimeMs)/(now-previous.at)*1000)/10
            this.previousCpu.set(pid,{cpuTimeMs:sample.cpuTimeMs,at:now})
          }
        }
        if(this.previousCpu.size>512)for(const pid of [...this.previousCpu.keys()].slice(0,this.previousCpu.size-512))this.previousCpu.delete(pid)
        this.cached={...result,key,at:now};return result})
      .finally(()=>this.pending.delete(key))
    this.pending.set(key,work)
    return work
  }
}
