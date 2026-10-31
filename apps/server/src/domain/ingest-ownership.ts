import type Database from 'better-sqlite3'
import {randomUUID,createHash} from 'node:crypto'
import {drizzle} from 'drizzle-orm/better-sqlite3'
import {operatorDecisions} from '../db/schema.js'
import {resolve} from 'node:path'
import {executionHostIdentity} from './execution-host.js'
import {validScanIntent,diagnoseScan,type ScanOwnerRow} from './scan-diagnostic.js'
import {isRecoveryRehearsal} from './recovery-rehearsal.js'
export class IngestOwnership {
  private readonly owner={host:executionHostIdentity(),pid:process.pid,boot:randomUUID()}
  constructor(private readonly sqlite:Database.Database){}
  private recover(){
    if(isRecoveryRehearsal(this.sqlite))return
    const rows=this.sqlite.prepare("SELECT id,state,roots,measure,owner_host,owner_pid,owner_boot FROM ingest_batches WHERE state='RUNNING'").all() as ScanOwnerRow[]
    for(const row of rows){
      // An unknown/remote/alive/reused PID is never proof of death. Keep the
      // global scanner blocked; no concurrent catalog mutations are admitted.
      if(!diagnoseScan(row,true).canRecover)continue
      const now=new Date().toISOString()
      const changed=this.sqlite.prepare("UPDATE ingest_batches SET state='PENDING',error='Scanner anterior encerrou; retomada do mesmo lote.',owner_host=NULL,owner_pid=NULL,owner_boot=NULL,updated_at=? WHERE id=? AND state='RUNNING' AND owner_host=? AND owner_pid=? AND owner_boot=? AND roots=? AND measure=?").run(now,row.id,row.owner_host,row.owner_pid,row.owner_boot,row.roots,row.measure)
      if(changed.changes!==1)continue
      // recover() runs only inside the caller's IMMEDIATE SQLite transaction.
      // The schema encrypts this audit on the SAME connection; any failure
      // rolls back the owner release, revision and subsequent claim together.
      drizzle(this.sqlite).insert(operatorDecisions).values({id:'scan-auto-recovery:'+randomUUID(),rundownId:'@library',kind:'MEDIA_SCAN_AUTO_RECOVERED',actorUsername:null,createdAt:now,payload:{batchId:row.id,roots:JSON.parse(row.roots),measure:Boolean(row.measure),proof:'LOCAL_PROCESS_ABSENT',recoveryActor:'SCANNER_WORKER',previousOwnerFingerprint:createHash('sha256').update(JSON.stringify([row.owner_host,row.owner_pid,row.owner_boot])).digest('hex'),automaticTake:false,processKilled:false}}).run()
    }
  }
  claim(roots:readonly string[],measure:boolean,id?:string):string|null{
    return this.sqlite.transaction(()=>{
      if(isRecoveryRehearsal(this.sqlite))return null
      this.recover()
      if(this.sqlite.prepare("SELECT 1 FROM ingest_batches WHERE state='RUNNING' LIMIT 1").get())return null
      const pending=this.sqlite.prepare("SELECT id,roots,measure,owner_host,owner_pid,owner_boot FROM ingest_batches WHERE state='PENDING' ORDER BY created_at,id LIMIT 1").get() as {id:string;roots:string;measure:number;owner_host:string|null;owner_pid:number|null;owner_boot:string|null}|undefined
      if(pending&&(!validScanIntent(pending)||pending.owner_host!==null||pending.owner_pid!==null||pending.owner_boot!==null))return null
      const now=new Date().toISOString()
      if(id){
        if(!pending||pending.id!==id)return null
        let saved:unknown;try{saved=JSON.parse(pending.roots)}catch{return null}
        if(!Array.isArray(saved)||!saved.every(path=>typeof path==='string')||JSON.stringify(saved.map(path=>resolve(path)))!==JSON.stringify(roots)||Boolean(pending.measure)!==measure)return null
        this.sqlite.prepare("UPDATE ingest_batches SET state='RUNNING',error=NULL,updated_at=?,owner_host=?,owner_pid=?,owner_boot=? WHERE id=? AND state='PENDING'").run(now,this.owner.host,this.owner.pid,this.owner.boot,id)
      }else{
        if(pending)return null
        id=randomUUID()
        this.sqlite.prepare('INSERT INTO ingest_batches(id,roots,measure,state,created_at,updated_at,owner_host,owner_pid,owner_boot) VALUES(?,?,?,?,?,?,?,?,?)').run(id,JSON.stringify(roots),measure?1:0,'RUNNING',now,now,this.owner.host,this.owner.pid,this.owner.boot)
      }
      return id
    }).immediate()
  }
  pending():{id:string;roots:string[];measure:boolean}|null{
    return this.sqlite.transaction(()=>{
      if(isRecoveryRehearsal(this.sqlite))return null
      this.recover()
      if(this.sqlite.prepare("SELECT 1 FROM ingest_batches WHERE state='RUNNING' LIMIT 1").get())return null
      const row=this.sqlite.prepare("SELECT id,roots,measure,owner_host,owner_pid,owner_boot FROM ingest_batches WHERE state='PENDING' ORDER BY created_at,id LIMIT 1").get() as {id:string;roots:string;measure:number;owner_host:string|null;owner_pid:number|null;owner_boot:string|null}|undefined
      if(!row)return null
      if(!validScanIntent(row)||row.owner_host!==null||row.owner_pid!==null||row.owner_boot!==null)return null
      let roots:unknown;try{roots=JSON.parse(row.roots)}catch{return null}
      if(!Array.isArray(roots)||!roots.length||!roots.every(path=>typeof path==='string'&&path.trim()))return null
      return {id:row.id,roots,measure:Boolean(row.measure)}
    }).immediate()
  }
  finish(id:string,cancelled:boolean,error:string|null){
    this.sqlite.prepare("UPDATE ingest_batches SET state=?,error=?,updated_at=?,owner_host=NULL,owner_pid=NULL,owner_boot=NULL WHERE id=? AND state='RUNNING' AND owner_host=? AND owner_pid=? AND owner_boot=?").run(cancelled?'PENDING':error?'FAILED':'COMPLETED',cancelled?'Leitura encerrada com segurança; lote aguarda retomada.':error,new Date().toISOString(),id,this.owner.host,this.owner.pid,this.owner.boot)
  }
}
