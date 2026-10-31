import type Database from 'better-sqlite3'
import {randomUUID} from 'node:crypto'
import {execFileSync} from 'node:child_process'
import {executionHostIdentity} from './execution-host.js'
import {readServerInstances,serverInstanceSignature,type ServerInstance} from '../db/server-instances.js'
import {assertStorageAdmissionOpen} from '../db/storage-admission.js'
import type {StorageMaintenance} from './storage-maintenance.js'
/** Distinguishes database storage lifetime from native child lifetime. CLOSED
 * is never proof of a stopped engine, host fence or channel promotion. */
export class ServerInstanceRegistration {
  private closed=false
  readonly id:string
  private readonly boot:string
  constructor(private readonly sqlite:Database.Database,maintenance?:StorageMaintenance){
    const row:ServerInstance={version:1,id:randomUUID(),host:executionHostIdentity(),pid:process.pid,boot:randomUUID(),phase:'OPEN',openedAt:new Date().toISOString(),closedAt:null}
    this.id=row.id
    this.boot=row.boot
    sqlite.transaction(()=>{if(maintenance)maintenance.assertHeldOn(sqlite);else assertStorageAdmissionOpen(sqlite);readServerInstances(sqlite);sqlite.prepare('INSERT INTO server_instances VALUES(?,?,?)').run(row.id,JSON.stringify(row),serverInstanceSignature(row))}).immediate()
  }
  storageClosed(){
    if(this.closed)return
    this.sqlite.transaction(()=>{
      const row=readServerInstances(this.sqlite).find(row=>row.id===this.id)
      if(!row||row.phase!=='OPEN'||row.boot!==this.boot||row.pid!==process.pid||row.host!==executionHostIdentity())throw new Error('Instância mudou; encerramento não confirmado.')
      const next:ServerInstance={...row,phase:'STORAGE_CLOSED',closedAt:new Date().toISOString()}
      const changed=this.sqlite.prepare('UPDATE server_instances SET payload=?,signature=? WHERE id=? AND signature=?').run(JSON.stringify(next),serverInstanceSignature(next),row.id,serverInstanceSignature(row))
      if(changed.changes!==1)throw new Error('Encerramento concorrente da instância não confirmado.')
    }).immediate()
    this.closed=true
  }
}
/** Windows reuses PIDs quickly; a stale OPEN row whose PID now belongs to an
 * unrelated program (browser, vMix, svchost) is not a living RPlayout. Only a
 * PID whose image is a RPlayout/Node executable stays protected. Listing
 * failure keeps every row protected (conservative). */
export type LocalImageLookup=(pids:number[])=>Map<number,string>|null
const SERVER_IMAGE=/^(rplayout[^\\/]*|node)\.exe$/i
export function windowsImageLookup(pids:number[]):Map<number,string>|null{
  if(process.platform!=='win32'||!pids.length)return null
  try{
    const out=execFileSync('tasklist',['/FO','CSV','/NH'],{encoding:'utf8',windowsHide:true,timeout:8000,maxBuffer:8*1024*1024})
    const wanted=new Set(pids),images=new Map<number,string>()
    for(const line of out.split(/\r?\n/)){
      const cols=line.match(/"([^"]*)"/g)?.map(col=>col.slice(1,-1))
      if(!cols||cols.length<2)continue
      const pid=Number(cols[1])
      if(wanted.has(pid))images.set(pid,cols[0]??'')
    }
    return images
  }catch{return null}
}
export function serverInstanceStorageStatus(sqlite:Database.Database,lookup:LocalImageLookup=windowsImageLookup):{open:number;storageClosed:number;localAbsent:number;protected:number;storageReleaseBlocked:boolean;nativeResourcesStopped:false}{
  const result={open:0,storageClosed:0,localAbsent:0,protected:0,storageReleaseBlocked:false,nativeResourcesStopped:false as const},host=executionHostIdentity()
  const occupied:number[]=[]
  const rows=readServerInstances(sqlite).map(row=>{
    if(row.phase==='STORAGE_CLOSED')result.storageClosed++;else result.open++
    // A declared storage close is not process death. Even closed/living or
    // reused PIDs stay protected until an authoritative local absence check.
    let absent=false
    if(row.host===host)try{process.kill(row.pid,0)}catch(error){absent=(error as NodeJS.ErrnoException).code==='ESRCH'}
    if(row.host===host&&!absent&&row.pid!==process.pid)occupied.push(row.pid)
    return {row,absent}
  })
  const images=occupied.length?lookup(occupied):null
  for(const {row,absent} of rows){
    // PID present but held by another program: the RPlayout that wrote the row is gone.
    const reused=!absent&&row.host===host&&row.pid!==process.pid&&images!==null&&(()=>{const image=images.get(row.pid);return image===undefined||!SERVER_IMAGE.test(image)})()
    if(absent||reused)result.localAbsent++;else result.protected++
  }
  result.storageReleaseBlocked=result.protected>0
  return result
}
