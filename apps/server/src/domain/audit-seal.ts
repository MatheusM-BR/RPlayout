import {createHash} from 'node:crypto'
import type Database from 'better-sqlite3'
import {IMMUTABLE_SCOPES} from '../db/audit-immutable.js'

/** Selagem da auditoria de segurança: cada selo cobre os eventos novos (em ordem
 * de created_at,id) e encadeia o hash do selo anterior. Hash sobre os campos
 * como estão gravados (payload ainda protegido): não depende da chave. */
const GENESIS='0'.repeat(64)
const scopes=IMMUTABLE_SCOPES.map(scope=>`'${scope}'`).join(',')
type Row={id:string;rundown_id:string;item_id:string|null;kind:string;payload:unknown;actor_username:string|null;created_at:string}
const digest=(prev:string,rows:Row[])=>{
  const hash=createHash('sha256').update(prev)
  for(const row of rows)hash.update(JSON.stringify([row.id,row.rundown_id,row.item_id,row.kind,typeof row.payload==='string'?row.payload:row.payload===null?null:String(row.payload),row.actor_username,row.created_at])).update('\n')
  return hash.digest('hex')
}
export function sealAudit(sqlite:Database.Database,now=new Date()):{sealed:number;seq:number|null}{
  return sqlite.transaction(()=>{
    const fresh=sqlite.prepare(`SELECT id,rundown_id,item_id,kind,payload,actor_username,created_at FROM operator_decisions WHERE rundown_id IN (${scopes}) AND id NOT IN (SELECT row_id FROM audit_sealed_rows) ORDER BY created_at,id`).all() as Row[]
    if(!fresh.length)return {sealed:0,seq:null}
    const last=sqlite.prepare('SELECT hash FROM audit_seals ORDER BY seq DESC LIMIT 1').get() as {hash:string}|undefined
    const hash=digest(last?.hash??GENESIS,fresh)
    const seq=Number(sqlite.prepare('INSERT INTO audit_seals(rows_count,prev_hash,hash,sealed_at) VALUES(?,?,?,?)').run(fresh.length,last?.hash??GENESIS,hash,now.toISOString()).lastInsertRowid)
    const link=sqlite.prepare('INSERT INTO audit_sealed_rows(row_id,seal_seq) VALUES(?,?)')
    for(const row of fresh)link.run(row.id,seq)
    return {sealed:fresh.length,seq}
  }).immediate()
}
export interface AuditIntegrity{ok:boolean;seals:number;sealedRows:number;unsealedRows:number;firstBrokenSeal:number|null;problem:string|null}
export function verifyAudit(sqlite:Database.Database):AuditIntegrity{
  const seals=sqlite.prepare('SELECT seq,rows_count,prev_hash,hash FROM audit_seals ORDER BY seq').all() as Array<{seq:number;rows_count:number;prev_hash:string;hash:string}>
  const result=(extra:Partial<AuditIntegrity>):AuditIntegrity=>({ok:false,seals:seals.length,sealedRows:0,unsealedRows:0,firstBrokenSeal:null,problem:null,...extra})
  let prev=GENESIS,sealedRows=0
  for(const seal of seals){
    if(seal.prev_hash!==prev)return result({firstBrokenSeal:seal.seq,problem:'Cadeia de selos quebrada (selo removido ou trocado).'})
    const ids=(sqlite.prepare('SELECT row_id FROM audit_sealed_rows WHERE seal_seq=?').all(seal.seq) as Array<{row_id:string}>).map(row=>row.row_id)
    if(ids.length!==seal.rows_count)return result({firstBrokenSeal:seal.seq,problem:'Número de eventos do selo diverge (evento removido do selo).'})
    const rows=sqlite.prepare(`SELECT id,rundown_id,item_id,kind,payload,actor_username,created_at FROM operator_decisions WHERE id IN (${ids.map(()=>'?').join(',')}) ORDER BY created_at,id`).all(...ids) as Row[]
    if(rows.length!==ids.length)return result({firstBrokenSeal:seal.seq,problem:'Evento selado foi apagado.'})
    if(digest(prev,rows)!==seal.hash)return result({firstBrokenSeal:seal.seq,problem:'Evento selado foi alterado.'})
    prev=seal.hash;sealedRows+=rows.length
  }
  const unsealed=(sqlite.prepare(`SELECT COUNT(*) AS n FROM operator_decisions WHERE rundown_id IN (${scopes}) AND id NOT IN (SELECT row_id FROM audit_sealed_rows)`).get() as {n:number}).n
  return {ok:true,seals:seals.length,sealedRows,unsealedRows:unsealed,firstBrokenSeal:null,problem:null}
}
